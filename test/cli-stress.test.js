import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

function createTempProject(prefix = 'sf-lwc-stress-') {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
  return { tmpProject, pkgDefault };
}

// ===========================================================================
// SECTION 1: Non-interactive Rejection Tests
// ===========================================================================

test('stress: cli add without component in standard non-TTY child process exits 1 with exact error message', async () => {
  const { tmpProject } = createTempProject('non-tty-err-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject]);
    assert.fail('Expected command to exit with error');
  } catch (err) {
    assert.equal(err.code, 1, 'Process exit code must be 1');
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combined,
      /Error: No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/,
      'Must contain exact non-interactive error message'
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add without component when CI=true exits 1 with exact error message', async () => {
  const { tmpProject } = createTempProject('ci-true-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject], {
      env: { ...process.env, CI: 'true' }
    });
    assert.fail('Expected command to fail fast when CI=true');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combined,
      /Error: No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add without component when CI=1 exits 1 with exact error message', async () => {
  const { tmpProject } = createTempProject('ci-one-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject], {
      env: { ...process.env, CI: '1' }
    });
    assert.fail('Expected command to fail fast when CI=1');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combined,
      /Error: No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add without component with --json flag exits 1 with exact error message', async () => {
  const { tmpProject } = createTempProject('json-flag-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject, '--json']);
    assert.fail('Expected command to fail fast when --json is passed');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combined,
      /Error: No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add without component with piped stdin stream terminates immediately with exit code 1', async () => {
  const { tmpProject } = createTempProject('piped-stdin-');

  try {
    await new Promise((res, rej) => {
      const child = spawn('node', [BIN, 'add', '--from', root, '--cwd', tmpProject], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      // Write nothing and end stdin
      child.stdin.end();

      child.on('close', (code) => {
        if (code === 1) {
          const combined = stderr + stdout;
          try {
            assert.match(
              combined,
              /Error: No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/
            );
            res();
          } catch (e) {
            rej(e);
          }
        } else {
          rej(new Error(`Expected exit code 1, got ${code}. Stderr: ${stderr}`));
        }
      });
      child.on('error', rej);
    });
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add without component and no registry exits 1 with registry error', async () => {
  const { tmpProject } = createTempProject('no-reg-');

  try {
    // Clear SF_LWC_REGISTRY
    const env = { ...process.env };
    delete env.SF_LWC_REGISTRY;

    await execFileAsync('node', [BIN, 'add', '--cwd', tmpProject], { env });
    assert.fail('Expected failure when no registry is specified');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(combined, /No registry\. Run "sf-lwc init", pass --from owner\/repo, or set SF_LWC_REGISTRY/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add outside an sfdx project directory fails immediately before TTY check', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-sfdx-'));

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', emptyDir]);
    assert.fail('Expected failure outside of SFDX project');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(combined, /No sfdx-project\.json found\. Run this inside a Salesforce DX project\./);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 2: Direct Single-Component Installation Tests
// ===========================================================================

test('stress: direct single component install (modal) installs all bundle files and creates lockfile', async () => {
  const { tmpProject, pkgDefault } = createTempProject('direct-modal-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify all LWC files in standard force-app layout
    const modalDir = path.join(pkgDefault, 'lwc', 'modal');
    assert.ok(fs.existsSync(modalDir), 'modal directory must exist');
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.html')), 'modal.html must exist');
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.js')), 'modal.js must exist');
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.css')), 'modal.css must exist');
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.js-meta.xml')), 'modal.js-meta.xml must exist');

    // Verify CustomLabels merged
    const labelsFile = path.join(pkgDefault, 'labels', 'CustomLabels.labels-meta.xml');
    assert.ok(fs.existsSync(labelsFile), 'CustomLabels.labels-meta.xml must exist');
    const labelXml = fs.readFileSync(labelsFile, 'utf8');
    assert.match(labelXml, /Modal_CloseTitle/);
    assert.match(labelXml, /Modal_DefaultCancel/);

    // Verify lockfile
    const lockfilePath = path.join(tmpProject, 'sf-lwc.lock.json');
    assert.ok(fs.existsSync(lockfilePath), 'sf-lwc.lock.json must exist');
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
    assert.ok(lockfile.components.modal, 'Lockfile must have modal entry');
    assert.equal(lockfile.components.modal.version, '1.0.0');
    assert.ok(Array.isArray(lockfile.components.modal.files), 'Lockfile must have files array');
    assert.ok(lockfile.components.modal.files.includes('lwc/modal/modal.js'));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: direct single component install with --dry-run touches no disk files', async () => {
  const { tmpProject, pkgDefault } = createTempProject('dry-run-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject, '--dry-run']
    );

    assert.match(stdout, /would write.*lwc\/modal\/modal\.js/);
    assert.match(stdout, /Dry run complete\. Nothing was changed\./);

    const modalDir = path.join(pkgDefault, 'lwc', 'modal');
    assert.ok(!fs.existsSync(modalDir), 'modal dir must NOT exist after dry-run');

    const lockfilePath = path.join(tmpProject, 'sf-lwc.lock.json');
    assert.ok(!fs.existsSync(lockfilePath), 'lockfile must NOT exist after dry-run');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: direct component install with --registry alias works identically to --from', async () => {
  const { tmpProject, pkgDefault } = createTempProject('reg-alias-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--registry', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: direct component install with SF_LWC_REGISTRY env var works without --from', async () => {
  const { tmpProject, pkgDefault } = createTempProject('env-reg-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--cwd', tmpProject],
      { env: { ...process.env, SF_LWC_REGISTRY: root } }
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: direct install of non-existent component fails with descriptive error', async () => {
  const { tmpProject } = createTempProject('nonexistent-comp-');

  try {
    await execFileAsync('node', [BIN, 'add', 'nonExistentBundle', '--from', root, '--cwd', tmpProject]);
    assert.fail('Expected failure for non-existent component');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(combined, /Component "nonExistentBundle" not found/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 3: Multi-Component Installation Tests
// ===========================================================================

test('stress: multi-component install (modal + toast-utils) installs all components and their assets', async () => {
  const { tmpProject, pkgDefault } = createTempProject('multi-modal-toast-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', 'toast-utils', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify modal files
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.html')));

    // Verify toast-utils files
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js-meta.xml')));

    // Verify lockfile tracks both components
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(tmpProject, 'sf-lwc.lock.json'), 'utf8')
    );
    assert.ok(lockfile.components.modal, 'Lockfile has modal');
    assert.ok(lockfile.components['toast-utils'], 'Lockfile has toast-utils');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: multi-component install with duplicate arguments deduplicates safely', async () => {
  const { tmpProject, pkgDefault } = createTempProject('multi-dedup-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', 'modal', 'modal', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: multi-component install with one valid and one invalid component fails cleanly without partial install', async () => {
  const { tmpProject, pkgDefault } = createTempProject('multi-partial-');

  try {
    await execFileAsync(
      'node',
      [BIN, 'add', 'modal', 'ghost-component-xyz', '--from', root, '--cwd', tmpProject]
    );
    assert.fail('Expected failure when any component is invalid');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(combined, /Component "ghost-component-xyz" not found/);

    // Verify modal was NOT installed (resolution fails before installation starts)
    const modalDir = path.join(pkgDefault, 'lwc', 'modal');
    assert.ok(!fs.existsSync(modalDir), 'modal dir must NOT exist if dependency resolution failed');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: multi-component install with Apex classes and dependencies (data-table)', async () => {
  const { tmpProject, pkgDefault } = createTempProject('data-table-deps-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'data-table', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ data-table@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/); // Transitive dependency
    assert.match(stdout, /Done\./);
    assert.match(stdout, /Manual steps:/);

    // Verify LWC component
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'dataTable', 'dataTable.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));

    // Verify Apex classes
    assert.ok(fs.existsSync(path.join(pkgDefault, 'classes', 'DataTableController.cls')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'classes', 'DataTableController.cls-meta.xml')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'classes', 'DataTableControllerTest.cls')));

    // Verify lockfile
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(tmpProject, 'sf-lwc.lock.json'), 'utf8')
    );
    assert.ok(lockfile.components['data-table']);
    assert.ok(lockfile.components['toast-utils']);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: multi-component install specifying both parent and transitive dependency explicitly', async () => {
  const { tmpProject, pkgDefault } = createTempProject('explicit-transitive-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'data-table', 'toast-utils', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ data-table@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Done\./);

    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'dataTable', 'dataTable.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: multi-component install all 3 components (modal, data-table, toast-utils)', async () => {
  const { tmpProject, pkgDefault } = createTempProject('all-three-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', 'data-table', 'toast-utils', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /\+ data-table@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Done\./);

    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'dataTable', 'dataTable.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));

    const lockfile = JSON.parse(
      fs.readFileSync(path.join(tmpProject, 'sf-lwc.lock.json'), 'utf8')
    );
    assert.equal(Object.keys(lockfile.components).length, 3);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 4: Advanced CLI Options, Project Layouts & Registry Edge Cases
// ===========================================================================

test('stress: re-installing already installed component without --overwrite is a no-op that leaves modified files intact', async () => {
  const { tmpProject, pkgDefault } = createTempProject('no-overwrite-');

  try {
    // 1. Initial install
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]);

    // 2. Modify modal.js locally
    const modalJsPath = path.join(pkgDefault, 'lwc', 'modal', 'modal.js');
    fs.writeFileSync(modalJsPath, '// CUSTOM MODIFIED CONTENT', 'utf8');

    // 3. Run add modal again without overwrite
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /= modal@1\.0\.0 already installed/);

    // Verify modified file was NOT overwritten
    const content = fs.readFileSync(modalJsPath, 'utf8');
    assert.equal(content, '// CUSTOM MODIFIED CONTENT', 'Local file must remain untouched');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: re-installing with -w / --overwrite flag replaces modified local files', async () => {
  const { tmpProject, pkgDefault } = createTempProject('with-overwrite-');

  try {
    // 1. Initial install
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]);

    // 2. Modify modal.js locally
    const modalJsPath = path.join(pkgDefault, 'lwc', 'modal', 'modal.js');
    fs.writeFileSync(modalJsPath, '// CUSTOM MODIFIED CONTENT', 'utf8');

    // 3. Run add modal with -w
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '-w', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /write.*lwc\/modal\/modal\.js/);

    // Verify modified file was overwritten with fresh content
    const content = fs.readFileSync(modalJsPath, 'utf8');
    assert.notEqual(content, '// CUSTOM MODIFIED CONTENT', 'Local file must be restored');
    assert.match(content, /export default class Modal/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: custom package directory in sfdx-project.json is respected by cli add', async () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-pkg-'));
  const customPkg = path.join(tmpProject, 'packages', 'core', 'main', 'default');
  fs.mkdirSync(customPkg, { recursive: true });
  fs.writeFileSync(
    path.join(tmpProject, 'sfdx-project.json'),
    JSON.stringify(
      {
        packageDirectories: [
          { path: 'packages/auxiliary', default: false },
          { path: 'packages/core', default: true }
        ],
        sourceApiVersion: '62.0'
      },
      null,
      2
    )
  );

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify files were installed into the custom default package directory
    const modalJs = path.join(customPkg, 'lwc', 'modal', 'modal.js');
    assert.ok(fs.existsSync(modalJs), 'modal.js must exist in custom package directory');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add with relative --cwd path resolves properly', async () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-cwd-'));
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

  try {
    const relCwd = path.relative(process.cwd(), tmpProject);
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', relCwd]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('stress: cli add from empty local registry throws descriptive error', async () => {
  const { tmpProject } = createTempProject('empty-reg-');
  const emptyRegDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-reg-src-'));

  try {
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', emptyRegDir, '--cwd', tmpProject]);
    assert.fail('Expected failure when registry has no components');
  } catch (err) {
    assert.equal(err.code, 1);
    const combined = (err.stderr || '') + (err.stdout || '');
    assert.match(combined, /Component "modal" not found in registry/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(emptyRegDir, { recursive: true, force: true });
  }
});

