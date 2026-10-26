import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { diff } from 'sf-lwc/diff.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.diff');

export type LwcDiffResult = {
  name: string;
  identical: boolean;
  files: Array<{
    file: string;
    status: string;
    diff?: string;
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
      const result = await diff(args.component, {
        from: flags.from,
        cwd,
      });

      if (result.identical) {
        this.log(`Component '${args.component}' matches registry exactly.`);
      } else {
        this.log(`Differences found in '${args.component}':`);
        for (const file of result.files) {
          if (file.status === 'identical') {
            this.log(`  ✓ ${file.file} (identical)`);
          } else if (file.status === 'missing') {
            this.log(`  ✖ ${file.file} (missing locally)`);
          } else if (file.status === 'modified') {
            this.log(`  ● ${file.file} (modified)`);
            if (file.diff) {
              this.log(file.diff);
            }
          }
        }
      }

      return result;
    } catch (err) {
      throw new SfError(
        `Failed to diff ${args.component}: ${(err as Error).message}`,
        'ComponentDiffFailed'
      );
    }
  }
}
