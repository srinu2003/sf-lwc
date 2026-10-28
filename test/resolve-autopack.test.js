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

test('local unpackaged component automatically discovers Apex classes and Custom Objects and packs manifest', async () => {
  const tmpSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-autopack-source-'));
  try {
    // 1. Setup SFDX source project
    fs.writeFileSync(
      path.join(tmpSource, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );

    // 2. Setup LWC component that imports AgentController
    const lwcDir = path.join(tmpSource, 'force-app', 'main', 'default', 'lwc', 'myAgent');
    fs.mkdirSync(lwcDir, { recursive: true });
    fs.writeFileSync(path.join(lwcDir, 'myAgent.html'), '<template><div>Agent</div></template>');
    fs.writeFileSync(
      path.join(lwcDir, 'myAgent.js'),
      `import { LightningElement } from 'lwc';
       import getAgentData from '@salesforce/apex/AgentController.getAgentData';
       export default class MyAgent extends LightningElement {}`
    );
    fs.writeFileSync(
      path.join(lwcDir, 'myAgent.js-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
       <LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
         <apiVersion>62.0</apiVersion>
         <isExposed>true</isExposed>
       </LightningComponentBundle>`
    );

    // 3. Setup Apex class AgentController which references Agent_Config__c
    const classesDir = path.join(tmpSource, 'force-app', 'main', 'default', 'classes');
    fs.mkdirSync(classesDir, { recursive: true });
    fs.writeFileSync(
      path.join(classesDir, 'AgentController.cls'),
      `public with sharing class AgentController {
         @AuraEnabled public static String getAgentData() {
           Agent_Config__c config = Agent_Config__c.getOrgDefaults();
           return config.ApiKey__c;
         }
       }`
    );
    fs.writeFileSync(
      path.join(classesDir, 'AgentController.cls-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
       <ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
         <apiVersion>62.0</apiVersion>
         <status>Active</status>
       </ApexClass>`
    );

    // 4. Setup Custom Object Agent_Config__c
    const objDir = path.join(tmpSource, 'force-app', 'main', 'default', 'objects', 'Agent_Config__c');
    const fieldsDir = path.join(objDir, 'fields');
    fs.mkdirSync(fieldsDir, { recursive: true });
    fs.writeFileSync(
      path.join(objDir, 'Agent_Config__c.object-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
       <CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><customSettingsType>Hierarchy</customSettingsType></CustomObject>`
    );
    fs.writeFileSync(
      path.join(fieldsDir, 'ApiKey__c.field-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
       <CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><type>Text</type></CustomField>`
    );

    // 5. Run loadManifest on unpackaged component
    const source = createSource(tmpSource);
    const manifest = await loadManifest(source, 'myAgent');

    // 6. Assertions
    assert.equal(manifest.name, 'myAgent');
    assert.equal(manifest.version, '1.0.0');

    // Verify all files were discovered
    assert.ok(manifest.files.includes('lwc/myAgent/myAgent.js'));
    assert.ok(manifest.files.includes('lwc/myAgent/myAgent.html'));
    assert.ok(manifest.files.includes('lwc/myAgent/myAgent.js-meta.xml'));
    assert.ok(manifest.files.includes('classes/AgentController.cls'));
    assert.ok(manifest.files.includes('classes/AgentController.cls-meta.xml'));
    assert.ok(manifest.files.includes('objects/Agent_Config__c/Agent_Config__c.object-meta.xml'));
    assert.ok(manifest.files.includes('objects/Agent_Config__c/fields/ApiKey__c.field-meta.xml'));

    // Verify .sf-lwc/myAgent.json was written
    const packedPath = path.join(tmpSource, '.sf-lwc', 'myAgent.json');
    assert.ok(fs.existsSync(packedPath));
    const onDiskManifest = JSON.parse(fs.readFileSync(packedPath, 'utf8'));
    assert.equal(onDiskManifest.name, 'myAgent');
    assert.deepEqual(onDiskManifest.files.sort(), manifest.files.sort());
  } finally {
    fs.rmSync(tmpSource, { recursive: true, force: true });
  }
});

test('commented-out imports and string literals do not trigger false dependencies', async () => {
  const tmpSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-comments-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpSource, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );

    const lwcDir = path.join(tmpSource, 'force-app', 'main', 'default', 'lwc', 'cleanComp');
    fs.mkdirSync(lwcDir, { recursive: true });
    fs.writeFileSync(
      path.join(lwcDir, 'cleanComp.html'),
      `<template>
         <!-- <c-commented-child></c-commented-child> -->
         <div>Clean</div>
       </template>`
    );
    fs.writeFileSync(
      path.join(lwcDir, 'cleanComp.js'),
      `import { LightningElement } from 'lwc';
       // import oldService from '@salesforce/apex/FakeOldClass.unusedMethod';
       /* import oldChild from 'c/fakeOldChild'; */
       import realService from '@salesforce/apex/RealClass.realMethod';
       export default class CleanComp extends LightningElement {}`
    );
    fs.writeFileSync(
      path.join(lwcDir, 'cleanComp.js-meta.xml'),
      `<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
         <apiVersion>62.0</apiVersion>
       </LightningComponentBundle>`
    );

    const classesDir = path.join(tmpSource, 'force-app', 'main', 'default', 'classes');
    fs.mkdirSync(classesDir, { recursive: true });
    fs.writeFileSync(
      path.join(classesDir, 'RealClass.cls'),
      `public with sharing class RealClass {
         @AuraEnabled public static void realMethod() {
           // FakeUnusedClass.doSomething();
           String logMsg = 'Referencing FakeUnusedClass in a string literal';
           // System.Label.FakeLabel
           String val = System.Label.RealLabel;
         }
       }`
    );
    fs.writeFileSync(
      path.join(classesDir, 'RealClass.cls-meta.xml'),
      `<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>62.0</apiVersion></ApexClass>`
    );

    // Create FakeUnusedClass on disk to prove it's NOT picked up just because it exists
    fs.writeFileSync(
      path.join(classesDir, 'FakeUnusedClass.cls'),
      `public class FakeUnusedClass {}`
    );
    fs.writeFileSync(
      path.join(classesDir, 'FakeUnusedClass.cls-meta.xml'),
      `<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>62.0</apiVersion></ApexClass>`
    );

    const labelsDir = path.join(tmpSource, 'force-app', 'main', 'default', 'labels');
    fs.mkdirSync(labelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(labelsDir, 'CustomLabels.labels-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
       <CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
         <labels><fullName>FakeLabel</fullName><value>Fake</value></labels>
         <labels><fullName>RealLabel</fullName><value>Real</value></labels>
       </CustomLabels>`
    );

    const source = createSource(tmpSource);
    const manifest = await loadManifest(source, 'cleanComp');

    // Dependencies must NOT include commented items
    assert.deepEqual(manifest.dependencies, []);
    assert.ok(manifest.files.includes('classes/RealClass.cls'));
    assert.ok(!manifest.files.includes('classes/FakeUnusedClass.cls'));
    assert.ok(!manifest.files.includes('classes/FakeOldClass.cls'));

    // Labels must only include RealLabel
    const labelNames = manifest.labels.map((l) => l.fullName);
    assert.deepEqual(labelNames, ['RealLabel']);
  } finally {
    fs.rmSync(tmpSource, { recursive: true, force: true });
  }
});
