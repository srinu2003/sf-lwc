import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { findProject } from 'sf-lwc/project.js';
// @ts-ignore
import { remove } from 'sf-lwc/remove.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.remove');

export type LwcRemoveResult = {
  ok: boolean;
  removed: string[];
  dryRun: boolean;
};

export default class LwcRemove extends SfCommand<LwcRemoveResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly aliases = ['lwc:rm'];

  public static readonly args = {
    component: Args.string({
      description: messages.getMessage('args.component.description'),
      required: true,
    }),
  };

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      default: false,
    }),
    'dry-run': Flags.boolean({
      summary: messages.getMessage('flags.dry-run.summary'),
      default: false,
    }),
  };

  public async run(): Promise<LwcRemoveResult> {
    const { args, flags } = await this.parse(LwcRemove);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    try {
      const project = await findProject(cwd);
      const isJson = flags.json;

      this.spinner.start(`Removing ${args.component}...`);
      await remove({
        names: [args.component],
        project,
        dryRun: flags['dry-run'],
        force: flags.force,
        log: (msg: string) => {
          if (!isJson) {
            this.log(msg);
          }
        },
      });
      this.spinner.stop(flags['dry-run'] ? 'Dry run finished' : 'Removed');

      return {
        ok: true,
        removed: [args.component],
        dryRun: flags['dry-run'],
      };
    } catch (err) {
      throw new SfError(
        `Failed to remove ${args.component}: ${(err as Error).message}`,
        'ComponentRemoveFailed'
      );
    }
  }
}
