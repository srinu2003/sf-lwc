import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { doctor } from 'sf-lwc/doctor.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.doctor');

export type LwcDoctorResult = {
  ok: boolean;
  checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
};

export default class LwcDoctor extends SfCommand<LwcDoctorResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public async run(): Promise<LwcDoctorResult> {
    let projectRoot = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      projectRoot = sfProject.getPath();
    } catch {
      // Fallback to process.cwd()
    }

    this.spinner.start('Running sf-lwc doctor diagnostics');

    try {
      const result: LwcDoctorResult = await doctor({
        cwd: projectRoot,
      });

      this.spinner.stop(result.ok ? 'Diagnostics complete' : 'Diagnostics identified issues');

      for (const check of result.checks) {
        if (check.status === 'pass') {
          this.log(`  ✓ ${check.name}: ${check.message}`);
        } else if (check.status === 'warn') {
          this.warn(`  ! ${check.name}: ${check.message}`);
        } else {
          this.log(`  ✖ ${check.name}: ${check.message}`);
        }
      }

      if (!result.ok) {
        this.error('Doctor diagnostics identified issues with the Salesforce project setup.');
      } else {
        this.log('\n✓ All health checks passed! Project is ready.');
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
