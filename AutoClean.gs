/***************
 * Gmail AutoClean — Spreadsheet-Bound Version
 ***************/

const GLOBAL_DRY_RUN = false; // false = live unless row Test is checked or Menu Dry Run is ON

const LEARN_LABEL_NAME = "AutoClean/Learn";
const KEEP_LABEL_NAME = "AutoClean/Keep";
const IGNORE_LABEL_NAME = "AutoClean/Ignore";
const MANAGED_LABEL_NAME = "AutoClean/Managed";

const REGISTRY_SPREADSHEET_NAME = "AutoClean Registry";
const REGISTRY_SPREADSHEET_ID_KEY = "AUTO_CLEAN_REGISTRY_SPREADSHEET_ID";

const SHEET_NAME = "AutoCleanSenders";
const SETTINGS_SHEET_NAME = "AutoCleanSettings";

const DEFAULT_MODE = "count";
const DEFAULT_VALUE = 1;
const DEFAULT_BATCH_SIZE = 50;

const PROP_DRY_RUN = "AUTO_CLEAN_GLOBAL_DRY_RUN";
const PROP_SCHEDULE = "AUTO_CLEAN_SCHEDULE";
const PROP_BATCH_SIZE = "AUTO_CLEAN_BATCH_SIZE";
const PROP_NEXT_BATCH_INDEX = "AUTO_CLEAN_NEXT_BATCH_INDEX";
const PROP_LAST_RUN = "AUTO_CLEAN_LAST_RUN";
const PROP_LAST_BATCH = "AUTO_CLEAN_LAST_BATCH";

const COL = {
  SENDER: 1,
  MODE: 2,
  VALUE: 3,
  ACTIVE: 4,
  TEST: 5,
  LAST_CHECKED: 6,
  LAST_REMOVED: 7,
  TOTAL_REMOVED: 8,
  WOULD_DELETE: 9,
  PROTECTED_KEPT: 10,
  TEST_SHEET: 11,
  NOTES: 12,
  ADDED: 13,
  ENABLED_SINCE: 14,
  LAST_EMAIL_SEEN: 15,
  LAST_BATCH: 16
};

const REGISTRY_COLUMN_COUNT = 16;

/***************
 * Menu
 ***************/

function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu("AutoClean")
    .addItem("Run Cleanup - Next Batch", "keepLatestOnly")
    .addItem("Run Full Cleanup", "keepLatestOnlyFull")
    .addSeparator()
    .addItem("Enable Auto Cleanup: Every Hour", "enableHourlyCleanup")
    .addItem("Enable Auto Cleanup: Every 6 Hours", "enableSixHourCleanup")
    .addItem("Enable Auto Cleanup: Every 12 Hours", "enableTwelveHourCleanup")
    .addItem("Enable Auto Cleanup: Daily", "enableDailyCleanup")
    .addItem("Disable Auto Cleanup", "disableAutomaticCleanup")
    .addSeparator()
    .addItem("Set Batch Size: 25", "setBatchSize25")
    .addItem("Set Batch Size: 50", "setBatchSize50")
    .addItem("Set Batch Size: 100", "setBatchSize100")
    .addItem("Reset Batch Position", "resetBatchPosition")
    .addSeparator()
    .addItem(getMenuDryRun() ? "Turn Menu Dry Run OFF" : "Turn Menu Dry Run ON", "toggleMenuDryRun")
    .addItem("Create Labels", "createLabelsFromMenu")
    .addItem("Open Gmail Labels", "showGmailLabels")
    .addItem("Purge All Test Sheets", "purgeAllTestSheets")
    .addItem("Show Registry", "showRegistry")
    .addItem("Refresh Settings", "updateSettingsSheet")
    .addSeparator()
    .addItem("Help", "showHelp")
    .addToUi();

  refreshRegistryDryRunIndicator();
}

function onInstall(e) {
  onOpen(e);
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  if (row < 2 || col !== COL.ACTIVE) return;

  const activeValue = getCheckboxEditValue(e);
  const testCell = sheet.getRange(row, COL.TEST);
  const enabledSinceCell = sheet.getRange(row, COL.ENABLED_SINCE);

  if (activeValue) {
    setCheckboxValue(testCell, true);
    if (!enabledSinceCell.getValue()) {
      enabledSinceCell.setValue(new Date());
    }
  } else {
    setCheckboxValue(testCell, false);
  }
}

function getCheckboxEditValue(e) {
  if (e.value === "TRUE") return true;
  if (e.value === "FALSE") return false;

  const value = e.range.getValue();
  return value === true || String(value).toLowerCase() === "true";
}

function setCheckboxValue(cell, checked) {
  cell.insertCheckboxes();
  cell.setValue(checked);
}

/***************
 * Public Run Functions
 ***************/

function keepLatestOnly() {
  runAutoClean(false); // next batch only
}

function keepLatestOnlyFull() {
  runAutoClean(true); // all active rules
}

/***************
 * Main
 ***************/

function runAutoClean(runFull) {
  const lock = LockService.getScriptLock();
  const hasUi = !!SpreadsheetApp.getActiveSpreadsheet();

  if (!lock.tryLock(30000)) {
    Logger.log("AutoClean: another run is in progress; skipping.");
    if (hasUi) {
      SpreadsheetApp.getUi().alert("AutoClean is already running. Please wait for it to finish.");
    }
    return;
  }

  try {
    runAutoCleanBody(runFull);
  } finally {
    lock.releaseLock();
  }
}

function runAutoCleanBody(runFull) {
  const ss = getRegistrySpreadsheet();
  const sheet = getOrCreateRegistrySheet();

  ensureRegistryHeaders(sheet);
  ensureLabelsExist();
  const managedLabel = getOrCreateLabel(MANAGED_LABEL_NAME);

  const globalDryRun = GLOBAL_DRY_RUN || getMenuDryRun();
  

  learnIgnoredSendersFromLabel(sheet);
  learnSendersFromLabel(sheet);
  syncManagedLabels(sheet);

  const allRules = getActiveRules(sheet);
  const batchInfo = runFull ? getFullBatch(allRules) : getNextBatch(allRules);
  const rules = batchInfo.rules;
  const batchLabel = batchInfo.label;

  let sendersProcessed = 0;
  let messagesFound = 0;
  let messagesSkippedStarred = 0;
  let messagesProtectedByKeepLabel = 0;
  let messagesToTrash = 0;

  Logger.log("==================================================");
  Logger.log("AutoClean Run Started");
  Logger.log(`Run type: ${runFull ? "FULL" : "BATCH"}`);
  Logger.log(`Batch: ${batchLabel}`);
  Logger.log(`Global constant dry run: ${GLOBAL_DRY_RUN}`);
  Logger.log(`Menu dry run: ${getMenuDryRun()}`);
  Logger.log(`Effective global dry run: ${globalDryRun}`);
  Logger.log(`Active rules total: ${allRules.length}`);
  Logger.log(`Rules in this run: ${rules.length}`);
  Logger.log(`Registry: ${ss.getUrl()}`);
  Logger.log("==================================================");

  rules.forEach(rule => {
    const ruleDryRun = globalDryRun || rule.test;
    const query = `from:${rule.sender} -in:trash -in:spam`;
    const threads = searchAllThreads(query);

    if (threads.length > 500) {
      Logger.log(`Warning: ${rule.sender} returned ${threads.length} threads (pagination required).`);
    }

    const candidates = [];
    const protectedItems = [];
    let lastEmailSeen = null;

    threads.forEach(thread => {

      ensureManagedLabel(thread, managedLabel);

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

    retentionKeptItems.forEach(item => {
      item.reason = "KEEP - RETENTION RULE";
    });

    oldItems.forEach(item => {
      item.reason = ruleDryRun ? "WOULD DELETE" : "TRASHED";
    });

    const allKeptItems = protectedItems.concat(retentionKeptItems);

    sendersProcessed++;
    messagesToTrash += oldItems.length;

    Logger.log("--------------------------------------------------");
    Logger.log(`Sender: ${rule.sender}`);
    Logger.log(`Mode: ${rule.mode}`);
    Logger.log(`Value: ${rule.value}`);
    Logger.log(`Row test mode: ${rule.test}`);
    Logger.log(`Effective mode: ${ruleDryRun ? "DRY RUN" : "LIVE"}`);
    Logger.log(`Search used: ${query}`);
    Logger.log(`Total found: ${candidates.length + protectedItems.length}`);
    Logger.log(`Protected kept: ${protectedItems.length}`);
    Logger.log(`Retention kept: ${retentionKeptItems.length}`);
    Logger.log(`${ruleDryRun ? "Would trash" : "Trashed"}: ${oldItems.length}`);
    Logger.log(`Last email seen: ${lastEmailSeen ? formatDate(lastEmailSeen) : "none"}`);

    allKeptItems.forEach(item => {
      Logger.log(`[${item.reason}] ${formatDate(item.date)} | ${item.subject}`);
    });

    oldItems.forEach(item => {
      Logger.log(`[${item.reason}] ${formatDate(item.date)} | ${item.subject}`);

      if (!ruleDryRun) {
        item.message.moveToTrash();
      }
    });

    if (rule.test || globalDryRun) {
      writeTestSheet(ss, sheet, rule, allKeptItems, oldItems);
    }

    updateRuleStats(
      sheet,
      rule.rowNumber,
      ruleDryRun,
      oldItems.length,
      protectedItems.length,
      lastEmailSeen,
      batchLabel
    );
  });

  completeBatch(batchInfo);

  PropertiesService.getScriptProperties().setProperty(PROP_LAST_RUN, new Date().toISOString());
  PropertiesService.getScriptProperties().setProperty(PROP_LAST_BATCH, batchLabel);

  cleanupObsoleteTestSheets(sheet);
  updateSettingsSheet();

  Logger.log("==================================================");
  Logger.log("AutoClean Summary");
  Logger.log(`Run type: ${runFull ? "FULL" : "BATCH"}`);
  Logger.log(`Batch: ${batchLabel}`);
  Logger.log(`Effective global dry run: ${globalDryRun}`);
  Logger.log(`Active rules total: ${allRules.length}`);
  Logger.log(`Rules processed: ${rules.length}`);
  Logger.log(`Senders processed: ${sendersProcessed}`);
  Logger.log(`Messages found: ${messagesFound}`);
  Logger.log(`Starred kept: ${messagesSkippedStarred}`);
  Logger.log(`AutoClean/Keep protected: ${messagesProtectedByKeepLabel}`);
  Logger.log(`Messages eligible: ${messagesToTrash}`);
  Logger.log("==================================================");
}

/***************
 * Batching
 ***************/

function getFullBatch(allRules) {
  return {
    rules: allRules,
    label: `FULL ${allRules.length} rule(s)`,
    advanceIndex: false
  };
}

function getNextBatch(allRules) {
  const total = allRules.length;
  const batchSize = getBatchSize();

  if (total === 0) {
    return {
      rules: [],
      label: "No active rules",
      advanceIndex: true,
      nextIndex: 0
    };
  }

  let start = getNextBatchIndex();

  if (start < 0 || start >= total) {
    start = 0;
  }

  const end = Math.min(start + batchSize, total);
  const batchRules = allRules.slice(start, end);
  const nextIndex = end >= total ? 0 : end;

  return {
    rules: batchRules,
    label: `Rows ${batchRules.length ? batchRules[0].rowNumber : "-"}-${batchRules.length ? batchRules[batchRules.length - 1].rowNumber : "-"} (${start + 1}-${end} of ${total})`,
    advanceIndex: true,
    nextIndex
  };
}

function completeBatch(batchInfo) {
  if (!batchInfo || !batchInfo.advanceIndex) return;
  setNextBatchIndex(batchInfo.nextIndex !== undefined ? batchInfo.nextIndex : 0);
}

function getBatchSize() {
  const value = Number(PropertiesService.getScriptProperties().getProperty(PROP_BATCH_SIZE));
  return value && value > 0 ? value : DEFAULT_BATCH_SIZE;
}

function setBatchSize(size) {
  PropertiesService.getScriptProperties().setProperty(PROP_BATCH_SIZE, String(size));
  resetBatchPosition();
  updateSettingsSheet();
  SpreadsheetApp.getUi().alert(`Batch size set to ${size}.`);
}

function setBatchSize25() {
  setBatchSize(25);
}

function setBatchSize50() {
  setBatchSize(50);
}

function setBatchSize100() {
  setBatchSize(100);
}

function getNextBatchIndex() {
  const value = Number(PropertiesService.getScriptProperties().getProperty(PROP_NEXT_BATCH_INDEX));
  return value && value >= 0 ? value : 0;
}

function setNextBatchIndex(index) {
  PropertiesService.getScriptProperties().setProperty(PROP_NEXT_BATCH_INDEX, String(index));
}

function resetBatchPosition() {
  setNextBatchIndex(0);
  updateSettingsSheet();
  SpreadsheetApp.getUi().alert("Batch position reset to the beginning.");
}

/***************
 * Learn / Ignore
 ***************/

function learnSendersFromLabel(sheet) {
  const learnLabel = GmailApp.getUserLabelByName(LEARN_LABEL_NAME);
  if (!learnLabel) return;

  const threads = getAllLabelThreads(learnLabel);
  const existing = getExistingSenders(sheet);

  let added = 0;
  let alreadyExisting = 0;
  let labelsRemoved = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const sender = normalizeSender(message.getFrom());

      if (existing.has(sender)) {
        alreadyExisting++;
        return;
      }

      addSenderRow(sheet, sender, true, true, "");
      existing.add(sender);
      added++;
      Logger.log(`Added sender via Learn: ${sender}`);
    });

    thread.removeLabel(learnLabel);
    labelsRemoved++;
  });

  Logger.log(`Learn added: ${added}`);
  Logger.log(`Learn already existing skipped: ${alreadyExisting}`);
  Logger.log(`Learn labels removed: ${labelsRemoved}`);
}

function learnIgnoredSendersFromLabel(sheet) {
  const ignoreLabel = GmailApp.getUserLabelByName(IGNORE_LABEL_NAME);
  if (!ignoreLabel) return;

  const threads = getAllLabelThreads(ignoreLabel);
  const existing = getExistingSenders(sheet);

  let added = 0;
  let alreadyExisting = 0;
  let labelsRemoved = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const sender = normalizeSender(message.getFrom());

      if (existing.has(sender)) {
        alreadyExisting++;
        return;
      }

      addSenderRow(sheet, sender, false, false, "Ignored via AutoClean/Ignore");
      existing.add(sender);
      added++;
      Logger.log(`Added ignored sender: ${sender}`);
    });

    thread.removeLabel(ignoreLabel);
    labelsRemoved++;
  });

  Logger.log(`Ignore added: ${added}`);
  Logger.log(`Ignore already existing skipped: ${alreadyExisting}`);
  Logger.log(`Ignore labels removed: ${labelsRemoved}`);
}

function addSenderRow(sheet, sender, active, test, notes) {
  const now = new Date();
  const row = getFirstEmptySenderRow(sheet);

  sheet.getRange(row, 1, 1, REGISTRY_COLUMN_COUNT).setValues([[
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
    "",
    ""
  ]]);

  applyRegistryRowFormatting(sheet, row);
  sheet.autoResizeColumns(1, REGISTRY_COLUMN_COUNT);
}

/***************
 * Registry Sheet
 ***************/

function getOrCreateRegistrySheet() {
  const ss = getRegistrySpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  const isNew = !sheet;

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  ensureRegistryHeaders(sheet);

  if (isNew) {
    initializeRegistrySheet(sheet);
  }

  updateRegistryDryRunIndicator(sheet);
  return sheet;
}

function getRegistryHeaders() {
  return [
    "Sender",
    "Mode",
    "Value",
    "Active",
    "Test",
    "Last Checked",
    "Last Removed",
    "Total Removed",
    "Would Delete",
    "Protected Kept",
    "Test Sheet",
    "Notes",
    "Added",
    "Enabled Since",
    "Last Email Seen",
    "Last Batch"
  ];
}

function migrateRemoveLastCleanupColumn(sheet) {
  if (sheet.getLastColumn() < 6) return;

  const header = String(sheet.getRange(1, 6).getValue() || "").trim();
  if (header === "Last Cleanup") {
    sheet.deleteColumn(6);
  }
}

function registryHeadersValid(sheet) {
  const expected = getRegistryHeaders();
  const lastCol = sheet.getLastColumn();

  if (lastCol < expected.length) return false;

  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  return expected.every((header, i) => String(actual[i] || "") === header);
}

function ensureRegistryHeaders(sheet) {
  migrateRemoveLastCleanupColumn(sheet);

  if (registryHeadersValid(sheet)) return;

  const headers = getRegistryHeaders();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, REGISTRY_COLUMN_COUNT).setFontWeight("bold");
}

function applyRegistryRowFormatting(sheet, row) {
  const modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["count", "days"], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(row, COL.MODE).setDataValidation(modeRule);
  sheet.getRange(row, COL.ACTIVE).insertCheckboxes();
  sheet.getRange(row, COL.TEST).insertCheckboxes();

  const valueRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(row, COL.VALUE).setDataValidation(valueRule);
}

function initializeRegistrySheet(sheet) {
  const maxRows = Math.max(sheet.getMaxRows(), 1000);

  for (let row = 2; row <= maxRows - 1; row++) {
    applyRegistryRowFormatting(sheet, row);
  }

  sheet.autoResizeColumns(1, REGISTRY_COLUMN_COUNT);
}

function ensureHeadersAndFormatting(sheet) {
  ensureRegistryHeaders(sheet);
  initializeRegistrySheet(sheet);
}

function getRegistrySpreadsheet() {
  const active = SpreadsheetApp.getActiveSpreadsheet();

  if (active) {
    return active;
  }

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
    const sender = String(values[i][0] || "").trim();
    if (!sender) return i + 2;
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
  const seenSenders = new Map();

  for (let i = 1; i < values.length; i++) {
    const rowNumber = i + 1;

    const sender = String(values[i][COL.SENDER - 1] || "").toLowerCase().trim();
    const mode = String(values[i][COL.MODE - 1] || DEFAULT_MODE).toLowerCase().trim();
    const value = Number(values[i][COL.VALUE - 1] || DEFAULT_VALUE);
    const active = values[i][COL.ACTIVE - 1];
    const test = values[i][COL.TEST - 1];

    if (!sender) continue;
    if (active === false || String(active).toLowerCase() === "false") continue;

    if (seenSenders.has(sender)) {
      appendDuplicateNote(sheet, rowNumber, seenSenders.get(sender));
      Logger.log(`Duplicate sender skipped: ${sender} row ${rowNumber}`);
      continue;
    }

    if (mode !== "count" && mode !== "days") {
      Logger.log(`Skipping row ${rowNumber}: invalid mode "${mode}".`);
      continue;
    }

    if (!value || value < 1) {
      Logger.log(`Skipping row ${rowNumber}: invalid value "${value}".`);
      continue;
    }

    if (!values[i][COL.ENABLED_SINCE - 1]) {
      sheet.getRange(rowNumber, COL.ENABLED_SINCE).setValue(new Date());
    }

    seenSenders.set(sender, rowNumber);

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

function countActiveRules(sheet) {
  const values = sheet.getDataRange().getValues();
  let count = 0;
  const seenSenders = new Set();

  for (let i = 1; i < values.length; i++) {
    const sender = String(values[i][COL.SENDER - 1] || "").toLowerCase().trim();
    const mode = String(values[i][COL.MODE - 1] || DEFAULT_MODE).toLowerCase().trim();
    const value = Number(values[i][COL.VALUE - 1] || DEFAULT_VALUE);
    const active = values[i][COL.ACTIVE - 1];

    if (!sender) continue;
    if (active === false || String(active).toLowerCase() === "false") continue;
    if (seenSenders.has(sender)) continue;
    if (mode !== "count" && mode !== "days") continue;
    if (!value || value < 1) continue;

    seenSenders.add(sender);
    count++;
  }

  return count;
}

function appendDuplicateNote(sheet, rowNumber, firstRowNumber) {
  const noteCell = sheet.getRange(rowNumber, COL.NOTES);
  const current = String(noteCell.getValue() || "").trim();

  if (current.includes("Duplicate sender")) return;

  const note = `Duplicate sender — using row ${firstRowNumber}`;
  noteCell.setValue(current ? `${current} | ${note}` : note);
}

function updateRuleStats(sheet, rowNumber, ruleDryRun, oldItemsCount, protectedKeptCount, lastEmailSeen, batchLabel) {
  const now = new Date();

  const removedCount = ruleDryRun ? 0 : oldItemsCount;
  const wouldDeleteCount = ruleDryRun ? oldItemsCount : 0;

  const totalCell = sheet.getRange(rowNumber, COL.TOTAL_REMOVED);
  const currentTotal = Number(totalCell.getValue() || 0);

  sheet.getRange(rowNumber, COL.LAST_CHECKED).setValue(now);
  sheet.getRange(rowNumber, COL.LAST_REMOVED).setValue(removedCount);
  sheet.getRange(rowNumber, COL.WOULD_DELETE).setValue(wouldDeleteCount);
  sheet.getRange(rowNumber, COL.PROTECTED_KEPT).setValue(protectedKeptCount);
  sheet.getRange(rowNumber, COL.LAST_EMAIL_SEEN).setValue(lastEmailSeen || "");
  sheet.getRange(rowNumber, COL.LAST_BATCH).setValue(batchLabel || "");

  totalCell.setValue(currentTotal + removedCount);
}

/***************
 * Test Sheets
 ***************/

const TEST_SHEET_PREFIX = "TEST_";
const LEGACY_TEST_SHEET_PREFIX = "TEST_Row_";

function writeTestSheet(ss, mainSheet, rule, keptItems, oldItems) {
  const testSheetName = makeTestSheetName(rule);
  let testSheet = ss.getSheetByName(testSheetName);

  if (!testSheet) {
    testSheet = ss.insertSheet(testSheetName);
  } else {
    testSheet.clear();
  }

  testSheet.appendRow([
    "Run Time",
    "Sender",
    "Mode",
    "Value",
    "Action",
    "Email Date",
    "From",
    "Open in Gmail",
    "Subject"
  ]);

  const now = new Date();

  const rows = [
    ...keptItems.map(item => testSheetRow(now, rule, item, item.reason)),
    ...oldItems.map(item => testSheetRow(now, rule, item, "WOULD DELETE"))
  ];

  if (rows.length > 0) {
    testSheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  testSheet.setFrozenRows(1);
  testSheet.getRange(1, 1, 1, 9).setFontWeight("bold");
  testSheet.autoResizeColumns(1, 9);
  applyTestSheetConditionalFormatting(testSheet, rows.length);

  setRegistryTestSheetLink(mainSheet, rule.rowNumber, ss, testSheetName);
}

function setRegistryTestSheetLink(mainSheet, rowNumber, ss, testSheetName) {
  const cell = mainSheet.getRange(rowNumber, COL.TEST_SHEET);
  const testSheet = ss.getSheetByName(testSheetName);

  if (!testSheet) {
    cell.setValue(testSheetName);
    return;
  }

  const gid = testSheet.getSheetId();
  const label = escapeFormulaString(testSheetName);
  cell.setFormula(`=HYPERLINK("#gid=${gid}", "${label}")`);
}

function escapeFormulaString(value) {
  return String(value).replace(/"/g, '""');
}

function testSheetRow(now, rule, item, action) {
  return [
    now,
    rule.sender,
    rule.mode,
    rule.value,
    action,
    item.date,
    item.from,
    `=HYPERLINK("${item.gmailUrl}", "Open")`,
    item.subject
  ];
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

// Not in the AutoClean menu (removed); kept for manual/script use — may return to menu later.
function purgeEmptyTestSheets() {
  const ss = getRegistrySpreadsheet();
  let purged = 0;

  ss.getSheets().forEach(sheet => {
    if (!isTestSheetName(sheet.getName())) return;

    if (sheet.getLastRow() <= 1) {
      ss.deleteSheet(sheet);
      purged++;
    }
  });

  SpreadsheetApp.getUi().alert(`Purged ${purged} empty test sheet(s).`);
}

function purgeAllTestSheets() {
  const ss = getRegistrySpreadsheet();
  let purged = 0;

  ss.getSheets().forEach(sheet => {
    if (!isTestSheetName(sheet.getName())) return;

    ss.deleteSheet(sheet);
    purged++;
  });

  const registry = getOrCreateRegistrySheet();
  const lastRow = registry.getLastRow();

  if (lastRow >= 2) {
    registry.getRange(2, COL.TEST_SHEET, lastRow - 1, 1).clearContent();
  }

  SpreadsheetApp.getUi().alert(`Purged ${purged} test sheet(s).`);
}

/***************
 * Settings Sheet
 ***************/

function updateSettingsSheet() {
  const ss = getRegistrySpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
  }

  const registry = getOrCreateRegistrySheet();

  sheet.clear();
  sheet.appendRow(["Setting", "Value"]);
  sheet.appendRow(["Global Constant Dry Run", GLOBAL_DRY_RUN]);
  sheet.appendRow(["Menu Dry Run", getMenuDryRun()]);
  sheet.appendRow(["Effective Dry Run", GLOBAL_DRY_RUN || getMenuDryRun()]);
  sheet.appendRow(["Automatic Cleanup", getScheduleLabel()]);
  sheet.appendRow(["Batch Size", getBatchSize()]);
  sheet.appendRow(["Next Batch Index", getNextBatchIndex()]);
  sheet.appendRow(["Active Rules", countActiveRules(registry)]);
  sheet.appendRow(["Last Run", getPropertyOrBlank(PROP_LAST_RUN)]);
  sheet.appendRow(["Last Batch", getPropertyOrBlank(PROP_LAST_BATCH)]);
  sheet.appendRow(["Last Refreshed", new Date()]);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  sheet.autoResizeColumns(1, 2);

  updateRegistryDryRunIndicator(registry);
}

function showRegistry() {
  const ss = getRegistrySpreadsheet();
  ss.setActiveSheet(getOrCreateRegistrySheet());
}

/***************
 * Triggers
 ***************/

function enableHourlyCleanup() {
  createCleanupTrigger("hourly");
}

function enableSixHourCleanup() {
  createCleanupTrigger("every6");
}

function enableTwelveHourCleanup() {
  createCleanupTrigger("every12");
}

function enableDailyCleanup() {
  createCleanupTrigger("daily");
}

function createCleanupTrigger(schedule) {
  deleteCleanupTriggers();

  let builder = ScriptApp.newTrigger("keepLatestOnly").timeBased();

  if (schedule === "hourly") builder = builder.everyHours(1);
  if (schedule === "every6") builder = builder.everyHours(6);
  if (schedule === "every12") builder = builder.everyHours(12);
  if (schedule === "daily") builder = builder.everyDays(1);

  builder.create();

  PropertiesService.getScriptProperties().setProperty(PROP_SCHEDULE, schedule);
  updateSettingsSheet();

  SpreadsheetApp.getUi().alert(`Automatic cleanup enabled: ${getScheduleLabel()}`);
}

function disableAutomaticCleanup() {
  deleteCleanupTriggers();

  PropertiesService.getScriptProperties().deleteProperty(PROP_SCHEDULE);
  updateSettingsSheet();

  SpreadsheetApp.getUi().alert("Automatic cleanup disabled.");
}

function deleteCleanupTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "keepLatestOnly") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getScheduleLabel() {
  const schedule = PropertiesService.getScriptProperties().getProperty(PROP_SCHEDULE);

  if (schedule === "hourly") return "Every hour";
  if (schedule === "every6") return "Every 6 hours";
  if (schedule === "every12") return "Every 12 hours";
  if (schedule === "daily") return "Daily";

  return "Disabled";
}

/***************
 * Dry Run
 ***************/

function getMenuDryRun() {
  const value = PropertiesService.getScriptProperties().getProperty(PROP_DRY_RUN);

  if (value === null) return false;

  return value === "true";
}

function toggleMenuDryRun() {
  const current = getMenuDryRun();

  PropertiesService.getScriptProperties().setProperty(PROP_DRY_RUN, String(!current));

  updateSettingsSheet();

  SpreadsheetApp.getUi().alert(`Menu Dry Run is now ${!current ? "ON" : "OFF"}.`);
}

function refreshRegistryDryRunIndicator() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  updateRegistryDryRunIndicator(sheet);
}

function updateRegistryDryRunIndicator(sheet) {
  const menuDryRun = getMenuDryRun();
  const effectiveDryRun = GLOBAL_DRY_RUN || menuDryRun;
  const lastCol = sheet.getLastColumn();

  if (lastCol > REGISTRY_COLUMN_COUNT) {
    const extraColCount = lastCol - REGISTRY_COLUMN_COUNT;
    const extraRange = sheet.getRange(1, REGISTRY_COLUMN_COUNT + 1, 1, extraColCount);

    extraRange.breakApart();
    extraRange.clearContent();
    extraRange.setBackground(null);
    extraRange.setFontColor(null);
    extraRange.setFontWeight("normal");
  }

  const headerRange = sheet.getRange(1, 1, 1, REGISTRY_COLUMN_COUNT);

  headerRange.breakApart();

  if (effectiveDryRun) {
    headerRange.setBackground("#fce5cd");
    headerRange.setFontColor("#7f4f00");
  } else {
    headerRange.setBackground("#d9ead3");
    headerRange.setFontColor("#274e13");
  }

  headerRange.setFontWeight("bold");
}

/***************
 * Labels / UI
 ***************/

function ensureLabelsExist() {
  getOrCreateLabel(LEARN_LABEL_NAME);
  getOrCreateLabel(KEEP_LABEL_NAME);
  getOrCreateLabel(IGNORE_LABEL_NAME);
  getOrCreateLabel(MANAGED_LABEL_NAME);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
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
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FManaged" target="_blank">Open AutoClean/Managed</a></p>
  `).setWidth(350).setHeight(220);

  SpreadsheetApp.getUi().showModalDialog(html, "AutoClean Gmail Labels");
}

function showHelp() {
  SpreadsheetApp.getUi().alert(
    "Gmail AutoClean\n\n" +
    "AutoClean/Learn: add sender to registry.\n" +
    "AutoClean/Keep: protect this email/thread.\n" +
    "AutoClean/Ignore: add sender as inactive.\n\n" +
    "AutoClean/Managed: shows messages from senders currently managed by AutoClean.\n\n" +
    "Mode=count keeps newest N emails.\n" +
    "Mode=days keeps emails from last N days.\n\n" +
    "Test mode creates preview sheets and deletes nothing.\n" +
    "Menu Dry Run prevents all deletion when ON.\n" +
    "Batching processes only part of your sender list each scheduled run.\n" +
    "Use Run Full Cleanup if you want to process all active senders at once."
  );
}

/***************
 * Helpers
 ***************/


function cleanupObsoleteTestSheets(sheet) {
  syncInactiveTestCheckboxes(sheet);

  const ss = getRegistrySpreadsheet();
  const lastRow = sheet.getLastRow();
  const slugsInTestMode = getTestModeSenderSlugs(sheet);

  let removed = 0;
  let renamed = 0;
  const sheetsToDelete = [];

  ss.getSheets().forEach(testSheet => {
    const name = testSheet.getName();
    if (!isTestSheetName(name)) return;

    const slug = senderSlugFromTestSheetName(name);
    if (!slug || !slugsInTestMode.has(slug)) {
      sheetsToDelete.push(testSheet);
      return;
    }

    if (name.startsWith(LEGACY_TEST_SHEET_PREFIX)) {
      const newName = makeTestSheetNameFromSlug(slug);
      const existingNew = ss.getSheetByName(newName);

      if (existingNew && existingNew !== testSheet) {
        sheetsToDelete.push(testSheet);
      } else if (!existingNew) {
        testSheet.setName(newName);
        renamed++;
      }
    }
  });

  sheetsToDelete.forEach(testSheet => {
    ss.deleteSheet(testSheet);
    removed++;
  });

  if (lastRow >= 2) {
    for (let row = 2; row <= lastRow; row++) {
      const sender = String(sheet.getRange(row, COL.SENDER).getValue() || "").toLowerCase().trim();

      if (!isActiveRow(sheet, row) || !isTestModeEnabled(sheet, row)) {
        sheet.getRange(row, COL.TEST_SHEET).clearContent();
        continue;
      }

      if (sender) {
        setRegistryTestSheetLink(sheet, row, ss, makeTestSheetNameFromSender(sender));
      }
    }
  }

  Logger.log(`Removed ${removed} obsolete test sheet(s).`);
  if (renamed) Logger.log(`Renamed ${renamed} legacy test sheet(s).`);
}

function getTestModeSenderSlugs(sheet) {
  const slugs = new Set();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return slugs;

  for (let row = 2; row <= lastRow; row++) {
    if (!isActiveRow(sheet, row) || !isTestModeEnabled(sheet, row)) continue;

    const sender = String(sheet.getRange(row, COL.SENDER).getValue() || "").toLowerCase().trim();
    if (sender) slugs.add(makeSenderSlug(sender));
  }

  return slugs;
}

function syncInactiveTestCheckboxes(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row++) {
    if (!isActiveRow(sheet, row) && isTestModeEnabled(sheet, row)) {
      sheet.getRange(row, COL.TEST).setValue(false);
    }
  }
}

function isActiveRow(sheet, row) {
  const value = sheet.getRange(row, COL.ACTIVE).getValue();
  return value === true || String(value).toLowerCase() === "true";
}

function isTestModeEnabled(sheet, row) {
  const value = sheet.getRange(row, COL.TEST).getValue();
  return value === true || String(value).toLowerCase() === "true";
}

function isTestSheetName(name) {
  return String(name).startsWith(TEST_SHEET_PREFIX);
}

function senderSlugFromTestSheetName(name) {
  if (name.startsWith(LEGACY_TEST_SHEET_PREFIX)) {
    const match = name.match(/^TEST_Row_\d+_(.+)$/);
    return match ? match[1] : null;
  }

  if (name.startsWith(TEST_SHEET_PREFIX)) {
    return name.substring(TEST_SHEET_PREFIX.length);
  }

  return null;
}

function makeSenderSlug(sender) {
  return String(sender)
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, "_")
    .substring(0, 40);
}

function makeTestSheetNameFromSlug(slug) {
  return `${TEST_SHEET_PREFIX}${slug}`;
}

function makeTestSheetNameFromSender(sender) {
  return makeTestSheetNameFromSlug(makeSenderSlug(sender));
}

function syncManagedLabels(sheet) {
  const managedLabel = getOrCreateLabel(MANAGED_LABEL_NAME);
  const activeSenders = getActiveSenderSet(sheet);

  const query = `label:"${MANAGED_LABEL_NAME}" -in:trash -in:spam`;
  const threads = searchAllThreads(query);

  if (threads.length > 500) {
    Logger.log(`Warning: Managed label sync returned ${threads.length} threads (pagination required).`);
  }

  let removed = 0;
  let kept = 0;

  threads.forEach(thread => {
    let shouldKeepManagedLabel = false;

    thread.getMessages().forEach(message => {
      const sender = normalizeSender(message.getFrom());

      if (activeSenders.has(sender)) {
        shouldKeepManagedLabel = true;
      }
    });

    if (shouldKeepManagedLabel) {
      kept++;
    } else {
      thread.removeLabel(managedLabel);
      removed++;
    }
  });

  Logger.log(`Managed labels kept: ${kept}`);
  Logger.log(`Managed labels removed: ${removed}`);
}

function getActiveSenderSet(sheet) {
  const values = sheet.getDataRange().getValues();
  const activeSenders = new Set();

  for (let i = 1; i < values.length; i++) {
    const sender = String(values[i][COL.SENDER - 1] || "").toLowerCase().trim();
    const active = values[i][COL.ACTIVE - 1];

    if (!sender) continue;
    if (active === false || String(active).toLowerCase() === "false") continue;

    activeSenders.add(sender);
  }

  return activeSenders;
}

function ensureManagedLabel(thread, managedLabel) {
  if (!managedLabel) return;

  if (!threadHasLabel(thread, MANAGED_LABEL_NAME)) {
    thread.addLabel(managedLabel);
  }
}


function threadHasLabel(thread, labelName) {
  return thread.getLabels().some(label => label.getName() === labelName);
}

function makeTestSheetName(rule) {
  return makeTestSheetNameFromSender(rule.sender);
}

function searchAllThreads(query, pageSize = 100) {
  const all = [];
  let start = 0;

  while (true) {
    const batch = GmailApp.search(query, start, pageSize);
    if (!batch.length) break;

    all.push(...batch);

    if (batch.length < pageSize) break;

    start += batch.length;
  }

  return all;
}

function getAllLabelThreads(label, pageSize = 100) {
  const all = [];
  let start = 0;

  while (true) {
    const batch = label.getThreads(start, pageSize);
    if (!batch.length) break;

    all.push(...batch);

    if (batch.length < pageSize) break;

    start += batch.length;
  }

  return all;
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

function getPropertyOrBlank(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}
