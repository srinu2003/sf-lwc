import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { update } from 'sf-lwc/update.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.update');

export type LwcUpdateResult = {
  updated: Array<{ name: string; oldVersion: string; newVersion: string }>;
  upToDate: string[];
};

export default class LwcUpdate extends SfCommand<LwcUpdateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    component: Args.string({
      description: 'Optional component name to update',
      required: false,
    }),
  };

  public static readonly flags = {
    all: Flags.boolean({
      summary: messages.getMessage('flags.all.summary'),
      default: false,
    }),
    'dry-run': Flags.boolean({
      summary: messages.getMessage('flags.dry-run.summary'),
      default: false,
    }),
  };

  public async run(): Promise<LwcUpdateResult> {
    const { args, flags } = await this.parse(LwcUpdate);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    const names = args.component ? [args.component] : [];

    this.spinner.start('Checking for component updates');
    try {
      const result = await update({
        names,
        all: flags.all,
        dryRun: flags['dry-run'],
        cwd,
      });

      this.spinner.stop('Done');

      const mappedUpdated = (result.updated || []).map((u: any) => ({
        name: u.name,
        oldVersion: u.from,
        newVersion: u.to,
      }));

      if (mappedUpdated.length === 0) {
        this.log('All components are up to date.');
      } else {
        this.log(`Updated ${mappedUpdated.length} component(s).`);
        for (const u of mappedUpdated) {
          this.log(`  ✓ ${u.name} (${u.oldVersion} -> ${u.newVersion})`);
        }
      }

      return {
        updated: mappedUpdated,
        upToDate: result.upToDate || [],
      };
    } catch (err) {
      this.spinner.stop('Failed');
      throw new SfError(
        `Failed to update components: ${(err as Error).message}`,
        'ComponentUpdateFailed'
      );
    }
  }
}
