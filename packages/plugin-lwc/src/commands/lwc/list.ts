import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfProject, SfError } from '@salesforce/core';
// @ts-ignore
import { createSource } from 'sf-lwc/source.js';
// @ts-ignore
import { listComponents, formatComponentList } from 'sf-lwc/list.js';
// @ts-ignore
import { readConfig } from 'sf-lwc/init.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-lwc', 'lwc.list');

export type LwcListResult = Array<{
  name: string;
  version: string;
  description: string;
  dependencies: string[];
}>;

export default class LwcList extends SfCommand<LwcListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly aliases = ['lwc:ls'];

  public static readonly flags = {
    from: Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.from.summary'),
    }),
  };

  public async run(): Promise<LwcListResult> {
    const { flags } = await this.parse(LwcList);

    let cwd = process.cwd();
    try {
      const sfProject = await SfProject.resolve();
      cwd = sfProject.getPath();
    } catch {
      // Standalone execution outside project
    }

    const config = await readConfig(cwd).catch(() => null);
    const spec = flags.from || config?.registry || process.env.SF_LWC_REGISTRY || 'srinu2003/sf-lwc@main';

    this.spinner.start(`Discovering components from ${spec}`);

    try {
      const source = createSource(spec);
      const components = await listComponents(source, spec);
      this.spinner.stop('Done');

      this.log(`Registry: ${source.label}\n`);
      this.log(formatComponentList(components));

      return components;
    } catch (err) {
      this.spinner.stop('Failed');
      throw new SfError(
        `Failed to list components: ${(err as Error).message}`,
        'ComponentListFailed'
      );
    }
  }
}
