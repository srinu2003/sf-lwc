import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_REPO = path.join(root, 'fixtures', 'sfdx-repo');
const pluginDir = path.join(root, 'packages', 'plugin-lwc');

function createTempProject(prefix = 'sf-lwc-plugin-test-') {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const pkgDefault = path.join(tmpProject, 'force-app', 'main', 'default');
  fs.mkdirSync(pkgDefault, { recursive: true });
  fs.writeFileSync(
    path.join(tmpProject, 'sfdx-project.json'),
    JSON.stringify(
      {
        packageDirectories: [{ path: 'force-app', default: true }],
        sourceApiVersion: '62.0',
      },
      null,
      2
    )
  );
  return tmpProject;
}

test('plugin-lwc command classes load and initialize successfully', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const diffMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'diff.js')).href);
  const doctorMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'doctor.js')).href);
  const listMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'list.js')).href);
  const packMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'pack.js')).href);
  const updateMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'update.js')).href);

  assert.ok(addMod.default);
  assert.equal(typeof addMod.default.summary, 'string');
  assert.equal(addMod.default.args.component.required, false);
  assert.equal(addMod.default.strict, false);

  assert.ok(diffMod.default);
  assert.equal(typeof diffMod.default.summary, 'string');
  assert.ok(doctorMod.default);
  assert.equal(typeof doctorMod.default.summary, 'string');
  assert.ok(listMod.default);
  assert.equal(typeof listMod.default.summary, 'string');
  assert.ok(packMod.default);
  assert.equal(typeof packMod.default.summary, 'string');
  assert.ok(updateMod.default);
  assert.equal(typeof updateMod.default.summary, 'string');
});

test('sf lwc command responds to --help via linked plugin', async (t) => {
  try {
    const { stdout } = await execFileAsync('sf.cmd', ['lwc', '--help'], {
      windowsHide: true,
      shell: true,
    });
    assert.match(stdout, /manage and install open-source LWC components/);
    assert.match(stdout, /lwc add/);
    assert.match(stdout, /lwc diff/);
    assert.match(stdout, /lwc doctor/);
    assert.match(stdout, /lwc list/);
    assert.match(stdout, /lwc pack/);
    assert.match(stdout, /lwc update/);
  } catch (err) {
    if (err.code === 'ENOENT') {
      t.skip('sf CLI binary not in PATH');
    } else {
      throw err;
    }
  }
});

test('sf lwc add --help reflects updated arguments and descriptions', async (t) => {
  try {
    const { stdout } = await execFileAsync('sf.cmd', ['lwc', 'add', '--help'], {
      windowsHide: true,
      shell: true,
    });
    assert.match(stdout, /\[SOURCEORCOMPONENT\.\.\.\]/);
    assert.match(stdout, /\[COMPONENT\.\.\.\]/);
    assert.match(stdout, /interactive/i);
    assert.match(stdout, /sf lwc add/);
    assert.match(stdout, /sf lwc add svierk\/awesome-lwc-collection qrCodeGenerator/);
  } catch (err) {
    if (err.code === 'ENOENT') {
      t.skip('sf CLI binary not in PATH');
    } else {
      throw err;
    }
  }
});

test('sf lwc add in non-interactive environment fails fast with descriptive error', async (t) => {
  try {
    await execFileAsync('sf.cmd', ['lwc', 'add', '--from', '.'], {
      windowsHide: true,
      shell: true,
    });
    assert.fail('Command should have exited with non-zero');
  } catch (err) {
    if (err.code === 'ENOENT') {
      t.skip('sf CLI binary not in PATH');
      return;
    }
    const combinedOutput = (err.stderr || '') + (err.stdout || '');
    assert.match(
      combinedOutput,
      /No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf lwc add <component>/
    );
  }
});

test('LwcAdd programmatic execution in non-interactive environment throws descriptive SfError', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const LwcAdd = addMod.default;

  const prevExitCode = process.exitCode;
  try {
    await assert.rejects(
      async () => {
        await LwcAdd.run(['--from', '.']);
      },
      (err) => {
        assert.match(
          err.message,
          /No component specified and terminal is non-interactive\. Specify at least one component, e.g\. sf lwc add <component>/
        );
        return true;
      }
    );
  } finally {
    process.exitCode = prevExitCode;
  }
});

test('LwcAdd programmatic execution without source repository throws NoSourceSpecified', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const LwcAdd = addMod.default;

  const tmpProject = createTempProject('sf-lwc-no-source-');
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  const prevRegistry = process.env.SF_LWC_REGISTRY;
  delete process.env.SF_LWC_REGISTRY;

  try {
    process.chdir(tmpProject);
    await assert.rejects(
      async () => {
        await LwcAdd.run(['modal']);
      },
      (err) => {
        assert.match(
          err.message,
          /No source repository specified/
        );
        return true;
      }
    );
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmpProject, { recursive: true, force: true });
    if (prevRegistry) process.env.SF_LWC_REGISTRY = prevRegistry;
    process.exitCode = prevExitCode;
  }
});

test('LwcAdd programmatic execution with component installs cleanly in dry-run mode', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const LwcAdd = addMod.default;

  const tmpProject = createTempProject('sf-lwc-plugin-add-dry-');
  const prevCwd = process.cwd();

  try {
    process.chdir(tmpProject);
    const result = await LwcAdd.run(['modal', '--from', FIXTURE_REPO, '--dry-run']);

    assert.equal(result.dryRun, true);
    assert.equal(Array.isArray(result.installed), true);
    assert.equal(result.installed.length, 1);
    assert.equal(result.installed[0].name, 'modal');
    assert.equal(result.installed[0].version, '1.0.0');
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('LwcAdd programmatic execution supports multiple space-separated and comma-separated components', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const LwcAdd = addMod.default;

  const tmpProject = createTempProject('sf-lwc-plugin-add-multi-');
  const prevCwd = process.cwd();

  try {
    process.chdir(tmpProject);

    // 1. Space-separated multiple arguments
    const resultSpace = await LwcAdd.run(['modal', 'toast-utils', '--from', FIXTURE_REPO, '--dry-run']);
    assert.equal(resultSpace.dryRun, true);
    assert.equal(resultSpace.installed.length, 2);
    const spaceNames = resultSpace.installed.map((c) => c.name).sort();
    assert.deepEqual(spaceNames.map(n => n.toLowerCase().replace(/[-_]/g, '')), ['modal', 'toastutils']);

    // 2. Comma-separated component string
    const resultComma = await LwcAdd.run(['modal,toast-utils', '--from', FIXTURE_REPO, '--dry-run']);
    assert.equal(resultComma.dryRun, true);
    assert.equal(resultComma.installed.length, 2);
    const commaNames = resultComma.installed.map((c) => c.name).sort();
    assert.deepEqual(commaNames.map(n => n.toLowerCase().replace(/[-_]/g, '')), ['modal', 'toastutils']);
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

test('sf lwc add modal --dry-run --json via CLI produces clean JSON without stdout pollution', async (t) => {
  const sfCmd = process.platform === 'win32' ? 'sf.cmd' : 'sf';
  const tmpProject = createTempProject('sf-lwc-plugin-json-');
  const prevExitCode = process.exitCode;

  try {
    const res = await execFileAsync(
      sfCmd,
      ['lwc', 'add', 'modal', '--from', FIXTURE_REPO, '--dry-run', '--json'],
      {
        cwd: tmpProject,
        windowsHide: true,
        shell: true,
      }
    );

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(res.stdout);
    }, `res.stdout must be valid JSON, received:\n${res.stdout}`);

    assert.equal(parsed.status, 0);
    assert.ok(parsed.result && Array.isArray(parsed.result.installed));
    assert.deepEqual(parsed.result.installed, [{ name: 'modal', version: '1.0.0' }]);
    assert.equal(parsed.result.dryRun, true);

    assert.equal(res.stdout.includes('+ modal@1.0.0'), false, 'stdout must not contain install banner');
    assert.equal(res.stdout.includes('would write'), false, 'stdout must not contain write progress');
  } catch (err) {
    if (err.code === 'ENOENT') {
      t.skip('sf CLI binary not in PATH');
      return;
    }
    throw err;
  } finally {
    process.exitCode = prevExitCode;
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});
