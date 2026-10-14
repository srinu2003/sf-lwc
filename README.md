# sf-lwc

CLI that copies open-source LWC components into a Salesforce DX project, along with their Apex classes,
custom labels, and component dependencies.

```bash
# Initialize project with default registry (creates sf-lwc.json)
node bin/sf-lwc.js init --from .

# List available components
node bin/sf-lwc.js list

# Add a component and its dependencies
node bin/sf-lwc.js add data-table

# Remove a component cleanly
node bin/sf-lwc.js remove data-table
```

For private registries, set `GITHUB_TOKEN` (or `GH_TOKEN`) to a token with read access to the repo.
Set `SF_LWC_REGISTRY` or run `sf-lwc init` to avoid typing `--from`.

## Registry layout (this repo is also the registry)

    components/<name>/manifest.json      # see schema/manifest.schema.json
    components/<name>/files/<path>       # mirrors <package-dir>/main/default/<path>

## What `init` does
1. Creates an `sf-lwc.json` configuration file in the Salesforce DX project root.
2. Saves the default `registry`, eliminating the need to type `--from` or set `SF_LWC_REGISTRY`.

## What `add` does
1. Resolves `dependencies` recursively (cycle-safe, dependencies first).
2. Copies files into `<package-dir>/main/default/`, skipping existing files unless `--overwrite`.
3. Merges `labels` into `labels/CustomLabels.labels-meta.xml` without touching existing labels.
4. Records installed files in `sf-lwc.lock.json` (groundwork for `update` / `remove`).
5. Prints `notes` for manual steps (permission sets, objects, fields).

## What `remove` does
1. Verifies the named component(s) are installed in `sf-lwc.lock.json`.
2. Blocks removing a dependency still required by another installed component unless `--force` is passed.
3. Deletes tracked files and prunes tracked custom labels.
4. Removes component entries from `sf-lwc.lock.json` (and deletes the lockfile when empty).
