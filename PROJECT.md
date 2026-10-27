# Project: sf-lwc Standard SFDX & Interactive Multi-Select

## Architecture
The `sf-lwc` workspace is a monorepo consisting of:
1. **Core Package (`sf-lwc`)**: Zero-dependency ESM package in root directory providing CLI (`bin/sf-lwc.js`) and core modules in `src/` (`list.js`, `resolve.js`, `install.js`, `source.js`, `diff.js`, etc.).
2. **Interactive Selector (`src/selector.js`)**: Zero-dependency interactive terminal picker using Node.js built-ins (`node:readline` and ANSI escape codes) supporting real-time fuzzy filtering, arrow navigation, spacebar multi-selection, and enter confirmation.
3. **Salesforce CLI Plugin (`packages/plugin-lwc`)**: TypeScript/oclif plugin linking to root via `"sf-lwc": "file:../.."`, providing `sf lwc *` commands.
4. **Data Flow**:
   - `listComponents(source)`: Enumerates available components using GitHub Git Trees API (`git/trees/HEAD?recursive=1`) or local filesystem under standard `force-app/main/default/lwc/` or curated `components/` in a single pass without 404 probing loops. Parses `<component>.js-meta.xml` directly to extract descriptions.
   - `selectComponents(components, options)`: If run interactively without component arguments, launches the terminal picker and returns selected component name(s). In non-interactive/CI environments without TTY, immediately throws an actionable error.
   - `resolve(source, names)` & `install(...)`: Natively accepts arrays of component names, handles dependency graphs, downloads bundles, merges custom labels, and writes lockfiles.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Standard SFDX Layout | Standardize on `force-app/main/default/lwc` as primary SFDX layout, eliminating `main/default/lwc` probing | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Zero Fallback Probing Loops | Eliminate sequential 404 probing across candidate directories in remote repository resolution | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Single-Pass Component Enumeration | Fast single-pass file tree enumeration via GitHub Git Trees API (`git/trees/HEAD?recursive=1`) and local fs | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Direct Bundle Parsing (`.js-meta.xml`) | Extract `<description>`, `<masterLabel>`, and `<apiVersion>` directly from `<component>.js-meta.xml` in parallel | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Immediate Descriptive Errors | Return specific, actionable error messages for non-existent repositories, non-LWC repositories, and missing local paths | M1 | ORIGINAL_REQUEST §R1 |
| 6 | SFDX Diff Support | Fix `src/diff.js` to correctly resolve files for standard SFDX repositories via `manifest._rawPrefix` | M1 | Explorer Survey 1 |
| 7 | Zero-Dependency Terminal Selector | Build `src/selector.js` with `node:readline` and ANSI escapes supporting fuzzy search, arrow keys, space toggle, enter | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Multi-Select & Single-Select | Support selecting one or more components with spacebar and confirm with Enter, with viewport windowing | M2 | ORIGINAL_REQUEST §R2 |
| 9 | TTY Guard & Non-Interactive Fast-Fail | Fail fast with exit code 1 and actionable error when run without component in non-interactive/CI/pipe environments | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Standalone CLI Interactive Add | Update `bin/sf-lwc.js` to trigger interactive selector when `names` is empty and TTY is active | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Non-Interactive Direct CLI Usage | Preserve non-interactive CLI usage (`sf-lwc add <name> --from <spec>`) without prompts | M2 | ORIGINAL_REQUEST §R2 |
| 12 | Dual CLI Plugin Compatibility | Update `packages/plugin-lwc/src/commands/lwc/add.ts` (`args.component.required: false`) to launch selector on empty args | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Dual CLI Multi-Component Parity | Enable `sf lwc add` to accept and install multiple components either via picker or command-line flags | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Automated Unit & Integration Tests | Test selector (mock streams), single-pass SFDX list, error conditions, CLI add, and plugin add with 100% pass | M4 | ORIGINAL_REQUEST §Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Standard SFDX Architecture & Zero Fallback Cascades | `src/list.js`, `src/source.js`, `src/diff.js` | none | DONE |
| M2 | Interactive Terminal Search & Multi-Select Engine | `src/selector.js`, `bin/sf-lwc.js` | M1 | DONE |
| M3 | Dual CLI Compatibility for Salesforce CLI Plugin | `packages/plugin-lwc/src/commands/lwc/add.ts`, messages | M2 | DONE |
| M4 | Comprehensive E2E Test Suite & Hardening | `test/selector.test.js`, `test/sfdx.test.js`, `test/add.test.js`, `test/plugin.test.js` | M1, M2, M3 | DONE |

## Interface Contracts
### `src/selector.js` ↔ `bin/sf-lwc.js` / `plugin-lwc`
- Function: `selectComponents(components: Array<{ name: string, description?: string, version?: string }>, options?: { stdin?: Readable, stdout?: Writable, pageSize?: number }): Promise<string[]>`
- Behavior:
  - If `options.stdin` is not a TTY (and not explicitly provided as a mock stream), throws `Error('No component specified and terminal is non-interactive. Specify at least one component, e.g. sf-lwc add <component>')`.
  - Returns array of selected component names (e.g. `['modal', 'signaturePad']`).
  - If user cancels with `Ctrl+C` or `Escape`, cleanly restores terminal state and exits or rejects.

### `src/list.js` ↔ `src/source.js`
- Function: `listComponents(source: Source): Promise<Array<{ name: string, description: string, version: string, dependencies: string[] }>>`
- Behavior:
  - Discovers components under `force-app/main/default/lwc` (or curated `components/`) in a single pass.
  - Inspects `<component>.js-meta.xml` in parallel to populate `description`.
  - Rejects with descriptive errors if repository does not exist, lacks LWC components, or local path does not exist.

## Code Layout
- `src/list.js`: Component listing and discovery logic.
- `src/source.js`: Remote and local source handlers.
- `src/diff.js`: File diffing against registry/source.
- `src/selector.js`: Interactive search and multi-select terminal UI.
- `bin/sf-lwc.js`: Standalone CLI entrypoint.
- `packages/plugin-lwc/src/commands/lwc/add.ts`: Salesforce CLI plugin add command.
- `packages/plugin-lwc/messages/lwc.add.md`: Help and documentation messages for plugin command.
- `test/`: Test suites executed via `node --test`.
