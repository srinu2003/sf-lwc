# summary
Upgrade installed components to the latest version from the registry.

# description
Inspects version declarations in sf-lwc.lock.json against upstream registry manifests, updates component files, and preserves Custom Labels.

# flags.all.summary
Update all installed components listed in the lockfile.

# flags.dry-run.summary
Preview updates without modifying local project files.

# examples
- <%= config.bin %> <%= command.id %> --all
- <%= config.bin %> <%= command.id %> modal
