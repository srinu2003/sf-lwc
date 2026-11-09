#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as p from '@clack/prompts';
import pc from 'picocolors';
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
import { selectComponents, isInteractiveSession } from '../src/selector.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

const LOGO_LINES = [
  '███████╗███████╗      ██╗     ██╗    ██╗ ██████╗ ',
  '██╔════╝██╔════╝      ██║     ██║    ██║██╔════╝ ',
  '███████╗█████╗  █████╗██║     ██║ █╗ ██║██║      ',
  '╚════██║██╔══╝  ╚════╝██║     ██║███╗██║██║      ',
  '███████║██║           ███████╗╚███╔███╔╝╚██████╗ ',
  '╚══════╝╚═╝           ╚══════╝ ╚══╝╚══╝  ╚═════╝ '
];

const GRAYS = [
  '\x1b[38;5;250m',
  '\x1b[38;5;248m',
  '\x1b[38;5;245m',
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m'
];

function showLogo() {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner() {
  showLogo();
  console.log();
  console.log(`${DIM}Add open-source LWC components & dependencies to your Salesforce DX project${RESET}`);
  console.log();
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc add ${DIM}<source> [component]${RESET}   ${DIM}Install an LWC component & dependencies${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc list ${DIM}[source]${RESET}              ${DIM}Discover available components in registry${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc pack ${DIM}<component>${RESET}           ${DIM}Export component & compile metadata dependencies${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc update ${DIM}[component]${RESET}         ${DIM}Update installed components to latest versions${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc remove ${DIM}<component>${RESET}         ${DIM}Safely remove an installed component${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc diff ${DIM}<component>${RESET}           ${DIM}Inspect local modifications vs registry version${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc doctor${RESET}                     ${DIM}Verify Salesforce DX project health & tooling${RESET}`);
  console.log(`  ${DIM}$${RESET} ${TEXT}sf-lwc init${RESET}                       ${DIM}Initialize project configuration${RESET}`);
  console.log();
  console.log(`${DIM}try:${RESET} sf-lwc add svierk/awesome-lwc-collection`);
  console.log();
}

const HELP = `
${BOLD}Usage:${RESET}
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

${BOLD}Commands:${RESET}
  add [source] [component...] Install LWC components & dependencies
  list, ls [source]           List components in source repository
  pack, export <component>    Package component & metadata from target org
  update [component...]       Update installed components to latest version
  remove, rm <component...>   Remove installed components cleanly
  diff <component>            Compare local component against registry
  doctor                      Verify project structure and integrity
  init                        Initialize sf-lwc.json configuration

${BOLD}Options:${RESET}
  --from <registry>           owner/repo[@ref] on GitHub, or a local path
                              (default: registry in sf-lwc.json or $SF_LWC_REGISTRY)
  --registry <reg>            alias for --from
  -o, --target-org <org>      target Salesforce org (default: default org)
  -d, --output <dir>          target destination directory
  -w, --overwrite             replace files or destination that already exist
  --dry-run                   simulate changes without modifying files
  --force                     force overwrite (init) or remove with dependents
  --json                      output results in machine-readable JSON
  --cwd <dir>                 project directory (default: current directory)
  -h, --help                  show this help
`;

const silentSpinner = {
  start: () => {},
  stop: () => {},
  message: () => {}
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      registry: { type: 'string' },
      'target-org': { type: 'string', short: 'o' },
      output: { type: 'string', short: 'd' },
      dist: { type: 'boolean', default: false },
      'max-depth': { type: 'string' },
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
  if (values.help || !cmd) {
    showBanner();
    console.log(HELP);
    return;
  }

  if (!['init', 'add', 'remove', 'rm', 'diff', 'update', 'doctor', 'list', 'ls', 'pack', 'export'].includes(cmd)) {
    throw new Error(`Unknown command "${cmd}". Try --help.`);
  }

  if ((cmd === 'pack' || cmd === 'export') && !names.length) {
    throw new Error('Specify a component name to pack, e.g. sf-lwc pack myComponent');
  }
  if (cmd === 'diff' && !names.length) {
    throw new Error('Specify a component name to diff, e.g. sf-lwc diff <component>');
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

  const isInteractive = isInteractiveSession(process.stdin, process.stdout, values);
  const isDisplayTty = Boolean(process.stdout.isTTY && !values.json);
  const spinner = (!isDisplayTty || values.json) ? silentSpinner : p.spinner();

  if (cmd === 'doctor') {
    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc doctor ')));
      spinner.start('Running project health diagnostics...');
    }

    const res = await doctor({
      cwd: values.cwd,
      json: values.json
    });

    if (isDisplayTty) {
      spinner.stop('Health diagnostics complete');
    }

    if (values.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    }

    if (isDisplayTty) {
      const checkLines = res.checks.map((c) => {
        const icon = c.status === 'pass' ? pc.green('✔') : c.status === 'warn' ? pc.yellow('!') : pc.red('✖');
        return `  ${icon} ${pc.bold(c.name)}: ${c.message}`;
      });
      p.note(checkLines.join('\n'), 'Diagnostic Report');
      if (res.ok) {
        console.log('\x1b[32mAll health checks passed! Project is ready.\x1b[0m\n');
        p.outro(pc.green('All health checks passed! Project is ready.'));
        process.exit(0);
      } else {
        console.log('\x1b[31mIssues detected. Please review the failures above.\x1b[0m\n');
        p.outro(pc.red('Issues detected. Please review the failures above.'));
        process.exit(1);
      }
    } else {
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
  }

  if (cmd === 'init') {
    const defaultRegistry = 'srinu2003/sf-lwc@main';
    const registry = values.from ?? values.registry ?? process.env.SF_LWC_REGISTRY ?? defaultRegistry;

    if (values.json) {
      await init({
        project,
        registry,
        force: values.force,
        dryRun: values['dry-run'],
        log: () => {}
      });
      console.log(JSON.stringify({ ok: true, configPath: path.join(project.root, 'sf-lwc.json'), registry, dryRun: values['dry-run'] }, null, 2));
      return;
    }

    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc init ')));
      spinner.start('Initializing project configuration...');
    } else {
      console.log(`Project:  ${project.root}\n`);
    }

    await init({
      project,
      registry,
      force: values.force,
      dryRun: values['dry-run']
    });

    if (isDisplayTty) {
      spinner.stop('Saved sf-lwc.json');
      p.note(`${pc.bold('Project:')}  ${project.root}\n${pc.bold('Registry:')} ${registry}`, 'Initialized Configuration');
      p.outro(values['dry-run'] ? pc.yellow('Dry run complete. Nothing was changed. Done.') : pc.green('Done. Project initialized successfully!'));
    } else {
      console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    }
    return;
  }

  if (cmd === 'remove' || cmd === 'rm') {
    if (values.json) {
      await remove({
        names,
        project,
        dryRun: values['dry-run'],
        force: values.force,
        log: () => {}
      });
      console.log(JSON.stringify({ ok: true, removed: names, dryRun: values['dry-run'] }, null, 2));
      return;
    }

    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc remove ')));
      spinner.start(`Verifying dependencies and removing ${names.join(', ')}...`);
    } else {
      console.log(`Project:  ${project.root}\n`);
    }

    await remove({
      names,
      project,
      dryRun: values['dry-run'],
      force: values.force
    });

    if (isDisplayTty) {
      spinner.stop('Components uninstalled and lockfile updated');
      p.note(`${pc.bold('Removed:')} ${names.join(', ')}\n${pc.bold('Project:')} ${project.root}`, 'Removal Summary');
      p.outro(values['dry-run'] ? pc.yellow('Dry run complete. Nothing was changed. Done.') : pc.green('Done. Component(s) removed successfully.'));
    } else {
      console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    }
    return;
  }

  if (cmd === 'update') {
    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc update ')));
      spinner.start('Checking installed components for upstream updates...');
    }

    const res = await update({
      names,
      all: values.all,
      from: values.from ?? values.registry,
      cwd: values.cwd,
      dryRun: values['dry-run'],
      force: values.force,
      json: values.json
    });

    if (isDisplayTty) {
      spinner.stop('Update check completed');
    }

    if (values.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    }

    if (isDisplayTty) {
      if (res.updated?.length) {
        const updateLines = res.updated.map(
          (u) => `  ${pc.green('✔')} ${pc.bold(u.name)} (${pc.dim(u.fromVersion)} → ${pc.green(u.toVersion)})`
        );
        p.note(updateLines.join('\n'), 'Updated Components');
        p.outro(values['dry-run'] ? pc.yellow('Dry run complete. Nothing was changed. Done.') : pc.green('Done. All components updated successfully!'));
      } else {
        p.outro(pc.green('Done. All components are up to date.'));
      }
    } else {
      console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
    }
    return;
  }

  if (cmd === 'diff') {
    if (!names.length) {
      throw new Error('Specify a component name to diff, e.g. sf-lwc diff <component>');
    }
    const componentName = names[0];

    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc diff ')));
      spinner.start(`Comparing local component "${componentName}" against upstream...`);
    }

    const result = await diff(componentName, {
      from: values.from ?? values.registry,
      cwd: values.cwd,
      json: values.json
    });

    if (isDisplayTty) {
      spinner.stop('Diff inspection complete');
    }

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    if (result.identical) {
      if (isDisplayTty) {
        p.note(
          `${pc.bold('Component:')} ${componentName}\n${pc.bold('Status:')}    100% match with upstream (identical)`,
          'Diff Verification'
        );
        p.outro(pc.green(`Done. Component '${componentName}' matches registry exactly.`));
      } else {
        console.log(`\x1b[32m✔\x1b[0m Component '${componentName}' matches registry exactly.`);
      }
      process.exit(0);
    }

    if (isDisplayTty) {
      const summaryList = [];
      for (const file of result.files) {
        if (file.status === 'identical') {
          summaryList.push(`  ${pc.green('✔')} ${file.file} ${pc.dim('(identical)')}`);
        } else if (file.status === 'missing') {
          summaryList.push(`  ${pc.red('✖')} ${file.file} ${pc.red('(missing locally)')}`);
        } else if (file.status === 'modified') {
          summaryList.push(`  ${pc.yellow('●')} ${file.file} ${pc.yellow('(modified)')}`);
        }
      }
      p.note(summaryList.join('\n'), `Differences in '${componentName}'`);

      for (const file of result.files) {
        if (file.status === 'modified' && file.diff) {
          console.log(`\n${pc.bold(pc.underline(file.file))}:`);
          const lines = file.diff.split('\n');
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              console.log(pc.green(line));
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              console.log(pc.red(line));
            } else if (line.startsWith('@@')) {
              console.log(pc.cyan(line));
            } else {
              console.log(pc.dim(line));
            }
          }
        }
      }
      p.outro(pc.yellow(`Differences detected. Run with --overwrite to reset to upstream.`));
      process.exit(1);
    } else {
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
  }

  if (cmd === 'pack' || cmd === 'export') {
    const componentName = names[0];
    const projectRoot = project ? project.root : values.cwd;
    const packageDefault = project ? project.targetRoot : undefined;

    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc pack ')));
    }

    await pack(componentName, {
      targetOrg: values['target-org'],
      output: values.output,
      dist: values.dist,
      maxDepth: values['max-depth'] ? parseInt(values['max-depth'], 10) : undefined,
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

  if (cmd === 'list' || cmd === 'ls') {
    if (remainingComponentTokens.length) {
      throw new Error(`"${cmd}" does not take component names. Try: sf-lwc ${cmd} [source]`);
    }

    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(` sf-lwc ${cmd} `)));
      spinner.start(`Connecting to ${pc.cyan(source.label)}...`);
    }

    const components = await listComponents(source, spec);

    if (values.json) {
      console.log(JSON.stringify(components, null, 2));
      return;
    }

    if (isDisplayTty) {
      spinner.stop(`Discovered ${pc.bold(pc.green(components.length))} component(s) in ${pc.cyan(source.label)}`);

      if (!components.length) {
        console.log(`\n  ${pc.yellow('No components found in this repository.')}\n`);
        p.outro(pc.yellow('Check your source path or repository branch.'));
        return;
      }

      console.log(`\n${pc.bold('Components in')} ${pc.cyan(source.label)} ${pc.dim(`(${components.length} available)`)}:\n`);
      for (const comp of components) {
        console.log(`  ${pc.cyan('-')} ${pc.bold(comp.name)} ${pc.dim(`@${comp.version}`)}`);
        if (comp.description) {
          console.log(`    ${pc.dim(comp.description)}`);
        }
        if (comp.dependencies && comp.dependencies.length) {
          console.log(`    ${pc.dim('dependencies:')} ${pc.yellow(comp.dependencies.join(', '))}`);
        }
      }
      console.log();
      p.outro(`Run ${pc.cyan(`sf-lwc add ${source.label} <name>`)} to install`);
    } else {
      console.log(`Registry: ${source.label}\n`);
      console.log(formatComponentList(components));
    }
    return;
  }

  if (cmd === 'add') {
    if (isDisplayTty) {
      p.intro(pc.bgCyan(pc.black(' sf-lwc add ')));
    }

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

      spinner.start(`Discovering available components in "${source.label}"...`);
      const components = await listComponents(source, spec);
      spinner.stop(`Discovered ${components.length} component(s) in "${source.label}"`);

      if (!components.length) {
        throw new Error(`No components found in repository "${source.label}".`);
      }
      targetNames = await selectComponents(components);
      if (!targetNames.length) {
        p.cancel('No components selected.');
        return;
      }
    }

    if (values.json) {
      const manifests = await resolve(source, targetNames);
      const notes = await install({
        source,
        manifests,
        project,
        overwrite: values.overwrite,
        dryRun: values['dry-run'],
        log: () => {}
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            installed: manifests.map((m) => m.name),
            dryRun: values['dry-run'],
            notes
          },
          null,
          2
        )
      );
      return;
    }

    if (isDisplayTty) {
      p.log.info(`${pc.bold('Source:')}  ${source.label}`);
      p.log.info(`${pc.bold('Project:')} ${project.root}`);
    } else {
      console.log(`Registry: ${source.label}\nProject:  ${project.root}\n`);
    }

    spinner.start(`Resolving ${targetNames.join(', ')} and metadata dependencies...`);
    const manifests = await resolve(source, targetNames);
    spinner.stop(`Resolved ${manifests.length} component manifest(s)`);

    spinner.start(`Installing files into ${pc.dim(project.root)}...`);
    const notes = await install({
      source,
      manifests,
      project,
      overwrite: values.overwrite,
      dryRun: values['dry-run']
    });
    spinner.stop(values['dry-run'] ? 'Dry run simulation finished' : 'Files written and lockfile updated');

    if (isDisplayTty) {
      const summaryLines = [
        `${pc.bold('Project:')}  ${project.root}`,
        `${pc.bold('Source:')}   ${source.label}`,
        `${pc.bold('Added:')}    ${manifests.map((m) => m.name).join(', ')}`
      ];
      if (notes.length) {
        summaryLines.push('', pc.bold('Manual post-install steps:'));
        for (const n of notes) {
          summaryLines.push(`  • ${n}`);
        }
      }
      p.note(summaryLines.join('\n'), values['dry-run'] ? 'Dry Run Summary' : 'Installation Summary');
      p.outro(values['dry-run'] ? pc.yellow('Dry run complete. Nothing was changed. Done.') : pc.green('Done. All components installed successfully!'));
    } else {
      console.log(values['dry-run'] ? '\nDry run complete. Nothing was changed.' : '\nDone.');
      if (notes.length) console.log('\nManual steps:\n' + notes.map((n) => `  - ${n}`).join('\n'));
    }
    return;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
