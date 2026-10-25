import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  pack,
  toKebabCase,
  parseLabelBlock,
  getAllFilesRecursively,
  METADATA_REGISTRY
} from '../src/pack.js';
import { validate } from '../src/resolve.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

test('toKebabCase correctly formats component names', () => {
  assert.equal(toKebabCase('spikeDemoComponent'), 'spike-demo-component');
  assert.equal(toKebabCase('HTMLBuilder'), 'html-builder');
  assert.equal(toKebabCase('DataTable'), 'data-table');
  assert.equal(toKebabCase('toast_utils'), 'toast-utils');
  assert.equal(toKebabCase('already-kebab'), 'already-kebab');
});

test('parseLabelBlock extracts custom label metadata from XML', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Greeting_Banner</fullName>
        <language>en_US</language>
        <protected>true</protected>
        <shortDescription>Banner Title</shortDescription>
        <value>Welcome to the Platform</value>
    </labels>
</CustomLabels>`;

  const parsed = parseLabelBlock(xml, 'Greeting_Banner');
  assert.deepEqual(parsed, {
    fullName: 'Greeting_Banner',
    value: 'Welcome to the Platform',
    shortDescription: 'Banner Title',
    language: 'en_US',
    protected: true
  });

  const missing = parseLabelBlock(xml, 'NonExistent');
  assert.equal(missing, null);
});

test('getAllFilesRecursively reads directory tree ignoring excluded folders', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-recursive-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'file2.js'), 'console.log()');
    fs.writeFileSync(path.join(tmpDir, '__tests__', 'test.js'), 'test');

    const files = getAllFilesRecursively(tmpDir);
    assert.deepEqual(files.sort(), ['file1.txt', 'sub/file2.js']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('METADATA_REGISTRY resolvers find local DX metadata files', () => {
  const tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-registry-test-'));
  try {
    // 1. LWC
    fs.mkdirSync(path.join(tmpPkg, 'lwc', 'myComp'), { recursive: true });
    fs.writeFileSync(path.join(tmpPkg, 'lwc', 'myComp', 'myComp.js'), '');
    fs.writeFileSync(path.join(tmpPkg, 'lwc', 'myComp', 'myComp.html'), '');
    const lwcFiles = METADATA_REGISTRY.LightningComponentBundle.resolve('myComp', tmpPkg);
    assert.deepEqual(lwcFiles.sort(), ['lwc/myComp/myComp.html', 'lwc/myComp/myComp.js']);

    // 2. ApexClass
    fs.mkdirSync(path.join(tmpPkg, 'classes'), { recursive: true });
    fs.writeFileSync(path.join(tmpPkg, 'classes', 'MyController.cls'), '');
    fs.writeFileSync(path.join(tmpPkg, 'classes', 'MyController.cls-meta.xml'), '');
    fs.writeFileSync(path.join(tmpPkg, 'classes', 'MyControllerTest.cls'), '');
    fs.writeFileSync(path.join(tmpPkg, 'classes', 'MyControllerTest.cls-meta.xml'), '');
    const apexFiles = METADATA_REGISTRY.ApexClass.resolve('MyController', tmpPkg);
    assert.deepEqual(apexFiles.sort(), [
      'classes/MyController.cls',
      'classes/MyController.cls-meta.xml',
      'classes/MyControllerTest.cls',
      'classes/MyControllerTest.cls-meta.xml'
    ]);

    // 3. StaticResource (file and dir)
    fs.mkdirSync(path.join(tmpPkg, 'staticresources', 'myBundle'), { recursive: true });
    fs.writeFileSync(path.join(tmpPkg, 'staticresources', 'myBundle.resource-meta.xml'), '');
    fs.writeFileSync(path.join(tmpPkg, 'staticresources', 'myBundle', 'app.css'), '');
    const resFiles = METADATA_REGISTRY.StaticResource.resolve('myBundle', tmpPkg);
    assert.deepEqual(resFiles.sort(), [
      'staticresources/myBundle.resource-meta.xml',
      'staticresources/myBundle/app.css'
    ]);

    // 4. CustomField
    fs.mkdirSync(path.join(tmpPkg, 'objects', 'Account', 'fields'), { recursive: true });
    fs.writeFileSync(path.join(tmpPkg, 'objects', 'Account', 'fields', 'CustomStatus__c.field-meta.xml'), '');
    const fieldFiles = METADATA_REGISTRY.CustomField.resolve('Account.CustomStatus__c', tmpPkg);
    assert.deepEqual(fieldFiles, ['objects/Account/fields/CustomStatus__c.field-meta.xml']);
  } finally {
    fs.rmSync(tmpPkg, { recursive: true, force: true });
  }
});

function setupMockProject() {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lwc-pack-proj-'));
  const pkgDefault = path.join(tmpProject, 'force-app', 'main', 'default');
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

  // Setup sample LWC files
  fs.mkdirSync(path.join(pkgDefault, 'lwc', 'sampleWidget'), { recursive: true });
  fs.writeFileSync(path.join(pkgDefault, 'lwc', 'sampleWidget', 'sampleWidget.js'), 'export default class {}');
  fs.writeFileSync(path.join(pkgDefault, 'lwc', 'sampleWidget', 'sampleWidget.html'), '<template></template>');
  fs.writeFileSync(path.join(pkgDefault, 'lwc', 'sampleWidget', 'sampleWidget.js-meta.xml'), '<LightningComponentBundle/>');

  // Setup dependent Apex Controller and Helper
  fs.mkdirSync(path.join(pkgDefault, 'classes'), { recursive: true });
  fs.writeFileSync(path.join(pkgDefault, 'classes', 'SampleWidgetController.cls'), 'public class SampleWidgetController {}');
  fs.writeFileSync(path.join(pkgDefault, 'classes', 'SampleWidgetController.cls-meta.xml'), '<ApexClass/>');
  fs.writeFileSync(path.join(pkgDefault, 'classes', 'SampleWidgetHelper.cls'), 'public class SampleWidgetHelper {}');
  fs.writeFileSync(path.join(pkgDefault, 'classes', 'SampleWidgetHelper.cls-meta.xml'), '<ApexClass/>');

  // Setup CustomLabels
  fs.mkdirSync(path.join(pkgDefault, 'labels'), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDefault, 'labels', 'CustomLabels.labels-meta.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Sample_Title</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Title label</shortDescription>
        <value>Widget Title</value>
    </labels>
    <labels>
        <fullName>Unrelated_Label</fullName>
        <value>Ignore me</value>
    </labels>
</CustomLabels>`
  );

  return { tmpProject, pkgDefault };
}

test('pack traces dependency graph, ignores standard entities, and emits valid manifest.json', async () => {
  const { tmpProject, pkgDefault } = setupMockProject();

  try {
    // Mock Tooling API queries
    const mockQueryToolingApi = (query) => {
      if (query.includes('FROM LightningComponentBundle WHERE DeveloperName')) {
        return [{ Id: '0Rb000000000001', DeveloperName: 'sampleWidget', ApiVersion: 62.0 }];
      }
      if (query.includes("MetadataComponentId = '0Rb000000000001'")) {
        return [
          {
            MetadataComponentName: 'sampleWidget',
            MetadataComponentType: 'LightningComponentBundle',
            RefMetadataComponentId: '01p000000000001',
            RefMetadataComponentName: 'SampleWidgetController',
            RefMetadataComponentType: 'ApexClass'
          },
          {
            MetadataComponentName: 'sampleWidget',
            MetadataComponentType: 'LightningComponentBundle',
            RefMetadataComponentId: '101000000000001',
            RefMetadataComponentName: 'Sample_Title',
            RefMetadataComponentType: 'CustomLabel'
          },
          {
            MetadataComponentName: 'sampleWidget',
            MetadataComponentType: 'LightningComponentBundle',
            RefMetadataComponentId: null,
            RefMetadataComponentName: 'Account',
            RefMetadataComponentType: 'StandardEntity' // Must be filtered out
          }
        ];
      }
      if (query.includes("MetadataComponentId = '01p000000000001'")) {
        return [
          {
            MetadataComponentName: 'SampleWidgetController',
            MetadataComponentType: 'ApexClass',
            RefMetadataComponentId: '01p000000000002',
            RefMetadataComponentName: 'SampleWidgetHelper',
            RefMetadataComponentType: 'ApexClass'
          }
        ];
      }
      if (query.includes("MetadataComponentId = '01p000000000002'")) {
        return [];
      }
      return [];
    };

    const destDir = path.join(tmpProject, 'components', 'sample-widget');
    const result = await pack('sampleWidget', {
      projectRoot: tmpProject,
      packageDefault: pkgDefault,
      destDir,
      queryToolingApi: mockQueryToolingApi
    });

    assert.equal(result.manifest.name, 'sample-widget');
    assert.equal(result.manifest.apiVersion, '62.0');
    assert.deepEqual(result.manifest.files.sort(), [
      'classes/SampleWidgetController.cls',
      'classes/SampleWidgetController.cls-meta.xml',
      'classes/SampleWidgetHelper.cls',
      'classes/SampleWidgetHelper.cls-meta.xml',
      'lwc/sampleWidget/sampleWidget.html',
      'lwc/sampleWidget/sampleWidget.js',
      'lwc/sampleWidget/sampleWidget.js-meta.xml'
    ]);
    assert.equal(result.manifest.labels.length, 1);
    assert.equal(result.manifest.labels[0].fullName, 'Sample_Title');
    assert.equal(result.manifest.labels[0].value, 'Widget Title');

    // Conformance with manifest schema validation
    validate(result.manifest, 'sample-widget');

    // Files on disk
    assert.ok(fs.existsSync(path.join(destDir, 'manifest.json')));
    const onDiskManifest = JSON.parse(fs.readFileSync(path.join(destDir, 'manifest.json'), 'utf-8'));
    assert.equal(onDiskManifest.name, 'sample-widget');
    assert.ok(fs.existsSync(path.join(destDir, 'files', 'classes', 'SampleWidgetController.cls')));
    assert.ok(fs.existsSync(path.join(destDir, 'files', 'classes', 'SampleWidgetHelper.cls')));
    assert.ok(fs.existsSync(path.join(destDir, 'files', 'lwc', 'sampleWidget', 'sampleWidget.js')));

    // StandardEntity was NOT bundled
    assert.ok(!result.discoveredByType.StandardEntity);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('pack honors --dry-run and does not write files to disk', async () => {
  const { tmpProject, pkgDefault } = setupMockProject();

  try {
    const mockQueryToolingApi = (query) => {
      if (query.includes('FROM LightningComponentBundle WHERE DeveloperName')) {
        return [{ Id: '0Rb000000000001', DeveloperName: 'sampleWidget', ApiVersion: 62.0 }];
      }
      return [];
    };

    const destDir = path.join(tmpProject, 'components', 'sample-widget');
    const result = await pack('sampleWidget', {
      projectRoot: tmpProject,
      packageDefault: pkgDefault,
      destDir,
      dryRun: true,
      queryToolingApi: mockQueryToolingApi
    });

    assert.equal(result.dryRun, true);
    assert.ok(!fs.existsSync(destDir), 'Directory should not exist in dry-run mode');
    assert.ok(result.manifest.files.length >= 3);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('pack honors --overwrite flag when destination exists', async () => {
  const { tmpProject, pkgDefault } = setupMockProject();

  try {
    const mockQueryToolingApi = () => [
      { Id: '0Rb000000000001', DeveloperName: 'sampleWidget', ApiVersion: 62.0 }
    ];

    const destDir = path.join(tmpProject, 'components', 'sample-widget');
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'dummy.txt'), 'old');

    // Without overwrite -> rejects
    await assert.rejects(
      pack('sampleWidget', {
        projectRoot: tmpProject,
        packageDefault: pkgDefault,
        destDir,
        overwrite: false,
        queryToolingApi: mockQueryToolingApi
      }),
      /Destination directory .* already exists\. Use -w \/ --overwrite to replace\./
    );

    // With overwrite -> succeeds
    await pack('sampleWidget', {
      projectRoot: tmpProject,
      packageDefault: pkgDefault,
      destDir,
      overwrite: true,
      queryToolingApi: mockQueryToolingApi
    });

    assert.ok(fs.existsSync(path.join(destDir, 'manifest.json')));
    assert.ok(!fs.existsSync(path.join(destDir, 'dummy.txt')), 'Old file wiped by overwrite');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('pack throws when root component is not found in org or files are missing locally', async () => {
  const { tmpProject, pkgDefault } = setupMockProject();

  try {
    // 1. Not in org
    await assert.rejects(
      pack('unknownComponent', {
        projectRoot: tmpProject,
        packageDefault: pkgDefault,
        queryToolingApi: () => []
      }),
      /LWC 'unknownComponent' not found in org/
    );

    // 2. Local files missing
    await assert.rejects(
      pack('missingLocalComponent', {
        projectRoot: tmpProject,
        packageDefault: pkgDefault,
        queryToolingApi: () => [{ Id: '0Rb999', DeveloperName: 'missingLocalComponent', ApiVersion: 62.0 }]
      }),
      /Local source files for 'missingLocalComponent' not found/
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli pack command integration tests (help, error on missing component)', async () => {
  // 1. Missing component argument throws error
  await assert.rejects(
    execFileAsync('node', [BIN, 'pack']),
    /Specify a component name to pack/
  );

  // 2. export alias works identically
  await assert.rejects(
    execFileAsync('node', [BIN, 'export']),
    /Specify a component name to pack/
  );

  // 3. CLI --help includes pack and export
  const { stdout } = await execFileAsync('node', [BIN, '--help']);
  assert.match(stdout, /sf-lwc pack <component> \[options\]/);
  assert.match(stdout, /sf-lwc export <component> \[options\]/);
  assert.match(stdout, /-o, --target-org <org>/);
  assert.match(stdout, /-d, --output <dir>/);
  assert.match(stdout, /-w, --overwrite/);
  assert.match(stdout, /--dry-run/);
  assert.match(stdout, /--json/);
});

test('pack --json mode returns structured output and outputs clean JSON', async () => {
  const { tmpProject, pkgDefault } = setupMockProject();

  try {
    const mockQueryToolingApi = (query) => {
      if (query.includes('FROM LightningComponentBundle WHERE DeveloperName')) {
        return [{ Id: '0Rb000000000001', DeveloperName: 'sampleWidget', ApiVersion: 62.0 }];
      }
      return [];
    };

    let loggedOutput = '';
    const originalLog = console.log;
    console.log = (msg) => {
      loggedOutput += msg + '\n';
    };

    let result;
    try {
      result = await pack('sampleWidget', {
        projectRoot: tmpProject,
        packageDefault: pkgDefault,
        json: true,
        dryRun: true,
        queryToolingApi: mockQueryToolingApi
      });
    } finally {
      console.log = originalLog;
    }

    assert.ok(result.manifest);
    assert.ok(result.dependencyTree);
    assert.equal(result.dryRun, true);

    const parsedJson = JSON.parse(loggedOutput.trim());
    assert.equal(parsedJson.manifest.name, 'sample-widget');
    assert.equal(parsedJson.dryRun, true);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});
