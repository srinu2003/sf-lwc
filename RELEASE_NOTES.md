```
███████╗███████╗      ██╗     ██╗    ██╗ ██████╗ 
██╔════╝██╔════╝      ██║     ██║    ██║██╔════╝ 
███████╗█████╗  █████╗██║     ██║ █╗ ██║██║      
╚════██║██╔══╝  ╚════╝██║     ██║███╗██║██║      
███████║██║           ███████╗╚███╔███╔╝╚██████╗ 
╚══════╝╚═╝           ╚══════╝ ╚══╝╚══╝  ╚═════╝ 
```

# sf-lwc v0.2.0-beta.1: Direct Code Ownership for Salesforce DX

> Component distribution for Salesforce DX. Copy open-source Lightning Web Components, Apex controllers, Custom Labels, and Static Resources directly into your DX project—no package lock-in, no managed package namespaces.

---

## Highlights

- **The shadcn/ui Model for Salesforce**: Direct source code ownership. Components live in your local `force-app/main/default/` directory, customized by your team, and committed with your repository.
- **Frictionless Consumer Experience**: Zero Salesforce CLI installation or org authorization required for consumer commands (`add`, `list`, `diff`, `update`, `remove`, `doctor`). Operates directly on the local DX workspace (`sfdx-project.json`).
- **Complete 8-Command Lifecycle**: Full parity across standalone CLI (`npx sf-lwc` / `sf-lwc`) and native Salesforce CLI plugin (`sf lwc`).
- **Automatic Dependency Graph Traversal**: Recursively resolves child LWCs, Apex classes, Custom Labels, and Static Resources with cycle detection.
- **Org Metadata Component Dependency Extraction**: Automated `pack` / `export` command using Salesforce Tooling API (`MetadataComponentDependency`) with standard entity protection.
- **Zero Rate-Limit Architecture**: Downloads streaming raw tarballs from `codeload.github.com` instead of burning GitHub REST API quotas (60 req/hr unauthenticated).

---

## Quickstart

```bash
# Add any open-source LWC directly into your project
npx sf-lwc add svierk/awesome-lwc-collection qrCodeGenerator

# Or install globally
npm install -g sf-lwc

# Or install as a Salesforce CLI plugin
sf plugins install sf-lwc
```

---

## What's New in v0.2.0-beta.1

### 1. The 8-Command CLI Suite
Both the standalone binary (`sf-lwc`) and the Salesforce CLI plugin (`sf lwc`) support the full lifecycle:

| Command | Alias | Description | Org Auth Required? |
| :--- | :---: | :--- | :---: |
| `init` | — | Initialize `sf-lwc.json` configuration and default registry | No |
| `list` | `ls` | Traverse remote or local repositories and discover components | No |
| `add` | — | Install components, Apex dependencies, Custom Labels & Static Resources | No |
| `diff` | — | Compare local files against upstream registry version (detect divergence) | No |
| `update` | — | Upgrade installed components to latest upstream release | No |
| `remove` | `rm` | Safely remove components, prune custom labels, and clean lockfile | No |
| `doctor` | — | Validate DX project structure, lockfile integrity, and JSON schema | No |
| `pack` | `export` | Trace live dependencies via Tooling API & bundle into registry layout | **Yes** (`-o devOrg`) |

### 2. Modern DX Sidecar Manifest Architecture
- Components are stored in standard Salesforce DX structures (`force-app/main/default/lwc/<name>/`).
- Optional sidecar manifests (`.sf-lwc/<name>.json`) declare metadata dependencies, Custom Labels, and post-installation setup notes.
- Validated automatically against JSON Schema (`schema/manifest.schema.json`).

### 3. Smart Label & Dependency Merging
- **Atomic Custom Label Merging**: Selectively injects component labels into `force-app/main/default/labels/CustomLabels.labels-meta.xml` without touching existing project labels.
- **Reference-Counted Dependency Protection**: `remove` prevents deleting shared child components or libraries if another component depends on them (override with `--force`).
- **Clean Lockfile Maintenance**: Tracks installed components and file hashes in `sf-lwc.lock.json`, automatically removing the lockfile when 0 components remain.

### 4. Hardened Security & Resilience
- **Path Traversal Protection**: Tarball extraction parses entries in-memory and strictly blocks `..` escape paths or directory traversals (`parseTar`).
- **Tooling API Query Injection Guard**: `pack` executes Salesforce CLI queries using discrete argument arrays (`execFileSync`) rather than interpolated shell strings.
- **Graceful Network Handling**: Live network timeouts (`ETIMEDOUT`) and authentication failures surface clear, actionable troubleshooting messages without masking errors.

---

## Verification & Quality
- **Test Suite**: 144 / 144 tests passing across unit, integration, stress, and live network suites (`npm test`).
- **Clean Distribution**: Package payload vetted via `npm pack --dry-run` (17 files, 32.8 kB).
- **TypeScript & Oclif**: Built with TypeScript 5.6 and `@oclif/core` 5.0 with automated `oclif.manifest.json` generation.

---

## Upgrade Guide

To update your global CLI or npx cache:
```bash
npm install -g sf-lwc@0.2.0-beta.1
```

To update the Salesforce CLI plugin:
```bash
sf plugins install sf-lwc
```
