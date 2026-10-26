# summary
Trace and package local LWC dependencies into a reusable component bundle.

# description
Uses Salesforce Tooling API dependency introspection to traverse related Apex classes, Custom Labels, and child LWCs, outputting a distribution bundle with manifest.json.

# flags.target-org.summary
Username or alias of the target scratch org or sandbox used for dependency introspection.

# flags.output.summary
Output directory for the packaged component.

# args.component.description
Root component bundle name to pack.

# examples
- <%= config.bin %> <%= command.id %> myComponent -o myOrg
- <%= config.bin %> <%= command.id %> myComponent --dry-run
