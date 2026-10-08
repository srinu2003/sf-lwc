# sf-lwc

CLI that copies open-source LWC components into a Salesforce DX project, along with their Apex classes,
custom labels, and component dependencies.

    node bin/sf-lwc.js add data-table --from . --dry-run          # local registry (this repo)
    node bin/sf-lwc.js list --from .                              # list available components
    GITHUB_TOKEN=... node bin/sf-lwc.js add data-table --from owner/sf-lwc@main
    SF_LWC_REGISTRY=owner/sf-lwc@main node bin/sf-lwc.js ls

For private registries, set `GITHUB_TOKEN` (or `GH_TOKEN`) to a token with read access to the repo.
Set `SF_LWC_REGISTRY` to avoid typing `--from`.

## Registry layout (this repo is also the registry)

    components/<name>/manifest.json      # see schema/manifest.schema.json
    components/<name>/files/<path>       # mirrors <package-dir>/main/default/<path>

## What `add` does
1. Resolves `dependencies` recursively (cycle-safe, dependencies first).
2. Copies files into `<package-dir>/main/default/`, skipping existing files unless `--overwrite`.
3. Merges `labels` into `labels/CustomLabels.labels-meta.xml` without touching existing labels.
4. Records installed files in `sf-lwc.lock.json` (groundwork for `update` / `remove`).
5. Prints `notes` for manual steps (permission sets, objects, fields).
