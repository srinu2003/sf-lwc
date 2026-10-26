import { SfCommand, Flags, Args } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { findProject } from '../../../../src/project.js';
// @ts-ignore
import { createSource } from '../../../../src/source.js';
// @ts-ignore
import { resolvePlan } from '../../../../src/resolve.js';
// @ts-ignore
import { install } from '../../../../src/install.js';
// @ts-ignore
import { readConfig } from '../../../../src/init.js';

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
    const from = flags.from || config?.registry;

    this.spinner.start(`Resolving ${args.component}`);

    try {
      const source = createSource(from);
      const plan = await resolvePlan(source, [args.component]);
      this.spinner.status = `Installing ${plan.length} component(s)`;

      await install({
        plan,
        project,
        source,
        overwrite: flags.overwrite,
        dryRun: flags['dry-run'],
      });

      this.spinner.stop('Done');
      this.log(`Successfully added ${args.component}${flags['dry-run'] ? ' (dry-run)' : ''}`);

      return {
        installed: plan.map((c: any) => ({ name: c.name, version: c.version })),
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
