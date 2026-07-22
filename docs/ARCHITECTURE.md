# Gmail AutoClean — Architecture

This document explains how AutoClean is structured so another developer can understand it and extend it safely.

It reflects script version **`20260721-2`** (`SCRIPT_VERSION` in `AutoClean.gs`).

Primary sources:

- `AutoClean.gs` — production logic
- `AutoClean.tests.gs` — menu-runnable self-tests
- `README.md` — user-facing behavior
- `CHANGELOG.md` — versioned behavior changes

---

## Mental model

AutoClean is a **spreadsheet-bound Google Apps Script** that:

1. Maintains a **sender registry** in Google Sheets (`AutoCleanSenders`)
2. Learns senders from Gmail labels (`AutoClean/Learn`, `AutoClean/Ignore`)
3. Periodically searches Gmail for each **active** sender
4. Protects some messages, retains others by count/days rules, and moves the rest to Trash
5. Writes run stats back to the registry and backs up lifetime totals in script properties

Safety defaults matter more than cleverness:

- Blank or corrupted **Active** is **not** live
- **Test** / Menu Dry Run / `GLOBAL_DRY_RUN` never trash
- **Total Removed** never decreases through normal code paths
- Registry reconcile prefers **formats + targeted heals** over rewriting healthy values

---

## Registry lifecycle

### Spreadsheet and sheet

| Constant | Value |
|----------|-------|
| `REGISTRY_SPREADSHEET_NAME` | `AutoClean Registry` |
| `REGISTRY_SPREADSHEET_ID_KEY` | `AUTO_CLEAN_REGISTRY_SPREADSHEET_ID` |
| `SHEET_NAME` | `AutoCleanSenders` |
| `REGISTRY_COLUMN_COUNT` | `18` |

`getRegistrySpreadsheet()` resolves:

1. The active spreadsheet if the script is bound to one
2. Otherwise the ID stored in script properties
3. Otherwise creates **AutoClean Registry** and stores its ID

`getOrCreateRegistrySheet()` / `getRegistrySheetLight()` get or insert `AutoCleanSenders`, then call `reconcileRegistrySheet(...)`.

New sheets get a **full** reconcile (including width auto-fit). Existing sheets get a **light** reconcile on normal cleanup.

### Column schema (`COL`)

Single source of truth: `getRegistrySchema()` / `COL`.

| Col | Constant | Header | Type |
|----:|----------|--------|------|
| 1 | `SENDER` | Sender | formula (Gmail search hyperlink) |
| 2 | `MODE` | Mode | list: `count`, `days` |
| 3 | `VALUE` | Value | positive number |
| 4 | `ACTIVE` | Active | checkbox |
| 5 | `TEST` | Test | checkbox |
| 6 | `KEEP_UNREAD` | Keep Unread | checkbox (default ON for new rows) |
| 7 | `LAST_CHECKED` | Last Checked | datetime |
| 8 | `LAST_REMOVED` | Last Removed | number |
| 9 | `TOTAL_REMOVED` | Total Removed | number |
| 10 | `WOULD_DELETE` | Would Delete | number |
| 11 | `PROTECTED_KEPT` | Protected Kept | number |
| 12 | `TEST_SHEET` | Test Sheet | text / hyperlink |
| 13 | `NOTES` | Notes | text |
| 14 | `ADDED` | Added | date |
| 15 | `ENABLED_SINCE` | Enabled Since | date |
| 16 | `LAST_EMAIL_SEEN` | Last Email Seen | date |
| 17 | `LAST_BATCH` | Last Batch | text |
| 18 | `GMAIL_SEARCH` | Gmail Search | formula |

### How rows appear

**Learn** (`learnSendersFromLabel`):

- Newest message sender in the labeled thread
- Skips the account’s own addresses / aliases
- `addSenderRow(sheet, sender, true, true, "")` → Active ON, Test ON, Keep Unread ON

**Ignore** (`learnIgnoredSendersFromLabel`):

- Same newest-sender rule
- `addSenderRow(sheet, sender, false, false, "Ignored via AutoClean/Ignore")`
- Ignore label removed; `AutoClean/IgnoredProcessed` added

**Ignore always runs before Learn** on each cleanup so a new sender cannot be learned active if Ignore already claimed them that run.

### Manual edits (`onEdit`)

Only on `AutoCleanSenders`, row ≥ 2:

| Edited | Behavior |
|--------|----------|
| Sender | Refresh Sender + Gmail Search formulas (or clear Sender if emptied) |
| Active → TRUE | Force Test ON; set Enabled Since if blank |
| Active → FALSE | Force Test OFF |

### Cleanup vs Verify/Fix

```
Cleanup run
  → light reconcile
  → assert headers (abort if mismatched)
  → Ignore / Learn / Managed sync
  → process active rules (search → protect → retain → trash/preview)
  → updateRuleStats
  → cleanupObsoleteTestSheets (unless early stop)
  → settings refresh

Verify/Fix Registry
  → full reconcile (light + Gmail links + trim + width auto-fit)
  → alternating colors
  → status alert (no Gmail trash)
```

`assertRegistryHeaders()` refuses to run cleanup on a broken header row and tells the user to run Verify/Fix first.

---

## Gmail lifecycle

### Labels

| Constant | Label |
|----------|-------|
| `LEARN_LABEL_NAME` | `AutoClean/Learn` |
| `KEEP_LABEL_NAME` | `AutoClean/Keep` |
| `IGNORE_LABEL_NAME` | `AutoClean/Ignore` |
| `IGNORE_PROCESSED_LABEL_NAME` | `AutoClean/IgnoredProcessed` |
| `MANAGED_LABEL_NAME` | `AutoClean/Managed` |

Created lazily via `ensureLabelsExist()` / `getOrCreateLabel()`.

### Per-sender cleanup

For each rule from `getActiveRules()`:

1. **Search** — `from:{sender} -in:trash -in:spam` via `searchAllThreads` (cap `MAX_THREADS_PER_SENDER = 500`)
2. **Filter** — only messages whose normalized From matches the rule sender
3. **Protect** — `classifyMessageProtection(...)`:
   - Starred → `KEEP - STARRED`
   - Thread has `AutoClean/Keep` → `KEEP - AUTOCLEAN KEEP LABEL`
   - Keep Unread ON and message unread → `KEEP - UNREAD`
4. **Retain** — `count` keeps newest N eligible; `days` keeps messages within the window
5. **Trash or preview** — `trashEligibleItems(oldItems, ruleDryRun)` only when not dry-run
6. **Managed** — touched threads get `AutoClean/Managed`
7. **Stats / test sheet** — `updateRuleStats`; `writeTestSheet` when Test or global dry-run

Effective dry-run:

```text
ruleDryRun = GLOBAL_DRY_RUN || menuDryRun || rule.test
```

### Managed label sync

`syncManagedLabels()` scans up to `MAX_MANAGED_SYNC_THREADS` (500) newest Managed threads and removes the label when no message From is in `getActiveSenderSet()`.

This is currently **best-effort** for large mailboxes (same newest page each run). Pagination / rotation is a Phase 2 concern.

### Test sheets

- Prefix `TEST_`
- Name from `makeSenderSlug(sender)` → `TEST_{readable30}_{12-hex}`
- Cap `MAX_TEST_SHEET_ROWS = 250`
- Linked from `COL.TEST_SHEET`
- Obsolete sheets cleaned by `cleanupObsoleteTestSheets` (skipped on early stop to save runtime)

---

## Reconciliation philosophy

Reconcile exists to keep the registry **structurally healthy** without casually rewriting user data.

### Light (every cleanup)

1. Migrations (`Last Cleanup` removal, Keep Unread insert)
2. `healMisplacedRegistryValues` — clear misplaced ints/dates/batch text; fix Test-row preview columns
3. `healKeepUnreadMisplacedDates`
4. `applyRegistrySchemaFormats` — **formats only**
5. `applyRegistryInputValidations` — Mode / Value only
6. `healRegistryCheckboxColumnsIfNeeded` — **probe first**; rewrite only if corrupted (`coerceCheckboxValue`, not live `isCheckboxTrue`)
7. `healNumericStatColumns` — number format enforcement
8. `syncLifetimeTotalsWithSheet` — `max(sheet, props)`
9. Header ensure + dry-run header styling

### Full (Verify/Fix)

Everything in light, plus:

- Refresh Sender + Gmail Search formulas
- Trim blank trailing rows
- Optional column width auto-fit
- (Menu path also re-applies light alternating colors)

### Why this order matters

Datetime format applied **before** clearing misplaced integers historically turned Total Removed values into `1/9/1900`-style dates. Heals that clear junk values must run **before** (or carefully relative to) format application so we do not “reveal” corruption as fake dates and then treat it as real data.

Aggressive bulk rewrites of healthy date/stat columns are intentionally avoided after earlier Verify/Fix regressions.

---

## Write paths

### Registry cells

| Writer | What it writes |
|--------|----------------|
| `onEdit` | Sender / Search formulas; Active↔Test; Enabled Since |
| `addSenderRow` | Full new row + formulas |
| `getActiveRules` | Enabled Since if blank |
| `appendDuplicateNote` | Notes |
| `updateRuleStats` | Last Checked, Last Removed, Would Delete, Protected Kept, Last Email Seen, Last Batch; Total Removed **only on live deletes** |
| `setRegistrySenderFormula` / `setRegistryGmailSearchFormula` | Formula columns |
| `ensureRegistryGmailSearchLinks` | All sender/search formulas (full reconcile) |
| `healMisplacedRegistryValues` | Targeted repairs in date/text/stat/Test columns |
| `healKeepUnreadMisplacedDates` | Keep Unread / Last Checked |
| `healRegistryCheckboxColumnsIfNeeded` | Active / Test / Keep Unread when probe fails |
| `syncLifetimeTotalsWithSheet` | Total Removed (raise only) |
| `migrateAddKeepUnreadColumn` | Insert Keep Unread + defaults |
| `ensureRegistryHeaderRow` | Header row when invalid |
| `syncInactiveTestCheckboxes` | Test → false when inactive |
| `cleanupObsoleteTestSheets` / `purgeAllTestSheets` | Test Sheet links |
| `updateRegistryDryRunIndicator` | Header styling; clears extra columns beyond 18 |

### Script properties

| Writer | Keys |
|--------|------|
| Registry create / stale clear | `AUTO_CLEAN_REGISTRY_SPREADSHEET_ID` |
| End of run | `AUTO_CLEAN_LAST_RUN`, `AUTO_CLEAN_LAST_BATCH` |
| Batch controls | `AUTO_CLEAN_BATCH_SIZE`, `AUTO_CLEAN_NEXT_BATCH_INDEX` |
| Schedule | `AUTO_CLEAN_SCHEDULE` |
| Menu dry run | `AUTO_CLEAN_GLOBAL_DRY_RUN` |
| Lifetime totals | `AUTO_CLEAN_LIFETIME_TOTAL_H_{32-hex}` (+ migrate/delete legacy slug keys) |

If you add a new feature that writes registry cells, document it here and add a self-test for the invariant it must preserve (especially Total Removed and Active).

---

## Schema invariants

1. **Exactly 18 columns** — headers must match `getRegistryHeaders()`
2. **Types** come from `getRegistrySchema()` (checkbox / date / datetime / number / list / formula / text)
3. **Active live gate** — only `isCheckboxTrue(active) === true`
4. **Test preview gate** — `isCheckboxTrue(test)` (blank Test means live, not preview)
5. **Keep Unread** — same boolean fail-closed helper
6. **Mode** — only `count` or `days`; invalid rows are skipped
7. **Value** — must be ≥ 1; invalid rows are skipped
8. **Duplicate active senders** — first wins; later rows get a Notes annotation and are skipped
9. **Extra columns beyond R** — cleared by dry-run indicator maintenance (do not store data there)

Cleanup will not proceed if headers fail `assertRegistryHeaders`.

---

## Lifetime invariant

**Total Removed is a lifetime counter.** It must not reset on quiet runs, dry-runs, Test mode, or routine reconcile.

### Storage

- Sheet: column I (`COL.TOTAL_REMOVED`)
- Backup: script property `AUTO_CLEAN_LIFETIME_TOTAL_H_{hash}`

### Read

```text
readLifetimeTotal = max(sheetCell, storedProperty)
```

### Write

- Live deletes only: `newTotal = current + removedCount`
- Reconcile sync: `merged = max(sheet, props)` — may raise sheet or props, never lower them intentionally

### Legacy migration

Old keys used truncated slugs. On read, AutoClean migrates legacy → hashed key and deletes the legacy key.

**Caveat:** if two senders previously collided on one legacy key, that merged total cannot be separated retrospectively. Whichever sender migrates first inherits it.

---

## Why Active fails closed

Checkbox corruption is common in Sheets (FALSE + date format → `12/30/1899`, pasted text, numbers, etc.).

Plain-text number format (`@`) on checkbox cells is also harmful: clicks store the string `"TRUE"` and Sheets reports a validation error. Checkbox columns must use **General** format with boolean values.

An earlier posture of “anything except FALSE is active” meant blank / junk Active rows could be processed **live**.

Two helpers at the sheet boundary:

| Helper | Job | String `"TRUE"` |
|--------|-----|-----------------|
| `isCheckboxTrue` | Live decisions (fail closed) | **false** — skip until storage is boolean |
| `coerceCheckboxValue` | Heal / new-row storage repair | **true** — write boolean `true` back |

Live contract (`isCheckboxTrue`):

```javascript
// Only explicit boolean true counts as checked.
return value === true;
```

Rejected for live processing: `"TRUE"`, `"true"`, `1`, dates (including Sheets epoch), `null`, blank, etc.

Used by:

- `getActiveRules`
- `getActiveSenderSet`
- `countActiveRules`
- `isActiveRow`
- Test / Keep Unread helpers

`healRegistryCheckboxColumnsIfNeeded` and `applyRegistryRowFormatting` use `coerceCheckboxValue` so repair never routes string checked values through the live fail-closed helper.

`onEdit` still understands edit-event `"TRUE"`/`"FALSE"` strings from the UI, then persists boolean checkbox values.

---

## Why hashes replaced slugs

Legacy `makeLegacySenderSlug` lowercased, stripped punctuation to `_`, and truncated to 40 characters.

That caused collisions such as:

- `news-alert@example.com`
- `news.alert@example.com`

Both became the same slug → shared test sheet names and/or lifetime property keys.

### Current design

| Use | Format |
|-----|--------|
| Test sheet slug | `{readable30}_{12-hex}` from SHA-256 (6 bytes) |
| Lifetime property key | `H_{32-hex}` from SHA-256 (16 bytes), **independent** of sheet slug |

Normalization (lowercase + trim) happens before hashing so display-name From headers and casing do not create duplicate identities after `normalizeSender`.

---

## Why Total Removed never decreases

Three cooperating rules:

1. **`updateRuleStats`** writes Total Removed only when live `removedCount > 0`
2. Quiet runs and dry-run/Test do not touch Total Removed (dry-run may zero Last Removed / set Would Delete)
3. **`syncLifetimeTotalsWithSheet`** only applies `max(sheet, props)`

Reconcile must not “heal” Total Removed down to 0 when a cell looks odd — prefer property backup and careful readers (`readLifetimeCountFromCell` prefers plain integer display text; real calendar dates in stat columns are not treated as huge serials).

If you change heal logic for numeric columns, add a test that a restored Total Removed value survives reconcile.

---

## Test philosophy

### Goals

Self-tests exist to lock **safety contracts**, not to simulate all of Gmail.

They run from **AutoClean → Run Self Tests** via `runSelfTests()` in `AutoClean.tests.gs`.

### Style

- Lightweight fakes (`makeFakeSheet`, stubbed helpers)
- No real Gmail search/trash in the suite
- Assert helpers: `assertEq`, `assertTrue`
- Temporary global stubbing restored in `finally`

### Covered (high value)

- Checkbox fail-closed primitive
- Active/Test rule selection
- Sender slug / lifetime key uniqueness
- Newest-message Learn helper + From normalization
- Protection classification + dry-run trash guard
- Lifetime increment / max sync
- Heal helpers for dates/text
- Reconcile orchestration reporting (mocked collaborators)

### Intentionally not covered (yet)

- Full end-to-end cleanup against live Gmail
- Managed-label pagination behavior
- Mid-sender runtime budget / partial scan UI
- Partial-failure accounting mid-`moveToTrash`
- Real Spreadsheet format/banding side effects
- Trigger installation and lock contention

When adding a risky write path, prefer:

1. Extract a small pure/helper function
2. Call it from production code
3. Add a self-test for the helper contract

---

## Extension checklist

Before shipping a change that touches cleanup or registry maintenance:

1. Does Active still require boolean `true`?
2. Can Total Removed decrease on any path you added?
3. Do dry-run / Test still skip `moveToTrash`?
4. Did you introduce a new identifier that can collide across senders?
5. Does light reconcile still avoid rewriting healthy checkbox values?
6. Did you update `CHANGELOG.md`, and this file if architecture changed?
7. Did you add or extend a self-test for the new invariant?

---

## Related reading

- [README.md](../README.md) — install, labels, workflow
- [CHANGELOG.md](../CHANGELOG.md) — versioned behavior
- [LICENSE](../LICENSE) — GPLv3
