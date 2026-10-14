import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSource } from '../src/source.js';
import { resolve } from '../src/resolve.js';
import { install, LOCK_FILE } from '../src/install.js';
import { remove } from '../src/remove.js';
import { findProject } from '../src/project.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function setupProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-remove-'));
  await mkdir(path.join(projectRoot, 'force-app', 'main', 'default'), { recursive: true });
  await writeFile(path.join(projectRoot, 'sfdx-project.json'), JSON.stringify({
    packageDirectories: [{ path: 'force-app', default: true }],
    sourceApiVersion: '62.0'
  }, null, 2));
  return projectRoot;
}

async function installComponents(projectRoot, names) {
  const source = createSource(root);
  const manifests = await resolve(source, names);
  const project = await findProject(projectRoot);
  await install({ source, manifests, project });
  return project;
}

test('remove deletes tracked files, prunes labels, and updates lockfile', async () => {
  const projectRoot = await setupProject();
  const project = await installComponents(projectRoot, ['data-table']);

  await remove({ names: ['data-table'], project });

  assert.equal(await exists(path.join(project.targetRoot, 'lwc', 'dataTable', 'dataTable.js')), false);
  assert.equal(await exists(path.join(project.targetRoot, 'lwc', 'dataTable')), false);
  assert.equal(await exists(path.join(project.root, LOCK_FILE)), true);

  const lock = JSON.parse(await readFile(path.join(project.root, LOCK_FILE), 'utf8'));
  assert.equal(Boolean(lock.components['data-table']), false);
  assert.equal(Boolean(lock.components['toast-utils']), true);

  const labels = await readFile(path.join(project.targetRoot, 'labels', 'CustomLabels.labels-meta.xml'), 'utf8');
  assert.equal(labels.includes('DataTable_NoRecords'), false);
  assert.equal(labels.includes('DataTable_InvalidObject'), false);
});

test('remove blocks deleting dependencies unless force is set', async () => {
  const projectRoot = await setupProject();
  const project = await installComponents(projectRoot, ['data-table']);

  await assert.rejects(
    remove({ names: ['toast-utils'], project }),
    /Cannot remove "toast-utils" because installed components depend on it: data-table\. Use --force to continue\./
  );

  await remove({ names: ['toast-utils'], project, force: true });
  const lock = JSON.parse(await readFile(path.join(project.root, LOCK_FILE), 'utf8'));
  assert.equal(Boolean(lock.components['toast-utils']), false);
  assert.equal(Boolean(lock.components['data-table']), true);
});

test('remove dry-run does not modify files or lockfile', async () => {
  const projectRoot = await setupProject();
  const project = await installComponents(projectRoot, ['toast-utils']);
  const lockPath = path.join(project.root, LOCK_FILE);
  const before = await readFile(lockPath, 'utf8');

  await remove({ names: ['toast-utils'], project, dryRun: true });

  assert.equal(await exists(path.join(project.targetRoot, 'lwc', 'toastUtils', 'toastUtils.js')), true);
  const after = await readFile(lockPath, 'utf8');
  assert.equal(after, before);
});

test('cli rm alias removes installed component', async () => {
  const projectRoot = await setupProject();
  await installComponents(projectRoot, ['toast-utils']);

  const { stdout } = await execFileAsync('node', ['bin/sf-lwc.js', 'rm', 'toast-utils', '--cwd', projectRoot], { cwd: root });
  assert.match(stdout, /Done\./);
  assert.equal(await exists(path.join(projectRoot, LOCK_FILE)), false);
});
