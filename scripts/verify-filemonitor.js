/**
 * verify-filemonitor.js — unit check of fileMonitor.js main-process logic.
 *
 * Runs under plain node with 'electron', './common' and './printHandler'
 * stubbed via Module._load, so the class can be exercised without the app:
 *   - instantiation (regression: the orphaned class-field statements used to
 *     throw ReferenceError on every `new FileMonitor()`)
 *   - directory scan (PDFs tracked, _temp and non-PDF skipped)
 *   - live fs.watch tracking of mid-session files
 *   - unprinted-file age filtering (5-min grace, 3-day cutoff)
 *   - markAsPrinted persistence — including files never tracked (the
 *     print-before-scan case) — surviving across instances
 *   - reminder dialog flows: Print Later re-asks, Mark as Printed stops it,
 *     Print Now spools printSilent and marks on success only
 *   - dialogOpen guard against stacked dialogs
 *
 *   node scripts/verify-filemonitor.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'filemon-'));
const BILLS = path.join(TMP, 'bills');
fs.mkdirSync(BILLS, { recursive: true });

// ---- controllable stubs -----------------------------------------------------
const state = {
  dialogResponse: 1,
  dialogCheckbox: false,
  dialogHang: false,
  dialogs: [],
  errorBoxes: [],
  printers: [{ name: 'Test Printer', isDefault: true }],
  printCalls: [],
  printErr: null
};

const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: () => TMP },
      dialog: {
        showMessageBox: (win, opts) => {
          state.dialogs.push({ message: opts.message, buttons: opts.buttons });
          if (state.dialogHang) return new Promise(() => {});
          return Promise.resolve({ response: state.dialogResponse, checkboxChecked: state.dialogCheckbox });
        },
        showErrorBox: (title, content) => state.errorBoxes.push({ title, content })
      },
      BrowserWindow: {
        getAllWindows: () => [{
          isDestroyed: () => false,
          webContents: { getPrintersAsync: async () => state.printers }
        }]
      }
    };
  }
  if (request === './common') {
    return {
      getBillsDir: () => BILLS,
      getPDF_FileName: (name, billDate, billNo) => `${name}_${billDate}_${billNo}.pdf`
    };
  }
  if (request === './printHandler') {
    return {
      printSilent: (p, printer, copies, paperSize, cb) => {
        state.printCalls.push({ p, printer, copies, paperSize });
        setTimeout(() => cb(state.printErr), 0);
      }
    };
  }
  return origLoad.apply(this, [request, ...args]);
};

const { FileMonitor } = require(path.join(ROOT, 'fileMonitor.js'));

// ---- harness ----------------------------------------------------------------
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function writePdf(name, size = 64) {
  fs.writeFileSync(path.join(BILLS, name), "%PDF-1.4\n" + "x".repeat(size));
}

(async () => {
  // 1. Instantiation must not throw (the orphaned-field regression)
  let mon;
  try {
    mon = new FileMonitor(BILLS);
    check("instantiation does not throw", true);
  } catch (e) {
    check("instantiation does not throw", false, `${e.name}: ${e.message}`);
  }

  // 2. Directory scan: PDF tracked, _temp and non-PDF skipped
  writePdf("keep.pdf");
  writePdf("skip_temp.pdf");
  fs.writeFileSync(path.join(BILLS, "notes.txt"), "not a bill");
  await mon.scanExistingFiles();
  check("scan tracks real PDF", mon.trackedFiles.has(path.join(BILLS, "keep.pdf")));
  check("scan skips _temp PDF", !mon.trackedFiles.has(path.join(BILLS, "skip_temp.pdf")));
  check("scan skips non-PDF", !mon.trackedFiles.has(path.join(BILLS, "notes.txt")));

  // 3. Live watcher picks up mid-session files
  mon.watchDirectory();
  writePdf("late.pdf");
  await sleep(600);
  check("watcher tracks mid-session PDF", mon.trackedFiles.has(path.join(BILLS, "late.pdf")));
  mon.stop();

  // 4. Age filtering (inject tracked entries with controlled birth times)
  const tenMin = new Date(Date.now() - 10 * 60 * 1000);
  const twoMin = new Date(Date.now() - 2 * 60 * 1000);
  const fourDays = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  mon.trackedFiles.set(path.join(BILLS, "oldEnough.pdf"), { created: tenMin, printed: false });
  mon.trackedFiles.set(path.join(BILLS, "tooFresh.pdf"), { created: twoMin, printed: false });
  mon.trackedFiles.set(path.join(BILLS, "stale.pdf"), { created: fourDays, printed: false });
  mon.trackedFiles.set(path.join(BILLS, "done.pdf"), { created: tenMin, printed: true });
  const unprinted = mon.getUnprintedFiles();
  const names = unprinted.map(f => f.name);
  check("10-min-old unprinted included", names.includes("oldEnough.pdf"));
  check("2-min-old excluded (grace)", !names.includes("tooFresh.pdf"));
  check("4-day-old excluded (cutoff)", !names.includes("stale.pdf"));
  check("printed excluded", !names.includes("done.pdf"));
  check("keep.pdf excluded while fresh", !names.includes("keep.pdf")); // real file, birthtime ~now

  // 5. markAsPrinted persists even for untracked files, across instances
  mon.markAsPrinted(path.join(BILLS, "never-tracked.pdf"));
  check("untracked print persisted", (() => {
    const data = JSON.parse(fs.readFileSync(path.join(TMP, "printedFiles.json"), 'utf8'));
    return Object.prototype.hasOwnProperty.call(data, "never-tracked.pdf");
  })());
  const mon2 = new FileMonitor(BILLS); // fresh instance → reads persisted map
  writePdf("never-tracked.pdf");
  await mon2.onFileAdded(path.join(BILLS, "never-tracked.pdf"));
  check("next instance treats persisted file as printed", mon2.trackedFiles.get(path.join(BILLS, "never-tracked.pdf")).printed === true);

  // 6. markBillAsPrinted builds the name through getPDF_FileName
  mon2.markBillAsPrinted(42, "Cust", "2026-10-26");
  check("markBillAsPrinted uses getPDF_FileName", (() => {
    const data = JSON.parse(fs.readFileSync(path.join(TMP, "printedFiles.json"), 'utf8'));
    return Object.prototype.hasOwnProperty.call(data, "Cust_2026-10-26_42.pdf");
  })());

  // 7. Dialog flows
  const dialogsBefore = state.dialogs.length;
  const filePath = path.join(BILLS, "oldEnough.pdf");

  // 7a. Print Later → not marked, and the next tick re-asks
  state.dialogResponse = 1;
  await mon.checkAndRemind();
  await mon.checkAndRemind();
  check("Print Later leaves file unprinted", mon.trackedFiles.get(filePath).printed === false);
  check("Print Later re-asks on next tick", state.dialogs.length === dialogsBefore + 2);

  // 7b. Mark as Printed → persisted and excluded
  state.dialogResponse = 2;
  await mon.checkAndRemind();
  check("Mark as Printed sets flag", mon.trackedFiles.get(filePath).printed === true);
  check("marked file no longer listed", !mon.getUnprintedFiles().some(f => f.name === "oldEnough.pdf"));

  // 7c. Print Now with a printer → printSilent called, files marked
  const freshPath = path.join(BILLS, "printNow.pdf");
  writePdf("printNow.pdf");
  mon.trackedFiles.set(freshPath, { created: tenMin, printed: false });
  state.dialogResponse = 0;
  state.printErr = null;
  await mon.checkAndRemind();
  check("Print Now spooled printSilent", state.printCalls.some(c => c.p === freshPath && c.printer === "Test Printer" && c.copies === 1));
  check("Print Now marks printed on success", mon.trackedFiles.get(freshPath).printed === true);

  // 7d. Print failure → left unprinted + error box
  const failPath = path.join(BILLS, "printFail.pdf");
  writePdf("printFail.pdf");
  mon.trackedFiles.set(failPath, { created: tenMin, printed: false });
  state.printErr = new Error("toner empty");
  await mon.checkAndRemind();
  check("failed print stays unprinted", mon.trackedFiles.get(failPath).printed === false);
  check("failed print shows error box", state.errorBoxes.some(b => b.title === "Print failed"));

  // 7e. dialogOpen guard — second checkAndRemind while dialog hangs must not stack
  state.dialogHang = true;
  const dialogsBeforeHang = state.dialogs.length;
  const pending = mon.checkAndRemind();
  await sleep(30);
  await mon.checkAndRemind();
  check("no stacked dialog while one is open", state.dialogs.length === dialogsBeforeHang + 1);
  state.dialogHang = false;

  // 8. stop() clears watcher and timers without throwing
  mon.watchDirectory();
  mon.startReminderInterval();
  mon.stop();
  check("stop clears interval", mon.reminderInterval === null);
  check("stop clears watcher", mon.watcher === null);

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
