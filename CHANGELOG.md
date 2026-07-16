# Changelog

All notable changes to Gmail AutoClean are documented here.

Versions match `SCRIPT_VERSION` in `AutoClean.gs` (format `YYYYMMDD-N`).

---

## 20260716-3

### Added

- New menu item: **Run Self Tests**
- Separate Apps Script test harness file: `AutoClean.tests.gs`
- Self-tests for high-risk corruption/total-write contracts:
  - stat/date normalization and lifetime count reads
  - datetime/text heal rules
  - registry column range math
  - `updateRuleStats` dry-run vs live lifetime write behavior
  - `syncLifetimeTotalsWithSheet` max-invariant (`max(sheet, props)`)
  - `reconcileRegistrySheet` full-mode orchestration/report notes

### Fixed

- Self-test harness fake `sheet` for reconcile tests now includes methods used by `updateRegistryDryRunIndicator` (`getLastColumn`, `getRange`)

---

## 20260716-2

### Fixed

- **Last Email Seen** showing batch text (`Rows 2-49…`) — cleared from date columns
- **Notes** dates stored as display strings (`7/13/2026`) — cleared from text columns

---

## 20260716-1

### Fixed

- **Verify/Fix corruption**: removed aggressive `healCheckboxCorruptionOnStatColumns` that rewrote all date/stat columns when Last Checked had a stray checkbox validation
- **Last Checked showing 1900 dates** (e.g. `1/9/1900` when Total Removed is `9`): heal clears misplaced integers and epoch dates from datetime columns **before** applying datetime format
- **Notes column showing dates**: dates are cleared from text columns (Notes, Test Sheet)
- **Test rows**: preview counts in Last Removed are moved to Would Delete when Test is checked
- **Total Removed mis-read**: lifetime reader prefers plain integer display text; real calendar dates in stat columns are no longer converted to huge serials
- `healNumericStatColumns` now only enforces number format — value repair runs once in `healMisplacedRegistryValues`

---

## 20260715-3

### Fixed

- Keep Unread / checkbox columns showing `12/30/1899` when `FALSE` had a date format applied

### Changed

- Registry maintenance policy:
  - Every cleanup reasserts **column formats** and **Mode / Value** validations (no healthy value rewrites)
  - Checkbox columns are **probed**; healed only when corruption is detected (preserves `TRUE` / `FALSE`)
  - **Verify/Fix** still does full reconcile (links, trim, optional width auto-fit)
- Cleanup no longer rewrites all checkbox cells on every run

---

## 20260711-1

### Fixed

- **Total Removed** resetting when stat cells were date/checkbox-corrupted (reader treated them as `0`)

### Added

- Robust numeric stat reading (dates, booleans, display text)
- Per-sender lifetime total backup in script properties (`max(sheet, backup)` on reconcile)
- Numeric stat column heal on reconcile

---

## 20260710-1

### Added

- Clickable **Sender** column — same Gmail search as **Gmail Search** (`from:… -in:trash -in:spam`)
- Sender links refreshed on Learn, Verify/Fix, and manual sender edits (`onEdit`)

### Changed

- **Gmail Search** column kept alongside Sender links

---

## 20260708-3

### Added

- Single registry schema map (`getRegistrySchema`) as source of truth
- `reconcileRegistrySheet()` for light (cleanup) vs full (Verify/Fix) maintenance
- Light alternating row colors (from row 2, preserving header dry-run colors)

### Fixed

- **Total Removed** / **Last Removed** no longer wiped on quiet live runs (zero deletes)
- Keep Unread / checkbox corruption healing for misplaced dates and bools in stat columns

### Changed

- Column widths auto-fit only on Verify/Fix (and new sheets), not on every cleanup

---

## 20260707-5

### Added

- Runtime time budget with early stop and resume on next batch
- Per-sender thread cap warnings
- Test sheet row limit for large previews

### Changed

- Trimmed redundant per-message logging in test / dry-run mode (test sheets already list items)

---

## 20260707-3

### Added

- Per-sender **Keep Unread** (default ON for new senders)
- Unread mail skipped when Keep Unread is checked
- Test sheet action `KEEP - UNREAD`

---

## 20260706-5

### Added / improved

- Menu and settings UI improvements
- Registry maintenance split (lighter cleanup path vs Verify/Fix)

---

## Earlier post-1.0.0 (through ~2026-07-06)

Notable work landed after the initial public release and before dated `SCRIPT_VERSION` tags above:

### Added

- Script versioning and GPLv3 licensing header
- **Gmail Search** column (clickable sender search in Gmail)
- **Verify/Fix Registry** layout verification and repair
- **AutoClean/Managed** label sync for managed senders
- Menu Dry Run indicator (header color: green live / orange preview)
- Batch size controls, last-batch tracking, settings dashboard
- Improved test sheet naming, links, and obsolete-sheet cleanup
- Stronger error handling and registry self-healing

### Changed

- Removed legacy **Last Cleanup** column in favor of **Last Checked**
- Streamlined column management and `onEdit` Active ↔ Test checkbox behavior
- README updates (install, updating code, support)

---

## Version 1.0.0

Initial public release.

### Added

- Automatic registry spreadsheet creation
- Automatic Gmail label creation
- Learn sender workflow
- Keep sender workflow
- Ignore sender workflow
- Count retention mode
- Days retention mode
- Per-sender Test Mode
- Global Dry Run
- Automatic statistics
- Preview-only cleanup
- Direct Gmail links in preview sheets
- Protected emails
  - Starred emails
  - AutoClean/Keep label
- Ignore senders
- Automatic cleanup logging
- Automatic sender discovery
- Conditional formatting in preview sheets
- Registry auto-formatting
- Data validation
- Checkboxes
- Automatic removal of Learn labels
- Automatic removal of Ignore labels after registration
- Spreadsheet self-healing
- Automatic registry creation
- Automatic label creation

### Safety Features

- Nothing deleted during Global Dry Run
- Nothing deleted while Test Mode enabled
- Starred emails never deleted
- AutoClean/Keep emails never deleted
- Preview before deletion
- Sender-specific enable/disable
- Sender-specific retention rules
