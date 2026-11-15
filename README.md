# sf-lwc

> Component distribution for Salesforce DX. Copy open-source Lightning Web Components, Apex dependencies, Custom Labels, and Static Resources directly into your DX project—no package lock-in, no managed package namespaces.

Similar to how shadcn/ui distributes web components into modern frontend repos, `sf-lwc` copies components directly into your local `force-app/main/default` directory. You own the code, can customize it freely, and commit it with the rest of your Salesforce codebase.

---

## Installation & Execution

`sf-lwc` can be run standalone via `npx` or installed as a native Salesforce CLI plugin:

### Standalone CLI (Zero setup)
```bash
# Run any command directly via npx
npx sf-lwc add <registry> <component>

# Or install globally
npm install -g sf-lwc
sf-lwc --help
```

### Salesforce CLI Plugin (`sf lwc`)
```bash
# Install into your local Salesforce CLI environment
sf plugins install sf-lwc

# Run with standard sf syntax
sf lwc add <component>
```

---

## Consumer Quickstart

To install components into an existing Salesforce DX project, **no Salesforce CLI installation or org authorization is required**. `sf-lwc` works directly against your local workspace filesystem (`sfdx-project.json`).

```bash
# 1. Initialize your project with a default registry (creates sf-lwc.json)
npx sf-lwc init --from svierk/awesome-lwc-collection

# 2. List available components in the registry
npx sf-lwc list

# 3. Add a component and all of its dependencies recursively
npx sf-lwc add qrCodeGenerator

# 4. Check for differences against upstream
npx sf-lwc diff

# 5. Verify local lockfile and manifest integrity
npx sf-lwc doctor
```

---

## Command Reference

### `init`
Initializes `sf-lwc` configuration in your Salesforce DX project root.

```bash
sf-lwc init --from <github-owner/repo | git-url | local-path>
```
- Creates an `sf-lwc.json` configuration file.
- Saves the default `registry`, eliminating the need to pass `--from` or specify the registry on subsequent commands.

### `list` (alias: `ls`)
Discovers available components in a registry.

```bash
sf-lwc list
sf-lwc list --from svierk/awesome-lwc-collection
sf-lwc list --json
```
- Traverses the target repository or directory.
- Discovers LWC bundles (`force-app/main/default/lwc/` or `main/default/lwc/`) and sidecar manifests (`.sf-lwc/*.json`).
- Outputs component names, descriptions, and dependency counts.

### `add`
Downloads and installs one or more components into your Salesforce DX package directory.

```bash
sf-lwc add <component> [more-components...]
sf-lwc add <github-owner/repo> <component>
sf-lwc add <component> --overwrite
sf-lwc add <component> --dry-run
sf-lwc add <component> --json
```
- **Recursive Dependency Resolution**: Resolves child LWC components, Apex classes, Custom Labels, and Static Resources (with cycle detection: rejects circular dependencies, installs dependencies first).
- **Safe Copy**: Copies files directly to `<package-dir>/main/default/`, skipping existing files unless `--overwrite` is specified.
- **Label Merging**: Atomically merges Custom Labels into `labels/CustomLabels.labels-meta.xml` without altering existing labels.
- **Lockfile Tracking**: Records installed files, SHA hashes, and dependency trees in `sf-lwc.lock.json`.
- **Manual Step Notices**: Prints installation notes and post-install steps (permission sets, custom fields, external services).

### `diff`
Compares installed local files against the upstream registry.

```bash
sf-lwc diff
sf-lwc diff <component>
sf-lwc diff --json
```
- Compares local file SHA-256 hashes against `sf-lwc.lock.json` and upstream registry sources.
- Highlights uncommitted local edits, upstream updates, or drifted files.

### `update`
Syncs already installed components with upstream changes.

```bash
sf-lwc update
sf-lwc update <component>
sf-lwc update --dry-run
```
- Re-fetches components and applies upstream changes.
- Preserves untouched files and prompts or honors flags on conflicting modifications.

### `remove` (alias: `rm`)
Safely uninstalls one or more components and their untangled dependencies.

```bash
sf-lwc remove <component>
sf-lwc remove <component> --force
```
- **Dependency Guard**: Prevents removing a component if another installed component still depends on it (override with `--force`).
- **Clean Pruning**: Deletes tracked bundle files and selectively prunes custom labels from `CustomLabels.labels-meta.xml`.
- **Lockfile Maintenance**: Updates `sf-lwc.lock.json`, automatically removing the file when 0 components remain.

### `doctor`
Validates project configuration, lockfile integrity, and registry manifests.

```bash
sf-lwc doctor
sf-lwc doctor --json
```
- Checks `sfdx-project.json` and default package directory validity.
- Verifies `sf-lwc.lock.json` consistency against disk.
- Validates local `.sf-lwc/*.json` manifests against the JSON Schema (`manifest.schema.json`).

---

## Component Authoring & Publishing

### `pack` (alias: `export`)
Automates packaging and dependency extraction for component authors using Salesforce org metadata.

> [!NOTE]
> `pack` requires the Salesforce CLI (`@salesforce/cli`) installed on your system `$PATH` and an authenticated org (`sf org login web`), because it queries Salesforce's Tooling API to trace dependencies dynamically.

```bash
# Package a component using your default authorized org
sf-lwc pack <componentName>

# Package using a specific org alias or username
sf-lwc pack <componentName> -o devOrg

# Preview extracted dependencies without writing files
sf-lwc pack <componentName> -o devOrg --dry-run
```

**How `pack` works:**
1. **Tooling API Traversal**: Queries Salesforce's `MetadataComponentDependency` Tooling API to trace the component's live dependency graph in the org.
2. **Recursive Metadata Resolution**: Identifies dependent Apex classes, controllers, Custom Labels, Child LWCs, Custom Objects/Fields, and Static Resources.
3. **Standard Entity Safeguards**: Protects standard Salesforce objects (never bundles `Account`, `Contact`, `User`, etc.).
4. **Manifest Generation**: Emits a sidecar manifest conforming to `manifest.schema.json` with declared dependencies, custom labels, and metadata files.
5. **Direct Source Export**: Extracts matching local source files into standard Salesforce DX layout ready for commit or distribution.

---

## Registry Architecture

Unlike package managers that require centralized servers, any Git repository or Salesforce DX project can act as an `sf-lwc` registry:

### Standard SFDX Repository Layout
```
my-lwc-registry/
├── sfdx-project.json
├── .sf-lwc/                      # Optional sidecar manifests
│   ├── qrCodeGenerator.json      # Dependencies, labels, notes
│   └── modal.json
└── force-app/main/default/
    ├── lwc/
    │   ├── qrCodeGenerator/
    │   └── modal/
    ├── classes/
    │   ├── QRCodeController.cls
    │   └── QRCodeController.cls-meta.xml
    └── labels/
        └── CustomLabels.labels-meta.xml
```

### Sidecar Manifest (`.sf-lwc/<name>.json`)
Manifests allow component authors to declare metadata dependencies and post-install guidance:
```json
{
  "$schema": "https://raw.githubusercontent.com/svierk/sf-lwc/main/schema/manifest.schema.json",
  "name": "qrCodeGenerator",
  "version": "1.0.0",
  "description": "Generates dynamic QR codes in LWC using an Apex controller",
  "dependencies": ["modal"],
  "labels": ["QRCode_Success_Message", "QRCode_Error_Invalid_URL"],
  "notes": [
    "Assign the QRCodePermissionSet permission set to authorized users.",
    "Verify CSP Trusted Sites for external image endpoints if enabled."
  ]
}
```

---

## Network & Rate Limit Strategy

`sf-lwc` is engineered to operate reliably in CI/CD pipelines and developer machines without authentication bottlenecks:

- **Unauthenticated GitHub Repositories**: Downloads streaming tarball archives via `codeload.github.com` instead of traversing the GitHub REST API. This completely avoids GitHub's 60 request/hour rate limit for public repositories.
- **Private Repositories**: For private GitHub repos, provide an access token via environment variable:
  ```bash
  export GITHUB_TOKEN=ghp_yourPersonalAccessToken
  # or
  export GH_TOKEN=ghp_yourPersonalAccessToken
  ```
- **Local & Enterprise Git**: Supports direct local paths (`--from ../my-local-registry`) and standard Git SSH / HTTPS clone URLs.

---

## Configuration (`sf-lwc.json`)

When you run `sf-lwc init`, an `sf-lwc.json` file is created in your DX root:

```json
{
  "$schema": "https://raw.githubusercontent.com/svierk/sf-lwc/main/schema/config.schema.json",
  "registry": "svierk/awesome-lwc-collection"
}
```

You can also override the registry using the `SF_LWC_REGISTRY` environment variable:
```bash
export SF_LWC_REGISTRY="my-org/core-components"
```

---

## Contributing & Development

```bash
# Clone the repository
git clone https://github.com/svierk/sf-lwc.git
cd sf-lwc

# Install dependencies and build plugins
npm install
npm run build

# Run full test suite (Node test runner)
npm test
```

## License

MIT
