/***************
 * Gmail AutoClean — Spreadsheet-Bound Version
 *
 * Version: see SCRIPT_VERSION below
 * Repository: https://github.com/wassupdoc/Gmail-AutoClean
 *
 * Copyright (C) 2026 LiVuP LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 ***************/

const SCRIPT_VERSION = "20260707-5";
const SCRIPT_REPOSITORY_URL = "https://github.com/wassupdoc/Gmail-AutoClean";

const GLOBAL_DRY_RUN = false; // Developer-only safety switch; not shown in the UI (use Menu Dry Run)

const LEARN_LABEL_NAME = "AutoClean/Learn";
const KEEP_LABEL_NAME = "AutoClean/Keep";
const IGNORE_LABEL_NAME = "AutoClean/Ignore";
const IGNORE_PROCESSED_LABEL_NAME = "AutoClean/IgnoredProcessed";
const MANAGED_LABEL_NAME = "AutoClean/Managed";

const REGISTRY_SPREADSHEET_NAME = "AutoClean Registry";
const REGISTRY_SPREADSHEET_ID_KEY = "AUTO_CLEAN_REGISTRY_SPREADSHEET_ID";

const SHEET_NAME = "AutoCleanSenders";
const SETTINGS_SHEET_NAME = "AutoCleanSettings";

const DEFAULT_MODE = "count";
const DEFAULT_VALUE = 1;
const DEFAULT_BATCH_SIZE = 50;

const MAX_THREADS_PER_SENDER = 500;
const MAX_MANAGED_SYNC_THREADS = 500;
const MAX_LOG_ITEMS_PER_RULE = 20;
const MAX_TEST_SHEET_ROWS = 250;
const RUN_TIME_BUDGET_MS = 4 * 60 * 1000 + 30 * 1000; // 4m30s; leave ~90s for wrap-up

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
  KEEP_UNREAD: 6,
  LAST_CHECKED: 7,
  LAST_REMOVED: 8,
  TOTAL_REMOVED: 9,
  WOULD_DELETE: 10,
  PROTECTED_KEPT: 11,
  TEST_SHEET: 12,
  NOTES: 13,
  ADDED: 14,
  ENABLED_SINCE: 15,
  LAST_EMAIL_SEEN: 16,
  LAST_BATCH: 17,
  GMAIL_SEARCH: 18
};

const REGISTRY_COLUMN_COUNT = 18;

/***************
 * Menu
 ***************/

function onOpen(e) {
  buildAutoCleanMenu();
  refreshRegistryDryRunIndicator();
  removeLegacySettingsSheet();
}

function buildAutoCleanMenu() {
  SpreadsheetApp.getUi()
    .createMenu("AutoClean")
    .addItem("Run Cleanup - Next Batch", "keepLatestOnly")
    .addItem("Run Full Cleanup", "keepLatestOnlyFull")
    .addSeparator()
    .addItem(getMenuDryRun() ? "Turn Menu Dry Run OFF" : "Turn Menu Dry Run ON", "toggleMenuDryRun")
    .addSeparator()
    .addItem(getScheduleMenuLabel("hourly", "Every Hour"), "enableHourlyCleanup")
    .addItem(getScheduleMenuLabel("every6", "Every 6 Hours"), "enableSixHourCleanup")
    .addItem(getScheduleMenuLabel("every12", "Every 12 Hours"), "enableTwelveHourCleanup")
    .addItem(getScheduleMenuLabel("daily", "Daily"), "enableDailyCleanup")
    .addItem(getDisableAutoCleanupMenuLabel(), "disableAutomaticCleanup")
    .addSeparator()
    .addItem(getBatchSizeMenuLabel(25), "setBatchSize25")
    .addItem(getBatchSizeMenuLabel(50), "setBatchSize50")
    .addItem(getBatchSizeMenuLabel(100), "setBatchSize100")
    .addItem("Reset Batch Position", "resetBatchPosition")
    .addSeparator()
    .addItem("Create Labels", "createLabelsFromMenu")
    .addItem("Open Gmail Labels", "showGmailLabels")
    .addItem("Purge All Test Sheets", "purgeAllTestSheets")
    .addItem("Show Registry", "showRegistry")
    .addItem("View Settings", "viewSettings")
    .addItem("Verify/Fix Registry", "verifyFixRegistryFromMenu")
    .addSeparator()
    .addItem("Help", "showHelp")
    .addToUi();
}

function refreshAutoCleanMenu() {
  buildAutoCleanMenu();
}

function menuCheckmark(active) {
  return active ? "\u2713 " : "";
}

function getCurrentSchedule() {
  return PropertiesService.getScriptProperties().getProperty(PROP_SCHEDULE) || "";
}

function getScheduleMenuLabel(scheduleKey, displayLabel) {
  return `${menuCheckmark(getCurrentSchedule() === scheduleKey)}Enable Auto Cleanup: ${displayLabel}`;
}

function getDisableAutoCleanupMenuLabel() {
  return `${menuCheckmark(!getCurrentSchedule())}Disable Auto Cleanup`;
}

function getBatchSizeMenuLabel(size) {
  return `${menuCheckmark(getBatchSize() === size)}Set Batch Size: ${size}`;
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

  return isCheckboxTrue(e.range.getValue());
}

function isCheckboxTrue(value) {
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
  } catch (error) {
    const message = String(error.message || error);
    Logger.log(message);

    if (hasUi) {
      SpreadsheetApp.getUi().alert(message);
      return;
    }

    throw error;
  } finally {
    lock.releaseLock();
  }
}

function runAutoCleanBody(runFull) {
  const ss = getRegistrySpreadsheet();
  const sheet = getOrCreateRegistrySheet();
  assertRegistryHeaders(sheet);
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
  let messagesSkippedUnread = 0;
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

  const runStartedAt = Date.now();
  let rulesProcessed = 0;
  let stoppedEarly = false;

  for (let i = 0; i < rules.length; i++) {
    if (isRunTimeBudgetExceeded(runStartedAt)) {
      stoppedEarly = true;
      Logger.log(`Time budget reached after ${rulesProcessed} sender(s); stopping early.`);
      break;
    }

    const rule = rules[i];
    const ruleDryRun = globalDryRun || rule.test;
    const query = `from:${rule.sender} -in:trash -in:spam`;
    const threads = searchAllThreads(query, 100, MAX_THREADS_PER_SENDER);

    if (threads.length >= MAX_THREADS_PER_SENDER) {
      Logger.log(
        `Warning: ${rule.sender} hit the ${MAX_THREADS_PER_SENDER}-thread cap; older mail may remain unprocessed this run.`
      );
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

        if (rule.keepUnread && message.isUnread()) {
          item.reason = "KEEP - UNREAD";
          protectedItems.push(item);
          messagesSkippedUnread++;
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
    rulesProcessed++;
    messagesToTrash += oldItems.length;

    Logger.log("--------------------------------------------------");
    Logger.log(`Sender: ${rule.sender}`);
    Logger.log(`Mode: ${rule.mode}`);
    Logger.log(`Value: ${rule.value}`);
    Logger.log(`Row test mode: ${rule.test}`);
    Logger.log(`Keep unread: ${rule.keepUnread}`);
    Logger.log(`Effective mode: ${ruleDryRun ? "DRY RUN" : "LIVE"}`);
    Logger.log(`Search used: ${query}`);
    Logger.log(`Total found: ${candidates.length + protectedItems.length}`);
    Logger.log(`Protected kept: ${protectedItems.length}`);
    Logger.log(`Retention kept: ${retentionKeptItems.length}`);
    Logger.log(`${ruleDryRun ? "Would trash" : "Trashed"}: ${oldItems.length}`);
    Logger.log(`Last email seen: ${lastEmailSeen ? formatDate(lastEmailSeen) : "none"}`);

    // Per-message logs are redundant in test/dry-run mode; test sheets already list them.
    if (!ruleDryRun) {
      logRuleItems(oldItems);
    }

    oldItems.forEach(item => {
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
  }

  if (stoppedEarly && rules.length > rulesProcessed) {
    const remaining = rules.slice(rulesProcessed).map(rule => rule.sender);
    Logger.log(`Senders not processed this run: ${remaining.join(", ")}`);
  }

  completeBatch(batchInfo, rulesProcessed, stoppedEarly);

  PropertiesService.getScriptProperties().setProperty(PROP_LAST_RUN, new Date().toISOString());
  PropertiesService.getScriptProperties().setProperty(PROP_LAST_BATCH, batchLabel);

  if (!stoppedEarly) {
    cleanupObsoleteTestSheets(sheet);
  } else {
    Logger.log("Skipped test-sheet cleanup this run to preserve time budget.");
  }

  updateSettingsSheet();

  Logger.log("==================================================");
  Logger.log("AutoClean Summary");
  Logger.log(`Run type: ${runFull ? "FULL" : "BATCH"}`);
  Logger.log(`Batch: ${batchLabel}`);
  Logger.log(`Stopped early: ${stoppedEarly}`);
  Logger.log(`Effective global dry run: ${globalDryRun}`);
  Logger.log(`Active rules total: ${allRules.length}`);
  Logger.log(`Rules processed: ${rulesProcessed} of ${rules.length}`);
  Logger.log(`Senders processed: ${sendersProcessed}`);
  Logger.log(`Messages found: ${messagesFound}`);
  Logger.log(`Starred kept: ${messagesSkippedStarred}`);
  Logger.log(`AutoClean/Keep protected: ${messagesProtectedByKeepLabel}`);
  Logger.log(`Unread kept: ${messagesSkippedUnread}`);
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
    advanceIndex: false,
    startIndex: 0
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
      nextIndex: 0,
      startIndex: 0
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
    nextIndex,
    startIndex: start
  };
}

function completeBatch(batchInfo, processedCount, stoppedEarly) {
  if (!batchInfo || !batchInfo.advanceIndex) return;

  if (stoppedEarly && processedCount < batchInfo.rules.length) {
    setNextBatchIndex(batchInfo.startIndex + processedCount);
    Logger.log(`Batch paused at sender ${processedCount + 1} of ${batchInfo.rules.length}; will resume on next run.`);
    return;
  }

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
  refreshAutoCleanMenu();
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

  const ignoredProcessedLabel = getOrCreateLabel(IGNORE_PROCESSED_LABEL_NAME);
  const threads = getAllLabelThreads(ignoreLabel);
  const existing = getExistingSenders(sheet);

  let added = 0;
  let alreadyExisting = 0;
  let labelsProcessed = 0;

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

    markIgnoreThreadProcessed(thread, ignoreLabel, ignoredProcessedLabel);
    labelsProcessed++;
  });

  Logger.log(`Ignore added: ${added}`);
  Logger.log(`Ignore already existing skipped: ${alreadyExisting}`);
  Logger.log(`Ignore labels processed: ${labelsProcessed}`);
}

function markIgnoreThreadProcessed(thread, ignoreLabel, ignoredProcessedLabel) {
  thread.removeLabel(ignoreLabel);

  if (!threadHasLabel(thread, IGNORE_PROCESSED_LABEL_NAME)) {
    thread.addLabel(ignoredProcessedLabel);
  }
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
    true,
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
    "",
    ""
  ]]);

  applyRegistryRowFormatting(sheet, row);
  setRegistryGmailSearchFormula(sheet, row);
  sheet.autoResizeColumns(1, REGISTRY_COLUMN_COUNT);
}

/***************
 * Registry Sheet
 ***************/

function getOrCreateRegistrySheet() {
  return getRegistrySheetLight();
}

function getRegistrySheetLight() {
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

function ensureRegistryLayoutMaintenance(sheet) {
  ensureRegistryColumnFormatting(sheet);
  ensureRegistryDataValidations(sheet);
  ensureRegistryGmailSearchLinks(sheet);
  updateRegistryDryRunIndicator(sheet);
  return trimRegistryTrailingRows(sheet);
}

function getRegistryHeaders() {
  return [
    "Sender",
    "Mode",
    "Value",
    "Active",
    "Test",
    "Keep Unread",
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
    "Last Batch",
    "Gmail Search"
  ];
}

function migrateRemoveLastCleanupColumn(sheet) {
  if (sheet.getLastColumn() < 6) return;

  const header = String(sheet.getRange(1, 6).getValue() || "").trim();
  if (header === "Last Cleanup") {
    sheet.deleteColumn(6);
  }
}

function migrateAddKeepUnreadColumn(sheet) {
  if (sheet.getLastColumn() < 6) return;

  const testHeader = String(sheet.getRange(1, COL.TEST).getValue() || "").trim();
  const nextHeader = String(sheet.getRange(1, COL.TEST + 1).getValue() || "").trim();

  if (testHeader !== "Test") return;
  if (nextHeader === "Keep Unread") return;
  if (nextHeader !== "Last Checked") return;

  sheet.insertColumnAfter(COL.TEST);
  sheet.getRange(1, COL.KEEP_UNREAD).setValue("Keep Unread");

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const range = getRegistryColumnRange(sheet, COL.KEEP_UNREAD, lastRow);
    range.insertCheckboxes();
    range.setValue(true);
  }
}

function getRegistryColumnRange(sheet, column, lastRow) {
  const endRow = lastRow || sheet.getLastRow();
  const numRows = endRow - 1;
  return sheet.getRange(2, column, numRows, 1);
}

function columnHasCheckboxValidation(sheet, row, column) {
  const validation = sheet.getRange(row, column).getDataValidation();
  if (!validation) return false;
  return validation.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
}

function repairCorruptedStatColumns(sheet) {
  if (!columnHasCheckboxValidation(sheet, 2, COL.LAST_CHECKED)) return 0;

  const lastDataRow = Math.max(getRegistryLastDataRow(sheet), 2);
  const statColumns = [
    COL.LAST_CHECKED,
    COL.LAST_REMOVED,
    COL.TOTAL_REMOVED,
    COL.WOULD_DELETE,
    COL.PROTECTED_KEPT
  ];

  statColumns.forEach(column => {
    const range = getRegistryColumnRange(sheet, column, lastDataRow);
    const values = range.getValues();

    const repairedValues = values.map(row => {
      const value = row[0];

      if (value === true || value === false) {
        if (column === COL.LAST_CHECKED) return [""];
        return [0];
      }

      return row;
    });

    range.clearDataValidations();
    range.setValues(repairedValues);
  });

  ensureRegistryColumnFormatting(sheet);
  Logger.log("Repaired stat columns corrupted by checkbox migration.");
  return statColumns.length;
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
  migrateAddKeepUnreadColumn(sheet);
  repairCorruptedStatColumns(sheet);

  if (registryHeadersValid(sheet)) return;

  const headers = getRegistryHeaders();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, REGISTRY_COLUMN_COUNT).setFontWeight("bold");
}

function assertRegistryHeaders(sheet) {
  const mismatches = getRegistryHeaderMismatches(sheet);

  if (!mismatches.length) return;

  const details = mismatches
    .map(m => `Column ${m.letter} (${m.column}): "${m.actual}" (expected "${m.expected}")`)
    .join("\n");

  throw new Error(
    "Registry headers do not match the expected layout.\n\n" +
    details +
    "\n\nFix row 1 on AutoCleanSenders before running cleanup."
  );
}

function getRegistryHeaderMismatches(sheet) {
  const expected = getRegistryHeaders();
  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  const mismatches = [];

  for (let i = 0; i < expected.length; i++) {
    const actualHeader = String(actual[i] || "").trim();

    if (actualHeader !== expected[i]) {
      mismatches.push({
        column: i + 1,
        letter: columnNumberToLetter(i + 1),
        actual: actualHeader || "(blank)",
        expected: expected[i]
      });
    }
  }

  return mismatches;
}

function verifyFixRegistryFromMenu() {
  const sheet = getRegistrySheetLight();
  ensureRegistryHeaders(sheet);

  const expected = getRegistryHeaders();
  const actual = sheet.getRange(1, 1, 1, REGISTRY_COLUMN_COUNT).getValues()[0];
  const headerMismatches = getRegistryHeaderMismatches(sheet);
  const formatMismatches = getRegistryFormatMismatches(sheet);
  const lines = [];

  for (let i = 0; i < expected.length; i++) {
    const col = i + 1;
    const letter = columnNumberToLetter(col);
    const actualHeader = String(actual[i] || "").trim();
    const status = actualHeader === expected[i] ? "OK" : "MISMATCH";

    lines.push(`${letter} (${col}) ${expected[i]}: ${status}`);

    if (status !== "OK") {
      lines.push(`  found: "${actualHeader || "(blank)"}"`);
    }
  }

  if (formatMismatches.length) {
    lines.push("");
    lines.push("Column formats to fix:");
    formatMismatches.forEach(m => {
      lines.push(`${m.letter} (${m.column}) ${m.label}: ${m.actual}`);
    });
  } else {
    lines.push("");
    lines.push("Column formats: OK");
  }

  const trimmedRows = ensureRegistryLayoutMaintenance(sheet);

  if (trimmedRows > 0) {
    lines.push("");
    lines.push(`Removed ${trimmedRows} blank row(s) below your sender list.`);
  }

  if (sheet.getLastColumn() > REGISTRY_COLUMN_COUNT) {
    lines.push("");
    lines.push(
      `Warning: ${sheet.getLastColumn() - REGISTRY_COLUMN_COUNT} extra column(s) after column ${columnNumberToLetter(REGISTRY_COLUMN_COUNT)}.`
    );
  }

  const headerSummary = headerMismatches.length
    ? `${headerMismatches.length} of ${REGISTRY_COLUMN_COUNT} headers do not match.`
    : `All ${REGISTRY_COLUMN_COUNT} headers match.`;

  const formatSummary = formatMismatches.length
    ? `${formatMismatches.length} column format(s) were corrected.`
    : "Column formats are correct.";

  const output = `Script version: ${SCRIPT_VERSION}\n${headerSummary}\n${formatSummary}\n\n${lines.join("\n")}`;
  Logger.log(output);

  if (SpreadsheetApp.getActiveSpreadsheet()) {
    SpreadsheetApp.getUi().alert("Verify/Fix Registry", output, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function debugRegistryColumns() {
  verifyFixRegistryFromMenu();
}

function columnNumberToLetter(column) {
  let letter = "";

  while (column > 0) {
    const mod = (column - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    column = Math.floor((column - 1) / 26);
  }

  return letter;
}

function getRegistryFormattedColumns() {
  return [
    { col: COL.LAST_CHECKED, label: "Last Checked", type: "datetime" },
    { col: COL.LAST_REMOVED, label: "Last Removed", type: "number" },
    { col: COL.TOTAL_REMOVED, label: "Total Removed", type: "number" },
    { col: COL.WOULD_DELETE, label: "Would Delete", type: "number" },
    { col: COL.PROTECTED_KEPT, label: "Protected Kept", type: "number" },
    { col: COL.TEST_SHEET, label: "Test Sheet", type: "text" },
    { col: COL.NOTES, label: "Notes", type: "text" },
    { col: COL.ADDED, label: "Added", type: "date" },
    { col: COL.ENABLED_SINCE, label: "Enabled Since", type: "date" },
    { col: COL.LAST_EMAIL_SEEN, label: "Last Email Seen", type: "date" },
    { col: COL.LAST_BATCH, label: "Last Batch", type: "text" },
    { col: COL.GMAIL_SEARCH, label: "Gmail Search", type: "text" }
  ];
}

function registryFormatPattern(type) {
  if (type === "datetime") return "m/d/yyyy h:mm:ss";
  if (type === "date") return "m/d/yyyy";
  if (type === "number") return "0";
  return "@";
}

function registryFormatMatches(type, format) {
  const actual = String(format || "").trim().toLowerCase();

  if (type === "text") {
    return actual.startsWith("@");
  }

  if (type === "number") {
    return actual === "0" || actual === "#,##0" || actual === "0.##########";
  }

  if (type === "date" || type === "datetime") {
    return actual.includes("y") || actual.includes("d");
  }

  return false;
}

function getRegistryFormatMismatches(sheet) {
  const sampleRow = 2;
  const mismatches = [];

  getRegistryFormattedColumns().forEach(column => {
    const format = sheet.getRange(sampleRow, column.col).getNumberFormat();

    if (!registryFormatMatches(column.type, format)) {
      mismatches.push({
        column: column.col,
        letter: columnNumberToLetter(column.col),
        label: column.label,
        actual: format || "(default)"
      });
    }
  });

  return mismatches;
}

function getRegistryLastDataRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;

  const values = sheet.getRange(2, COL.SENDER, lastRow - 1, 1).getValues();
  let lastDataRow = 1;

  for (let i = 0; i < values.length; i++) {
    const sender = String(values[i][0] || "").trim();
    if (sender) lastDataRow = i + 2;
  }

  return lastDataRow;
}

function ensureRegistryColumnFormatting(sheet) {
  getRegistryFormattedColumns().forEach(column => {
    const letter = columnNumberToLetter(column.col);
    sheet.getRange(`${letter}2:${letter}`)
      .setNumberFormat(registryFormatPattern(column.type));
  });
}

function ensureRegistryDataValidations(sheet) {
  const lastDataRow = getRegistryLastDataRow(sheet);
  if (lastDataRow < 2) return;

  for (let row = 2; row <= lastDataRow; row++) {
    applyRegistryRowFormatting(sheet, row);
  }
}

function trimRegistryTrailingRows(sheet) {
  const lastDataRow = getRegistryLastDataRow(sheet);
  const keepThrough = Math.max(lastDataRow, 2);
  const currentLast = sheet.getLastRow();

  if (currentLast <= keepThrough) return 0;

  const deleteCount = currentLast - keepThrough;
  sheet.deleteRows(keepThrough + 1, deleteCount);
  return deleteCount;
}

function makeGmailSenderSearchQuery(sender) {
  return `from:${sender} -in:trash -in:spam`;
}

function makeGmailSenderSearchUrl(sender) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(makeGmailSenderSearchQuery(sender))}`;
}

function setRegistryGmailSearchFormula(sheet, row) {
  const senderCell = `A${row}`;
  const formula =
    `=IF(${senderCell}="","",HYPERLINK("https://mail.google.com/mail/u/0/#search/" & ENCODEURL("from:" & ${senderCell} & " -in:trash -in:spam"), "Search"))`;

  sheet.getRange(row, COL.GMAIL_SEARCH).setFormula(formula);
}

function ensureRegistryGmailSearchLinks(sheet) {
  const lastDataRow = getRegistryLastDataRow(sheet);
  if (lastDataRow < 2) return;

  for (let row = 2; row <= lastDataRow; row++) {
    setRegistryGmailSearchFormula(sheet, row);
  }
}

function applyRegistryRowFormatting(sheet, row) {
  const modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["count", "days"], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(row, COL.MODE).setDataValidation(modeRule);
  sheet.getRange(row, COL.ACTIVE).insertCheckboxes();
  sheet.getRange(row, COL.TEST).insertCheckboxes();
  sheet.getRange(row, COL.KEEP_UNREAD).insertCheckboxes();

  const valueRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(row, COL.VALUE).setDataValidation(valueRule);
}

function initializeRegistrySheet(sheet) {
  ensureRegistryColumnFormatting(sheet);
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
    const keepUnread = values[i][COL.KEEP_UNREAD - 1];

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
      test: isCheckboxTrue(test),
      keepUnread: isCheckboxTrue(keepUnread)
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
  const allItems = [
    ...keptItems.map(item => ({ item, action: item.reason })),
    ...oldItems.map(item => ({ item, action: "WOULD DELETE" }))
  ];
  const totalItems = allItems.length;
  const visibleItems = allItems.slice(0, MAX_TEST_SHEET_ROWS);
  const hiddenCount = totalItems - visibleItems.length;

  const rows = visibleItems.map(entry => testSheetRow(now, rule, entry.item, entry.action));

  if (hiddenCount > 0) {
    rows.push([
      now,
      rule.sender,
      rule.mode,
      rule.value,
      "NOTE",
      "",
      "",
      "",
      `${hiddenCount} more message(s) not shown; use Gmail Search for the full list.`
    ]);
  }

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

function getSettingsSnapshot() {
  const ss = getRegistrySpreadsheet();
  const registry = ss.getSheetByName(SHEET_NAME);
  const lastRun = getPropertyOrBlank(PROP_LAST_RUN);

  return {
    scriptVersion: SCRIPT_VERSION,
    menuDryRun: getMenuDryRun(),
    schedule: getScheduleLabel(),
    batchSize: getBatchSize(),
    nextBatchIndex: getNextBatchIndex(),
    activeRules: registry ? countActiveRules(registry) : 0,
    lastRun: lastRun ? formatSettingsTimestamp(lastRun) : "—",
    lastBatch: getPropertyOrBlank(PROP_LAST_BATCH) || "—",
    refreshedAt: formatDate(new Date())
  };
}

function formatSettingsTimestamp(value) {
  const date = new Date(value);

  if (isNaN(date.getTime())) return String(value);

  return formatDate(date);
}

function formatSettingsBoolean(value) {
  return value ? "ON" : "OFF";
}

function removeLegacySettingsSheet() {
  const ss = getRegistrySpreadsheet();
  const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);

  if (sheet) {
    ss.deleteSheet(sheet);
  }
}

function viewSettings() {
  removeLegacySettingsSheet();
  showSettingsDialog();
}

function showSettingsDialog() {
  const settings = getSettingsSnapshot();
  const dryRunClass = settings.menuDryRun ? "warn" : "ok";

  const html = HtmlService.createHtmlOutput(`
    <style>
      body {
        font-family: Roboto, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        color: #202124;
        margin: 0;
        padding: 0 2px 8px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #dadce0;
      }
      .title {
        font-size: 18px;
        font-weight: 500;
        margin: 0;
        color: #274e13;
      }
      .version {
        font-size: 11px;
        color: #5f6368;
        background: #f1f3f4;
        border-radius: 12px;
        padding: 4px 10px;
        white-space: nowrap;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 8px 10px;
        border-bottom: 1px solid #e8eaed;
        vertical-align: top;
      }
      th {
        width: 42%;
        color: #5f6368;
        font-weight: 500;
      }
      td {
        color: #202124;
      }
      tr:last-child th,
      tr:last-child td {
        border-bottom: none;
      }
      .ok {
        color: #274e13;
        font-weight: 500;
      }
      .warn {
        color: #7f4f00;
        font-weight: 500;
      }
      .footer {
        margin-top: 12px;
        font-size: 11px;
        color: #5f6368;
      }
    </style>
    <div class="header">
      <h1 class="title">AutoClean Settings</h1>
      <span class="version">${settings.scriptVersion}</span>
    </div>
    <table>
      <tr><th>Menu dry run</th><td class="${dryRunClass}">${formatSettingsBoolean(settings.menuDryRun)}</td></tr>
      <tr><th>Automatic cleanup</th><td>${settings.schedule}</td></tr>
      <tr><th>Batch size</th><td>${settings.batchSize}</td></tr>
      <tr><th>Next batch index</th><td>${settings.nextBatchIndex}</td></tr>
      <tr><th>Active rules</th><td>${settings.activeRules}</td></tr>
      <tr><th>Last run</th><td>${settings.lastRun}</td></tr>
      <tr><th>Last batch</th><td>${settings.lastBatch}</td></tr>
    </table>
    <p class="footer">As of ${settings.refreshedAt}</p>
  `).setWidth(480).setHeight(420);

  SpreadsheetApp.getUi().showModalDialog(html, "AutoClean Settings");
}

function updateSettingsSheet() {
  const registry = getRegistrySpreadsheet().getSheetByName(SHEET_NAME);

  if (registry) {
    updateRegistryDryRunIndicator(registry);
  }
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
  refreshAutoCleanMenu();

  SpreadsheetApp.getUi().alert(`Automatic cleanup enabled: ${getScheduleLabel()}`);
}

function disableAutomaticCleanup() {
  deleteCleanupTriggers();

  PropertiesService.getScriptProperties().deleteProperty(PROP_SCHEDULE);
  updateSettingsSheet();
  refreshAutoCleanMenu();

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
  refreshAutoCleanMenu();

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
  getOrCreateLabel(IGNORE_PROCESSED_LABEL_NAME);
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
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FIgnoredProcessed" target="_blank">Open AutoClean/IgnoredProcessed</a></p>
    <p><a href="https://mail.google.com/mail/u/0/#label/AutoClean%2FManaged" target="_blank">Open AutoClean/Managed</a></p>
  `).setWidth(350).setHeight(260);

  SpreadsheetApp.getUi().showModalDialog(html, "AutoClean Gmail Labels");
}

function showHelp() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body {
        font-family: Roboto, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        color: #202124;
        margin: 0;
        padding: 0 2px 8px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #dadce0;
      }
      .title {
        font-size: 18px;
        font-weight: 500;
        margin: 0;
        color: #274e13;
      }
      .version {
        font-size: 11px;
        color: #5f6368;
        background: #f1f3f4;
        border-radius: 12px;
        padding: 4px 10px;
        white-space: nowrap;
      }
      .repo-link {
        display: inline-block;
        margin-bottom: 16px;
        color: #1a73e8;
        text-decoration: none;
        font-weight: 500;
      }
      .repo-link:hover {
        text-decoration: underline;
      }
      h2 {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #5f6368;
        margin: 16px 0 8px;
      }
      h2:first-of-type {
        margin-top: 0;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        margin: 0 0 8px;
        padding-left: 0;
      }
      .label {
        display: inline-block;
        font-family: "Roboto Mono", monospace;
        font-size: 12px;
        color: #274e13;
        background: #e8f5e9;
        border-radius: 4px;
        padding: 1px 6px;
        margin-right: 4px;
      }
      p {
        margin: 0 0 8px;
      }
      .note {
        margin-top: 14px;
        padding: 10px 12px;
        background: #f8f9fa;
        border-left: 3px solid #34a853;
        border-radius: 0 4px 4px 0;
        color: #3c4043;
      }
    </style>
    <div class="header">
      <h1 class="title">Gmail AutoClean</h1>
      <span class="version">${SCRIPT_VERSION}</span>
    </div>
    <a class="repo-link" href="${SCRIPT_REPOSITORY_URL}" target="_blank">GitHub repository</a>
    <h2>Gmail labels</h2>
    <ul>
      <li><span class="label">AutoClean/Learn</span> Add sender to registry</li>
      <li><span class="label">AutoClean/Keep</span> Protect this email or thread</li>
      <li><span class="label">AutoClean/Ignore</span> Add sender as inactive</li>
      <li><span class="label">AutoClean/IgnoredProcessed</span> Ignored senders already processed</li>
      <li><span class="label">AutoClean/Managed</span> Mail from senders AutoClean manages</li>
    </ul>
    <h2>Retention rules</h2>
    <p><strong>count</strong> keeps the newest N emails.<br>
    <strong>days</strong> keeps emails from the last N days.</p>
    <h2>Safety and preview</h2>
    <ul>
      <li><strong>Test</strong> creates preview sheets and deletes nothing</li>
      <li><strong>Keep Unread</strong> skips unread mail for that sender</li>
      <li><strong>Menu Dry Run</strong> prevents all deletion when ON</li>
      <li><strong>Gmail Search</strong> opens Gmail filtered to that sender</li>
    </ul>
    <h2>Runs and batching</h2>
    <p>Scheduled cleanup processes the next batch of senders each run.</p>
    <p class="note">Use <strong>Run Full Cleanup</strong> to process all active senders at once.</p>
    <h2>Spreadsheet</h2>
    <ul>
      <li><strong>View Settings</strong> opens the settings dashboard</li>
      <li><strong>Verify/Fix Registry</strong> repairs headers, formats, validations, and links</li>
    </ul>
  `).setWidth(520).setHeight(540);

  SpreadsheetApp.getUi().showModalDialog(html, "Gmail AutoClean Help");
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
  const threads = searchAllThreads(query, 100, MAX_MANAGED_SYNC_THREADS);

  if (threads.length >= MAX_MANAGED_SYNC_THREADS) {
    Logger.log(`Warning: Managed label sync hit the ${MAX_MANAGED_SYNC_THREADS}-thread cap.`);
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

function searchAllThreads(query, pageSize = 100, maxResults = 0) {
  const all = [];
  let start = 0;

  while (true) {
    const remaining = maxResults > 0 ? maxResults - all.length : pageSize;
    const requestSize = maxResults > 0 ? Math.min(pageSize, remaining) : pageSize;

    if (maxResults > 0 && requestSize <= 0) break;

    const batch = GmailApp.search(query, start, requestSize || pageSize);
    if (!batch.length) break;

    all.push(...batch);

    if (batch.length < requestSize) break;
    if (maxResults > 0 && all.length >= maxResults) break;

    start += batch.length;
  }

  return all;
}

function isRunTimeBudgetExceeded(runStartedAt) {
  return Date.now() - runStartedAt >= RUN_TIME_BUDGET_MS;
}

function logRuleItems(items) {
  const limit = MAX_LOG_ITEMS_PER_RULE;

  items.slice(0, limit).forEach(item => {
    Logger.log(`[${item.reason}] ${formatDate(item.date)} | ${item.subject}`);
  });

  if (items.length > limit) {
    Logger.log(`... and ${items.length - limit} more`);
  }
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
