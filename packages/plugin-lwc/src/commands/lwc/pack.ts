import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { findProject } from 'sf-lwc/project.js';
// @ts-ignore
import { pack } from 'sf-lwc/pack.js';

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
    let project = null;
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Fallback
    }

    try {
      project = await findProject(cwd);
    } catch {
      // Non-fatal if packaging standalone
    }

    const orgAliasOrUsername = flags['target-org'] ? flags['target-org'].getUsername() : undefined;

    this.spinner.start(`Packaging component ${args.component}`);
    try {
      const result = await pack(args.component, {
        targetOrg: orgAliasOrUsername,
        output: flags.output,
        overwrite: flags.overwrite,
        dryRun: flags['dry-run'],
        projectRoot: cwd,
        packageDefault: project ? project.targetRoot : undefined,
      });

      this.spinner.stop('Done');
      this.log(`Successfully packed ${args.component} into ${result.destDir}`);

      return {
        success: true,
        name: args.component,
        outputDirectory: result.destDir,
        files: result.files,
      };
    } catch (err) {
      this.spinner.stop('Failed');
      throw new SfError(
        `Failed to pack component ${args.component}: ${(err as Error).message}`,
        'ComponentPackFailed'
      );
    }
  }
}
