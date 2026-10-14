import { access, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pruneLabels } from './labels.js';
import { LOCK_FILE, readLock } from './install.js';

const exists = (p) => access(p).then(() => true, () => false);

async function pruneEmptyDirs(fromDir, stopAtDir) {
  let dir = fromDir;
  while (dir.startsWith(stopAtDir) && dir !== stopAtDir) {
    const items = await readdir(dir);
    if (items.length) break;
    await rmdir(dir);
    dir = path.dirname(dir);
  }
}

function findBlockingDependents(lock, namesToRemove) {
  const blocking = new Map();
  for (const [componentName, component] of Object.entries(lock.components ?? {})) {
    if (namesToRemove.has(componentName)) continue;
    for (const dep of component.dependencies ?? []) {
      if (!namesToRemove.has(dep)) continue;
      const list = blocking.get(dep) ?? [];
      list.push(componentName);
      blocking.set(dep, list);
    }
  }
  return blocking;
}

export async function remove({ names, project, dryRun = false, force = false, log = console.log }) {
  const lock = await readLock(project.root);
  const installed = lock.components ?? {};
  const uniqueNames = [...new Set(names)];
  for (const name of uniqueNames) {
    if (!installed[name]) throw new Error(`Component "${name}" is not installed.`);
  }

  const namesToRemove = new Set(uniqueNames);
  const blocking = findBlockingDependents(lock, namesToRemove);
  if (blocking.size && !force) {
    const [name, dependents] = [...blocking.entries()][0];
    throw new Error(`Cannot remove "${name}" because installed components depend on it: ${dependents.join(', ')}. Use --force to continue.`);
  }

  for (const name of uniqueNames) {
    const component = installed[name];
    log(`- ${name}@${component.version}`);

    for (const rel of component.files ?? []) {
      const file = path.join(project.targetRoot, rel);
      if (!(await exists(file))) continue;
      log(`    ${dryRun ? 'would delete' : 'delete'}  ${rel}`);
      if (!dryRun) {
        await unlink(file);
        await pruneEmptyDirs(path.dirname(file), project.targetRoot);
      }
    }

    const labelNames = component.labels ?? [];
    if (labelNames.length) {
      const labelFile = path.join(project.targetRoot, 'labels', 'CustomLabels.labels-meta.xml');
      if (await exists(labelFile)) {
        const current = await readFile(labelFile, 'utf8');
        const { xml, removed } = pruneLabels(current, labelNames);
        if (removed.length) {
          log(`    ${dryRun ? 'would prune' : 'prune'}  labels: ${removed.join(', ')}`);
          if (!dryRun) await writeFile(labelFile, xml);
        }
      }
    }

    if (!dryRun) delete lock.components[name];
  }

  if (dryRun) return;
  if (!Object.keys(lock.components).length) {
    const lockPath = path.join(project.root, LOCK_FILE);
    if (await exists(lockPath)) await unlink(lockPath);
    return;
  }
  await writeFile(path.join(project.root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
}
