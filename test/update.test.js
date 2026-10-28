import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareSemver, update } from '../src/update.js';
import { LOCK_FILE } from '../src/install.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_REPO = path.join(root, 'fixtures', 'sfdx-repo');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

test('compareSemver accurately compares versions', () => {
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.1.0', '1.0.0'), 1);
  assert.equal(compareSemver('1.0.0', '1.1.0'), -1);
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
});

test('update skips already up-to-date components unless force is set', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-update-'));
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

    // Run update without force -> upToDate
    const res = await update({ from: FIXTURE_REPO, cwd: projectRoot });
    assert.deepEqual(res.updated, []);
    assert.deepEqual(res.upToDate, ['modal']);

    // Run update with force -> updated
    const resForce = await update({ from: FIXTURE_REPO, cwd: projectRoot, force: true });
    assert.equal(resForce.updated.length, 1);
    assert.equal(resForce.updated[0].name, 'modal');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('update upgrades outdated component in lockfile and writes new files', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-update-'));
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

    // Initial simulated install with older version (0.9.0)
    await writeFile(
      path.join(projectRoot, LOCK_FILE),
      JSON.stringify(
        {
          components: {
            'toast-utils': {
              version: '0.9.0',
              files: ['lwc/toastUtils/toastUtils.js', 'lwc/toastUtils/toastUtils.js-meta.xml']
            }
          }
        },
        null,
        2
      )
    );
    await mkdir(path.join(pkgDefault, 'lwc', 'toastUtils'), { recursive: true });
    await writeFile(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js'), '// old version\n');

    // 1. Dry run
    const dryRes = await update({ names: ['toast-utils'], from: FIXTURE_REPO, cwd: projectRoot, dryRun: true });
    assert.equal(dryRes.updated.length, 1);
    assert.equal(dryRes.updated[0].from, '0.9.0');
    assert.equal(dryRes.updated[0].to, '1.0.0');

    // File should not have changed
    const contentBefore = await readFile(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js'), 'utf8');
    assert.equal(contentBefore, '// old version\n');

    // 2. Real update via CLI
    const { stdout } = await execFileAsync('node', [
      BIN,
      'update',
      'toast-utils',
      '--from',
      FIXTURE_REPO,
      '--cwd',
      projectRoot
    ]);
    assert.match(stdout, /Done\./);

    // Lockfile should now record 1.0.0
    const lock = JSON.parse(await readFile(path.join(projectRoot, LOCK_FILE), 'utf8'));
    assert.equal(lock.components['toast-utils'].version, '1.0.0');

    // File content should be updated
    const contentAfter = await readFile(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js'), 'utf8');
    assert.notEqual(contentAfter, '// old version\n');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
