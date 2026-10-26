# summary
Diagnose Salesforce DX project health, lockfile integrity, and component registry connectivity.

# description
Runs diagnostic checks verifying DX project package root directories, registry connectivity, and physical presence of all files tracked in sf-lwc.lock.json.

# flags.registry.summary
Custom registry URL or path to test connectivity against.

# examples
- <%= config.bin %> <%= command.id %>
- <%= config.bin %> <%= command.id %> --json
