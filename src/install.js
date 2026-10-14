import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeLabels } from './labels.js';

const exists = (p) => access(p).then(() => true, () => false);
export const LOCK_FILE = 'sf-lwc.lock.json';

export async function readLock(root) {
  try { return JSON.parse(await readFile(path.join(root, LOCK_FILE), 'utf8')); }
  catch { return { components: {} }; }
}

export async function install({ source, manifests, project, overwrite = false, dryRun = false, log = console.log }) {
  const lock = await readLock(project.root);
  const notes = [];
  const verb = dryRun ? 'would write' : 'write';

  for (const m of manifests) {
    const prev = lock.components[m.name];
    if (prev && prev.version === m.version && !overwrite) {
      log(`= ${m.name}@${m.version} already installed`);
      continue;
    }
    if (project.apiVersion && parseFloat(project.apiVersion) < parseFloat(m.apiVersion)) {
      log(`! ${m.name} needs API ${m.apiVersion}; project sourceApiVersion is ${project.apiVersion}`);
    }
    log(`+ ${m.name}@${m.version}`);

    const written = [];
    for (const rel of m.files) {
      const dest = path.join(project.targetRoot, rel);
      if ((await exists(dest)) && !overwrite) { log(`    skip (exists)  ${rel}`); continue; }
      const data = await source.read(`components/${m.name}/files/${rel}`);
      log(`    ${verb}  ${rel}`);
      if (!dryRun) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data);
      }
      written.push(rel);
    }

    if (m.labels?.length) {
      const labelFile = path.join(project.targetRoot, 'labels', 'CustomLabels.labels-meta.xml');
      const current = (await exists(labelFile)) ? await readFile(labelFile, 'utf8') : null;
      const { xml, added, skipped } = mergeLabels(current, m.labels);
      if (added.length) {
        log(`    ${dryRun ? 'would merge' : 'merge'}  labels: ${added.join(', ')}`);
        if (!dryRun) {
          await mkdir(path.dirname(labelFile), { recursive: true });
          await writeFile(labelFile, xml);
        }
      }
      if (skipped.length) log(`    skip (exists)  labels: ${skipped.join(', ')}`);
    }

    lock.components[m.name] = {
      version: m.version,
      files: written.length ? written : prev?.files ?? [],
      labels: (m.labels ?? []).map((l) => l.fullName),
      dependencies: m.dependencies ?? []
    };
    for (const n of m.notes ?? []) notes.push(`[${m.name}] ${n}`);
  }

  if (!dryRun) await writeFile(path.join(project.root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
  return notes;
}
