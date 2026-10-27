# summary
List available components from a remote or local LWC registry.

# description
Queries a GitHub repository (registry layout or standard SFDX force-app/main/default/lwc) or local folder to discover available Lightning Web Components.

# flags.from.summary
Upstream GitHub repository (owner/repo[@ref], GitHub URL) or local registry path.

# examples
- <%= config.bin %> <%= command.id %>
- <%= config.bin %> <%= command.id %> --from owner/repo
- <%= config.bin %> <%= command.id %> --from https://github.com/svierk/awesome-lwc-collection.git
