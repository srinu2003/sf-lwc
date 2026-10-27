# summary
Add open-source Lightning Web Components to your Salesforce DX project.

# description
Downloads component source files from an upstream Git repository or local registry, recursively resolves dependencies, merges Custom Labels, and registers installed items in sf-lwc.lock.json. When run in an interactive terminal without specifying a component, launches an interactive fuzzy-searchable multi-component selector.

# flags.from.summary
Upstream GitHub repository (owner/repo or owner/repo@tag) or local registry path.

# flags.overwrite.summary
Overwrite existing component files without prompting.

# flags.dry-run.summary
Simulate installation and preview file and label changes without writing to disk.

# args.component.description
Name of the component to install from the registry (e.g. modal). If omitted in an interactive terminal, launches an interactive component selector. Supports comma-separated or multiple component names.

# examples
- <%= config.bin %> <%= command.id %>
- <%= config.bin %> <%= command.id %> modal
- <%= config.bin %> <%= command.id %> modal,toast-utils
- <%= config.bin %> <%= command.id %> modal toast-utils
- <%= config.bin %> <%= command.id %> modal --from user/repo@v1.0.0
- <%= config.bin %> <%= command.id %> toast-utils --dry-run
