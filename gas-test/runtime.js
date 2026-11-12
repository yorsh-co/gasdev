// Test runtime for Apps Script. A plain global script: it has no module syntax
// and is concatenated with the library under test and its tests by
// `gasdev gas-test build`. Run `runGasTests` from the editor.

/** Marks the start of the encoded results in the value returned by `runGasTests`. */
const GAS_TEST_START_ = '@@GAS_TEST@@';

/** Marks the end of the encoded results. */
const GAS_TEST_END_ = '@@END@@';

/** Script property that names the spreadsheet tests use when no ID is passed. */
const GAS_TEST_PROPERTY_ = 'GAS_TEST_SPREADSHEET_ID';

/** Sheets created by a run are named `__gt_<epochMs>_...`; older ones are leftovers. */
const GAS_TEST_SHEET_ = /^__gt_(\d+)_/;

/** Age after which a leftover test sheet is deleted. */
const GAS_TEST_STALE_MS_ = 60 * 60 * 1000;

/**
 * @typedef {object} GasTestEntry
 * @property {'test' | 'info'} kind
 * @property {string} name
 * @property {(context: GasTestContext) => unknown} fn
 */

/**
 * @typedef {object} GasTestResult
 * @property {string} name
 * @property {'PASS' | 'FAIL' | 'INFO'} status
 * @property {number} ms Duration in milliseconds.
 * @property {string} [message] Failure message, or the text of an INFO result.
 */

/** @type {GasTestEntry[]} */
const GAS_TEST_REGISTRY_ = [];

/**
 * Registers a test; it fails when `fn` throws.
 *
 * @param {string} name
 * @param {(context: GasTestContext) => void} fn
 */
function test(name, fn) {
  GAS_TEST_REGISTRY_.push({ kind: 'test', name, fn });
}

/**
 * Registers a check that records context-dependent behaviour. The string `fn`
 * returns, or the message it throws, is reported as INFO; it never fails the run.
 *
 * @param {string} name
 * @param {(context: GasTestContext) => string} fn
 */
function info(name, fn) {
  GAS_TEST_REGISTRY_.push({ kind: 'info', name, fn });
}

/**
 * Throws when the condition is falsy.
 *
 * @param {unknown} condition
 * @param {string} [message]
 */
function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

/**
 * Runs every registered test in registration order. Library code under test
 * only needs a spreadsheet when a test reads `context.spreadsheet`.
 *
 * @param {string} [spreadsheetId] Spreadsheet to use; see `gasTestSpreadsheet_`.
 * @returns {string} The results, base64-encoded between sentinels so a caller can
 *   find them in surrounding output.
 */
function runGasTests(spreadsheetId) {
  const started = Date.now();
  const prefix = `__gt_${started}_`;
  /** @type {GasTestResult[]} */
  const results = [];
  /** @type {GoogleAppsScript.Spreadsheet.Spreadsheet | undefined} */
  let spreadsheet;

  /** @param {GasTestResult} result */
  const record = (result) => {
    results.push(result);
    console.log(gasTestLine_(result));
  };

  /** @type {GasTestContext} */
  const context = {
    prefix,
    get spreadsheet() {
      if (!spreadsheet) {
        spreadsheet = gasTestSpreadsheet_(spreadsheetId);
        try {
          gasTestSweep_(spreadsheet, started);
        } catch (error) {
          record({
            name: 'stale sheet sweep',
            status: 'INFO',
            ms: 0,
            message: gasTestMessage_(error),
          });
        }
      }
      return spreadsheet;
    },
  };

  try {
    for (const { kind, name, fn } of GAS_TEST_REGISTRY_) {
      const t0 = Date.now();
      try {
        const returned = fn(context);
        const ms = Date.now() - t0;
        record(
          kind === 'info'
            ? {
                name,
                status: 'INFO',
                ms,
                message: returned == null ? '' : String(returned),
              }
            : { name, status: 'PASS', ms },
        );
      } catch (error) {
        const ms = Date.now() - t0;
        const message = gasTestMessage_(error);
        record(
          kind === 'info'
            ? { name, status: 'INFO', ms, message }
            : { name, status: 'FAIL', ms, message },
        );
      }
    }
  } finally {
    if (spreadsheet) {
      const t0 = Date.now();
      try {
        gasTestRemove_(spreadsheet, (name) => name.startsWith(prefix));
      } catch (error) {
        record({
          name: 'cleanup',
          status: 'INFO',
          ms: Date.now() - t0,
          message: gasTestMessage_(error),
        });
      }
    }
  }

  const elapsedMs = Date.now() - started;
  const count = (/** @type {string} */ status) =>
    results.filter((r) => r.status === status).length;
  console.log(
    `${count('PASS')} passed, ${count('FAIL')} failed, ${count('INFO')} info in ${(elapsedMs / 1000).toFixed(1)} s`,
  );
  return (
    GAS_TEST_START_ +
    Utilities.base64Encode(
      JSON.stringify({ results, elapsedMs }),
      Utilities.Charset.UTF_8,
    ) +
    GAS_TEST_END_
  );
}

/**
 * Resolves the spreadsheet: the argument, else the `GAS_TEST_SPREADSHEET_ID`
 * script property, else the active spreadsheet.
 *
 * @param {string | undefined} spreadsheetId
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 * @throws {Error} When none of the three is available.
 */
function gasTestSpreadsheet_(spreadsheetId) {
  if (typeof spreadsheetId === 'string' && spreadsheetId !== '') {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  const stored =
    PropertiesService.getScriptProperties().getProperty(GAS_TEST_PROPERTY_);
  if (stored) return SpreadsheetApp.openById(stored);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error(
    `No spreadsheet available. Pass an ID to runGasTests(spreadsheetId), set the ${GAS_TEST_PROPERTY_} script property, or bind the script to a spreadsheet (SpreadsheetApp.getActiveSpreadsheet()).`,
  );
}

/**
 * Deletes test sheets left by runs that never reached their cleanup, such as
 * one killed by the 6-minute execution limit.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {number} now Epoch milliseconds.
 */
function gasTestSweep_(spreadsheet, now) {
  gasTestRemove_(spreadsheet, (name) => {
    const match = GAS_TEST_SHEET_.exec(name);
    return match !== null && now - Number(match[1]) > GAS_TEST_STALE_MS_;
  });
}

/**
 * Deletes the sheets whose name satisfies the predicate.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {(name: string) => boolean} matches
 */
function gasTestRemove_(spreadsheet, matches) {
  for (const sheet of spreadsheet.getSheets()) {
    if (matches(sheet.getName())) spreadsheet.deleteSheet(sheet);
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function gasTestMessage_(error) {
  const message = /** @type {{ message?: unknown } | null} */ (error)?.message;
  return typeof message === 'string' ? message : String(error);
}

/**
 * Formats a result as one execution-log line.
 *
 * @param {GasTestResult} result
 * @returns {string}
 */
function gasTestLine_({ name, status, ms, message }) {
  if (status === 'PASS') return `PASS ${name} (${ms} ms)`;
  if (status === 'FAIL') return `FAIL ${name} (${ms} ms): ${message}`;
  return `INFO ${name}: ${message}`;
}
