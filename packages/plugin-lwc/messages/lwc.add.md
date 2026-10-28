# summary
Add open-source Lightning Web Components to your Salesforce DX project.

# description
Downloads component source files from an upstream Git repository or local SFDX project, recursively resolves dependencies, merges Custom Labels, and registers installed items in sf-lwc.lock.json.

Supports passing the repository or project directly as the first argument, or via --from. When run without a component name in an interactive terminal, launches an interactive fuzzy-searchable multi-component selector.

# flags.from.summary
Upstream GitHub repository (owner/repo or owner/repo@tag, GitHub URL) or local SFDX project path.

# flags.overwrite.summary
Overwrite existing component files without prompting.

# flags.dry-run.summary
Simulate installation and preview file and label changes without writing to disk.

# args.sourceOrComponent.description
GitHub repository (URL or owner/repo), local SFDX path, or component name.

# args.component.description
Component name to install when a repository is provided as the first argument. If omitted in an interactive terminal, launches an interactive selector.

# examples
- <%= config.bin %> <%= command.id %> svierk/awesome-lwc-collection qrCodeGenerator
- <%= config.bin %> <%= command.id %> https://github.com/svierk/awesome-lwc-collection
- <%= config.bin %> <%= command.id %> ../DocuMake-DocAgent bw_DocuMakeAgent
- <%= config.bin %> <%= command.id %> qrCodeGenerator --from svierk/awesome-lwc-collection
