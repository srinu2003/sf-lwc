#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createSource, isSourceSpec } from '../src/source.js';
import { resolve } from '../src/resolve.js';
import { findProject } from '../src/project.js';
import { install } from '../src/install.js';
import { remove } from '../src/remove.js';
import { listComponents, formatComponentList } from '../src/list.js';
import { init, readConfig } from '../src/init.js';
import { pack } from '../src/pack.js';
import { diff } from '../src/diff.js';
import { update } from '../src/update.js';
import { doctor } from '../src/doctor.js';
import { selectComponents } from '../src/selector.js';

const HELP = `sf-lwc — add open-source LWC components to a Salesforce DX project

Usage:
  sf-lwc init [options]
  sf-lwc doctor [options]
  sf-lwc add [source] [component...] [options]
  sf-lwc update [component...] [options]
  sf-lwc remove <component...> [options]
  sf-lwc rm <component...> [options]
  sf-lwc diff <component> [options]
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
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      cwd: { type: 'string', default: process.cwd() },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  const [cmd, ...names] = positionals;
  if (values.help || !cmd) return console.log(HELP);
  if (!['init', 'add', 'remove', 'rm', 'diff', 'update', 'doctor', 'list', 'ls', 'pack', 'export'].includes(cmd)) {
    throw new Error(`Unknown command "${cmd}". Try --help.`);
  }

  if ((cmd === 'pack' || cmd === 'export') && !names.length) {
    throw new Error('Specify a component name to pack, e.g. sf-lwc pack myComponent');
  }
  if (['remove', 'rm'].includes(cmd) && !names.length) {
    throw new Error(`Specify at least one component, e.g. sf-lwc ${cmd} data-table`);
  }

  let project;
  try {
    project = await findProject(values.cwd);
  } catch (err) {
    if (!['list', 'ls'].includes(cmd)) throw err;
  }

  if (cmd === 'doctor') {
    const res = await doctor({
      cwd: values.cwd,
      json: values.json
    });

    if (values.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    }

    console.log('=== sf-lwc Doctor Diagnostic Report ===\n');
    for (const c of res.checks) {
      if (c.status === 'pass') {
        console.log(`  \x1b[32m✔\x1b[0m ${c.name}: ${c.message}`);
      } else if (c.status === 'warn') {
        console.log(`  \x1b[33m!\x1b[0m ${c.name}: ${c.message}`);
      } else {
        console.log(`  \x1b[31m✖\x1b[0m ${c.name}: ${c.message}`);
      }
    }
    console.log('');
    if (res.ok) {
      console.log('\x1b[32mAll health checks passed! Project is ready.\x1b[0m\n');
      process.exit(0);
    } else {
      console.log('\x1b[31mIssues detected. Please review the failures above.\x1b[0m\n');
      process.exit(1);
    }
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

  if (cmd === 'update') {
    const res = await update({
      names,
      all: values.all,
      from: values.from ?? values.registry,
      cwd: values.cwd,
      dryRun: values['dry-run'],
      force: values.force,
      json: values.json
    });
    if (values.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    }
    console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    return;
  }

  if (cmd === 'diff') {
    if (!names.length) {
      throw new Error('Specify a component name to diff, e.g. sf-lwc diff modal');
    }
    const componentName = names[0];
    const result = await diff(componentName, {
      from: values.from ?? values.registry,
      cwd: values.cwd,
      json: values.json
    });

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    if (result.identical) {
      console.log(`\x1b[32m✔\x1b[0m Component '${componentName}' matches registry exactly.`);
      process.exit(0);
    }

    console.log(`\x1b[33m!\x1b[0m Differences found in '${componentName}':\n`);
    for (const file of result.files) {
      if (file.status === 'identical') {
        console.log(`\x1b[32m  ✔ ${file.file} (identical)\x1b[0m`);
      } else if (file.status === 'missing') {
        console.log(`\x1b[31m  ✖ ${file.file} (missing locally)\x1b[0m`);
      } else if (file.status === 'modified') {
        console.log(`\x1b[33m  ● ${file.file} (modified)\x1b[0m`);
        if (file.diff) {
          const lines = file.diff.split('\n');
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              console.log(`\x1b[32m${line}\x1b[0m`);
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              console.log(`\x1b[31m${line}\x1b[0m`);
            } else if (line.startsWith('@@')) {
              console.log(`\x1b[36m${line}\x1b[0m`);
            } else {
              console.log(line);
            }
          }
          console.log('');
        }
      }
    }
    process.exit(1);
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

  let detectedSource = values.from ?? values.registry ?? envRegistry ?? config?.registry;
  const remainingComponentTokens = [];

  for (let i = 0; i < names.length; i++) {
    const token = names[i];
    if (i === 0 && !values.from && !values.registry && isSourceSpec(token)) {
      detectedSource = token;
    } else {
      remainingComponentTokens.push(token);
    }
  }

  const spec = detectedSource;
  if (!spec) {
    throw new Error('No source repository specified. Pass a repository or project path, e.g.: sf-lwc add <owner/repo> [component] or pass --from <owner/repo>');
  }

  const source = createSource(spec);
  if (cmd === 'add') {
    let targetNames = Array.from(
      new Set(
        remainingComponentTokens
          .flatMap((token) => token.split(','))
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );

    if (!targetNames.length) {
      if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || values.json) {
        throw new Error('No component specified and terminal is non-interactive. Specify at least one component, e.g. sf-lwc add <component>');
      }
      const components = await listComponents(source, spec);
      if (!components.length) {
        throw new Error(`No components found in repository "${source.label}".`);
      }
      targetNames = await selectComponents(components);
      if (!targetNames.length) {
        console.log('No components selected.');
        return;
      }
    }

    console.log(`Registry: ${source.label}\nProject:  ${project.root}\n`);

    const manifests = await resolve(source, targetNames);
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
