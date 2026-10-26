import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { findProject } from 'sf-lwc/project.js';
// @ts-ignore
import { createSource } from 'sf-lwc/source.js';
// @ts-ignore
import { resolve } from 'sf-lwc/resolve.js';
// @ts-ignore
import { install } from 'sf-lwc/install.js';
// @ts-ignore
import { readConfig } from 'sf-lwc/init.js';

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

  public static readonly args = {
    component: Args.string({
      description: messages.getMessage('args.component.description'),
      required: true,
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
    const { args, flags } = await this.parse(LwcAdd);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    const project = await findProject(cwd);
    const config = await readConfig(cwd);
    const from = flags.from || config?.registry || process.env.SF_LWC_REGISTRY || '.';

    this.spinner.start(`Resolving ${args.component}`);

    try {
      const source = createSource(from);
      const manifests = await resolve(source, [args.component]);
      this.spinner.status = `Installing ${manifests.length} component(s)`;

      const notes = await install({
        source,
        manifests,
        project,
        overwrite: flags.overwrite,
        dryRun: flags['dry-run'],
      });

      this.spinner.stop('Done');
      this.log(`Successfully added ${args.component}${flags['dry-run'] ? ' (dry-run)' : ''}`);
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
      throw new SfError(
        `Failed to install ${args.component}: ${(err as Error).message}`,
        'ComponentInstallFailed'
      );
    }
  }
}
