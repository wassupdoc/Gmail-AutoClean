const GLOBAL_DRY_RUN = true; // true = no deletion anywhere; false = live except rows with Test checked

const LEARN_LABEL_NAME = "AutoClean/Learn";
const KEEP_LABEL_NAME = "AutoClean/Keep";
const IGNORE_LABEL_NAME = "AutoClean/Ignore";

const REGISTRY_SPREADSHEET_NAME = "AutoClean Registry";
const REGISTRY_SPREADSHEET_ID_KEY = "AUTO_CLEAN_REGISTRY_SPREADSHEET_ID";
const SHEET_NAME = "AutoCleanSenders";

const DEFAULT_MODE = "count";
const DEFAULT_VALUE = 1;

const COL = {
  SENDER: 1,
  MODE: 2,
  VALUE: 3,
  ACTIVE: 4,
  TEST: 5,
  LAST_CLEANUP: 6,
  LAST_REMOVED: 7,
  TOTAL_REMOVED: 8,
  WOULD_DELETE: 9,
  PROTECTED_KEPT: 10,
  TEST_SHEET: 11,
  NOTES: 12,
  ADDED: 13,
  ENABLED_SINCE: 14,
  LAST_EMAIL_SEEN: 15
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("AutoClean")
    .addItem("Run Cleanup", "keepLatestOnly")
    .addItem("Open Gmail Labels", "showGmailLabels")
    .addItem("Create Labels", "createLabelsFromMenu")
    .addItem("Purge Empty Test Sheets", "purgeEmptyTestSheets")
    .addItem("Show Registry", "showRegistry")
    .addSeparator()
    .addItem("Help", "showHelp")
    .addToUi();
}

function keepLatestOnly() {
  const ss = getRegistrySpreadsheet();
  const sheet = getOrCreateRegistrySheet();
  ensureHeadersAndFormatting(sheet);
  ensureLabelsExist();
  logRegistryLink();

  learnIgnoredSendersFromLabel(sheet);
  learnSendersFromLabel(sheet);

  const rules = getActiveRules(sheet);

  let sendersProcessed = 0;
  let messagesFound = 0;
  let messagesSkippedStarred = 0;
  let messagesProtectedByKeepLabel = 0;
  let messagesToTrash = 0;

  rules.forEach(rule => {
    const ruleDryRun = GLOBAL_DRY_RUN || rule.test;
    const query = `from:${rule.sender} -in:trash -in:spam`;
    const threads = GmailApp.search(query);

    const candidates = [];
    const protectedItems = [];
    let lastEmailSeen = null;

    threads.forEach(thread => {
      const threadHasKeepLabel = threadHasLabel(thread, KEEP_LABEL_NAME);
      const threadId = thread.getId();
      const gmailUrl = makeGmailThreadUrl(threadId);

      thread.getMessages().forEach(message => {
        const from = normalizeSender(message.getFrom());
        if (from !== rule.sender) return;
        if (message.isInTrash()) return;

        const date = message.getDate();
        if (!lastEmailSeen || date > lastEmailSeen) lastEmailSeen = date;

        const item = {
          message,
          threadId,
          gmailUrl,
          date,
          from,
          subject: message.getSubject(),
          reason: ""
        };

        messagesFound++;

        if (message.isStarred()) {
          item.reason = "KEEP - STARRED";
          protectedItems.push(item);
          messagesSkippedStarred++;
          return;
        }

        if (threadHasKeepLabel) {
          item.reason = "KEEP - AUTOCLEAN KEEP LABEL";
          protectedItems.push(item);
          messagesProtectedByKeepLabel++;
          return;
        }

        candidates.push(item);
      });
    });

    candidates.sort((a, b) => b.date - a.date);
    protectedItems.sort((a, b) => b.date - a.date);

    let retentionKeptItems = [];
    let oldItems = [];

    if (rule.mode === "count") {
      retentionKeptItems = candidates.slice(0, rule.value);
      oldItems = candidates.slice(rule.value);
    }

    if (rule.mode === "days") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rule.value);
      retentionKeptItems = candidates.filter(item => item.date >= cutoff);
      oldItems = candidates.filter(item => item.date < cutoff);
    }

    retentionKeptItems.forEach(item => item.reason = "KEEP - RETENTION RULE");
    oldItems.forEach(item => item.reason = ruleDryRun ? "WOULD DELETE" : "TRASHED");

    const allKeptItems = protectedItems.concat(retentionKeptItems);

    sendersProcessed++;
    messagesToTrash += oldItems.length;

    oldItems.forEach(item => {
      if (!ruleDryRun) item.message.moveToTrash();
    });

    if (rule.test || GLOBAL_DRY_RUN) {
      writeTestSheet(ss, sheet, rule, allKeptItems, oldItems);
    }

    if (!ruleDryRun) {
      deleteTestSheetIfExists(ss, sheet, rule.rowNumber);
    }

    updateRuleStats(
      sheet,
      rule.rowNumber,
      ruleDryRun ? 0 : oldItems.length,
      oldItems.length,
      protectedItems.length,
      lastEmailSeen
    );
  });

  Logger.log("==================================================");
  Logger.log("AutoClean Summary");
  Logger.log(`Global mode: ${GLOBAL_DRY_RUN ? "DRY RUN" : "LIVE"}`);
  Logger.log(`Registry sheet: ${ss.getUrl()}`);
  Logger.log(`Active rules: ${rules.length}`);
  Logger.log(`Senders processed: ${sendersProcessed}`);
  Logger.log(`Messages found: ${messagesFound}`);
  Logger.log(`Starred kept: ${messagesSkippedStarred}`);
  Logger.log(`AutoClean/Keep protected: ${messagesProtectedByKeepLabel}`);
  Logger.log(`Messages eligible: ${messagesToTrash}`);
  Logger.log("==================================================");
}

function learnSendersFromLabel(sheet) {
  const learnLabel = GmailApp.getUserLabelByName(LEARN_LABEL_NAME);
  const threads = learnLabel.getThreads();
  const existing = getExistingSenders(sheet);

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const sender = normalizeSender(message.getFrom());
      if (existing.has(sender)) return;

      addSenderRow(sheet, sender, true, true, "");
      existing.add(sender);
      Logger.log(`Added sender via Learn: ${sender}`);
    });

    thread.removeLabel(learnLabel);
  });
}

function learnIgnoredSendersFromLabel(sheet) {
  const ignoreLabel = GmailApp.getUserLabelByName(IGNORE_LABEL_NAME);
  const threads = ignoreLabel.getThreads();
  const existing = getExistingSenders(sheet);

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const sender = normalizeSender(message.getFrom());
      if (existing.has(sender)) return;

      addSenderRow(sheet, sender, false, false, "Ignored via AutoClean/Ignore");
      existing.add(sender);
      Logger.log(`Added ignored sender: ${sender}`);
    });

    thread.removeLabel(ignoreLabel);
  });
}

function addSenderRow(sheet, sender, active, test, notes) {
  const now = new Date();
  const row = getFirstEmptySenderRow(sheet);

  sheet.getRange(row, 1, 1, 15).setValues([[
    sender,
    DEFAULT_MODE,
    DEFAULT_VALUE,
    active,
    test,
    "",
    0,
    0,
    0,
    0,
    "",
    notes,
    now,
    active ? now : "",
    ""
  ]]);

  ensureHeadersAndFormatting(sheet);
}

function writeTestSheet(ss, mainSheet, rule, keptItems, oldItems) {
  const testSheetName = makeTestSheetName(rule);
  let testSheet = ss.getSheetByName(testSheetName);

  if (!testSheet) testSheet = ss.insertSheet(testSheetName);
  else testSheet.clear();

  testSheet.appendRow([
    "Run Time",
    "Sender",
    "Mode",
    "Value",
    "Action",
    "Email Date",
    "From",
    "Subject",
    "Open in Gmail"
  ]);

  const now = new Date();
  const rows = [];

  keptItems.forEach(item => {
    rows.push([
      now,
      rule.sender,
      rule.mode,
      rule.value,
      item.reason,
      item.date,
      item.from,
      item.subject,
      `=HYPERLINK("${item.gmailUrl}", "Open")`
    ]);
  });

  oldItems.forEach(item => {
    rows.push([
      now,
      rule.sender,
      rule.mode,
      rule.value,
      "WOULD DELETE",
      item.date,
      item.from,
      item.subject,
      `=HYPERLINK("${item.gmailUrl}", "Open")`
    ]);
  });

  if (rows.length > 0) {
    testSheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  testSheet.setFrozenRows(1);
  testSheet.getRange(1, 1, 1, 9).setFontWeight("bold");
  testSheet.autoResizeColumns(1, 9);
  applyTestSheetConditionalFormatting(testSheet, rows.length);

  mainSheet.getRange(rule.rowNumber, COL.TEST_SHEET).setValue(testSheetName);
}

function applyTestSheetConditionalFormatting(sheet, rowCount) {
  if (rowCount < 1) return;

  const range = sheet.getRange(2, 1, rowCount, 9);

  const keepRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2<>"WOULD DELETE"')
    .setBackground("#d9ead3")
    .setRanges([range])
    .build();

  const deleteRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2="WOULD DELETE"')
    .setBackground("#f4cccc")
    .setRanges([range])
    .build();

  sheet.setConditionalFormatRules([keepRule, deleteRule]);
}

function deleteTestSheetIfExists(ss, mainSheet, rowNumber) {
  const testSheetName = String(mainSheet.getRange(rowNumber, COL.TEST_SHEET).getValue() || "").trim();
  if (!testSheetName) return;

  const testSheet = ss.getSheetByName(testSheetName);
  if (testSheet) ss.deleteSheet(testSheet);

  mainSheet.getRange(rowNumber, COL.TEST_SHEET).setValue("");
}

function purgeEmptyTestSheets() {
  const ss = getRegistrySpreadsheet();
  const sheets = ss.getSheets();
  let purged = 0;

  sheets.forEach(sheet => {
    if (!sheet.getName().startsWith("TEST_Row_")) return;

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      ss.deleteSheet(sheet);
      purged++;
    }
  });

  SpreadsheetApp.getUi().alert(`Purged ${purged} empty test sheet(s).`);
}

function showRegistry() {
  const ss = getRegistrySpreadsheet();
  const sheet = getOrCreateRegistrySheet();
  ss.setActiveSheet(sheet);
}

function createLabelsFromMenu() {
  ensureLabelsExist();
  SpreadsheetApp.getUi().alert("AutoClean labels created or already exist.");
}

function showGmailLabels() {
  const html = HtmlService.createHtmlOutput(`
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FLearn" target="_blank">Open AutoClean/Learn</a></p>
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FKeep" target="_blank">Open AutoClean/Keep</a></p>
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FIgnore" target="_blank">Open AutoClean/Ignore</a></p>
  `).setWidth(350).setHeight(180);

  SpreadsheetApp.getUi().showModalDialog(html, "AutoClean Gmail Labels");
}

function showHelp() {
  SpreadsheetApp.getUi().alert(
    "AutoClean Help\n\n" +
    "AutoClean/Learn: add sender to registry.\n" +
    "AutoClean/Keep: protect that email/thread.\n" +
    "AutoClean/Ignore: add sender as inactive.\n\n" +
    "Mode=count keeps newest N emails.\n" +
    "Mode=days keeps emails from last N days.\n\n" +
    "Test mode creates preview sheets and deletes nothing."
  );
}

function ensureHeadersAndFormatting(sheet) {
  const headers = [
    "Sender",
    "Mode",
    "Value",
    "Active",
    "Test",
    "Last Cleanup",
    "Last Removed",
    "Total Removed",
    "Would Delete",
    "Protected Kept",
    "Test Sheet",
    "Notes",
    "Added",
    "Enabled Since",
    "Last Email Seen"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  applySheetFormatting(sheet);
}

function applySheetFormatting(sheet) {
  const maxRows = Math.max(sheet.getMaxRows(), 1000);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 15).setFontWeight("bold");

  const modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["count", "days"], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, COL.MODE, maxRows - 1, 1).setDataValidation(modeRule);

  sheet.getRange(2, COL.ACTIVE, maxRows - 1, 1).insertCheckboxes();
  sheet.getRange(2, COL.TEST, maxRows - 1, 1).insertCheckboxes();

  const valueRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, COL.VALUE, maxRows - 1, 1).setDataValidation(valueRule);
  sheet.autoResizeColumns(1, 15);
}

function getOrCreateRegistrySheet() {
  const ss = getRegistrySpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  ensureHeadersAndFormatting(sheet);
  return sheet;
}

function getRegistrySpreadsheet() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(REGISTRY_SPREADSHEET_ID_KEY);

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      props.deleteProperty(REGISTRY_SPREADSHEET_ID_KEY);
    }
  }

  const ss = SpreadsheetApp.create(REGISTRY_SPREADSHEET_NAME);
  props.setProperty(REGISTRY_SPREADSHEET_ID_KEY, ss.getId());

  Logger.log("Created new AutoClean registry spreadsheet:");
  Logger.log(ss.getUrl());

  return ss;
}

function getFirstEmptySenderRow(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const values = sheet.getRange(2, COL.SENDER, lastRow - 1, 1).getValues();

  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][0] || "").trim()) return i + 2;
  }

  return lastRow + 1;
}

function getExistingSenders(sheet) {
  const values = sheet.getDataRange().getValues();
  const senders = new Set();

  for (let i = 1; i < values.length; i++) {
    const sender = String(values[i][COL.SENDER - 1] || "").toLowerCase().trim();
    if (sender) senders.add(sender);
  }

  return senders;
}

function getActiveRules(sheet) {
  const values = sheet.getDataRange().getValues();
  const rules = [];

  for (let i = 1; i < values.length; i++) {
    const rowNumber = i + 1;
    const sender = String(values[i][COL.SENDER - 1] || "").toLowerCase().trim();
    const mode = String(values[i][COL.MODE - 1] || DEFAULT_MODE).toLowerCase().trim();
    const value = Number(values[i][COL.VALUE - 1] || DEFAULT_VALUE);
    const active = values[i][COL.ACTIVE - 1];
    const test = values[i][COL.TEST - 1];

    if (!sender) continue;
    if (active === false || String(active).toLowerCase() === "false") continue;
    if (mode !== "count" && mode !== "days") continue;
    if (!value || value < 1) continue;

    if (!values[i][COL.ENABLED_SINCE - 1]) {
      sheet.getRange(rowNumber, COL.ENABLED_SINCE).setValue(new Date());
    }

    rules.push({
      rowNumber,
      sender,
      mode,
      value,
      test: test === true || String(test).toLowerCase() === "true"
    });
  }

  return rules;
}

function updateRuleStats(sheet, rowNumber, removedCount, wouldDeleteCount, protectedKeptCount, lastEmailSeen) {
  const now = new Date();
  const totalCell = sheet.getRange(rowNumber, COL.TOTAL_REMOVED);
  const currentTotal = Number(totalCell.getValue() || 0);

  sheet.getRange(rowNumber, COL.LAST_CLEANUP).setValue(now);
  sheet.getRange(rowNumber, COL.LAST_REMOVED).setValue(removedCount);
  sheet.getRange(rowNumber, COL.WOULD_DELETE).setValue(wouldDeleteCount);
  sheet.getRange(rowNumber, COL.PROTECTED_KEPT).setValue(protectedKeptCount);
  sheet.getRange(rowNumber, COL.LAST_EMAIL_SEEN).setValue(lastEmailSeen || "");
  totalCell.setValue(currentTotal + removedCount);
}

function ensureLabelsExist() {
  getOrCreateLabel(LEARN_LABEL_NAME);
  getOrCreateLabel(KEEP_LABEL_NAME);
  getOrCreateLabel(IGNORE_LABEL_NAME);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function threadHasLabel(thread, labelName) {
  return thread.getLabels().some(label => label.getName() === labelName);
}

function makeTestSheetName(rule) {
  const senderPart = rule.sender.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40);
  return `TEST_Row_${rule.rowNumber}_${senderPart}`;
}

function makeGmailThreadUrl(threadId) {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

function logRegistryLink() {
  const ss = getRegistrySpreadsheet();
  Logger.log("Open AutoClean Registry:");
  Logger.log(ss.getUrl());
}

function openRegistryLink() {
  logRegistryLink();
}

function normalizeSender(from) {
  const match = from.match(/<(.+?)>/);
  return match ? match[1].toLowerCase().trim() : from.toLowerCase().trim();
}

function formatDate(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}
