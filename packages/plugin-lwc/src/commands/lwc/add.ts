import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { findProject } from 'sf-lwc/project.js';
// @ts-ignore
import { createSource, isSourceSpec } from 'sf-lwc/source.js';
// @ts-ignore
import { resolve } from 'sf-lwc/resolve.js';
// @ts-ignore
import { install } from 'sf-lwc/install.js';
// @ts-ignore
import { readConfig } from 'sf-lwc/init.js';
// @ts-ignore
import { listComponents } from 'sf-lwc/list.js';
// @ts-ignore
import { selectComponents } from 'sf-lwc/selector.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.add');

export type LwcAddResult = {
  installed: Array<{ name: string; version?: string }>;
  dryRun: boolean;
};

export default class LwcAdd extends SfCommand<LwcAddResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly strict = false;

  public static readonly args = {
    sourceOrComponent: Args.string({
      description: messages.getMessage('args.sourceOrComponent.description'),
      required: false,
    }),
    component: Args.string({
      description: messages.getMessage('args.component.description'),
      required: false,
    }),
  };

  public static readonly flags = {
    from: Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.from.summary'),
    }),
    overwrite: Flags.boolean({
      char: 'w',
      summary: messages.getMessage('flags.overwrite.summary'),
      default: false,
    }),
    'dry-run': Flags.boolean({
      summary: messages.getMessage('flags.dry-run.summary'),
      default: false,
    }),
  };

  public async run(): Promise<LwcAddResult> {
    const { args, argv, flags } = await this.parse(LwcAdd);

    const rawTokens: string[] = [];
    if (argv && argv.length > 0) {
      for (const item of argv) {
        if (typeof item === 'string' && !item.startsWith('-')) {
          rawTokens.push(item);
        }
      }
    } else {
      if (args.sourceOrComponent) rawTokens.push(args.sourceOrComponent);
      if (args.component) rawTokens.push(args.component);
    }

    let detectedSource = flags.from || undefined;
    const remainingComponentTokens: string[] = [];

    for (let i = 0; i < rawTokens.length; i++) {
      const token = rawTokens[i];
      if (i === 0 && !flags.from && isSourceSpec(token)) {
        detectedSource = token;
      } else {
        remainingComponentTokens.push(token);
      }
    }

    const componentNames: string[] = Array.from(
      new Set(
        remainingComponentTokens
          .flatMap((token) => token.split(','))
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );

    if (componentNames.length === 0) {
      if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || flags.json || this.jsonEnabled()) {
        throw new SfError(
          'No component specified and terminal is non-interactive. Specify at least one component, e.g. sf lwc add <component>',
          'NoComponentSpecified'
        );
      }
    }

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    const project = await findProject(cwd);
    const config = await readConfig(cwd).catch(() => null);

    const spec = detectedSource || config?.registry || process.env.SF_LWC_REGISTRY;
    if (!spec) {
      throw new SfError(
        'No source repository specified. Pass a repository or project path, e.g.: sf lwc add <owner/repo> [component] or sf lwc add --from <owner/repo>',
        'NoSourceSpecified'
      );
    }

    const source = createSource(spec);
    let targetNames = componentNames;

    if (targetNames.length === 0) {
      this.spinner.start(`Discovering available components from ${source.label}`);
      const components = await listComponents(source, spec);
      this.spinner.stop();

      if (!components || components.length === 0) {
        this.log(`No components found in repository "${source.label}".`);
        return { installed: [], dryRun: flags['dry-run'] };
      }

      const selected = await selectComponents(components);
      if (!selected || selected.length === 0) {
        this.log('No components selected.');
        return { installed: [], dryRun: flags['dry-run'] };
      }

      targetNames = selected;
    }

    const namesDisplay = targetNames.join(', ');
    this.spinner.start(`Resolving ${namesDisplay}`);

    try {
      const manifests = await resolve(source, targetNames);
      this.spinner.status = `Installing ${manifests.length} component(s)`;

      const notes = await install({
        source,
        manifests,
        project,
        overwrite: flags.overwrite,
        dryRun: flags['dry-run'],
        log: (msg: string) => this.log(msg),
      });

      this.spinner.stop('Done');
      this.log(`Successfully added ${namesDisplay}${flags['dry-run'] ? ' (dry-run)' : ''}`);
      if (notes && notes.length) {
        this.log('Manual steps:');
        for (const n of notes) {
          this.log(`  - ${n}`);
        }
      }

      return {
        installed: manifests.map((c: any) => ({ name: c.name, version: c.version })),
        dryRun: flags['dry-run'],
      };
    } catch (err) {
      this.spinner.stop('Failed');
      if (err instanceof SfError) {
        throw err;
      }
      throw new SfError(
        `Failed to install ${namesDisplay}: ${(err as Error).message}`,
        'ComponentInstallFailed'
      );
    }
  }
}
