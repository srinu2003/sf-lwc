#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createSource } from '../src/source.js';
import { resolve } from '../src/resolve.js';
import { findProject } from '../src/project.js';
import { install } from '../src/install.js';

const HELP = `sf-lwc — add open-source LWC components to a Salesforce DX project

Usage:
  sf-lwc add <component...> [options]

Options:
  --from <registry>   owner/repo[@ref] on GitHub, or a local path
                      (default: $SF_LWC_REGISTRY)
  --overwrite         replace files that already exist
  --dry-run           show what would happen, change nothing
  --cwd <dir>         project directory (default: current)
  -h, --help          show this help
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      overwrite: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      cwd: { type: 'string', default: process.cwd() },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  const [cmd, ...names] = positionals;
  if (values.help || !cmd) return console.log(HELP);
  if (cmd !== 'add') throw new Error(`Unknown command "${cmd}". Try --help.`);
  if (!names.length) throw new Error('Specify at least one component, e.g. sf-lwc add data-table');

  const spec = values.from ?? process.env.SF_LWC_REGISTRY;
  if (!spec) throw new Error('No registry. Pass --from owner/repo or set SF_LWC_REGISTRY.');

  const source = createSource(spec);
  const project = await findProject(values.cwd);
  console.log(`Registry: ${source.label}\nProject:  ${project.root}\n`);

  const manifests = await resolve(source, names);
  const notes = await install({
    source, manifests, project,
    overwrite: values.overwrite, dryRun: values['dry-run']
  });

  console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
  if (notes.length) console.log('\nManual steps:\n' + notes.map((n) => `  - ${n}`).join('\n'));
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
