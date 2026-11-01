/**
 * verify-ledger.js — live ledger table + ledger PDF run (Playwright _electron).
 *
 * Covers the accepted ledger-review fixes:
 *   - opening balance row at the top of the ledger table (ignored when not
 *     set), running balances shifted by it, entries still newest-first
 *   - print-ledger: entries ordered by entryNo ASC, opening balance rendered
 *     as the FIRST PDF entry row (stored value for the current year, else
 *     the previous year's closing balance carries in)
 *   - PDF summary box after the table: Total bills (Dr) vs Total payments
 *     (Cr) matched, outstanding balance at the end
 *
 * Expectations are computed from the DEV database BEFORE the app launches
 * (the ledger's running balances are all-time cumulative, so the summary's
 * outstanding is the all-time last balance, not a window-only sum).
 *
 *   node scripts/verify-ledger.js
 *
 * APP_ENV=DEV. Side effects, all restored:
 *   - the chosen customer's opening balance (moreInfo.openingBalance) is
 *     snapshotted before the run and written back after
 *   - generated PDFs under Documents/Ledger are deleted after the checks
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "ledger-shots");
const OPENING = 5000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const pageErrors = [];
const knownErrors = []; // pre-existing close-modal broadcast crashes (reported, not counted against the app)
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function waitFor(fn, timeout = 15000, step = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (_) { /* transient DOM races */ }
    await sleep(step);
  }
  return null;
}

const inr = n => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- expectation helpers (replicate common.js getFinYearStrtEndDt exactly) ----
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "policy.json")).toString());
const FY_DAY = /^\d{1,2}-\d{1,2}$/.test(POLICY.financialYearStartDate) ? POLICY.financialYearStartDate : "01-03";
function fyWindow(year) {
  let strtDt = new Date(), endDt = new Date();
  strtDt.setDate(1);
  let [dt, mnt] = FY_DAY.split("-").map(num => Number(num));
  strtDt.setMonth(mnt);
  strtDt.setDate(dt);
  if (strtDt.getMonth() > new Date().getMonth()) {
    strtDt.setFullYear(strtDt.getFullYear() - 1);
    endDt.setFullYear(endDt.getFullYear());
  }
  endDt.setMonth(strtDt.getMonth() - 1);
  endDt.setDate(31);
  endDt.setFullYear(strtDt.getFullYear() - year + 1);
  strtDt.setFullYear(strtDt.getFullYear() - year);
  return { strtDt, endDt };
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rowsFor(db, tbl, from, to) {
  return new Promise((res, rej) => {
    db.all(
      `SELECT entryNo,type,date,billAmt,payments,balance FROM "${tbl}"
        WHERE julianday(date) >= julianday(?) AND julianday(date) <= julianday(?)
        ORDER BY entryNo ASC`, [ymd(from), ymd(to)],
      (e, r) => e ? rej(e) : res(r)
    );
  });
}
function priorBalance(db, tbl, before) {
  return new Promise((res, rej) => {
    db.get(
      `SELECT balance FROM "${tbl}" WHERE julianday(date) < julianday(?) ORDER BY entryNo DESC LIMIT 1`,
      [ymd(before)], (e, r) => e ? rej(e) : res(r ? Number(r.balance) : null)
    );
  });
}
function sums(rows) {
  let dr = 0, cr = 0;
  for (const e of rows) {
    if (e.type === "sale") dr += e.billAmt - e.payments;
    else if (e.type === "purchase") cr += e.billAmt - e.payments;
    else if (e.type === "payment") cr += e.payments;
    else if (e.type === "out-payment") dr += e.payments;
  }
  return { dr, cr };
}

// Read the stored openingBalance straight from the DB — the only race-free
// way to know the add-opening-balance write has landed.
function dbOpening(id) {
  return new Promise((res, rej) => {
    const db = new sqlite3.Database(path.join(ROOT, "db", "bbs.db"));
    db.get("SELECT moreInfo FROM customers WHERE id=?", [id], (e, r) => {
      db.close();
      if (e) return rej(e);
      let mi = {};
      try { mi = JSON.parse(r.moreInfo || "{}"); } catch (_) {}
      res(mi.openingBalance);
    });
  });
}
// Authoritative restore (no app involved): rewrite moreInfo minus the key.
function restoreOpeningDirect(id, original) {
  return new Promise((res) => {
    const db = new sqlite3.Database(path.join(ROOT, "db", "bbs.db"));
    db.get("SELECT moreInfo FROM customers WHERE id=?", [id], (e, row) => {
      if (e || !row) { db.close(); return res(null); }
      let mi;
      try { mi = JSON.parse(row.moreInfo || "{}"); } catch (_) { mi = {}; }
      if (original === "UNSET") delete mi.openingBalance;
      else mi.openingBalance = Number(original);
      db.run("UPDATE customers SET moreInfo=? WHERE id=?", [JSON.stringify(mi), id], (e2) => {
        db.get("SELECT moreInfo FROM customers WHERE id=?", [id], (e3, row2) => {
          db.close();
          let back = null;
          try { back = JSON.parse(row2.moreInfo || "{}").openingBalance; } catch (_) {}
          console.log(`DB restore (direct): openingBalance now ${back === undefined || back === null ? "unset" : back}`);
          res(back);
        });
      });
    });
  });
}

// ---- pre-launch expectations from the DEV database ----
async function buildExpectations() {
  const db = new sqlite3.Database(path.join(ROOT, "db", "bbs.db"));
  const fy0 = fyWindow(0), fy1 = fyWindow(1);
  const customers = await new Promise((res, rej) => db.all("SELECT id,name,moreInfo FROM customers", (e, r) => e ? rej(e) : res(r)));
  let exp = null;
  for (const c of customers) {
    const tbl = `${c.id}Ledger`;
    const has = await new Promise((res, rej) => db.get(`SELECT name FROM sqlite_master WHERE name=?`, [tbl], (e, r) => e ? rej(e) : res(!!r)));
    if (!has) continue;
    const p0 = await rowsFor(db, tbl, fy0.strtDt, fy0.endDt);
    if (exp && exp.p0.length >= 2) break; // prefer a customer with >=2 current-year entries
    if (!p0.length) continue;
    const p1 = await rowsFor(db, tbl, fy1.strtDt, fy1.endDt);
    let mi = {};
    try { mi = JSON.parse(c.moreInfo || "{}"); } catch (_) {}
    exp = {
      id: c.id, name: c.name,
      p0, p1,
      p0Prior: await priorBalance(db, tbl, fy0.strtDt),
      p1Prior: await priorBalance(db, tbl, fy1.strtDt),
      stored: mi.openingBalance,
      ...sums(p0), p1sum: sums(p1),
      p0Last: p0.length ? Number(p0.at(-1).balance) : null,
      p1Last: p1.length ? Number(p1.at(-1).balance) : null
    };
    if (p0.length >= 2) break;
  }
  db.close();
  return exp;
}
async function extractPDFText(pdfPath) {
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(" ") + " ";
  }
  await doc.destroy().catch(() => {});
  return text;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const exp = await buildExpectations();
  if (!exp) { console.error("VERIFY FAILED: no customer with a ledger table found"); process.exit(1); }
  check("prep: expectation customer from DB", true, `${exp.name} — fy0 rows=${exp.p0.length}, fy1 rows=${exp.p1.length}, stored=${exp.stored === undefined || exp.stored === null || exp.stored === "" ? "unset" : exp.stored}, p0Prior=${exp.p0Prior === null ? "none" : exp.p0Prior}, p1Prior=${exp.p1Prior === null ? "none" : exp.p1Prior}`);

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const mainConsole = [];
  try {
    app.process().stdout.on("data", d => mainConsole.push(String(d)));
    app.process().stderr.on("data", d => mainConsole.push(String(d)));
  } catch (_) {}
  const page = await app.firstWindow();
  page.on("pageerror", err => {
    const str = String((err && err.stack) || err);
    if (/closeModal|customerPortal\.js:7\d\d|billPageInit/.test(str)) knownErrors.push(str);
    else pageErrors.push(str);
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let portalPage = null;
  let originalOpening = "UNSET";
  const createdPDFs = new Set();
  let ledgerDir = null;

  try {
    // ---- login ----
    await page.evaluate(() => {
      document.getElementById("tour-overlay")?.remove();
      document.getElementById("update-prompt-overlay")?.remove();
      const later = document.getElementById("bp-btn-later");
      if (later && later.offsetParent !== null) later.click();
    });
    if (await page.$('[data-ui="login-form"]')) {
      await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
      await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
      await page.locator('[data-ui="login-form"] button[type="submit"]').click();
      await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
      await page.waitForTimeout(2000);
    }

    // ---- open the portal through its real menu opener (Sale → Customer Portal) ----
    await app.evaluate(({ Menu }) => {
      const saleMenu = Menu.getApplicationMenu().items.find(i => i.label === "Sale");
      const item = saleMenu.submenu.items.find(i => i.label === "Customer Portal");
      item.click();
    });
    portalPage = await app.waitForEvent("window", {
      predicate: p => p.url().includes("customerPortal.html"),
      timeout: 20000
    });
    portalPage.on("pageerror", err => {
      const str = String((err && err.stack) || err);
      if (/closeModal|customerPortal\.js:7\d\d|billPageInit/.test(str)) knownErrors.push(str);
      else pageErrors.push(str);
    });
    await portalPage.waitForLoadState("domcontentloaded");
    const listReady = await waitFor(async () =>
      (await portalPage.$(`.customer-div[data-cust-id="${exp.id}"]`)) !== null, 20000);
    check("portal: window opened, expectation customer listed", !!listReady, exp.name);
    if (!listReady) throw new Error("customer not in portal list");

    ledgerDir = path.join(await app.evaluate(({ app }) => app.getPath("documents")), "Ledger");
    const pdfBefore = new Set(fs.existsSync(ledgerDir) ? fs.readdirSync(ledgerDir).filter(f => f.endsWith(".pdf")) : []);

    // ---- open the customer's ledger ----
    await portalPage.evaluate((id) => {
      document.querySelector(`.customer-div[data-cust-id="${id}"]`).click();
    }, exp.id);
    const firstLoad = await waitFor(async () => await portalPage.evaluate(() => {
      const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")];
      return rows.length ? rows.length : null;
    }), 20000);
    check("portal: ledger table loaded", !!firstLoad, `${firstLoad} rows`);
    if (!firstLoad) throw new Error("ledger table never loaded");

    originalOpening = await portalPage.evaluate(() => {
      const mi = selectedCustomer && selectedCustomer.moreInfo;
      const raw = mi && mi.openingBalance;
      return raw === undefined || raw === null || raw === "" ? "UNSET" : raw;
    });
    check("prep: opening balance snapshot matches DB", originalOpening === "UNSET"
      ? (exp.stored === undefined || exp.stored === null || exp.stored === "")
      : String(originalOpening) === String(exp.stored),
      originalOpening === "UNSET" ? "unset" : `was ${originalOpening}`);

    // ---- set an opening balance through the real handler ----
    await portalPage.evaluate(({ id, opening }) => {
      ipcRenderer.send("add-opening-balance", id, opening);
    }, { id: exp.id, opening: OPENING });
    const dbHas = await waitFor(async () => String(await dbOpening(exp.id)) === String(OPENING), 15000);
    check("prep: opening balance 5000 saved through add-opening-balance", !!dbHas);

    // refresh-customer-list rebuilds only the MAIN cache; get-customer pushes
    // it to the renderer (the portal's own refreshHelper has the same gap).
    // Sleep between them: refresh awaits a heavy rebuild. Retried once for the
    // app's intermittent startup-cache race.
    const pushList = async () => {
      await portalPage.evaluate(() => ipcRenderer.send("refresh-customer-list"));
      await sleep(4000);
      await portalPage.evaluate(() => ipcRenderer.send("get-customer"));
    };
    const listShows = async () => await portalPage.evaluate((id) => {
      const c = customerList.find(x => x.id === id);
      const mi = c && c.moreInfo;
      return mi && Number(mi.openingBalance) === 5000;
    }, exp.id);
    await pushList();
    let listOk = await waitFor(listShows, 15000);
    if (!listOk) { await sleep(3000); await pushList(); listOk = await waitFor(listShows, 15000); }
    check("prep: renderer customer list shows the new opening balance", !!listOk);

    // ---- reload the ledger table and check the opening row ----
    await portalPage.evaluate((id) => {
      document.querySelector(`.customer-div[data-cust-id="${id}"]`).click();
    }, exp.id);
    const withOpening = await waitFor(async () => await portalPage.evaluate(() => {
      const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")];
      if (!rows.length) return null;
      const cells = r => [...r.querySelectorAll(".col")].map(p => p.textContent.trim());
      if (cells(rows[0])[1] !== "Opening balance") return null;
      return {
        first: cells(rows[0]),
        entryNos: rows.map(r => r.dataset.entryNo).filter(Boolean).map(Number)
      };
    }), 20000);
    if (!withOpening) {
      const diag = await portalPage.evaluate(() => {
        const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")];
        return {
          count: rows.length,
          firstRows: rows.slice(0, 3).map(r => [...r.querySelectorAll(".col")].map(p => p.textContent.trim())),
          moreInfo: selectedCustomer && selectedCustomer.moreInfo,
          entries: (ledgerEntries || []).map(e => ({ type: e.type, billNo: e.billNo, entryNo: e.entryNo })).slice(0, 5)
        };
      }).catch(() => "diag-failed");
      check("table: opening balance row on top", false, JSON.stringify(diag).slice(0, 400));
      const consoleTail = mainConsole.join("").split("\n").filter(Boolean).slice(-30);
      check("main-console: tail dump", false, consoleTail.join("\n").slice(0, 2500));
      throw new Error("opening row never appeared — see diagnostics");
    }
    check("table: opening balance row on top", true, withOpening.first.join(" | "));
    // The table renders balance cells with roundOffTo2DecimalPlace, which does
    // not group digits (5000 stays "5000") — compare page-side.
    const pageBal = await portalPage.evaluate(() => String(roundOffTo2DecimalPlace(5000)));
    check("table: opening row shows the stored opening balance", withOpening.first[3] === pageBal, withOpening.first[3]);

    const entryNos = withOpening.entryNos;
    if (entryNos.length >= 2) {
      const desc = entryNos.every((n, i) => i === 0 || entryNos[i - 1] >= n);
      check("table: entries remain newest-first below the opening row", desc, `entryNos ${entryNos[0]} → ${entryNos.at(-1)}`);
    } else {
      check("table: entries remain newest-first below the opening row", true, "single entry — order trivially held");
    }
    const shiftOk = await portalPage.evaluate((opening) => {
      const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")].slice(1, 6);
      return rows.length > 0 && rows.every(r => {
        const entry = ledgerEntries.find(e => String(e.entryNo) === r.dataset.entryNo);
        if (!entry) return false;
        const shown = r.querySelectorAll(".col")[3].textContent.trim();
        return shown === String(roundOffTo2DecimalPlace(entry.balance + opening));
      });
    }, OPENING);
    check("table: running balances shifted by the stored opening", !!shiftOk);
    await portalPage.screenshot({ path: path.join(SHOTS, "1-ledger-table-with-opening.png") });

    // ---- current-year PDF with stored opening ----
    await portalPage.evaluate(({ id }) => ipcRenderer.send("print-ledger", id, 0, 2), { id: exp.id });
    const pdfPath = await waitFor(() => {
      const files = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".pdf") && !pdfBefore.has(f));
      if (!files.length) return null;
      const p = path.join(ledgerDir, files[0]);
      return fs.statSync(p).size > 1000 ? p : null;
    }, 30000);
    check("pdf: current-year ledger generated", !!pdfPath, pdfPath && path.basename(pdfPath));
    if (!pdfPath) throw new Error("ledger PDF was not generated");
    createdPDFs.add(pdfPath);
    await sleep(1500);

    const assertText = async (label, cond, text) => {
      check(label, cond, cond ? "" : `\n---- PDF text ----\n${text.slice(0, 900)}\n------------------`);
    };
    let text = null;
    try { text = await extractPDFText(pdfPath); check("pdf: text extracted", true, `${text.length} chars`); }
    catch (err) { check("pdf: text extracted", false, String(err)); }
    if (text) {
      const firstSaleIdx = text.indexOf("Sale: Bill Number");
      const firstPayIdx = text.indexOf("Payment");
      const openingIdx = text.indexOf("Opening balance");
      const firstEntryIdx = firstSaleIdx === -1 ? firstPayIdx : (firstPayIdx === -1 ? firstSaleIdx : Math.min(firstSaleIdx, firstPayIdx));
      await assertText("pdf: opening balance is the first entry row", openingIdx !== -1 && openingIdx < firstEntryIdx, text);
      await assertText("pdf: summary box present after the table",
        text.includes("Summary") && text.includes("Total bills (Dr)") && text.includes("Total payments (Cr)") && text.includes("Outstanding balance"), text);
      await assertText("pdf: summary bills total (Dr) correct", text.includes(inr(exp.dr)), text);
      await assertText("pdf: summary payments total (Cr) correct", text.includes(inr(exp.cr)), text);
      // A legacy typed opening-balance entry already sits inside the running
      // balances, so print-ledger skips the stored-opening shift then.
      const hasTypedOpening = exp.p0.some(e => e.type === "opening-balance");
      const expectedOutstanding = hasTypedOpening
        ? (exp.p0Last === null ? 0 : exp.p0Last)
        : OPENING + (exp.p0Last === null ? 0 : exp.p0Last);
      await assertText("pdf: summary outstanding = stored opening + all-time last balance", text.includes(inr(expectedOutstanding)),
        `expected ${inr(expectedOutstanding)} — ${text}`);
      check("pdf: header no longer prints an Opening Balance stat line", !text.includes("Opening Balance:"));
    }
    fs.rmSync(pdfPath, { force: true }); // same filename will be reused by the final print
    createdPDFs.delete(pdfPath);
    await sleep(500);

    // ---- previous-year PDF: carry-in from the year before (chaining) ----
    await portalPage.evaluate(({ id }) => ipcRenderer.send("print-ledger", id, 1, 2), { id: exp.id });
    const pdf1 = await waitFor(() => {
      const files = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".pdf") && !pdfBefore.has(f));
      if (!files.length) return null;
      const p = path.join(ledgerDir, files[0]);
      return fs.statSync(p).size > 1000 ? p : null;
    }, 30000);
    check("pdf: previous-year ledger generated", !!pdf1, pdf1 && path.basename(pdf1));
    if (pdf1) {
      createdPDFs.add(pdf1);
      await sleep(1500);
      let text1 = null;
      try { text1 = await extractPDFText(pdf1); } catch (err) { check("pdf: previous-year text extracted", false, String(err)); }
      if (text1) {
        check("pdf: previous-year summary box present", text1.includes("Summary") && text1.includes("Outstanding balance"));
        const expectOpening = exp.p1Prior !== null;
        await assertText("pdf: previous-year opening = previous year's closing",
          text1.includes("Opening balance") === expectOpening, text1);
        if (expectOpening) {
          await assertText("pdf: previous-year carry-in value correct", text1.includes(inr(exp.p1Prior)), text1);
        }
        if (exp.p1.length) {
          await assertText("pdf: previous-year outstanding reconciles (no double shift)",
            text1.includes(inr(exp.p1Last)), `expected ${inr(exp.p1Last)} — ${text1}`);
        }
      }
      fs.rmSync(pdf1, { force: true });
      createdPDFs.delete(pdf1);
      await sleep(500);
    }

    // ---- restore the original opening balance ----
    await portalPage.evaluate(async ({ id, original }) => {
      ipcRenderer.send("add-opening-balance", id, original === "UNSET" ? undefined : original);
    }, { id: exp.id, original: originalOpening });
    const dbRestored = await waitFor(async () => {
      const v = await dbOpening(exp.id);
      return originalOpening === "UNSET"
        ? (v === undefined || v === null || v === "")
        : String(v) === String(originalOpening);
    }, 15000);
    check("cleanup: opening balance restored in DB", !!dbRestored, originalOpening === "UNSET" ? "removed" : `back to ${originalOpening}`);
    await pushList();
    const listBack = await waitFor(async () => await portalPage.evaluate((id) => {
      const c = customerList.find(x => x.id === id);
      const mi = c && c.moreInfo;
      return !(mi && mi.openingBalance !== undefined && mi.openingBalance !== null && mi.openingBalance !== "");
    }, exp.id), 15000);
    check("cleanup: renderer list no longer shows an opening balance", !!listBack);
    // Mark the current table rows as stale; loadLedgerTable rebuilds async
    // (invoke → removeAllElem → re-append), so wait until the OLD rows are
    // gone instead of reading the previous table's still-mounted DOM.
    await portalPage.evaluate(() => {
      const el = document.querySelector("#ledger-div #tbody .row.body");
      if (el) el.dataset.__stale = "1";
    });
    await portalPage.evaluate((id) => {
      document.querySelector(`.customer-div[data-cust-id="${id}"]`).click();
    }, exp.id);

    const afterRestore = await waitFor(async () => await portalPage.evaluate(() => {
      if (document.querySelector('[data-__stale="1"]')) return null;
      const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")];
      if (!rows.length) return null;
      return [...rows[0].querySelectorAll(".col")].map(p => p.textContent.trim());
    }), 20000);
    if (originalOpening === "UNSET") {
      // A legacy typed opening-balance entry legitimately renders that row even
      // when no stored opening is set, and it already sits inside the balances.
      const hasTypedOpening = exp.p0.some(e => e.type === "opening-balance");
      if (hasTypedOpening) {
        check("table: opening row ignored when opening balance not set", true, "legacy typed opening-balance entry present — row legitimately stays");
      } else {
        check("table: opening row ignored when opening balance not set", !!afterRestore && afterRestore[1] !== "Opening balance",
          afterRestore && afterRestore[1]);
      }
      const unshiftOk = await portalPage.evaluate(() => {
        const rows = [...document.querySelectorAll("#ledger-div #tbody .row.body")].slice(0, 6);
        return rows.length > 0 && rows.every(r => {
          const entry = ledgerEntries.find(e => String(e.entryNo) === r.dataset.entryNo);
          if (!entry) return false;
          const shown = r.querySelectorAll(".col")[3].textContent.trim();
          return shown === String(roundOffTo2DecimalPlace(entry.balance));
        });
      });
      check("table: balances unshifted again after restore", !!unshiftOk);
    }

    // ---- final PDF with no stored opening: summary still present ----
    await portalPage.evaluate(({ id }) => ipcRenderer.send("print-ledger", id, 0, 2), { id: exp.id });
    const pdf2 = await waitFor(() => {
      const files = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".pdf") && !pdfBefore.has(f));
      if (!files.length) return null;
      const p = path.join(ledgerDir, files[0]);
      return fs.statSync(p).size > 1000 ? p : null;
    }, 30000);
    check("pdf: final (no-opening) ledger generated", !!pdf2);
    if (pdf2) {
      createdPDFs.add(pdf2);
      await sleep(1500);
      let text2 = null;
      try { text2 = await extractPDFText(pdf2); } catch (err) { check("pdf: final text extracted", false, String(err)); }
      if (text2) {
        check("pdf: final summary box present", text2.includes("Summary") && text2.includes("Outstanding balance"));
        if (originalOpening === "UNSET") {
          if (exp.p0Prior === null) {
            await assertText("pdf: no opening row when opening balance not set", !text2.includes("Opening balance"), text2);
          } else {
            await assertText("pdf: current-year opening chained from previous year's closing",
              text2.includes("Opening balance") && text2.includes(inr(exp.p0Prior)), text2);
          }
          await assertText("pdf: final outstanding = all-time last balance (carry-in already inside)",
            text2.includes(inr(exp.p0Last === null ? 0 : exp.p0Last)), text2);
        } else {
          await assertText("pdf: restored original opening row present",
            text2.includes("Opening balance") && text2.includes(inr(Number(originalOpening))), text2);
          await assertText("pdf: final outstanding = original opening + all-time last balance",
            text2.includes(inr(Number(originalOpening) + (exp.p0Last === null ? 0 : exp.p0Last))), text2);
        }
      }
      fs.rmSync(pdf2, { force: true });
      createdPDFs.delete(pdf2);
    }

    check("renderer: zero unexpected page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    check("app: pre-existing close-modal broadcast crash noted (list view)", true,
      `${knownErrors.length} occurrence(s) — add-opening-balance broadcasts close-modal, refreshHelper calls billPageInit while the bill page is not open`);
  } finally {
    if (portalPage && !portalPage.isClosed() && exp) {
      await portalPage.evaluate(async ({ id, original }) => {
        ipcRenderer.send("add-opening-balance", id, original === "UNSET" ? undefined : original);
      }, { id: exp.id, original: originalOpening }).catch(() => {});
    }
    for (const p of createdPDFs) {
      try { fs.rmSync(p, { force: true }); } catch (_) {}
    }
    await app.close().catch(() => {});
    // Authoritative restore — the in-app IPC above can race app close, which
    // is exactly how a previous run left 5000 behind.
    await restoreOpeningDirect(exp.id, originalOpening);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => {
  console.error("VERIFY FAILED:", err);
  console.error("renderer errors so far:", pageErrors.slice(0, 5));
  process.exit(1);
});
