# Gmail AutoClean

Automatically keep only the newest newsletters, promotional emails, journals, recurring notifications, and other low-value email while protecting everything important.

Instead of manually deleting hundreds (or thousands) of old emails, AutoClean learns which senders you want to manage and automatically applies customizable retention rules.

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
- 🚫 Ignore senders completely
- 📊 Spreadsheet dashboard
- 📈 Automatic statistics
- 📄 Detailed test reports
- 🔗 Direct Gmail links to every reviewed email
- 📆 Tracks when a rule was enabled
- 📬 Tracks the last email seen from every sender
- ⏰ Automatic scheduled cleanup
- 📋 Custom spreadsheet menu
- 🎯 Zero manual spreadsheet setup

---

# How It Works

AutoClean uses three Gmail labels.

```
AutoClean
├── Learn
├── Keep
└── Ignore
```

---

# AutoClean/Learn

Apply this label to **one email** from a sender you want AutoClean to manage.

Example:

```
Costco Newsletter
```

Run AutoClean.

The sender is automatically added to the registry.

The Learn label is automatically removed.

Every new sender starts with:

- Test Mode = ON
- Active = ON
- Keep newest 1 email

Nothing is deleted until you've reviewed the results.

---

# AutoClean/Keep

Apply this label to **any email or thread**.

Those emails are permanently protected.

Examples:

- Important coupon
- Tax receipt
- Medical journal issue
- Warranty information
- Purchase confirmation

Protected emails are excluded before retention rules are calculated.

---

# AutoClean/Ignore

Apply this label to one email from a sender.

The sender is added to the registry as:

```
Active = FALSE
```

AutoClean will never process that sender unless you later enable it manually.

Perfect for:

- Friends
- Family
- Banks
- Work email
- Schools
- Anything accidentally added to Learn

---

# Registry Spreadsheet

The first run automatically creates:

```
AutoClean Registry
```

No manual setup required.

The spreadsheet is the control center.

## Columns

| Column | Description |
|---------|-------------|
| Sender | Email address |
| Mode | count or days |
| Value | Number of emails or days |
| Active | Enable cleanup |
| Test | Preview only |
| Last Cleanup | Last execution |
| Last Removed | Emails removed last run |
| Total Removed | Lifetime deleted |
| Would Delete | Preview count |
| Protected Kept | Protected emails |
| Test Sheet | Preview worksheet |
| Notes | Optional notes |
| Added | Rule creation date |
| Enabled Since | Date cleanup became active |
| Last Email Seen | Most recent email received |

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

Running AutoClean creates a worksheet such as

```
TEST_Row_4_costco
```

The report shows every email:

| Action | Meaning |
|---------|---------|
| KEEP - RETENTION RULE | Kept by retention |
| KEEP - STARRED | Protected |
| KEEP - AUTOCLEAN KEEP LABEL | Protected |
| WOULD DELETE | Would be deleted |

Each row contains a direct Gmail link so you can inspect the email.

Nothing is deleted while Test Mode is enabled.

---

# Global Dry Run

AutoClean also supports a global preview mode.

When enabled:

- Nothing is deleted
- Every sender behaves like Test Mode
- Safe for first-time setup

This can be toggled from the spreadsheet menu.

---

# Automatic Protection

The following emails are never deleted:

- ⭐ Starred emails
- 🏷 AutoClean/Keep
- 🚫 Inactive senders
- 🗑 Trash
- 🚫 Spam

---

# Spreadsheet Menu

AutoClean adds a custom menu.

```
AutoClean
─────────────────────
Run Cleanup

Enable Auto Cleanup
  • Every Hour
  • Every 6 Hours
  • Every 12 Hours
  • Daily

Disable Auto Cleanup

Toggle Menu Dry Run

Create Labels

Open Gmail Labels

Purge Empty Test Sheets

Purge All Test Sheets

Show Registry

Refresh Settings

Help
```

Most users never need to open Apps Script after installation.

---

# Settings Sheet

AutoClean automatically maintains an **AutoCleanSettings** worksheet.

It shows:

- Global Dry Run status
- Menu Dry Run status
- Effective Dry Run
- Automatic cleanup schedule
- Active rules
- Last refresh

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

# Installation

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

- AutoClean.gs
- SheetMenu.gs

---

## Step 4

Save the project.

---

## Step 5

Run

```
keepLatestOnly()
```

once.

Grant Gmail and Sheets permissions.

---

## Step 6

Reload the spreadsheet.

The AutoClean menu will appear.

---

## Step 7

Start labeling emails.

---

# Scheduling

Automatic schedules can be created directly from the AutoClean menu.

No Apps Script trigger setup is required.

Supported intervals:

- Every Hour
- Every 6 Hours
- Every 12 Hours
- Daily

---

# Requirements

- Google Gmail
- Google Sheets
- Google Apps Script

---

# License

MIT License

---

# Disclaimer

Always review Test Mode before enabling automatic deletion.

Although AutoClean protects:

- Starred emails
- AutoClean/Keep emails
- Inactive senders
- Spam
- Trash

you are ultimately responsible for reviewing your cleanup rules.
