import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isSourceSpec } from '../src/source.js';
import { matchComponentName } from '../src/resolve.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

function createTempProject(name = 'sf-lwc-add-test-') {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), name));
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

test('cli add without component in non-interactive environment fails fast with descriptive error', async () => {
  const { tmpProject } = createTempProject('add-non-tty-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject]);
    assert.fail('Command should have thrown error');
  } catch (err) {
    assert.equal(err.code, 1);
    const combinedOutput = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combinedOutput,
      /No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf-lwc add <component>/
    );
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add with --json flag and no component in non-interactive terminal fails fast', async () => {
  const { tmpProject } = createTempProject('add-json-');

  try {
    await execFileAsync('node', [BIN, 'add', '--from', root, '--cwd', tmpProject, '--json']);
    assert.fail('Command should have thrown error');
  } catch (err) {
    assert.equal(err.code, 1);
    const combinedOutput = (err.stderr || '') + (err.stdout || '');
    assert.match(combinedOutput, /No component specified and terminal is non-interactive/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add with component name executes directly without prompting in non-interactive terminal', async () => {
  const { tmpProject, pkgDefault } = createTempProject('add-direct-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify files were installed
    const modalDir = path.join(pkgDefault, 'lwc', 'modal');
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.html')));
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.js')));
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.css')));
    assert.ok(fs.existsSync(path.join(modalDir, 'modal.js-meta.xml')));

    // Verify lockfile was written
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(tmpProject, 'sf-lwc.lock.json'), 'utf8')
    );
    assert.ok(lockfile.components.modal);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add multiple components directly without prompting', async () => {
  const { tmpProject, pkgDefault } = createTempProject('add-multi-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal', 'toast-utils', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify both component directories exist
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add comma-separated component names without prompting', async () => {
  const { tmpProject, pkgDefault } = createTempProject('add-comma-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal,toast-utils', '--from', root, '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Done\./);

    // Verify both component directories exist
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add mixed comma-separated and space-separated component names with duplicates and whitespace', async () => {
  const { tmpProject } = createTempProject('add-mixed-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', 'modal, toast-utils', 'modal', '--from', root, '--cwd', tmpProject, '--dry-run']
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /\+ toast-utils@1\.0\.0/);
    assert.match(stdout, /Dry run complete/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add with commas-only in non-interactive environment fails fast', async () => {
  const { tmpProject } = createTempProject('add-commas-only-');

  try {
    await execFileAsync('node', [BIN, 'add', ', , ,', '--from', root, '--cwd', tmpProject]);
    assert.fail('Command should have thrown error');
  } catch (err) {
    assert.equal(err.code, 1);
    const combinedOutput = (err.stderr || '') + (err.stdout || '');
    assert.match(combinedOutput, /No component specified and terminal is non-interactive/);
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('cli add supports positional source and component without --from', async () => {
  const { tmpProject, pkgDefault } = createTempProject('add-pos-');

  try {
    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'add', root, 'modal', '--cwd', tmpProject]
    );

    assert.match(stdout, /\+ modal@1\.0\.0/);
    assert.match(stdout, /Done\./);
    assert.ok(fs.existsSync(path.join(pkgDefault, 'lwc', 'modal', 'modal.js')));
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('isSourceSpec accurately differentiates repositories/paths from component names', () => {
  // Sources (should return true)
  assert.equal(isSourceSpec('owner/repo'), true);
  assert.equal(isSourceSpec('svierk/awesome-lwc-collection'), true);
  assert.equal(isSourceSpec('svierk/awesome-lwc-collection@v1.0.0'), true);
  assert.equal(isSourceSpec('https://github.com/owner/repo'), true);
  assert.equal(isSourceSpec('http://github.com/owner/repo'), true);
  assert.equal(isSourceSpec('git@github.com:owner/repo.git'), true);
  assert.equal(isSourceSpec('github:owner/repo'), true);
  assert.equal(isSourceSpec('./local/path'), true);
  assert.equal(isSourceSpec('../parent/path'), true);
  assert.equal(isSourceSpec('/absolute/unix/path'), true);
  assert.equal(isSourceSpec('C:\\Users\\test\\project'), true);
  assert.equal(isSourceSpec('D:/Projects/lwc'), true);

  // Component names (should return false)
  assert.equal(isSourceSpec('modal'), false);
  assert.equal(isSourceSpec('toastUtils'), false);
  assert.equal(isSourceSpec('toast-utils'), false);
  assert.equal(isSourceSpec('qrCodeGenerator'), false);
  assert.equal(isSourceSpec('qr-code-generator'), false);
  assert.equal(isSourceSpec('bw_DocuMakeAgent'), false);
  assert.equal(isSourceSpec('bw-docu-make-agent'), false);
  assert.equal(isSourceSpec(''), false);
  assert.equal(isSourceSpec(null), false);
});

test('matchComponentName matches exact, case-insensitive, kebab-case, and normalized names', () => {
  const candidates = ['qrCodeGenerator', 'bw_DocuMakeAgent', 'modal', 'html-builder'];

  // Exact match
  assert.equal(matchComponentName(candidates, 'modal'), 'modal');
  assert.equal(matchComponentName(candidates, 'qrCodeGenerator'), 'qrCodeGenerator');

  // Case-insensitive
  assert.equal(matchComponentName(candidates, 'MODAL'), 'modal');

  // Kebab-case to camelCase
  assert.equal(matchComponentName(candidates, 'qr-code-generator'), 'qrCodeGenerator');

  // CamelCase to kebab-case
  assert.equal(matchComponentName(candidates, 'htmlBuilder'), 'html-builder');

  // Underscore / complex casing
  assert.equal(matchComponentName(candidates, 'bw-docu-make-agent'), 'bw_DocuMakeAgent');
  assert.equal(matchComponentName(candidates, 'bw_documakeagent'), 'bw_DocuMakeAgent');

  // Unmatched remains input
  assert.equal(matchComponentName(candidates, 'unknownComponent'), 'unknownComponent');
});
