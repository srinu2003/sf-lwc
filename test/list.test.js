import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSource, normalizeSpec } from '../src/source.js';
import { listComponents } from '../src/list.js';
import { loadManifest } from '../src/resolve.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('normalizeSpec normalizes GitHub URLs, git SSH, and shorthands', () => {
  assert.equal(normalizeSpec('https://github.com/svierk/awesome-lwc-collection.git'), 'svierk/awesome-lwc-collection');
  assert.equal(normalizeSpec('https://github.com/svierk/awesome-lwc-collection'), 'svierk/awesome-lwc-collection');
  assert.equal(normalizeSpec('git@github.com:svierk/awesome-lwc-collection.git'), 'svierk/awesome-lwc-collection');
  assert.equal(normalizeSpec('github:svierk/awesome-lwc-collection'), 'svierk/awesome-lwc-collection');
  assert.equal(normalizeSpec('https://github.com/owner/repo/tree/develop'), 'owner/repo@develop');
  assert.equal(normalizeSpec('./local/path'), './local/path');
});

test('listComponents reads components from local SFDX project', async () => {
  const fixtureRepo = path.join(root, 'fixtures', 'sfdx-repo');
  const source = createSource(fixtureRepo);
  const components = await listComponents(source, fixtureRepo);
  assert.deepEqual(
    components.map((component) => component.name),
    ['dataTable', 'modal', 'toastUtils']
  );
  assert.equal(components[0].version, '1.0.0');
});

test('listComponents auto-discovers components from direct SFDX directory without manifest.json', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'sf-sfdx-test-'));
  try {
    await writeFile(
      path.join(tmp, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );
    const lwcDir = path.join(tmp, 'force-app/main/default/lwc/customWidget');
    await mkdir(lwcDir, { recursive: true });
    await writeFile(path.join(lwcDir, 'customWidget.js'), 'export default class CustomWidget {}');
    await writeFile(path.join(lwcDir, 'customWidget.html'), '<template>Hello</template>');
    await writeFile(
      path.join(lwcDir, 'customWidget.js-meta.xml'),
      '<?xml version="1.0" encoding="UTF-8"?><LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>61.0</apiVersion><isExposed>true</isExposed><description>Custom SFDX Widget</description></LightningComponentBundle>'
    );

    const source = createSource(tmp);
    const components = await listComponents(source, tmp);
    assert.equal(components.length, 1);
    assert.equal(components[0].name, 'customWidget');
    assert.equal(components[0].version, '1.0.0');

    const manifest = await loadManifest(source, 'customWidget');
    assert.equal(manifest.name, 'customWidget');
    assert.equal(manifest.apiVersion, '61.0');
    assert.equal(manifest.description, 'Custom SFDX Widget');
    assert.deepEqual(manifest.files.sort(), [
      'lwc/customWidget/customWidget.html',
      'lwc/customWidget/customWidget.js',
      'lwc/customWidget/customWidget.js-meta.xml'
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('cli list command prints component details', async () => {
  const fixtureRepo = path.join(root, 'fixtures', 'sfdx-repo');
  const { stdout } = await execFileAsync('node', ['bin/sf-lwc.js', 'list', '--from', fixtureRepo], { cwd: root });
  assert.match(stdout, /Registry:\s+/);
  assert.match(stdout, /- dataTable@1\.0\.0/);
  assert.match(stdout, /- modal@1\.0\.0/);
  assert.match(stdout, /- toastUtils@1\.0\.0/);
});

test('cli ls alias works', async () => {
  const fixtureRepo = path.join(root, 'fixtures', 'sfdx-repo');
  const { stdout } = await execFileAsync('node', ['bin/sf-lwc.js', 'ls', '--from', fixtureRepo], { cwd: root });
  assert.match(stdout, /- dataTable@1\.0\.0/);
  assert.match(stdout, /- modal@1\.0\.0/);
});
