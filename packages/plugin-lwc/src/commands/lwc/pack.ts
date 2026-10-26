import { SfCommand, Flags, Args } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { pack } from '../../../../src/pack.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.pack');

export type LwcPackResult = {
  success: boolean;
  name: string;
  outputDirectory: string;
  files: string[];
};

export default class LwcPack extends SfCommand<LwcPackResult> {
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
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    output: Flags.string({
      char: 'd',
      summary: messages.getMessage('flags.output.summary'),
    }),
    overwrite: Flags.boolean({
      char: 'w',
      default: false,
    }),
    'dry-run': Flags.boolean({
      default: false,
    }),
  };

  public async run(): Promise<LwcPackResult> {
    const { args, flags } = await this.parse(LwcPack);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    const orgAliasOrUsername = flags['target-org'] ? flags['target-org'].getUsername() : undefined;

    this.spinner.start(`Packaging component ${args.component}`);
    try {
      const result = await pack({
        name: args.component,
        targetOrg: orgAliasOrUsername,
        outputDir: flags.output,
        overwrite: flags.overwrite,
        dryRun: flags['dry-run'],
        cwd,
      });

      this.spinner.stop('Done');
      this.log(`Successfully packaged ${args.component} into ${result.outputDirectory}`);

      return result;
    } catch (err) {
      this.spinner.stop('Failed');
      throw new SfError(
        `Packaging failed: ${(err as Error).message}`,
        'PackCommandFailed'
      );
    }
  }
}
