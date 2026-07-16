/**
 * AutoClean self-tests (menu runnable)
 *
 * Keep this file separate from AutoClean.gs so production logic stays clean.
 * Tests use lightweight fakes and do not touch real Gmail or Sheets data.
 */

function runSelfTests() {
  const tests = [
    test_normalizeStatNumberValue_realDate_returnsZero,
    test_readLifetimeCountFromCell_prefersDisplayInteger,
    test_healDatetimeRegistryValue_clearsBatchText,
    test_healTextRegistryValue_clearsDateText,
    test_getRegistryColumnRange_usesLastDataRowCount,
    test_updateRuleStats_dryRun_doesNotIncrementLifetimeTotal,
    test_updateRuleStats_liveRun_incrementsLifetimeTotal,
    test_syncLifetimeTotalsWithSheet_usesMaxNeverDecreases,
    test_reconcileRegistrySheet_reportsRepairNotesAndFullActions
  ];

  const failures = [];
  const started = new Date();

  tests.forEach(testFn => {
    try {
      testFn();
      Logger.log("PASS: " + testFn.name);
    } catch (err) {
      const message = (err && err.message) ? err.message : String(err);
      failures.push(`${testFn.name}: ${message}`);
      Logger.log("FAIL: " + testFn.name + " -> " + message);
    }
  });

  const elapsedMs = new Date().getTime() - started.getTime();
  const passed = tests.length - failures.length;
  const summary = [
    `Self tests finished in ${elapsedMs} ms`,
    `Passed: ${passed}/${tests.length}`,
    `Failed: ${failures.length}`
  ];

  if (failures.length) {
    summary.push("");
    summary.push("Failures:");
    failures.forEach(f => summary.push("- " + f));
  }

  const output = summary.join("\n");
  Logger.log(output);
  SpreadsheetApp.getUi().alert("AutoClean Self Tests", output, SpreadsheetApp.getUi().ButtonSet.OK);

  return { total: tests.length, passed, failed: failures.length, failures };
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "Expected equality"} (expected=${expected}, actual=${actual})`);
  }
}

function test_normalizeStatNumberValue_realDate_returnsZero() {
  const result = normalizeStatNumberValue(new Date("2026-07-16T00:00:00Z"));
  assertEq(result, 0, "Real calendar date must not be converted to stat serial");
}

function test_readLifetimeCountFromCell_prefersDisplayInteger() {
  const cell = {
    getValue: () => new Date("1900-04-13T00:00:00Z"),
    getDisplayValue: () => "104"
  };
  const result = readLifetimeCountFromCell(cell);
  assertEq(result, 104, "Display integer should be trusted for lifetime total");
}

function test_healDatetimeRegistryValue_clearsBatchText() {
  const batch = healDatetimeRegistryValue("Rows 2-49 (1-47 of 47)");
  assertEq(batch, "", "Batch label text should not remain in date column");

  const realDate = healDatetimeRegistryValue("7/16/2026");
  assertTrue(realDate instanceof Date, "Date text should normalize to Date object");
}

function test_healTextRegistryValue_clearsDateText() {
  const cleaned = healTextRegistryValue("7/13/2026");
  assertEq(cleaned, "", "Date-like text should be cleared from text columns");
}

function test_getRegistryColumnRange_usesLastDataRowCount() {
  let call = null;
  const sheet = {
    getRange: (row, column, numRows, numCols) => {
      call = { row, column, numRows, numCols };
      return {};
    }
  };

  getRegistryColumnRange(sheet, COL.TOTAL_REMOVED, 48);
  assertEq(call.row, 2, "Range should start at row 2");
  assertEq(call.column, COL.TOTAL_REMOVED, "Range column mismatch");
  assertEq(call.numRows, 47, "Range row count should be lastDataRow - 1");
  assertEq(call.numCols, 1, "Range should be one column wide");
}

function test_updateRuleStats_dryRun_doesNotIncrementLifetimeTotal() {
  const fake = makeFakeSheet();
  fake.setValue(2, COL.SENDER, "support@example.com");
  fake.setValue(2, COL.TOTAL_REMOVED, 24);

  const originalReadLifetimeTotal = readLifetimeTotal;
  const originalWriteStoredLifetimeTotal = writeStoredLifetimeTotal;
  let propertyWriteCount = 0;

  readLifetimeTotal = () => 24;
  writeStoredLifetimeTotal = () => { propertyWriteCount++; };

  try {
    updateRuleStats(fake, 2, true, 93, 3, "", "Rows 2-49 (1-47 of 47)");
    assertEq(fake.getValue(2, COL.WOULD_DELETE), 93, "Dry run should set Would Delete");
    assertEq(fake.getValue(2, COL.LAST_REMOVED), 0, "Dry run should keep Last Removed at 0");
    assertEq(fake.getValue(2, COL.TOTAL_REMOVED), 24, "Dry run must not change Total Removed");
    assertEq(propertyWriteCount, 0, "Dry run must not write lifetime property");
  } finally {
    readLifetimeTotal = originalReadLifetimeTotal;
    writeStoredLifetimeTotal = originalWriteStoredLifetimeTotal;
  }
}

function test_updateRuleStats_liveRun_incrementsLifetimeTotal() {
  const fake = makeFakeSheet();
  fake.setValue(2, COL.SENDER, "support@example.com");
  fake.setValue(2, COL.TOTAL_REMOVED, 24);

  const originalReadLifetimeTotal = readLifetimeTotal;
  const originalWriteStoredLifetimeTotal = writeStoredLifetimeTotal;
  let propertyWritten = null;

  readLifetimeTotal = () => 24;
  writeStoredLifetimeTotal = (sender, total) => { propertyWritten = { sender, total }; };

  try {
    updateRuleStats(fake, 2, false, 3, 1, "", "Rows 2-49 (1-47 of 47)");
    assertEq(fake.getValue(2, COL.LAST_REMOVED), 3, "Live run should set Last Removed");
    assertEq(fake.getValue(2, COL.WOULD_DELETE), 0, "Live run should clear Would Delete");
    assertEq(fake.getValue(2, COL.TOTAL_REMOVED), 27, "Live run should increment Total Removed");
    assertTrue(!!propertyWritten, "Live run should write lifetime property");
    assertEq(propertyWritten.sender, "support@example.com", "Property sender mismatch");
    assertEq(propertyWritten.total, 27, "Property total mismatch");
  } finally {
    readLifetimeTotal = originalReadLifetimeTotal;
    writeStoredLifetimeTotal = originalWriteStoredLifetimeTotal;
  }
}

function test_syncLifetimeTotalsWithSheet_usesMaxNeverDecreases() {
  const fake = makeFakeSheet();
  fake.setValue(2, COL.SENDER, "a@example.com");
  fake.setValue(2, COL.TOTAL_REMOVED, 10);
  fake.setValue(3, COL.SENDER, "b@example.com");
  fake.setValue(3, COL.TOTAL_REMOVED, 2);

  const originalGetRegistryLastDataRow = getRegistryLastDataRow;
  const originalReadStoredLifetimeTotal = readStoredLifetimeTotal;
  const originalWriteStoredLifetimeTotal = writeStoredLifetimeTotal;
  const writes = {};

  getRegistryLastDataRow = () => 3;
  readStoredLifetimeTotal = sender => sender === "a@example.com" ? 7 : 9;
  writeStoredLifetimeTotal = (sender, total) => { writes[sender] = total; };

  try {
    const synced = syncLifetimeTotalsWithSheet(fake);
    assertEq(synced, 1, "Only one row should need sheet sync");
    assertEq(fake.getValue(2, COL.TOTAL_REMOVED), 10, "Higher sheet value must be preserved");
    assertEq(fake.getValue(3, COL.TOTAL_REMOVED), 9, "Lower sheet value must be raised to property max");
    assertEq(writes["a@example.com"], 10, "Property should be raised to preserved max");
    assertEq(writes["b@example.com"], undefined, "Property already max should not be rewritten");
  } finally {
    getRegistryLastDataRow = originalGetRegistryLastDataRow;
    readStoredLifetimeTotal = originalReadStoredLifetimeTotal;
    writeStoredLifetimeTotal = originalWriteStoredLifetimeTotal;
  }
}

function test_reconcileRegistrySheet_reportsRepairNotesAndFullActions() {
  const sheet = {};
  const calls = [];

  const originals = {
    migrateRemoveLastCleanupColumn,
    migrateAddKeepUnreadColumn,
    healMisplacedRegistryValues,
    healKeepUnreadMisplacedDates,
    getRegistryFormatMismatches,
    applyRegistrySchemaFormats,
    applyRegistryInputValidations,
    healRegistryCheckboxColumnsIfNeeded,
    healNumericStatColumns,
    syncLifetimeTotalsWithSheet,
    ensureRegistryHeaderRow,
    getRegistryHeaderMismatches,
    ensureRegistryGmailSearchLinks,
    trimRegistryTrailingRows,
    applyRegistrySchemaWidths
  };

  migrateRemoveLastCleanupColumn = () => false;
  migrateAddKeepUnreadColumn = () => false;
  healMisplacedRegistryValues = () => ({ datetime: 1, text: 2, stats: 0, testRows: 1 });
  healKeepUnreadMisplacedDates = () => 0;
  getRegistryFormatMismatches = () => [];
  applyRegistrySchemaFormats = () => 0;
  applyRegistryInputValidations = () => { calls.push("validations"); };
  healRegistryCheckboxColumnsIfNeeded = () => 0;
  healNumericStatColumns = () => 0;
  syncLifetimeTotalsWithSheet = () => 0;
  ensureRegistryHeaderRow = () => { calls.push("header"); };
  getRegistryHeaderMismatches = () => [];
  ensureRegistryGmailSearchLinks = () => { calls.push("gmailLinks"); };
  trimRegistryTrailingRows = () => 0;
  applyRegistrySchemaWidths = () => { calls.push("widths"); };

  try {
    const report = reconcileRegistrySheet(sheet, { mode: "full", resizeWidths: true });
    assertEq(report.mode, "full", "Mode should be full");
    assertTrue(report.gmailLinksEnsured, "Full mode should ensure Gmail links");
    assertTrue(report.widthsApplied, "Requested width apply should be reported");
    assertTrue(report.notes.some(n => n.includes("date/time columns")), "Datetime repair note should be present");
    assertTrue(report.notes.some(n => n.includes("text columns")), "Text repair note should be present");
    assertTrue(report.notes.some(n => n.includes("test-row preview")), "Test-row repair note should be present");
    assertEq(calls.includes("validations"), true, "Validations should be applied");
    assertEq(calls.includes("gmailLinks"), true, "Gmail links should be ensured in full mode");
    assertEq(calls.includes("widths"), true, "Widths should be applied when requested");
  } finally {
    migrateRemoveLastCleanupColumn = originals.migrateRemoveLastCleanupColumn;
    migrateAddKeepUnreadColumn = originals.migrateAddKeepUnreadColumn;
    healMisplacedRegistryValues = originals.healMisplacedRegistryValues;
    healKeepUnreadMisplacedDates = originals.healKeepUnreadMisplacedDates;
    getRegistryFormatMismatches = originals.getRegistryFormatMismatches;
    applyRegistrySchemaFormats = originals.applyRegistrySchemaFormats;
    applyRegistryInputValidations = originals.applyRegistryInputValidations;
    healRegistryCheckboxColumnsIfNeeded = originals.healRegistryCheckboxColumnsIfNeeded;
    healNumericStatColumns = originals.healNumericStatColumns;
    syncLifetimeTotalsWithSheet = originals.syncLifetimeTotalsWithSheet;
    ensureRegistryHeaderRow = originals.ensureRegistryHeaderRow;
    getRegistryHeaderMismatches = originals.getRegistryHeaderMismatches;
    ensureRegistryGmailSearchLinks = originals.ensureRegistryGmailSearchLinks;
    trimRegistryTrailingRows = originals.trimRegistryTrailingRows;
    applyRegistrySchemaWidths = originals.applyRegistrySchemaWidths;
  }
}

function makeFakeSheet() {
  const values = {};
  const formats = {};

  function key(row, col) {
    return `${row}:${col}`;
  }

  function makeCell(row, col) {
    const cell = {
      getValue: () => values[key(row, col)],
      setValue: function(value) {
        values[key(row, col)] = value;
        return cell;
      },
      getDisplayValue: () => {
        const value = values[key(row, col)];
        return value === null || value === undefined ? "" : String(value);
      },
      setNumberFormat: function(pattern) {
        formats[key(row, col)] = pattern;
        return cell;
      }
    };
    return cell;
  }

  return {
    getRange: (row, col) => makeCell(row, col),
    setValue: (row, col, value) => { values[key(row, col)] = value; },
    getValue: (row, col) => values[key(row, col)],
    getFormat: (row, col) => formats[key(row, col)] || ""
  };
}
