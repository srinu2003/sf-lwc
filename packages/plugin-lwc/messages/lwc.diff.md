# summary
Show unified line-by-line diff between locally customized components and the upstream registry.

# description
Compares each tracked file for a component against the original source from the registry using standard unified diff format.

# flags.from.summary
Upstream GitHub repository or local path to diff against.

# args.component.description
Component name to diff (e.g. modal).

# examples
- <%= config.bin %> <%= command.id %> modal
- <%= config.bin %> <%= command.id %> modal --json
