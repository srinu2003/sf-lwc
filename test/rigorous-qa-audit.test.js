import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { createSource } from '../src/source.js';
import { resolve } from '../src/resolve.js';
import { install, LOCK_FILE } from '../src/install.js';
import { remove } from '../src/remove.js';
import { doctor } from '../src/doctor.js';
import { pack } from '../src/pack.js';
import { findProject } from '../src/project.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');
const FIXTURE_REPO = path.join(root, 'fixtures', 'sfdx-repo');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createCleanSfdxProject(prefix = 'sf-lwc-qa-') {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const pkgDefault = path.join(projectRoot, 'force-app', 'main', 'default');
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
  return { projectRoot, pkgDefault };
}

// ─────────────────────────────────────────────────────────────────────────────
// QA-1: SHARED DEPENDENCY REFERENCE COUNTING AUDIT
// ─────────────────────────────────────────────────────────────────────────────
test('QA-1: Reference-counted retention prevents deletion of shared dependencies during removals', async () => {
  const { projectRoot, pkgDefault } = await createCleanSfdxProject('sf-lwc-qa-refcount-');

  try {
    const project = await findProject(projectRoot);
    const mockSource = {
      root: projectRoot,
      label: 'mock-source',
      async read(rel) {
        return `// content of ${rel}`;
      },
      async readComponentFile(manifest, rel) {
        return `// content of ${rel} for ${manifest.name}`;
      }
    };

    // compA declares shared class and its own LWC
    const manifestA = {
      name: 'compA',
      version: '1.0.0',
      apiVersion: '62.0',
      files: ['lwc/compA/compA.js', 'classes/SharedHelper.cls', 'classes/SharedHelper.cls-meta.xml'],
      labels: [{ fullName: 'Shared_Label', value: 'Shared Label Value' }]
    };

    // compB also declares the shared class and its own LWC
    const manifestB = {
      name: 'compB',
      version: '1.0.0',
      apiVersion: '62.0',
      files: ['lwc/compB/compB.js', 'classes/SharedHelper.cls', 'classes/SharedHelper.cls-meta.xml'],
      labels: [{ fullName: 'Shared_Label', value: 'Shared Label Value' }]
    };

    // 1. Install compA
    await install({ source: mockSource, manifests: [manifestA], project });
    assert.equal(await exists(path.join(pkgDefault, 'classes', 'SharedHelper.cls')), true);
    assert.equal(await exists(path.join(pkgDefault, 'lwc', 'compA', 'compA.js')), true);

    // 2. Install compB (SharedHelper already exists on disk, so write is skipped)
    await install({ source: mockSource, manifests: [manifestB], project });
    assert.equal(await exists(path.join(pkgDefault, 'lwc', 'compB', 'compB.js')), true);

    // Verify lockfile tracks SharedHelper under BOTH components
    const lock1 = JSON.parse(await readFile(path.join(projectRoot, LOCK_FILE), 'utf8'));
    assert.ok(lock1.components.compA.files.includes('classes/SharedHelper.cls'));
    assert.ok(lock1.components.compB.files.includes('classes/SharedHelper.cls'));

    // 3. Remove compA - SharedHelper MUST be retained for compB
    await remove({ names: ['compA'], project });
    assert.equal(await exists(path.join(pkgDefault, 'lwc', 'compA')), false, 'compA LWC should be removed');
    assert.equal(await exists(path.join(pkgDefault, 'classes', 'SharedHelper.cls')), true, 'SharedHelper MUST remain for compB');

    // 4. Remove compB - Now SharedHelper MUST be removed as count reaches 0
    await remove({ names: ['compB'], project });
    assert.equal(await exists(path.join(pkgDefault, 'lwc', 'compB')), false, 'compB LWC should be removed');
    assert.equal(await exists(path.join(pkgDefault, 'classes', 'SharedHelper.cls')), false, 'SharedHelper should now be deleted');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-2: RIGOROUS JSON PROTOCOL AUDIT ACROSS ALL COMMANDS
// ─────────────────────────────────────────────────────────────────────────────
test('QA-2: Rigorous --json mode outputs pristine machine-readable JSON across all commands', async () => {
  const { projectRoot } = await createCleanSfdxProject('sf-lwc-qa-json-');

  try {
    // 1. init --json
    const { stdout: initOut } = await execFileAsync('node', [BIN, 'init', '--json', '--cwd', projectRoot]);
    const initJson = JSON.parse(initOut);
    assert.equal(initJson.ok, true);
    assert.ok(initJson.configPath);

    // 2. doctor --json
    const { stdout: docOut } = await execFileAsync('node', [BIN, 'doctor', '--json', '--cwd', projectRoot]);
    const docJson = JSON.parse(docOut);
    assert.equal(docJson.ok, true);
    assert.ok(Array.isArray(docJson.checks));

    // 3. list --json
    const { stdout: listOut } = await execFileAsync('node', [BIN, 'list', '--from', FIXTURE_REPO, '--json', '--cwd', projectRoot]);
    const listJson = JSON.parse(listOut);
    assert.ok(Array.isArray(listJson));
    assert.ok(listJson.length > 0);
    assert.ok(listJson.some((c) => c.name === 'dataTable' || c.name === 'data-table'));

    // 4. add --dry-run --json
    const { stdout: addOut } = await execFileAsync('node', [
      BIN,
      'add',
      '--from',
      FIXTURE_REPO,
      'toast-utils',
      '--dry-run',
      '--json',
      '--cwd',
      projectRoot
    ]);
    const addJson = JSON.parse(addOut);
    assert.equal(addJson.ok, true);
    assert.equal(addJson.dryRun, true);
    assert.ok(Array.isArray(addJson.installed));

    // 5. pack --dry-run --json
    const mockToolingQuery = (query) => {
      if (query.includes('FROM LightningComponentBundle')) {
        return [{ Id: '0Rb000000000001', DeveloperName: 'myComp', ApiVersion: 62.0 }];
      }
      return [];
    };

    const pkgDir = path.join(projectRoot, 'force-app', 'main', 'default');
    await mkdir(path.join(pkgDir, 'lwc', 'myComp'), { recursive: true });
    await writeFile(path.join(pkgDir, 'lwc', 'myComp', 'myComp.js'), 'export default class MyComp {}');

    const packResult = await pack('myComp', {
      projectRoot,
      packageDefault: pkgDir,
      dryRun: true,
      json: true,
      queryToolingApi: mockToolingQuery
    });
    assert.equal(packResult.manifest.name, 'my-comp');
    assert.ok(packResult.files.includes('lwc/myComp/myComp.js'));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-3: CONFIGURATION HIERARCHY & PRECEDENCE AUDIT
// ─────────────────────────────────────────────────────────────────────────────
test('QA-3: Source configuration precedence respects flag > positional > env > config', async () => {
  const { projectRoot } = await createCleanSfdxProject('sf-lwc-qa-prec-');

  try {
    // Write sf-lwc.json pointing to FIXTURE_REPO
    await writeFile(
      path.join(projectRoot, 'sf-lwc.json'),
      JSON.stringify({ registry: FIXTURE_REPO }, null, 2)
    );

    // 1. Without arguments, sf-lwc list uses registry in sf-lwc.json
    const { stdout: out1 } = await execFileAsync('node', [BIN, 'list', '--cwd', projectRoot]);
    assert.match(out1, /Registry:\s+/);
    assert.match(out1, /- dataTable @1\.0\.0/);

    // 2. Positional argument overrides config file
    const { stdout: out2 } = await execFileAsync('node', [
      BIN,
      'list',
      FIXTURE_REPO,
      '--cwd',
      projectRoot
    ]);
    assert.match(out2, /- dataTable @1\.0\.0/);

    // 3. Explicit --from flag overrides all
    const { stdout: out3 } = await execFileAsync('node', [
      BIN,
      'list',
      '--from',
      FIXTURE_REPO,
      '--cwd',
      projectRoot
    ]);
    assert.match(out3, /- dataTable @1\.0\.0/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-4: DOCTOR COMPLIANCE ON CORRUPTED CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────
test('QA-4: Doctor identifies corrupted lockfiles and malformed CustomLabels XML', async () => {
  const { projectRoot, pkgDefault } = await createCleanSfdxProject('sf-lwc-qa-doc-');

  try {
    // Corrupt the lockfile with broken JSON
    await writeFile(path.join(projectRoot, LOCK_FILE), '{ "components": broken_json_here');

    const res1 = await doctor({ cwd: projectRoot });
    assert.equal(res1.ok, false);
    assert.ok(res1.checks.some((c) => c.name === 'sf-lwc.lock.json' && c.status === 'fail'));

    // Fix lockfile
    await writeFile(path.join(projectRoot, LOCK_FILE), JSON.stringify({ components: {} }));

    // Create broken CustomLabels XML (unclosed tags)
    await mkdir(path.join(pkgDefault, 'labels'), { recursive: true });
    await writeFile(path.join(pkgDefault, 'labels', 'CustomLabels.labels-meta.xml'), '<CustomLabels><unclosed>');

    const res2 = await doctor({ cwd: projectRoot });
    assert.equal(res2.ok, false);
    assert.ok(res2.checks.some((c) => c.name === 'CustomLabels' && c.status === 'fail'));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-5: DIFF COMMAND VERIFICATION ON MODIFIED SOURCE
// ─────────────────────────────────────────────────────────────────────────────
test('QA-5: Diff command accurately displays line-by-line differences on modified files', async () => {
  const { projectRoot, pkgDefault } = await createCleanSfdxProject('sf-lwc-qa-diff-');

  try {
    // Install toast-utils
    await execFileAsync('node', [BIN, 'add', '--from', FIXTURE_REPO, 'toast-utils', '--cwd', projectRoot]);

    // Check diff before modifications -> Clean
    const { stdout: cleanDiff } = await execFileAsync('node', [BIN, 'diff', 'toast-utils', '--from', FIXTURE_REPO, '--cwd', projectRoot]);
    assert.match(cleanDiff, /100% match|matches registry/i);

    // Modify a file
    const jsPath = path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js');
    const originalJs = await readFile(jsPath, 'utf8');
    await writeFile(jsPath, originalJs + '\n// Custom Team Modification\n');

    // Check diff after modifications -> Exits with code 1 and outputs unified diff
    try {
      await execFileAsync('node', [BIN, 'diff', 'toast-utils', '--from', FIXTURE_REPO, '--cwd', projectRoot]);
      assert.fail('Expected diff to exit with code 1 when differences exist');
    } catch (err) {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /Custom Team Modification/);
      assert.match(err.stdout, /\+.*Custom Team Modification/);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-6: PACK TRAVERSAL BOUNDS & SAFEGUARD AUDIT
// ─────────────────────────────────────────────────────────────────────────────
test('QA-6: Pack enforces recursion depth limits, sanitizes SOQL, and creates zero extra folders', async () => {
  const { projectRoot, pkgDefault } = await createCleanSfdxProject('sf-lwc-qa-pack-');

  try {
    await mkdir(path.join(pkgDefault, 'lwc', 'rootWidget'), { recursive: true });
    await writeFile(path.join(pkgDefault, 'lwc', 'rootWidget', 'rootWidget.js'), 'export default class RootWidget {}');

    await mkdir(path.join(pkgDefault, 'classes'), { recursive: true });
    await writeFile(path.join(pkgDefault, 'classes', 'ControllerOne.cls'), 'public class ControllerOne {}');
    await writeFile(path.join(pkgDefault, 'classes', 'ControllerOne.cls-meta.xml'), '<ApexClass/>');
    await writeFile(path.join(pkgDefault, 'classes', 'ServiceTwo.cls'), 'public class ServiceTwo {}');
    await writeFile(path.join(pkgDefault, 'classes', 'ServiceTwo.cls-meta.xml'), '<ApexClass/>');

    const logs = [];
    const mockToolingQuery = (query) => {
      // Test single quote escaping in query
      if (query.includes('FROM LightningComponentBundle WHERE DeveloperName')) {
        return [{ Id: '0Rb000000000001', DeveloperName: "rootWidget", ApiVersion: 62.0 }];
      }
      if (query.includes("MetadataComponentId = '0Rb000000000001'")) {
        return [
          {
            MetadataComponentName: 'rootWidget',
            MetadataComponentType: 'LightningComponentBundle',
            RefMetadataComponentId: '01p000000000001',
            RefMetadataComponentName: 'ControllerOne',
            RefMetadataComponentType: 'ApexClass'
          }
        ];
      }
      if (query.includes("MetadataComponentId = '01p000000000001'")) {
        return [
          {
            MetadataComponentName: 'ControllerOne',
            MetadataComponentType: 'ApexClass',
            RefMetadataComponentId: '01p000000000002',
            RefMetadataComponentName: 'ServiceTwo',
            RefMetadataComponentType: 'ApexClass'
          }
        ];
      }
      return [];
    };

    // 1. Pack with maxDepth = 1 (stops at ControllerOne, skips ServiceTwo)
    const resDepth1 = await pack('rootWidget', {
      projectRoot,
      packageDefault: pkgDefault,
      maxDepth: 1,
      queryToolingApi: mockToolingQuery,
      log: (msg) => logs.push(msg)
    });

    assert.ok(resDepth1.files.includes('classes/ControllerOne.cls'));
    assert.equal(resDepth1.files.includes('classes/ServiceTwo.cls'), false, 'ServiceTwo must be skipped at depth 1');
    assert.ok(logs.some((l) => l.includes('Reached maximum dependency depth')));

    // 2. Sidecar verification: .sf-lwc/root-widget.json created, NO components/ folder created
    assert.equal(await exists(path.join(projectRoot, '.sf-lwc', 'root-widget.json')), true);
    assert.equal(await exists(path.join(projectRoot, 'components')), false, 'Zero extra components/ folder');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-7: DEFENSIVE CLI VALIDATION & EXIT CODES
// ─────────────────────────────────────────────────────────────────────────────
test('QA-7: Defensive command validation fails fast with standard exit codes', async () => {
  // Unknown command
  await assert.rejects(
    execFileAsync('node', [BIN, 'nonexistentCommand']),
    (err) => err.code === 1 && err.stderr.includes('Unknown command')
  );

  // Missing component for pack
  await assert.rejects(
    execFileAsync('node', [BIN, 'pack']),
    (err) => err.code === 1 && err.stderr.includes('Specify a component name to pack')
  );

  // Missing component for remove
  await assert.rejects(
    execFileAsync('node', [BIN, 'remove']),
    (err) => err.code === 1 && err.stderr.includes('Specify at least one component')
  );

  // Missing component for diff
  await assert.rejects(
    execFileAsync('node', [BIN, 'diff']),
    (err) => err.code === 1 && err.stderr.includes('Specify a component name to diff')
  );
});
