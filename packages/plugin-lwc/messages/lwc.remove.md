# summary
Remove installed Lightning Web Components from your Salesforce DX project.

# description
Uninstalls components tracked in sf-lwc.lock.json, deletes unshared files and labels, prunes empty directories, and updates the lockfile. Shared dependencies required by other installed components are safely retained unless --force is specified.

# flags.force.summary
Force removal even if other installed components depend on this component.

# flags.dry-run.summary
Simulate component removal without deleting files or modifying the lockfile.

# args.component.description
Name of the component to remove (e.g. modal).

# examples
- <%= config.bin %> <%= command.id %> modal
- <%= config.bin %> <%= command.id %> modal --force
- <%= config.bin %> <%= command.id %> modal --dry-run
- <%= config.bin %> <%= command.id %> modal --json
