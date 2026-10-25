#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createSource } from '../src/source.js';
import { resolve } from '../src/resolve.js';
import { findProject } from '../src/project.js';
import { install } from '../src/install.js';
import { remove } from '../src/remove.js';
import { listComponents, formatComponentList } from '../src/list.js';
import { init, readConfig } from '../src/init.js';
import { pack } from '../src/pack.js';

const HELP = `sf-lwc — add open-source LWC components to a Salesforce DX project

Usage:
  sf-lwc init [options]
  sf-lwc add <component...> [options]
  sf-lwc remove <component...> [options]
  sf-lwc rm <component...> [options]
  sf-lwc list [options]
  sf-lwc ls [options]
  sf-lwc pack <component> [options]
  sf-lwc export <component> [options]

Options:
  --from <registry>       owner/repo[@ref] on GitHub, or a local path
                          (default: registry in sf-lwc.json or $SF_LWC_REGISTRY)
  --registry <reg>        alias for --from
  -o, --target-org <org>  target Salesforce org (default: default org)
  -d, --output <dir>      target destination directory (default: components/<component>)
  -w, --overwrite         replace files or destination that already exist
  --dry-run               show what would happen, change nothing
  --force                 force overwrite (init) or remove even with dependents (remove)
  --json                  output in JSON format
  --cwd <dir>             project directory (default: current)
  -h, --help              show this help
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      registry: { type: 'string' },
      'target-org': { type: 'string', short: 'o' },
      output: { type: 'string', short: 'd' },
      overwrite: { type: 'boolean', short: 'w', default: false },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      cwd: { type: 'string', default: process.cwd() },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  const [cmd, ...names] = positionals;
  if (values.help || !cmd) return console.log(HELP);
  if (!['init', 'add', 'remove', 'rm', 'list', 'ls', 'pack', 'export'].includes(cmd)) {
    throw new Error(`Unknown command "${cmd}". Try --help.`);
  }

  if ((cmd === 'pack' || cmd === 'export') && !names.length) {
    throw new Error('Specify a component name to pack, e.g. sf-lwc pack myComponent');
  }
  if (['add', 'remove', 'rm'].includes(cmd) && !names.length) {
    throw new Error(`Specify at least one component, e.g. sf-lwc ${cmd} data-table`);
  }

  let project;
  try {
    project = await findProject(values.cwd);
  } catch (err) {
    if (!['list', 'ls'].includes(cmd)) throw err;
  }

  if (cmd === 'init') {
    console.log(`Project:  ${project.root}\n`);
    const defaultRegistry = 'srinu2003/sf-lwc@main';
    const registry = values.from ?? values.registry ?? process.env.SF_LWC_REGISTRY ?? defaultRegistry;
    await init({
      project,
      registry,
      force: values.force,
      dryRun: values['dry-run']
    });
    console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    return;
  }

  if (cmd === 'remove' || cmd === 'rm') {
    console.log(`Project:  ${project.root}\n`);
    await remove({
      names,
      project,
      dryRun: values['dry-run'],
      force: values.force
    });
    console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    return;
  }

  if (cmd === 'pack' || cmd === 'export') {
    const componentName = names[0];
    const projectRoot = project ? project.root : values.cwd;
    const packageDefault = project ? project.targetRoot : undefined;

    await pack(componentName, {
      targetOrg: values['target-org'],
      output: values.output,
      overwrite: values.overwrite,
      dryRun: values['dry-run'],
      json: values.json,
      projectRoot,
      packageDefault
    });
    return;
  }

  const config = project ? await readConfig(project.root) : null;
  const envRegistry = process.env.SF_LWC_REGISTRY?.trim() || undefined;
  const spec = values.from ?? values.registry ?? envRegistry ?? config?.registry;
  if (!spec) {
    throw new Error('No registry. Run "sf-lwc init", pass --from owner/repo, or set SF_LWC_REGISTRY.');
  }

  const source = createSource(spec);
  if (cmd === 'add') {
    console.log(`Registry: ${source.label}\nProject:  ${project.root}\n`);

    const manifests = await resolve(source, names);
    const notes = await install({
      source, manifests, project,
      overwrite: values.overwrite, dryRun: values['dry-run']
    });

    console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    if (notes.length) console.log('\nManual steps:\n' + notes.map((n) => `  - ${n}`).join('\n'));
    return;
  }

  if (names.length) throw new Error(`"${cmd}" does not take component names. Try: sf-lwc ${cmd}`);
  const components = await listComponents(source, spec);
  console.log(`Registry: ${source.label}\n`);
  console.log(formatComponentList(components));
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
