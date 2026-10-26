import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { doctor } from '../../../../src/doctor.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.doctor');

export type LwcDoctorResult = {
  passed: boolean;
  checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; message: string }>;
  errors: string[];
  warnings: string[];
};

export default class LwcDoctor extends SfCommand<LwcDoctorResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    registry: Flags.string({
      char: 'r',
      summary: messages.getMessage('flags.registry.summary'),
    }),
  };

  public async run(): Promise<LwcDoctorResult> {
    const { flags } = await this.parse(LwcDoctor);

    let projectRoot = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      projectRoot = sfProject.getPath();
    } catch {
      // Fallback to process.cwd()
    }

    this.spinner.start('Running sf-lwc doctor diagnostics');

    try {
      const result = await doctor({
        cwd: projectRoot,
        registry: flags.registry,
      });

      this.spinner.stop(result.passed ? 'Diagnostics complete' : 'Diagnostics identified issues');

      if (!result.passed) {
        this.error(`Diagnostics failed: ${result.errors.join('; ')}`);
        process.exitCode = 1;
      } else {
        this.log('✓ All checks passed.');
      }

      return result;
    } catch (err) {
      this.spinner.stop('Failed');
      throw new SfError(
        `Doctor command failed: ${(err as Error).message}`,
        'DoctorCommandFailed'
      );
    }
  }
}
