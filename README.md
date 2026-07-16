# Gmail AutoClean

Automatically keep only the newest newsletters, promotional emails, journals, recurring notifications, and other low-value email while protecting everything important.

Instead of manually deleting hundreds (or thousands) of old emails, AutoClean learns which senders you want to manage and automatically applies customizable retention rules.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S0P222IKZ9)

For developers extending AutoClean, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (registry/Gmail lifecycles, write paths, invariants, and test philosophy).

---

# Features

- 📬 Learn new senders with a Gmail label
- 🧹 Keep only the newest **N** emails
- 📅 Keep emails from the last **N** days
- ⚙️ Individual rules per sender
- 🧪 Per-sender Test Mode
- 🔒 Global Dry Run
- ⭐ Never delete starred emails
- 🏷 Never delete emails marked with **AutoClean/Keep**
- 🚫 Autoclean/Ignore to ignore senders completely
- 📈 Automatic statistics
- 📄 Detailed test reports
- 🔗 Direct Gmail links to every reviewed email
- 📆 Tracks when a rule was enabled
- 📬 Tracks the last email seen from every sender
- ⏰ Automatic scheduled cleanup
- 📋 Custom spreadsheet menu
- 🚀 Automatically creates and maintains its own registry spreadsheet/dashboard
- 🔁 Automatically batches cleanup to support hundreds of senders
- 🧾 Last Checked tracking
- 🧩 Last Batch tracking
- ⚡ Manual full cleanup option
- ♻️ Cleans existing inbox history, not just future emails

---

# Installation

## Recommended Install: Make a Copy

The easiest way to install Gmail AutoClean is to make a copy of the template spreadsheet:

[Make a copy of AutoClean Registry](https://docs.google.com/spreadsheets/d/1lF6n_nuEwqy8wGQCoxa9FsyDAvjaCSJ4bGuHkfdwPjk/copy)

After copying:

1. Open the copied spreadsheet.
2. Reload it if needed.
3. Use `AutoClean → Create Labels`.
4. Use `AutoClean → Run Cleanup - Next Batch`.
5. Approve the requested permissions.
6. Start labeling Gmail messages with:
   - `AutoClean/Learn`
   - `AutoClean/Keep`
   - `AutoClean/Ignore`
  

## Manual Install

## Step 1

Create a new Google Spreadsheet.

---

## Step 2

Open

```
Extensions
→ Apps Script
```

---

## Step 3

Paste:

- `AutoClean.gs`
- `AutoClean.tests.gs` (required — the menu includes **Run Self Tests**)

Create both files in the Apps Script project (File → New → Script file), then paste the matching contents from this repository.

---

## Step 4

Save the project.

---

## Step 5

Run **AutoClean → Run Cleanup - Next Batch** (or **Run Full Cleanup**) once to initialize AutoClean and grant permissions.

You can also run `keepLatestOnly()` once from the Apps Script editor.

Grant Gmail and Sheets permissions.

---

## Step 6

Reload the spreadsheet.

The AutoClean menu will automatically appear in the toolbar.

---

## Step 7

Start labeling emails.

If the AutoClean labels don't already exist, they will be created automatically the first time the script runs.

---

# Updating AutoClean

There are **no automatic updates** for Apps Script projects.

To update:

1. Open your AutoClean spreadsheet on desktop.
2. Go to `Extensions → Apps Script`.
3. Replace the contents of `AutoClean.gs` with the latest from this repository.
4. Replace (or add) `AutoClean.tests.gs` with the latest from this repository.
5. Save the project.
6. Return to the spreadsheet and reload the page.
7. Run `AutoClean → View Settings`.

Your sender registry and settings will remain in the spreadsheet.

Longer term, the more polished approach would be a small **Updater** menu item using a library or fetching from GitHub, but that adds trust and security complexity. Manual replace-from-GitHub is the safest and clearest approach for now.

---

# How It Works

AutoClean uses five Gmail labels.

```
AutoClean
├── Learn
├── Keep
├── Ignore
├── IgnoredProcessed
└── Managed
```

---

# AutoClean/Learn

Apply this label to **one email** from a sender you want AutoClean to manage.

Example:

```
Costco Newsletter
```

Run AutoClean.

AutoClean learns **only the sender of the newest message** in that labeled thread (not every participant in the conversation). Your own address and Gmail aliases are skipped.

The Learn label is automatically removed because it is only used to teach AutoClean about a new sender once.

Every new sender starts with:

- Test Mode = ON
- Active = ON
- Keep Unread = ON
- Keep newest 1 email

Nothing is deleted until you've reviewed the results.

---

# AutoClean/Keep

Apply this label to **any email or thread**.

Those emails are protected for as long as the **AutoClean/Keep** label remains applied.

Examples:

- Important coupon
- Tax receipt
- Medical journal issue
- Warranty information
- Purchase confirmation

Protected emails are excluded before retention rules are calculated.

**AutoClean never removes the AutoClean/Keep label automatically.** You can remove it yourself when protection is no longer needed.

---

# AutoClean/Ignore

Apply this label to one email from a sender.

The sender is added to the registry as:

```
Active = FALSE
```

AutoClean will never process that sender unless you later enable it manually.

After AutoClean processes the email, **AutoClean/Ignore** is removed and **AutoClean/IgnoredProcessed** is applied so you can still see ignored mail in Gmail without reprocessing it every run.

Use **AutoClean/Ignore** for new senders to block. Browse **AutoClean/IgnoredProcessed** to review what has already been ignored.

Perfect for:

- Friends
- Family
- Banks
- Work email
- Schools
- Anything accidentally added to Learn

**Important limitations:**

- **Ignore runs before Learn** on every cleanup run. If a sender is not yet in the registry, Ignore adds them as inactive before Learn can add them as active.
- **Ignore does not undo Learn.** If cleanup already ran and Learn added an **active** row, applying Ignore later will not deactivate that sender — uncheck **Active** in the spreadsheet instead.
- Senders **not in the registry at all** are never processed by AutoClean; Ignore is only needed when you want them recorded as blocked.

---

# AutoClean/IgnoredProcessed

AutoClean applies this label automatically after processing **AutoClean/Ignore**.

It is not something you apply manually. Use it in Gmail to see which ignored senders have already been added to the registry as inactive.

---
# AutoClean/Managed

AutoClean automatically applies this label to conversations from active managed senders.

This lets you see in Gmail that a sender is already managed by AutoClean.

If a sender is removed from the registry or marked inactive, AutoClean removes the Managed label on the next run.

---

# Registry Dashboard/Spreadsheet

The first run automatically creates:

```
AutoClean Registry
```

No manual setup required.

The spreadsheet is the control center.

The registry updates automatically every time AutoClean runs.

![AutoClean registry spreadsheet with AutoCleanSenders tab](docs/registry-empty.png)

*Empty registry after setup. Screenshots with populated data coming soon.*

## Columns

| Column | Description |
|---------|-------------|
| Sender | Clickable email address — opens the same Gmail search as **Gmail Search** (`from:… -in:trash -in:spam`) |
| Mode | count or days |
| Value | Number of emails or days |
| Active | Enable cleanup |
| Test | Preview only |
| Keep Unread | When checked, unread mail from this sender is never deleted (default **ON** for new senders) |
| Last Checked | Last time this sender was processed |
| Last Removed | Emails removed on the last live run that deleted something (quiet runs leave this unchanged) |
| Total Removed | Lifetime deleted (only increases; never reset by later runs) |
| Would Delete | Preview count |
| Protected Kept | Starred, AutoClean/Keep, and unread (when **Keep Unread** is on) |
| Test Sheet | Clickable link to the sender's `TEST_*` preview worksheet (set after the first test run) |
| Notes | Optional notes |
| Added | Rule creation date |
| Enabled Since | Date cleanup became active |
| Last Email Seen | Most recent email received |
| Last Batch | Batch that last processed this sender |
| Gmail Search | Clickable link to open Gmail search for that sender (`from:… -in:trash -in:spam`) |

**Registry tips:**

- Do not duplicate sender rows — duplicates are skipped and noted in the **Notes** column
- Do not delete rows — set **Active** to false instead to pause a sender
- Use **AutoClean → Verify/Fix Registry** for a full reconcile (links, trim, width auto-fit). Normal cleanup re-applies column formats and Mode/Value validations, and only heals checkbox columns when a probe detects corruption (preserving TRUE/FALSE).

---

# Batching

AutoClean processes senders in batches so large registries do not hit Google Apps Script runtime limits.

Even senders with hundreds or thousands of emails are processed efficiently because AutoClean searches one sender at a time rather than loading your entire mailbox.

By default, scheduled cleanup processes the **next batch** of senders, not the entire registry.

Default batch size:

```text
50 senders
```

Google Apps Script has a **6-minute** execution limit. AutoClean stops early when approaching that limit and resumes on the next batch run. If you see timeouts, lower the batch size (try **25** or **15**) and avoid **Run Full Cleanup** on large registries.

---

## Why Batching Exists

If you manage hundreds of senders, processing every sender in one run can take too long.

Batching lets AutoClean process a smaller group each time.

Example:

```text
Run 1: senders 1–50
Run 2: senders 51–100
Run 3: senders 101–150
Run 4: starts over at sender 1
```

---

## Menu Options

From the AutoClean menu:

```text
Run Cleanup - Next Batch
Run Full Cleanup

Set Batch Size: 25
Set Batch Size: 50
Set Batch Size: 100

Reset Batch Position
```

---

## Scheduled Cleanup

Scheduled cleanup uses:

```text
Run Cleanup - Next Batch
```

This means every scheduled run continues where the previous run stopped.

---

## Full Cleanup

Use:

```text
AutoClean → Run Full Cleanup
```

to process all active senders immediately.

This is useful for:

- Small registries
- Manual maintenance
- Testing
- First-time cleanup

---

## Batch Tracking

AutoClean tracks batching in the spreadsheet.

| Column | Description |
|---|---|
| Last Checked | Last time that sender was processed |
| Last Batch | Batch that last processed that sender |

The Settings sheet also tracks:

| Setting | Description |
|---|---|
| Batch Size | Current number of senders per batch |
| Next Batch Index | Where the next scheduled batch starts |
| Last Run | Last AutoClean execution |
| Last Batch | Last processed batch |

---

## Recommended Batch Size

| Registry Size | Recommended Batch Size |
|---:|---:|
| 1–100 senders | 50 |
| 100–500 senders | 25–50 |
| 500+ senders | 25 |

Most users should start with:

```text
50
```

**If a run times out:** use **Set Batch Size: 25** (or lower), run **Next Batch** instead of **Full Cleanup**, and leave heavy test-mode senders (large mailboxes) in Test until reviewed. AutoClean caps each sender at 500 threads per run and pauses before the 6-minute Apps Script limit when needed.

---

# Retention Modes

## Count Mode

Keep the newest

```
5
```

emails.

Delete everything older.

---

## Days Mode

Keep emails newer than

```
30
```

days.

Delete everything older.

---

# Test Mode

Every newly learned sender starts in Test Mode.

Each sender gets its own review worksheet, making it easy to approve one sender at a time and protect individual emails with **AutoClean/Keep**.

Running AutoClean creates a worksheet such as

```
TEST_sales_e_costco_com_a1b2c3d4e5f6
```

(Names use a short readable prefix plus a hash suffix so similar addresses cannot collide.)

The **Test Sheet** column in the registry links directly to that worksheet tab.

The report shows every email:

| Action | Meaning |
|---------|---------|
| KEEP - RETENTION RULE | Kept by retention |
| KEEP - STARRED | Protected |
| KEEP - AUTOCLEAN KEEP LABEL | Protected |
| KEEP - UNREAD | Protected because **Keep Unread** is on and the message is unread |
| WOULD DELETE | Would be deleted |

Each row contains a direct Gmail link so you can inspect the email.

Test reports are color-coded:

🟢 Green = kept

🔴 Red = would delete

Nothing is deleted while Test Mode is enabled.

Test mode requires both **Active** and **Test** to be checked.

- Unchecking **Active** automatically unchecks **Test** and removes the test sheet on the next run
- Re-checking **Active** automatically turns **Test** back on (safe default) until you manually disable it

---

# Global Dry Run

AutoClean has two user-facing preview controls plus an optional developer switch in code.

## Menu Dry Run and Test mode

Mail is only deleted when **both** global preview layers are off and the sender row is not in **Test** mode:

| Layer | Where | Default |
|-------|--------|---------|
| **Menu Dry Run** | `AutoClean → Turn Menu Dry Run ON/OFF` | OFF |
| **Per-sender Test** | **Test** checkbox on each registry row | ON for newly learned senders |

When **Menu Dry Run** is ON:

- Nothing is deleted for any sender
- Test preview sheets are generated for processed senders
- Safe for first-time setup

Menu Dry Run can be toggled from the spreadsheet without editing code.

The **AutoCleanSenders** header row (row 1) changes color to show preview status:

- **Green** — Menu Dry Run is OFF and live deletion is allowed for senders not in Test mode
- **Orange** — Menu Dry Run is ON, or the developer constant below is enabled (preview only, nothing deleted)

Reload the sheet or run cleanup after toggling to refresh the color.

## Developer constant (`GLOBAL_DRY_RUN`)

For power users and template authors, `GLOBAL_DRY_RUN` at the top of `AutoClean.gs` is a code-level safety switch. It is **not shown** in the settings dialog or menu.

```javascript
const GLOBAL_DRY_RUN = false;
```

When set to `true`:

- Nothing is deleted, even if Menu Dry Run is OFF
- The registry header turns orange (same as Menu Dry Run ON)
- Useful for distributing a safe-by-default copy, or as a belt-and-suspenders guard until you deliberately edit the script

Effective global preview is: `GLOBAL_DRY_RUN` **or** Menu Dry Run. Per-sender **Test** mode is separate and applies on top of that.

---

# Automatic Protection

The following emails are never deleted:

- ⭐ Starred emails
- 🏷 AutoClean/Keep
- 📬 Unread mail from senders with **Keep Unread** enabled
- 🚫 Inactive senders
- 🗑 Trash
- 🚫 Spam

**Keep Unread** is per sender and defaults to **ON** for new senders (including Learn). Uncheck it on any sender where you want unread mail eligible for cleanup. When enabled, AutoClean will not remove mail you have not opened yet; once you read a message, normal count/days rules apply on the next run.

## Deleted emails and recovery

AutoClean moves eligible emails to **Gmail Trash** — it does not permanently erase them. You can recover trashed emails from Gmail Trash, typically for about 30 days, using Gmail's normal undo/recovery flow.

---

# Spreadsheet Menu

AutoClean adds a custom menu.

```
AutoClean
─────────────────────
Run Cleanup - Next Batch
Run Full Cleanup

Enable Auto Cleanup: Every Hour
Enable Auto Cleanup: Every 6 Hours
Enable Auto Cleanup: Every 12 Hours
Enable Auto Cleanup: Daily
Disable Auto Cleanup

Set Batch Size: 25
Set Batch Size: 50
Set Batch Size: 100
Reset Batch Position

Turn Menu Dry Run ON / OFF

Create Labels

Open Gmail Labels

Purge All Test Sheets

Show Registry

View Settings

Verify/Fix Registry

Run Self Tests

Help
```

`purgeEmptyTestSheets()` (deletes only empty `TEST_*` sheets) exists in the script but is not in the menu — it was removed and may be added back later. Use **Purge All Test Sheets** to remove all test sheets, or run `purgeEmptyTestSheets()` from the Apps Script editor if you only want to clear empty ones.

## Self Tests

Use **AutoClean → Run Self Tests** to run the built-in safety checks in `AutoClean.tests.gs`.

The test runner validates high-risk contracts such as:

- Active/Test fail-closed safety (blank Active is never live)
- sender-slug / lifetime-key collision resistance
- Learn newest-message sender selection
- message protection classification (starred / Keep / unread)
- dry-run vs live trash guards (`moveToTrash` never called in dry run)
- stat/date normalization and lifetime reads
- date/text heal behavior
- registry range math
- `updateRuleStats` dry-run vs live lifetime write behavior
- `syncLifetimeTotalsWithSheet` max-invariant (never decrease totals)
- `reconcileRegistrySheet` full-mode orchestration/reporting

Results are shown in a summary alert:

- `Passed: X/Y`
- `Failed: N`

Most users never need to open Apps Script after installation.

---

# Settings

Use **AutoClean → View Settings** to open a read-only dashboard showing:

- Script version
- Menu dry run status
- Automatic cleanup schedule
- Batch size and next batch index
- Active rules count
- Last run and last batch

Values are read live from script properties each time you open the dialog. The old **AutoCleanSettings** worksheet is removed automatically when you use View Settings.

---

# Typical Workflow

1. Receive newsletter

2. Apply

```
AutoClean/Learn
```

3. Run AutoClean

4. Review generated Test Sheet

5. Protect any individual email

```
AutoClean/Keep
```

6. Run AutoClean again

7. Disable Test Mode

8. Enable automatic schedule

Done.

---


# Scheduling

Automatic schedules can be created directly from the AutoClean menu.

No Apps Script trigger setup is required.

Supported intervals:

- Every Hour
- Every 6 Hours
- Every 12 Hours
- Daily

## Concurrent runs

Only one cleanup run executes at a time. If you start a run while another is already in progress — for example, clicking the menu during a scheduled run — AutoClean shows **"AutoClean is already running"** and skips the overlapping run. Wait for the current run to finish, then try again.

---

# Requirements

- Google Gmail
- Google Sheets
- Google Apps Script

---

# Support

If AutoClean saves you time, consider supporting the project.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S0P222IKZ9)

---

# License

Copyright © 2026 LiVuP LLC. Gmail AutoClean is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0).

---

# Disclaimer

Always review Test Mode before enabling automatic deletion.

Although AutoClean protects:

The following emails are never deleted:

- ⭐ Starred emails
- 🏷 Emails or threads labeled AutoClean/Keep
- 📬 Unread messages when Keep Unread is enabled
- 🚫 Senders marked inactive
- 🚫 Senders learned through AutoClean/Ignore
- 🗑 Emails already in Trash
- 🚫 Emails in Spam


AutoClean has been designed with multiple safeguards—including Test Mode, protected labels, starred email protection, and preview reports—but you should always review your cleanup rules before enabling automatic deletion.
