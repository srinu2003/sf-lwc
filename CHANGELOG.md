# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta.1] - 2026-11-16

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for full release details, architectural highlights, and migration notes.

### Added
- **8-Command CLI Lifecycle**: Full parity between standalone CLI (`npx sf-lwc` / `sf-lwc`) and Salesforce CLI plugin (`sf lwc`):
  - `init`: Project configuration initialization and registry caching.
  - `list` (alias `ls`): Local and remote component discovery with metadata summaries.
  - `add`: Recursive dependency resolution, atomic Custom Label merging, and lockfile tracking.
  - `diff`: Upstream drift detection against local files and lockfile hashes.
  - `update`: Upstream component upgrade engine.
  - `remove` (alias `rm`): Reference-counted safe uninstallation and label pruning.
  - `doctor`: Project diagnostics, lockfile verification, and manifest schema validation.
  - `pack` (alias `export`): Org-based dynamic dependency tracing via Tooling API.
- **Sidecar Manifests**: Supported `.sf-lwc/<name>.json` sidecar manifests for declaring dependencies and installation notes.
- **Schema Validation**: Added `schema/manifest.schema.json` and integrated validation into `sf-lwc doctor`.
- **CLI Flags**: Added `-v` and `--version` support to the standalone binary.

### Changed
- **Consumer Onboarding**: Streamlined consumer flow to require zero Salesforce CLI installation or org authorization.
- **Registry Engine**: Replaced GitHub REST API traversal with direct streaming tarball extraction from `codeload.github.com` to prevent unauthenticated 60 req/hr rate limits.

### Fixed
- **Security (Tarball Traversal)**: Blocked path traversal vulnerabilities in `parseTar` rejecting entries escaping the destination root.
- **Security (Command Injection)**: Guarded Tooling API query execution in `pack` using discrete argument arrays in `execFileSync`.
- **Custom Labels Regex**: Constrained label matching regex to prevent crossing `<labels>` XML block boundaries.
- **Error Preservation**: Prevented masking network or authentication errors as missing components during resolution.
