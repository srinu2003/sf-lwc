import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exists = (p) => access(p).then(() => true, () => false);
export const CONFIG_FILE = 'sf-lwc.json';

export async function readConfig(root) {
  try {
    const filePath = path.join(root, CONFIG_FILE);
    if (!(await exists(filePath))) return null;
    const content = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function init({ project, registry, force = false, dryRun = false, log = console.log }) {
  const filePath = path.join(project.root, CONFIG_FILE);
  if ((await exists(filePath)) && !force) {
    throw new Error(`Config file "${CONFIG_FILE}" already exists. Use --force to overwrite.`);
  }

  const config = {
    registry
  };

  const verb = dryRun ? 'would write' : 'write';
  log(`+ ${CONFIG_FILE} (registry: ${registry})`);
  log(`    ${verb}  ${CONFIG_FILE}`);

  if (!dryRun) {
    await writeFile(filePath, JSON.stringify(config, null, 2) + '\n');
  }
}
