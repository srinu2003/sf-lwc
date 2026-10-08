import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const exists = (p) => access(p).then(() => true, () => false);

export async function findProject(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(dir, 'sfdx-project.json');
    if (await exists(file)) {
      const cfg = JSON.parse(await readFile(file, 'utf8'));
      const dirs = cfg.packageDirectories ?? [];
      const def = dirs.find((d) => d.default) ?? dirs[0];
      return {
        root: dir,
        targetRoot: path.join(dir, def?.path ?? 'force-app', 'main', 'default'),
        apiVersion: cfg.sourceApiVersion
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('No sfdx-project.json found. Run this inside a Salesforce DX project.');
    dir = parent;
  }
}
