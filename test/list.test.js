import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSource } from '../src/source.js';
import { listComponents } from '../src/list.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('listComponents reads local registry manifests', async () => {
  const source = createSource(root);
  const components = await listComponents(source, root);
  assert.deepEqual(
    components.map((component) => component.name),
    ['data-table', 'toast-utils']
  );
  assert.equal(components[0].version, '1.0.0');
  assert.deepEqual(components[0].dependencies, ['toast-utils']);
});

test('cli list command prints component details', async () => {
  const { stdout } = await execFileAsync('node', ['bin/sf-lwc.js', 'list', '--from', root], { cwd: root });
  assert.match(stdout, /Registry:\s+/);
  assert.match(stdout, /- data-table@1\.0\.0/);
  assert.match(stdout, /Config-driven record table backed by an Apex controller\./);
  assert.match(stdout, /dependencies: toast-utils/);
  assert.match(stdout, /- toast-utils@1\.0\.0/);
});

test('cli ls alias works', async () => {
  const { stdout } = await execFileAsync('node', ['bin/sf-lwc.js', 'ls', '--from', root], { cwd: root });
  assert.match(stdout, /- data-table@1\.0\.0/);
});
