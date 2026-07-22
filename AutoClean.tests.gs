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
    test_reconcileRegistrySheet_reportsRepairNotesAndFullActions,
    test_getActiveRules_blankActive_isSkipped,
    test_getActiveRules_falseActive_isSkipped,
    test_getActiveRules_trueActive_blankTest_isLive,
    test_getActiveRules_trueActive_trueTest_isPreview,
    test_getActiveRules_corruptedActiveDate_isSkipped,
    test_makeSenderSlug_similarAddresses_doNotCollide,
    test_lifetimePropertyKeys_doNotCollide_forSimilarSenders,
    test_getNewestMessageSender_usesNewestOnly,
    test_normalizeSender_displayNameAngleBrackets,
    test_classifyMessageProtection_guards,
    test_trashEligibleItems_dryRun_neverCallsMoveToTrash,
    test_trashEligibleItems_live_callsMoveToTrash,
    test_isCheckboxTrue_acceptsOnlyBooleanTrue,
    test_isCheckboxTrue_rejectsAllNonBooleanTruthyShapes,
    test_coerceCheckboxValue_preservesStringTrue,
    test_coerceCheckboxValue_edgeCases_matrix,
    test_coerceCheckboxValue_activeDefault_neverTurnsJunkOn,
    test_coerceCheckboxValue_keepUnreadDefault_blankBecomesOn,
    test_getCheckboxEditValue_readsEditEventStrings,
    test_getActiveRules_stringTrueActive_isSkipped,
    test_getActiveRules_stringFalseActive_isSkipped,
    test_getActiveRules_numericActive_isSkipped,
    test_getActiveRules_stringKeepUnread_isOff,
    test_getActiveRules_stringTest_isNotPreview,
    test_countActiveRules_matchesBooleanActiveOnly,
    test_getActiveSenderSet_ignoresStringTrue,
    test_checkboxFormats_rejectPlainTextAndDates,
    test_registryFormatPattern_checkboxUsesGeneral
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
  const sheet = {
    getLastColumn: () => 18,
    getRange: () => makeFakeRange()
  };
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

function makeFakeRange() {
  const range = {
    breakApart: function() { return range; },
    clearContent: function() { return range; },
    setBackground: function() { return range; },
    setFontColor: function() { return range; },
    setFontWeight: function() { return range; }
  };
  return range;
}

function test_getActiveRules_blankActive_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, "", false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "Blank Active must be skipped");
}

function test_getActiveRules_falseActive_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, false, false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "FALSE Active must be skipped");
}

function test_getActiveRules_trueActive_blankTest_isLive() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, true, "", true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 1, "TRUE Active should produce a rule");
  assertEq(rules[0].test, false, "Blank Test should mean live (not preview)");
}

function test_getActiveRules_trueActive_trueTest_isPreview() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, true, true, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 1, "TRUE Active + TRUE Test should produce a rule");
  assertEq(rules[0].test, true, "TRUE Test should mean preview");
}

function test_getActiveRules_corruptedActiveDate_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, new Date(1899, 11, 30), false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "Corrupted Active date must be skipped");
}

function test_getActiveRules_stringTrueActive_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, "TRUE", false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "String TRUE Active must fail closed until coerced to boolean");
}

function test_makeSenderSlug_similarAddresses_doNotCollide() {
  const a = makeSenderSlug("news-alert@example.com");
  const b = makeSenderSlug("news.alert@example.com");
  assertTrue(a !== b, "Similar senders must not share the same slug");
  assertTrue(/_[0-9a-f]{12}$/.test(a), "Slug should end with 12-char hex digest");
}

function test_lifetimePropertyKeys_doNotCollide_forSimilarSenders() {
  const a = lifetimeTotalPropertyKey("news-alert@example.com");
  const b = lifetimeTotalPropertyKey("news.alert@example.com");
  assertTrue(a !== b, "Lifetime property keys must not collide for similar senders");
  assertTrue(a.indexOf("H_") > -1, "Lifetime key should use independent hash prefix");
}

function test_getNewestMessageSender_usesNewestOnly() {
  const thread = {
    getMessages: () => [
      {
        getFrom: () => "old@example.com",
        getDate: () => new Date("2026-01-01")
      },
      {
        getFrom: () => "Display Name <newest@example.com>",
        getDate: () => new Date("2026-07-01")
      },
      {
        getFrom: () => "middle@example.com",
        getDate: () => new Date("2026-03-01")
      }
    ]
  };

  assertEq(getNewestMessageSender(thread), "newest@example.com", "Must learn newest message sender only");
}

function test_normalizeSender_displayNameAngleBrackets() {
  assertEq(
    normalizeSender("Display Name <EMAIL@Example.com>"),
    "email@example.com",
    "Angle-bracket From headers should normalize to lowercase email"
  );
}

function test_classifyMessageProtection_guards() {
  const starred = { isStarred: () => true, isUnread: () => false };
  const keepThread = { isStarred: () => false, isUnread: () => false };
  const unread = { isStarred: () => false, isUnread: () => true };
  const plain = { isStarred: () => false, isUnread: () => false };

  assertEq(classifyMessageProtection(starred, false, true), "KEEP - STARRED", "Starred must be protected");
  assertEq(classifyMessageProtection(keepThread, true, true), "KEEP - AUTOCLEAN KEEP LABEL", "Keep label must protect");
  assertEq(classifyMessageProtection(unread, false, true), "KEEP - UNREAD", "Unread + Keep Unread must protect");
  assertEq(classifyMessageProtection(unread, false, false), "", "Unread with Keep Unread off is eligible");
  assertEq(classifyMessageProtection(plain, false, true), "", "Plain message is eligible");
}

function test_trashEligibleItems_dryRun_neverCallsMoveToTrash() {
  let calls = 0;
  const items = [{ message: { moveToTrash: () => { calls++; } } }];
  const trashed = trashEligibleItems(items, true);
  assertEq(trashed, 0, "Dry run must trash 0");
  assertEq(calls, 0, "Dry run must never call moveToTrash");
}

function test_trashEligibleItems_live_callsMoveToTrash() {
  let calls = 0;
  const items = [
    { message: { moveToTrash: () => { calls++; } } },
    { message: { moveToTrash: () => { calls++; } } }
  ];
  const trashed = trashEligibleItems(items, false);
  assertEq(trashed, 2, "Live run should trash all items");
  assertEq(calls, 2, "Live run should call moveToTrash once per item");
}

function test_isCheckboxTrue_acceptsOnlyBooleanTrue() {
  assertEq(isCheckboxTrue(true), true, "Boolean true should be checked");
  assertEq(isCheckboxTrue(false), false, "Boolean false should not be checked");
  assertEq(isCheckboxTrue("TRUE"), false, "Text TRUE must fail closed");
  assertEq(isCheckboxTrue("true"), false, "Text true must fail closed");
  assertEq(isCheckboxTrue(1), false, "Numeric 1 must fail closed");
  assertEq(isCheckboxTrue(new Date()), false, "Date must fail closed");
  assertEq(isCheckboxTrue(null), false, "Null must fail closed");
  assertEq(isCheckboxTrue(""), false, "Blank must fail closed");
  assertEq(isCheckboxTrue(new Date(1899, 11, 30)), false, "Epoch date must fail closed");
}

function test_isCheckboxTrue_rejectsAllNonBooleanTruthyShapes() {
  const rejected = [
    ["false", "lowercase false string"],
    ["FALSE", "uppercase FALSE string"],
    [" True ", "padded True string"],
    ["yes", "yes string"],
    ["1", "string 1"],
    [0, "numeric 0"],
    [1, "numeric 1"],
    [-1, "numeric -1"],
    [undefined, "undefined"],
    ["   ", "whitespace"],
    [new Date(1900, 0, 9), "misplaced 1900 date"],
    [new Date(NaN), "invalid date"],
    [{}, "object"],
    [[], "array"]
  ];

  rejected.forEach(entry => {
    assertEq(isCheckboxTrue(entry[0]), false, entry[1] + " must fail closed");
  });
}

function test_coerceCheckboxValue_preservesStringTrue() {
  assertEq(coerceCheckboxValue(true, false), true, "Boolean true preserved");
  assertEq(coerceCheckboxValue(false, true), false, "Boolean false preserved");
  assertEq(coerceCheckboxValue("TRUE", false), true, "String TRUE coerces to true");
  assertEq(coerceCheckboxValue("true", false), true, "String true coerces to true");
  assertEq(coerceCheckboxValue("FALSE", true), false, "String FALSE coerces to false");
  assertEq(coerceCheckboxValue("", true), true, "Blank uses defaultChecked true");
  assertEq(coerceCheckboxValue(null, false), false, "Null uses defaultChecked false");
  assertEq(coerceCheckboxValue(new Date(1899, 11, 30), true), false, "Epoch becomes false");
  assertEq(coerceCheckboxValue("maybe", true), false, "Junk becomes false");
}

function test_coerceCheckboxValue_edgeCases_matrix() {
  // Checked-intent strings (heal must preserve as boolean true)
  assertEq(coerceCheckboxValue("TRUE", false), true, "TRUE");
  assertEq(coerceCheckboxValue("True", false), true, "True");
  assertEq(coerceCheckboxValue(" true ", false), true, "padded true");
  assertEq(coerceCheckboxValue("false", true), false, "false string wins over default");
  assertEq(coerceCheckboxValue(" False ", true), false, "padded False");

  // Blank-like → column default
  assertEq(coerceCheckboxValue("", false), false, "empty + default false");
  assertEq(coerceCheckboxValue("", true), true, "empty + default true");
  assertEq(coerceCheckboxValue(null, true), true, "null + default true");
  assertEq(coerceCheckboxValue(undefined, false), false, "undefined + default false");
  assertEq(coerceCheckboxValue(undefined, true), true, "undefined + default true");
  assertEq(coerceCheckboxValue("   ", false), false, "whitespace + default false");
  assertEq(coerceCheckboxValue("   ", true), true, "whitespace + default true");

  // Epoch / FALSE-as-date always unchecked
  assertEq(coerceCheckboxValue(new Date(1899, 11, 30), true), false, "epoch ignores default true");
  assertEq(coerceCheckboxValue(new Date(1899, 11, 30), false), false, "epoch with default false");

  // Other dates use column default (misplaced calendar value in checkbox col)
  assertEq(coerceCheckboxValue(new Date(2024, 5, 1), true), true, "real date + default true");
  assertEq(coerceCheckboxValue(new Date(2024, 5, 1), false), false, "real date + default false");
  assertEq(coerceCheckboxValue(new Date(1900, 0, 9), false), false, "1900 serial-ish date + default false");
  assertEq(coerceCheckboxValue(new Date(1900, 0, 9), true), true, "1900 serial-ish date + default true");

  // Junk / numeric corruption never becomes checked via coerce
  assertEq(coerceCheckboxValue(1, false), false, "numeric 1");
  assertEq(coerceCheckboxValue(1, true), false, "numeric 1 ignores default");
  assertEq(coerceCheckboxValue(0, true), false, "numeric 0");
  assertEq(coerceCheckboxValue("1", true), false, "string 1");
  assertEq(coerceCheckboxValue("yes", true), false, "yes");
  assertEq(coerceCheckboxValue("on", false), false, "on");
  assertEq(coerceCheckboxValue("checked", true), false, "checked");
  assertEq(coerceCheckboxValue(new Date(NaN), true), false, "invalid date");
}

function test_coerceCheckboxValue_activeDefault_neverTurnsJunkOn() {
  // Active has no checkboxDefault → heal uses defaultChecked false
  const junk = ["maybe", 1, 0, "yes", "TRUEISH", new Date(NaN)];
  junk.forEach(value => {
    assertEq(coerceCheckboxValue(value, false), false, "Active junk must stay off: " + value);
  });
  assertEq(coerceCheckboxValue("TRUE", false), true, "Active string TRUE must become boolean true");
  assertEq(coerceCheckboxValue("", false), false, "Active blank stays off");
}

function test_coerceCheckboxValue_keepUnreadDefault_blankBecomesOn() {
  // Keep Unread checkboxDefault true
  assertEq(coerceCheckboxValue("", true), true, "Keep Unread blank → on");
  assertEq(coerceCheckboxValue(null, true), true, "Keep Unread null → on");
  assertEq(coerceCheckboxValue("FALSE", true), false, "Keep Unread FALSE stays off");
  assertEq(coerceCheckboxValue(false, true), false, "Keep Unread boolean false stays off");
  assertEq(coerceCheckboxValue(new Date(1899, 11, 30), true), false, "Keep Unread epoch → off not default");
}

function test_getCheckboxEditValue_readsEditEventStrings() {
  assertEq(
    getCheckboxEditValue({ value: "TRUE", range: { getValue: () => false } }),
    true,
    "onEdit TRUE string is checked"
  );
  assertEq(
    getCheckboxEditValue({ value: "FALSE", range: { getValue: () => true } }),
    false,
    "onEdit FALSE string is unchecked"
  );
  assertEq(
    getCheckboxEditValue({ value: undefined, range: { getValue: () => true } }),
    true,
    "missing edit value falls back to range boolean true"
  );
  assertEq(
    getCheckboxEditValue({ value: "OTHER", range: { getValue: () => "TRUE" } }),
    false,
    "non TRUE/FALSE edit value still fail-closes via isCheckboxTrue on range"
  );
}

function test_getActiveRules_stringFalseActive_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, "FALSE", false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "String FALSE Active must be skipped");
}

function test_getActiveRules_numericActive_isSkipped() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, 1, false, true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 0, "Numeric Active must be skipped");
}

function test_getActiveRules_stringKeepUnread_isOff() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, true, false, "TRUE"]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 1, "Boolean Active still selects rule");
  assertEq(rules[0].keepUnread, false, "String TRUE Keep Unread must fail closed as off");
}

function test_getActiveRules_stringTest_isNotPreview() {
  const sheet = makeRulesSheet([["news@example.com", "count", 1, true, "TRUE", true]]);
  const rules = getActiveRules(sheet);
  assertEq(rules.length, 1, "Boolean Active still selects rule");
  assertEq(rules[0].test, false, "String TRUE Test must fail closed as live (not preview)");
}

function test_countActiveRules_matchesBooleanActiveOnly() {
  const sheet = makeRulesSheet([
    ["a@example.com", "count", 1, true, false, true],
    ["b@example.com", "count", 1, "TRUE", false, true],
    ["c@example.com", "count", 1, false, false, true],
    ["d@example.com", "count", 1, 1, false, true],
    ["e@example.com", "count", 1, "", false, true]
  ]);
  assertEq(countActiveRules(sheet), 1, "Only boolean true Active counts");
}

function test_getActiveSenderSet_ignoresStringTrue() {
  const sheet = makeRulesSheet([
    ["a@example.com", "count", 1, true, false, true],
    ["b@example.com", "count", 1, "TRUE", false, true]
  ]);
  const active = getActiveSenderSet(sheet);
  assertEq(active.has("a@example.com"), true, "Boolean Active sender included");
  assertEq(active.has("b@example.com"), false, "String TRUE Active sender excluded");
}

function test_checkboxFormats_rejectPlainTextAndDates() {
  assertEq(isPlainTextNumberFormat("@"), true, "@ is plain text");
  assertEq(isPlainTextNumberFormat("@_"), true, "@_ is plain text");
  assertEq(isPlainTextNumberFormat("General"), false, "General is not plain text");
  assertEq(isPlainTextNumberFormat(""), false, "Empty is not plain text");

  assertEq(registryFormatMatches("checkbox", "General"), true, "General OK for checkbox");
  assertEq(registryFormatMatches("checkbox", ""), true, "Empty/automatic OK for checkbox");
  assertEq(registryFormatMatches("checkbox", "@"), false, "Plain text not OK for checkbox");
  assertEq(registryFormatMatches("checkbox", "m/d/yyyy"), false, "Date format not OK for checkbox");
}

function test_registryFormatPattern_checkboxUsesGeneral() {
  assertEq(registryFormatPattern("checkbox"), "General", "Checkbox columns must use General");
  assertEq(registryFormatPattern("text"), "@", "Text columns still use plain text");
  assertEq(registryFormatPattern("number"), "0", "Number columns use 0");
}

function makeRulesSheet(rows) {
  const header = ["Sender", "Mode", "Value", "Active", "Test", "Keep Unread", "Last Checked", "Last Removed", "Total Removed", "Would Delete", "Protected Kept", "Test Sheet", "Notes", "Added", "Enabled Since", "Last Email Seen", "Last Batch", "Gmail Search"];
  const values = [header];

  rows.forEach(row => {
    const full = new Array(18).fill("");
    for (let i = 0; i < row.length; i++) full[i] = row[i];
    values.push(full);
  });

  const fake = makeFakeSheet();
  fake.getDataRange = () => ({
    getValues: () => values
  });

  // getActiveRules may write Enabled Since via getRange(row, COL.ENABLED_SINCE).setValue(...)
  return fake;
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
