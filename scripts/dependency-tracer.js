export {
  pack,
  packComponent,
  exportComponent,
  METADATA_REGISTRY,
  toKebabCase,
  parseLabelBlock,
  getAllFilesRecursively
} from '../src/pack.js';

import { exportComponent } from '../src/pack.js';

if (process.argv[1]?.includes('dependency-tracer.js')) {
  const comp = process.argv[2] || 'spikeDemoComponent';
  const org = process.argv[3] || 'devOrg';
  const project = process.argv[4] || 'c:\\Users\\tsiri\\Projects\\custom-lwc';
  exportComponent(comp, { targetOrg: org, projectRoot: project }).catch((err) => {
    console.error('Export error:', err.message);
    process.exit(1);
  });
}
