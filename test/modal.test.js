import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validate, loadManifest } from '../src/resolve.js';
import { createSource } from '../src/source.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

test('modal manifest is valid conforming to schema and validate()', async () => {
  const source = createSource(root);
  const manifest = await loadManifest(source, 'modal');

  assert.equal(manifest.name, 'modal');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.apiVersion, '62.0');
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.files.sort(), [
    'lwc/modal/modal.css',
    'lwc/modal/modal.html',
    'lwc/modal/modal.js',
    'lwc/modal/modal.js-meta.xml'
  ]);
  assert.equal(manifest.labels.length, 2);
  assert.equal(manifest.labels[0].fullName, 'Modal_CloseTitle');
  assert.equal(manifest.labels[1].fullName, 'Modal_DefaultCancel');

  // Throws if invalid
  validate(manifest, 'modal');
});

test('cli list includes modal in available components', async () => {
  const { stdout } = await execFileAsync('node', [BIN, 'list', '--from', root]);
  assert.match(stdout, /- modal@1\.0\.0/);
  assert.match(stdout, /Accessible, SLDS-compliant modal dialog component/);
});

test('modal component can be installed and removed cleanly via sf-lwc add and remove', async () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-modal-project-'));
  const pkgDefault = path.join(tmpProject, 'force-app', 'main', 'default');

  try {
    fs.mkdirSync(pkgDefault, { recursive: true });
    fs.writeFileSync(
      path.join(tmpProject, 'sfdx-project.json'),
      JSON.stringify(
        {
          packageDirectories: [{ path: 'force-app', default: true }],
          sourceApiVersion: '62.0'
        },
        null,
        2
      )
    );

    // 1. Add modal
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]);

    // Verify files installed
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.html')), 'modal.html installed');
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')), 'modal.js installed');
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.css')), 'modal.css installed');
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js-meta.xml')), 'modal.js-meta.xml installed');

    // Verify labels merged
    const labelsPath = path.join(pkgDefault, 'labels', 'CustomLabels.labels-meta.xml');
    assert.ok(fs.existsSync(labelsPath), 'CustomLabels file created');
    const labelsXml = fs.readFileSync(labelsPath, 'utf-8');
    assert.match(labelsXml, /<fullName>Modal_CloseTitle<\/fullName>/);
    assert.match(labelsXml, /<value>Close<\/value>/);
    assert.match(labelsXml, /<fullName>Modal_DefaultCancel<\/fullName>/);
    assert.match(labelsXml, /<value>Cancel<\/value>/);

    // Verify lockfile
    const lockPath = path.join(tmpProject, 'sf-lwc.lock.json');
    assert.ok(fs.existsSync(lockPath), 'Lockfile exists');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    assert.ok(lock.components.modal);
    assert.equal(lock.components.modal.version, '1.0.0');

    // 2. Remove modal
    await execFileAsync('node', [BIN, 'remove', 'modal', '--cwd', tmpProject]);

    // Verify files removed
    assert.ok(!fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.html')));
    assert.ok(!fs.existsSync(path.join(pkgDefault, 'lwc', 'modal')));

    // Verify labels pruned
    const labelsAfter = fs.readFileSync(labelsPath, 'utf-8');
    assert.doesNotMatch(labelsAfter, /<fullName>Modal_CloseTitle<\/fullName>/);
    assert.doesNotMatch(labelsAfter, /<fullName>Modal_DefaultCancel<\/fullName>/);

    // Verify lockfile removed when empty
    assert.ok(!fs.existsSync(lockPath));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});
