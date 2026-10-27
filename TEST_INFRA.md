# E2E Test Infra: sf-lwc

## Test Philosophy
- Opaque-box, requirement-driven testing based on `ORIGINAL_REQUEST.md`.
- No reliance on internal module implementation details.
- Dual CLI compatibility: tests exercise both standalone `sf-lwc` CLI and plugin `sf lwc` (or plugin command classes).
- Fast, deterministic verification with `node:test` and `node:assert/strict`.

## Feature Inventory & Test Coverage
| # | Feature | Source (Requirement) | Tier 1 (Unit) | Tier 2 (Boundary/Error) | Tier 3 (Integration/Pairwise) | Tier 4 (E2E Scenarios) |
|---|---------|----------------------|:-------------:|:-----------------------:|:-----------------------------:|:----------------------:|
| 1 | Standard SFDX Layout | ORIGINAL_REQUEST §R1 | ✓ | ✓ | ✓ | ✓ |
| 2 | Zero Fallback Probing Loops | ORIGINAL_REQUEST §R1 | ✓ | ✓ | ✓ | ✓ |
| 3 | Single-Pass Component Enumeration | ORIGINAL_REQUEST §R1 | ✓ | ✓ | ✓ | ✓ |
| 4 | Direct Bundle Parsing (`.js-meta.xml`) | ORIGINAL_REQUEST §R1 | ✓ | ✓ | ✓ | ✓ |
| 5 | Descriptive Errors (Missing / Non-LWC) | ORIGINAL_REQUEST §R1 | ✓ | ✓ | ✓ | ✓ |
| 6 | SFDX Diff Support | Survey 1 | ✓ | ✓ | ✓ | ✓ |
| 7 | Zero-Dependency Selector | ORIGINAL_REQUEST §R2 | ✓ | ✓ | ✓ | ✓ |
| 8 | Multi-Select & Single-Select | ORIGINAL_REQUEST §R2 | ✓ | ✓ | ✓ | ✓ |
| 9 | TTY Guard & Non-Interactive Fast-Fail | ORIGINAL_REQUEST §R2 | ✓ | ✓ | ✓ | ✓ |
| 10 | Standalone CLI Interactive Add | ORIGINAL_REQUEST §R2 | ✓ | ✓ | ✓ | ✓ |
| 11 | Non-Interactive Direct CLI Usage | ORIGINAL_REQUEST §R2 | ✓ | ✓ | ✓ | ✓ |
| 12 | Dual CLI Plugin Compatibility | ORIGINAL_REQUEST §R3 | ✓ | ✓ | ✓ | ✓ |
| 13 | Dual CLI Multi-Component Parity | ORIGINAL_REQUEST §R3 | ✓ | ✓ | ✓ | ✓ |

## Test Architecture
- Test Runner: `npm test` (`node --test test/*.test.js`) with `pretest` (`npm run build`).
- Mock Stream Harness: `test/selector.test.js` uses `PassThrough` streams with `setRawMode` stubs to simulate interactive typing, arrow navigation, space selection, enter confirmation, and exit signals.
- Directory Layout:
  - `test/sfdx.test.js`: Single-pass listing, zero fallback loops, error cases on non-LWC repos, `.js-meta.xml` parsing.
  - `test/selector.test.js`: Interactive selector fuzzy search, arrow navigation, multi-select, TTY rejection.
  - `test/add.test.js`: Standalone CLI `sf-lwc add` non-interactive usage, multi-install, non-TTY fast-fail.
  - `test/plugin.test.js`: Salesforce CLI plugin command execution, help verification, non-TTY guard.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Target |
|---|----------|--------------------|--------|
| 1 | Interactive multi-component install from SFDX repo | F1, F3, F4, F7, F8, F10 | Terminal user workflow |
| 2 | Direct non-interactive CLI script execution (`sf-lwc add modal --from svierk/awesome-lwc-collection`) | F1, F3, F4, F11 | CI/CD automation pipeline |
| 3 | Non-interactive execution without component fails fast | F9, F10, F12 | Script error handling |
| 4 | Non-LWC repository rejected with clear actionable error | F2, F5 | User error feedback |
| 5 | Dual CLI parity: `sf lwc add` command mirrors `sf-lwc add` | F12, F13 | Salesforce DX developer |
