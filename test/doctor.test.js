import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { doctor } from '../src/doctor.js';
import { LOCK_FILE } from '../src/install.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_REPO = path.join(root, 'fixtures', 'sfdx-repo');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

test('doctor fails gracefully on non-DX directories', async () => {
  const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-doctor-empty-'));
  try {
    const res = await doctor({ cwd: emptyDir });
    assert.equal(res.ok, false);
    assert.ok(res.checks.some(c => c.name === 'sfdx-project.json' && c.status === 'fail'));
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});

test('doctor passes on clean DX project with valid lockfile and custom labels', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-doctor-valid-'));
  const pkgDefault = path.join(projectRoot, 'force-app', 'main', 'default');

  try {
    await mkdir(pkgDefault, { recursive: true });
    await writeFile(
      path.join(projectRoot, 'sfdx-project.json'),
      JSON.stringify(
        {
          packageDirectories: [{ path: 'force-app', default: true }],
          sourceApiVersion: '62.0'
        },
        null,
        2
      )
    );

    // Install modal
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', FIXTURE_REPO, '--cwd', projectRoot]);

    const res = await doctor({ cwd: projectRoot });
    assert.equal(res.ok, true);
    assert.ok(res.checks.some(c => c.name === 'sfdx-project.json' && c.status === 'pass'));
    assert.ok(res.checks.some(c => c.name === 'file-integrity' && c.status === 'pass'));
    assert.ok(res.checks.some(c => c.name === 'CustomLabels' && c.status === 'pass'));

    // CLI doctor execution
    const { stdout } = await execFileAsync('node', [BIN, 'doctor', '--cwd', projectRoot]);
    assert.match(stdout, /All health checks passed! Project is ready\./);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('doctor detects missing tracked files from lockfile', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-doctor-corrupt-'));
  const pkgDefault = path.join(projectRoot, 'force-app', 'main', 'default');

  try {
    await mkdir(pkgDefault, { recursive: true });
    await writeFile(
      path.join(projectRoot, 'sfdx-project.json'),
      JSON.stringify(
        {
          packageDirectories: [{ path: 'force-app', default: true }],
          sourceApiVersion: '62.0'
        },
        null,
        2
      )
    );

    // Write lockfile declaring missing files
    await writeFile(
      path.join(projectRoot, LOCK_FILE),
      JSON.stringify(
        {
          components: {
            'ghost-comp': {
              version: '1.0.0',
              files: ['lwc/ghostComp/ghostComp.js']
            }
          }
        },
        null,
        2
      )
    );

    const res = await doctor({ cwd: projectRoot });
    assert.equal(res.ok, false);
    assert.ok(res.checks.some(c => c.name === 'file:ghost-comp/lwc/ghostComp/ghostComp.js' && c.status === 'fail'));

    // CLI doctor exits with code 1
    await assert.rejects(
      execFileAsync('node', [BIN, 'doctor', '--cwd', projectRoot]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stdout, /Issues detected\. Please review the failures above\./);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
