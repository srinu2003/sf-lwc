import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { init, readConfig, CONFIG_FILE } from '../src/init.js';
import { findProject } from '../src/project.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_REPO = path.join(root, 'fixtures', 'sfdx-repo');

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function setupProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-init-'));
  await mkdir(path.join(projectRoot, 'force-app', 'main', 'default'), { recursive: true });
  await writeFile(path.join(projectRoot, 'sfdx-project.json'), JSON.stringify({
    packageDirectories: [{ path: 'force-app', default: true }],
    sourceApiVersion: '62.0'
  }, null, 2));
  return projectRoot;
}

test('init creates sf-lwc.json with specified registry', async () => {
  const projectRoot = await setupProject();
  const project = await findProject(projectRoot);

  await init({ project, registry: 'test/repo@main' });

  const configPath = path.join(projectRoot, CONFIG_FILE);
  assert.equal(await exists(configPath), true);

  const config = await readConfig(projectRoot);
  assert.equal(config.registry, 'test/repo@main');
});

test('init rejects overwrite when file exists without --force', async () => {
  const projectRoot = await setupProject();
  const project = await findProject(projectRoot);

  await init({ project, registry: 'test/repo@v1' });

  await assert.rejects(
    init({ project, registry: 'test/repo@v2' }),
    /Config file "sf-lwc.json" already exists\. Use --force to overwrite\./
  );

  await init({ project, registry: 'test/repo@v2', force: true });
  const config = await readConfig(projectRoot);
  assert.equal(config.registry, 'test/repo@v2');
});

test('init dry-run does not create sf-lwc.json', async () => {
  const projectRoot = await setupProject();
  const project = await findProject(projectRoot);

  await init({ project, registry: 'test/repo@main', dryRun: true });

  const configPath = path.join(projectRoot, CONFIG_FILE);
  assert.equal(await exists(configPath), false);
});

test('cli init creates config file with default or custom registry', async () => {
  const projectRoot = await setupProject();

  const { stdout } = await execFileAsync(
    'node',
    ['bin/sf-lwc.js', 'init', '--from', FIXTURE_REPO, '--cwd', projectRoot],
    { cwd: root }
  );

  assert.match(stdout, /Done\./);
  const config = JSON.parse(await readFile(path.join(projectRoot, CONFIG_FILE), 'utf8'));
  assert.equal(config.registry, FIXTURE_REPO);
});

test('cli list and add commands pick up registry from sf-lwc.json without --from', async () => {
  const projectRoot = await setupProject();

  // Initialize with local root registry
  await execFileAsync(
    'node',
    ['bin/sf-lwc.js', 'init', '--from', FIXTURE_REPO, '--cwd', projectRoot],
    { cwd: root }
  );

  // List components without --from or env var
  const { stdout: listOut } = await execFileAsync(
    'node',
    ['bin/sf-lwc.js', 'list', '--cwd', projectRoot],
    { cwd: root, env: { ...process.env, SF_LWC_REGISTRY: '' } }
  );
  assert.match(listOut, /- dataTable@1\.0\.0/);
  assert.match(listOut, /- toastUtils@1\.0\.0/);

  // Add component without --from or env var
  const { stdout: addOut } = await execFileAsync(
    'node',
    ['bin/sf-lwc.js', 'add', 'toast-utils', '--cwd', projectRoot],
    { cwd: root, env: { ...process.env, SF_LWC_REGISTRY: '' } }
  );
  assert.match(addOut, /Done\./);
  assert.equal(await exists(path.join(projectRoot, 'force-app', 'main', 'default', 'lwc', 'toastUtils', 'toastUtils.js')), true);
});
