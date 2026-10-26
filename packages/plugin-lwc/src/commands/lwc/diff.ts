import { SfCommand, Flags, Args } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { diff } from '../../../../src/diff.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.diff');

export type LwcDiffResult = {
  hasModifications: boolean;
  diffs: Array<{
    file: string;
    hasDiff: boolean;
    unifiedDiff?: string;
    status: 'identical' | 'modified' | 'missing_local' | 'missing_upstream';
  }>;
};

export default class LwcDiff extends SfCommand<LwcDiffResult> {
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
  };

  public async run(): Promise<LwcDiffResult> {
    const { args, flags } = await this.parse(LwcDiff);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    try {
      const result = await diff({
        component: args.component,
        from: flags.from,
        cwd,
      });

      if (result.hasModifications) {
        this.log(`Modifications found in ${args.component}:`);
        for (const d of result.diffs) {
          if (d.hasDiff) {
            this.log(`--- ${d.file} (${d.status}) ---`);
            if (d.unifiedDiff) {
              this.log(d.unifiedDiff);
            }
          }
        }
      } else {
        this.log(`No modifications detected in ${args.component}. Matches upstream registry.`);
      }

      return result;
    } catch (err) {
      throw new SfError(
        `Diff failed: ${(err as Error).message}`,
        'DiffCommandFailed'
      );
    }
  }
}
