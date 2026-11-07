import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSource } from '../src/source.js';
import { loadManifest, resolve, verifySourceProject } from '../src/resolve.js';

test('verifySourceProject throws error when sfdx-project.json is missing in local source', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-sfdx-src-'));
  try {
    const source = createSource(tmpDir);
    await assert.rejects(
      async () => verifySourceProject(source),
      /is not a valid Salesforce DX project \(missing sfdx-project\.json\)/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadManifest throws error when component does not exist in local source', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-missing-comp-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );
    const source = createSource(tmpDir);
    await assert.rejects(
      async () => loadManifest(source, 'nonExistentWidget'),
      /Component "nonExistentWidget" not found in repository/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('component with explicit .sf-lwc manifest loads all packaged files deterministically', async () => {
  const tmpSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-manifest-source-'));
  try {
    // 1. Setup SFDX source project
    fs.writeFileSync(
      path.join(tmpSource, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );

    // 2. Setup LWC component
    const lwcDir = path.join(tmpSource, 'force-app', 'main', 'default', 'lwc', 'myAgent');
    fs.mkdirSync(lwcDir, { recursive: true });
    fs.writeFileSync(path.join(lwcDir, 'myAgent.html'), '<template><div>Agent</div></template>');
    fs.writeFileSync(path.join(lwcDir, 'myAgent.js'), 'export default class MyAgent {}');
    fs.writeFileSync(
      path.join(lwcDir, 'myAgent.js-meta.xml'),
      `<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
         <apiVersion>62.0</apiVersion>
       </LightningComponentBundle>`
    );

    // 3. Setup explicit manifest in .sf-lwc/myAgent.json
    const dotSfLwcDir = path.join(tmpSource, '.sf-lwc');
    fs.mkdirSync(dotSfLwcDir, { recursive: true });
    const manifestData = {
      name: 'myAgent',
      version: '1.0.0',
      description: 'Packaged agent component',
      apiVersion: '62.0',
      files: [
        'lwc/myAgent/myAgent.js',
        'lwc/myAgent/myAgent.html',
        'lwc/myAgent/myAgent.js-meta.xml',
        'classes/AgentController.cls',
        'classes/AgentController.cls-meta.xml'
      ],
      dependencies: [],
      labels: []
    };
    fs.writeFileSync(path.join(dotSfLwcDir, 'myAgent.json'), JSON.stringify(manifestData, null, 2));

    // 4. Load manifest
    const source = createSource(tmpSource);
    const manifest = await loadManifest(source, 'myAgent');

    assert.equal(manifest.name, 'myAgent');
    assert.deepEqual(manifest.files.sort(), manifestData.files.sort());
  } finally {
    fs.rmSync(tmpSource, { recursive: true, force: true });
  }
});

test('unmanifested component synthesizes clean root LWC bundle without guessing unverified dependencies', async () => {
  const tmpSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-unmanifested-source-'));
  try {
    fs.writeFileSync(
      path.join(tmpSource, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );

    const lwcDir = path.join(tmpSource, 'force-app', 'main', 'default', 'lwc', 'rawWidget');
    fs.mkdirSync(lwcDir, { recursive: true });
    fs.writeFileSync(path.join(lwcDir, 'rawWidget.html'), '<template><div>Raw</div></template>');
    fs.writeFileSync(path.join(lwcDir, 'rawWidget.js'), 'export default class RawWidget {}');
    fs.writeFileSync(
      path.join(lwcDir, 'rawWidget.js-meta.xml'),
      `<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
         <apiVersion>61.0</apiVersion>
         <description>Raw Widget Description</description>
       </LightningComponentBundle>`
    );

    const source = createSource(tmpSource);
    const manifest = await loadManifest(source, 'rawWidget');

    assert.equal(manifest.name, 'rawWidget');
    assert.equal(manifest.apiVersion, '61.0');
    assert.equal(manifest.description, 'Raw Widget Description');
    assert.deepEqual(manifest.files.sort(), [
      'lwc/rawWidget/rawWidget.html',
      'lwc/rawWidget/rawWidget.js',
      'lwc/rawWidget/rawWidget.js-meta.xml'
    ]);
    assert.deepEqual(manifest.dependencies, []);
  } finally {
    fs.rmSync(tmpSource, { recursive: true, force: true });
  }
});
