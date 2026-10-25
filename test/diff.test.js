import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { splitLines, generateUnifiedDiff, diff } from '../src/diff.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'bin', 'sf-lwc.js');

test('splitLines correctly splits text and normalizes CRLF and LF', () => {
  assert.deepEqual(splitLines('hello\r\nworld\r\n'), ['hello', 'world']);
  assert.deepEqual(splitLines('foo\nbar\n'), ['foo', 'bar']);
  assert.deepEqual(splitLines('single line'), ['single line']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines(null), []);
});

test('generateUnifiedDiff returns null for identical content', () => {
  const result = generateUnifiedDiff('const a = 1;\r\nconst b = 2;\n', 'const a = 1;\nconst b = 2;\n', 'test.js');
  assert.equal(result, null);
});

test('generateUnifiedDiff returns unified format for modified lines', () => {
  const oldText = 'line1\nline2\nline3\n';
  const newText = 'line1\nline2 modified\nline3\n';
  const result = generateUnifiedDiff(oldText, newText, 'lwc/test/test.js');

  assert.ok(result);
  assert.match(result, /--- a\/lwc\/test\/test\.js/);
  assert.match(result, /\+\+\+ b\/lwc\/test\/test\.js/);
  assert.match(result, /@@ -1,3 \+1,3 @@/);
  assert.match(result, /-line2/);
  assert.match(result, /\+line2 modified/);
});

test('diff detects identical, modified, and missing files in SFDX project', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-diff-'));
  const pkgDefault = path.join(projectRoot, 'force-app', 'main', 'default');

  try {
    await mkdir(path.join(pkgDefault, 'lwc', 'modal'), { recursive: true });
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

    // 1. Initial state: No files installed yet -> all files should be 'missing'
    const initialDiff = await diff('modal', { from: root, cwd: projectRoot });
    assert.equal(initialDiff.name, 'modal');
    assert.equal(initialDiff.identical, false);
    assert.ok(initialDiff.files.every(f => f.status === 'missing'));

    // 2. Install modal via CLI
    await execFileAsync('node', [BIN, 'add', 'modal', '--from', root, '--cwd', projectRoot]);

    // Now diff should be identical
    const afterInstallDiff = await diff('modal', { from: root, cwd: projectRoot });
    assert.equal(afterInstallDiff.identical, true);
    assert.ok(afterInstallDiff.files.every(f => f.status === 'identical'));

    // 3. Customize local modal.js
    const localModalJs = path.join(pkgDefault, 'lwc', 'modal', 'modal.js');
    await writeFile(localModalJs, '// Customized locally\nexport default class Modal {};\n');

    const customizedDiff = await diff('modal', { from: root, cwd: projectRoot });
    assert.equal(customizedDiff.identical, false);
    const jsFile = customizedDiff.files.find(f => f.file === 'lwc/modal/modal.js');
    assert.ok(jsFile);
    assert.equal(jsFile.status, 'modified');
    assert.ok(jsFile.diff.includes('+export default class Modal {};'));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('cli diff exits with code 0 on identical and code 1 on divergence', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-diff-cli-'));
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

    // Install component
    await execFileAsync('node', [BIN, 'add', 'toast-utils', '--from', root, '--cwd', projectRoot]);

    // 1. diff identical -> exit code 0
    const { stdout: identicalOut } = await execFileAsync('node', [
      BIN,
      'diff',
      'toast-utils',
      '--from',
      root,
      '--cwd',
      projectRoot
    ]);
    assert.match(identicalOut, /matches registry exactly/);

    // 2. Modify file -> exit code 1
    const localJs = path.join(pkgDefault, 'lwc', 'toastUtils', 'toastUtils.js');
    await writeFile(localJs, '// local edit\n');

    await assert.rejects(
      execFileAsync('node', [BIN, 'diff', 'toast-utils', '--from', root, '--cwd', projectRoot]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stdout, /Differences found in 'toast-utils'/);
        assert.match(err.stdout, /● lwc\/toastUtils\/toastUtils\.js \(modified\)/);
        return true;
      }
    );

    // 3. diff --json mode exits 0 and returns valid JSON even when modified
    const { stdout: jsonOut } = await execFileAsync('node', [
      BIN,
      'diff',
      'toast-utils',
      '--from',
      root,
      '--cwd',
      projectRoot,
      '--json'
    ]);
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.name, 'toast-utils');
    assert.equal(parsed.identical, false);
    assert.ok(Array.isArray(parsed.files));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
