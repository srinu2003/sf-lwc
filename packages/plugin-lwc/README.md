# @sf-lwc/plugin-lwc

Official Salesforce CLI (`sf`) plugin for **sf-lwc**: seamlessly add, diff, update, and package open-source Lightning Web Components in your Salesforce DX workspaces.

[![Version](https://img.shields.io/npm/v/plugin-lwc.svg)](https://npmjs.org/package/plugin-lwc)
[![License](https://img.shields.io/npm/l/plugin-lwc.svg)](https://github.com/srinu2003/sf-lwc/blob/main/LICENSE)

---

## ⚡ Installation

Install directly into your Salesforce CLI environment:

```bash
sf plugins install @srinu2003/plugin-lwc
```

### Local Linking for Development

```bash
cd packages/plugin-lwc
sf plugins link .
```

Verify the plugin is registered:

```bash
sf plugins
sf lwc --help
```

---

## 🛠️ Commands

### `sf lwc add <component>`
Installs a component from the registry into your default DX package directory, merges Custom Labels, and updates `sf-lwc.lock.json`.

```bash
sf lwc add modal
sf lwc add toast-utils --dry-run
sf lwc add modal --from user/repo@v1.0.0
```

### `sf lwc diff <component>`
Displays a unified line-by-line diff between locally customized components and the upstream registry.

```bash
sf lwc diff modal
sf lwc diff modal --json
```

### `sf lwc update [component]`
Checks `sf-lwc.lock.json` against upstream registry versions and upgrades files safely.

```bash
sf lwc update --all
sf lwc update modal
```

### `sf lwc doctor`
Validates DX project package root, registry connectivity, and physical lockfile integrity.

```bash
sf lwc doctor
```

### `sf lwc pack <component>`
Introspects and traces local LWC dependencies via the Salesforce Tooling API across Apex, Labels, and child LWCs.

```bash
sf lwc pack myComponent -o myOrg
```
