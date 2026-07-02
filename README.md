# Gmail AutoClean

Automatically keep only the newest newsletters, coupons, recurring notifications, journals, and promotional emails while protecting anything important.

Instead of manually deleting hundreds of old emails, AutoClean learns which senders you want to manage and automatically keeps only the emails you care about.

---

## Features

✅ Learn new senders with a Gmail label

✅ Keep newest **N** emails

✅ Keep emails from the last **N days**

✅ Individual sender rules

✅ Per-sender Test Mode

✅ Global Dry Run

✅ Spreadsheet dashboard

✅ Detailed test reports

✅ Direct Gmail links for every email

✅ Never delete starred emails

✅ Never delete emails marked with AutoClean/Keep

✅ Ignore senders entirely

✅ Automatic statistics

---

## How It Works

There are three Gmail labels.

```
AutoClean
    Learn
    Keep
    Ignore
```

### AutoClean/Learn

Label **one email** from a sender.

Example:

```
Costco Newsletter
```

Run AutoClean.

The sender is automatically added to your registry spreadsheet.

The Learn label is automatically removed.

---

### AutoClean/Keep

Apply this label to any email or thread.

Those emails will **never** be deleted, even if they would normally match the cleanup rules.

Examples:

- Important coupon
- Tax statement
- Medical journal issue
- Receipt

---

### AutoClean/Ignore

Apply this label to one email from a sender.

The sender is added to the registry as

```
Active = FALSE
```

and AutoClean will never process that sender unless you later enable it.

Examples:

- Family emails
- Friends
- Work
- Banks

---

# Registry Spreadsheet

The first time AutoClean runs it automatically creates

```
AutoClean Registry
```

No manual setup is required.

Columns include:

| Column | Description |
|---------|-------------|
| Sender | Email address |
| Mode | count or days |
| Value | Number of emails or days |
| Active | Whether cleanup is enabled |
| Test | Run in preview mode |
| Last Cleanup | Last execution |
| Last Removed | Emails deleted last run |
| Total Removed | Lifetime total |
| Would Delete | Preview count |
| Protected Kept | Protected by Keep label |
| Test Sheet | Generated review sheet |
| Notes | User notes |
| Added | Date sender added |

---

# Modes

## Count

Keep newest

```
5
```

emails.

Delete everything older.

---

## Days

Keep emails newer than

```
30
```

days.

Delete older emails.

---

# Test Mode

Every newly learned sender begins in

```
Test = TRUE
```

Running AutoClean creates a dedicated review sheet like

```
TEST_Row_4_costco
```

containing

| Action | Description |
|---------|-------------|
| KEEP - RETENTION RULE | Newest emails |
| KEEP - STARRED | Starred email |
| KEEP - AUTOCLEAN KEEP LABEL | Protected email |
| WOULD DELETE | Emails that would be removed |

Every row also includes a direct Gmail link.

Nothing is deleted while Test Mode is enabled.

---

# Going Live

Once you're happy with the preview:

Uncheck

```
Test
```

for that sender.

The next scheduled run will automatically clean that sender.

---

# Global Dry Run

The script also supports

```
GLOBAL_DRY_RUN = true
```

When enabled

- Nothing is deleted
- Every sender behaves like Test Mode
- Great for initial setup

---

# Gmail Labels

The script automatically creates these labels if missing.

```
AutoClean/Learn

AutoClean/Keep

AutoClean/Ignore
```

---

# Automatic Protection

The following emails are **never deleted**:

- ⭐ Starred emails
- Emails with AutoClean/Keep
- Senders marked inactive
- Trash
- Spam

---

# Typical Workflow

1. Receive newsletter

2. Label it

```
AutoClean/Learn
```

3. Run AutoClean

4. Review generated test sheet

5. If something should always stay

```
AutoClean/Keep
```

6. Re-run

7. Uncheck Test

8. Schedule automatic execution

Done.

---

# Scheduling

Create an Apps Script Trigger.

Recommended:

Every day

or

Every 6 hours

---

# Installation

1. Open Google Apps Script

https://script.google.com

2. Create a new project

3. Paste AutoClean.gs

4. Save

5. Run

```
keepLatestOnly()
```

6. Grant Gmail and Sheets permissions

7. Start labeling emails

---

# License

MIT License

---

# Disclaimer

Always begin with Test Mode enabled.

Although AutoClean has safeguards (Keep label, Starred emails, preview sheets), you are responsible for reviewing cleanup rules before enabling automatic deletion.
