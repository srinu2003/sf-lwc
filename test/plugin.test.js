import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, 'packages', 'plugin-lwc');

test('plugin-lwc command classes load and initialize successfully', async () => {
  const addMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'add.js')).href);
  const diffMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'diff.js')).href);
  const doctorMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'doctor.js')).href);
  const packMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'pack.js')).href);
  const updateMod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'commands', 'lwc', 'update.js')).href);

  assert.ok(addMod.default);
  assert.equal(typeof addMod.default.summary, 'string');
  assert.ok(diffMod.default);
  assert.equal(typeof diffMod.default.summary, 'string');
  assert.ok(doctorMod.default);
  assert.equal(typeof doctorMod.default.summary, 'string');
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
