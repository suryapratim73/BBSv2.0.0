/**
 * verify-proforma.js — live Proforma Bills run (Playwright _electron).
 * Drives the real app through the full quote lifecycle:
 *   Order Manager tabs → "+" opens the sale page in proforma mode → save
 *   lands in proformas.json (no DB writes) → dashboard stays clean →
 *   the quote shows under the Proforma Bills tab → details view →
 *   Convert opens the sale page in new-from-proforma mode → save produces
 *   a real invoice (numeric billNo, DB row) and removes the quote.
 *
 *   node scripts/verify-proforma.js
 *
 * APP_ENV=DEV. Because a conversion is a REAL sale save, the dev store
 * (db/, model/*.json, orders.json, proformas.json) is snapshotted before
 * the run and restored afterwards, so the repo and dev DB stay clean.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "proforma-shots");
const BACKUP = path.join(ROOT, "test-results", "proforma-backup");
const DB_DIR = path.join(ROOT, "db");
const MODEL_DIR = path.join(ROOT, "model");
const ORDERS_JSON = path.join(ROOT, "orders.json");
const PROFORMAS_JSON = path.join(ROOT, "proformas.json");

const CUST = "VERIFY-PROFORMA-CUST";
const ITEM = "VERIFY-PROFORMA-ITEM";
const ZEN_JSON = path.join(ROOT, "zenMode.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const pageErrors = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function waitFor(fn, timeout = 15000, step = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const val = await fn();
    if (val) return val;
    await sleep(step);
  }
  return null;
}

// snapshot / restore the dev store (DB + JSON stores)
function snapshotStore() {
  fs.rmSync(BACKUP, { recursive: true, force: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  if (fs.existsSync(DB_DIR)) fs.cpSync(DB_DIR, path.join(BACKUP, "db"), { recursive: true });
  for (const f of ["schema.json", "dynamicSchemas.json"]) {
    const p = path.join(MODEL_DIR, f);
    if (fs.existsSync(p)) fs.cpSync(p, path.join(BACKUP, f));
  }
  for (const p of [ORDERS_JSON, PROFORMAS_JSON]) {
    if (fs.existsSync(p)) fs.cpSync(p, path.join(BACKUP, path.basename(p)));
  }
  if (fs.existsSync(ZEN_JSON)) fs.cpSync(ZEN_JSON, path.join(BACKUP, "zenMode.json"));
}
async function restoreStore() {
  if (!fs.existsSync(path.join(BACKUP, "db"))) return;
  // sqlite can hold bbs.db for a moment after app.close() — retry with backoff
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(DB_DIR, { recursive: true, force: true });
      break;
    } catch (err) {
      if (err.code !== "EBUSY" && err.code !== "EPERM") throw err;
      await sleep(1000);
    }
  }
  fs.cpSync(path.join(BACKUP, "db"), DB_DIR, { recursive: true });
  for (const f of ["schema.json", "dynamicSchemas.json"]) {
    const src = path.join(BACKUP, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(MODEL_DIR, f));
  }
  for (const f of ["orders.json", "proformas.json"]) {
    const src = path.join(BACKUP, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(ROOT, f));
    else fs.rmSync(path.join(ROOT, f), { force: true });
  }
  const zenSrc = path.join(BACKUP, "zenMode.json");
  if (fs.existsSync(zenSrc)) fs.cpSync(zenSrc, ZEN_JSON);
  else fs.rmSync(ZEN_JSON, { force: true });
}

function readProformas() {
  try {
    const data = JSON.parse(fs.readFileSync(PROFORMAS_JSON).toString());
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  snapshotStore();

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let omPage = null;
  let salePage = null;
  try {
    // ---- login ----
    await page.evaluate(() => {
      document.getElementById("tour-overlay")?.remove();
      document.getElementById("update-prompt-overlay")?.remove();
    });
    if (await page.$('[data-ui="login-form"]')) {
      await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
      await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
      await page.locator('[data-ui="login-form"] button[type="submit"]').click();
      await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
      await page.waitForTimeout(2000);
    }

    // Zen Mode is active on this machine (discVal 20) — it would skew the
    // amounts and lock bill dates. Stop it for the run; zenMode.json is
    // restored with the rest of the store afterwards.
    const zenBefore = await page.evaluate(async () => await ipcRenderer.invoke("get-zen-mode-state"));
    if (zenBefore) await page.evaluate(() => ipcRenderer.invoke("stop-zen-mode"));
    check("prep: zen stopped for the run", !(await page.evaluate(async () => await ipcRenderer.invoke("get-zen-mode-state"))));

    // ---- open Order Manager through its real menu opener (Sale → View Orders) ----
    await app.evaluate(({ Menu }) => {
      const saleMenu = Menu.getApplicationMenu().items.find(i => i.label === "Sale");
      const item = saleMenu.submenu.items.find(i => i.label === "View Orders");
      item.click();
    });
    omPage = await app.waitForEvent("window", {
      predicate: p => p.url().includes("orderManager.html"),
      timeout: 20000
    });
    omPage.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
    await omPage.waitForLoadState("domcontentloaded");
    await waitFor(async () => (await omPage.$("#tab-bar")) && (await omPage.$("#orders-table .tbody")), 15000);

    // ---- tab UI ----
    const defaultTab = await omPage.evaluate(() => ({
      ordersActive: document.getElementById("tab-orders").classList.contains("active"),
      title: document.getElementById("list-title").textContent,
      proformasHidden: document.getElementById("proformas-table").classList.contains("hide"),
      ordersVisible: !document.getElementById("orders-table").classList.contains("hide")
    }));
    check("tabs: Orders active by default", defaultTab.ordersActive && defaultTab.title === "Unbilled orders", JSON.stringify(defaultTab));
    check("tabs: proforma table hidden initially", defaultTab.proformasHidden && defaultTab.ordersVisible);

    await omPage.evaluate(() => document.getElementById("tab-proformas").click());
    await omPage.waitForTimeout(300);
    const proformaTab = await omPage.evaluate(() => ({
      active: document.getElementById("tab-proformas").classList.contains("active"),
      title: document.getElementById("list-title").textContent,
      proformasVisible: !document.getElementById("proformas-table").classList.contains("hide"),
      ordersHidden: document.getElementById("orders-table").classList.contains("hide"),
      plusMsg: document.getElementById("new-entry-btn").dataset.msg
    }));
    check("tabs: Proforma Bills tab switches view", proformaTab.active && proformaTab.title === "Proforma bills" && proformaTab.proformasVisible && proformaTab.ordersHidden, JSON.stringify(proformaTab));
    check("tabs: + tooltip switches to proforma", proformaTab.plusMsg === "Create new proforma bill", proformaTab.plusMsg);
    await omPage.locator("#page-1").screenshot({ path: path.join(SHOTS, "1-proforma-tab.png") });

    // ---- seed a stock item so the fuzzy datalist can select it (snapshot restore removes it) ----
    const seeded = await page.evaluate(async (item) => {
      const created = await ipcRenderer.invoke("create-stock", { name: item, hsn: "7204", buyPrice: 0 });
      ipcRenderer.send("save-stock-info", created.id, { standardSellPrice: 500, taxSlab: 0 });
      await new Promise(r => setTimeout(r, 500));
      return created.id;
    }, ITEM);
    check("prep: stock item seeded", !!seeded, String(seeded));

    // ---- "+" opens the sale page in proforma mode ----
    await omPage.evaluate(() => ipcRenderer.send("new-sale-purchase", 3));
    salePage = await app.waitForEvent("window", {
      predicate: p => p.url().includes("salePage.html"),
      timeout: 20000
    });
    salePage.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
    await salePage.waitForLoadState("domcontentloaded");
    const step1Ready = await waitFor(async () => (await salePage.$('[data-name="name"]')) && (await salePage.$('[data-type="proceed"]')), 20000);
    if (!step1Ready) {
      const dump = await salePage.evaluate(() => document.body ? document.body.innerHTML.slice(0, 600) : "no body");
      check("sale page: step 1 form rendered", false, dump);
      throw new Error("sale page step 1 missing");
    }

    // step 1 — customer
    await salePage.locator('[data-name="name"]').fill(CUST);
    await salePage.locator('[data-name="address"]').fill("Verify Lane, Test City");
    await salePage.locator('[data-type="proceed"]').click();
    await waitFor(async () => await salePage.$("#bill-number-regular"), 10000);

    // step 2 — bill details (proforma preset; the status override runs in a 100ms timeout)
    await salePage.waitForTimeout(400);
    const billMetaStep2 = await salePage.evaluate(() => ({
      billNo: document.querySelector('[data-name="billNo"]')?.value || "",
      billType: document.querySelector('input[data-name="billType"]:checked')?.value || "",
      billStatus: document.querySelector('input[name="billStatus"]:checked')?.id || ""
    }));
    check("sale page: proforma bill number assigned", billMetaStep2.billNo.startsWith("proforma_"), billMetaStep2.billNo);
    check("sale page: bill type radio = proforma", billMetaStep2.billType === "proforma", billMetaStep2.billType);
    check("sale page: status forced open", billMetaStep2.billStatus === "bill-status-open", billMetaStep2.billStatus);
    // App defaults a fresh sale to Transport with a required transporter name (salePage.js:381-389);
    // pick Hand like a user would so the form can validate.
    await salePage.locator("#delivery-mode").selectOption("hand");
    await salePage.locator("#bill-no-div, #bill-number-regular").first().screenshot({ path: path.join(SHOTS, "2-proforma-step2.png") });

    await salePage.locator('[data-type="proceed"]').click();
    if (!(await waitFor(async () => await salePage.$("#add-item"), 8000))) {
      const diag = await salePage.evaluate(() => {
        const form = document.querySelector("form");
        return {
          header: document.getElementById("page-header")?.textContent,
          stepAttr: document.querySelector("#page-container")?.getAttribute("data-step") || document.body.getAttribute("data-step") || null,
          toasts: [...document.querySelectorAll(".toast-div")].map(t => t.textContent.trim()).slice(0, 4),
          invalid: form ? [...form.querySelectorAll(":invalid")].map(i => ({ id: i.id, name: i.name, type: i.type, value: i.value, disabled: i.disabled })) : [],
          formValid: form ? form.checkValidity() : null,
          mainHTML: document.querySelector("main")?.innerHTML.slice(0, 500)
        };
      });
      throw new Error("step 3 missing after step-2 proceed — " + JSON.stringify(diag, null, 2));
    }

    // step 3 — items (real selection flow: exact-match input → change → selectionHandler pushes to orderItems)
    await salePage.evaluate(() => document.querySelector("#add-item > button").click());
    await salePage.waitForTimeout(300);
    await salePage.evaluate((item) => {
      const row = document.querySelector("#tbody .body.row:not(.row-control-div)");
      const name = row.querySelector("input[data-name='name']");
      name.value = item;
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
    }, ITEM);
    await salePage.waitForTimeout(600); // selectionHandler is async — rate/hsn/unit fill + orderItems push
    await salePage.evaluate(() => {
      const row = document.querySelector("#tbody .body.row:not(.row-control-div)");
      const qty = row.querySelector("input[data-name='qty']");
      qty.value = "2";
      qty.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await salePage.waitForTimeout(500);
    await salePage.locator('[data-type="proceed"]').click();
    await waitFor(async () => await salePage.$("#summary-div"), 10000);
    await salePage.locator("#summary-div").screenshot({ path: path.join(SHOTS, "3-proforma-summary.png") });

    // ---- save → proformas.json, sale window closes ----
    const closed = salePage.waitForEvent("close", { timeout: 30000 }).catch(() => null);
    await salePage.locator('[data-type="save"]').click();
    check("save: sale window closed after proforma save", !!(await closed));
    salePage = null;

    // the file write happens just after the window close — poll the store
    const saved = await waitFor(async () => readProformas().find(o => o.name === CUST) || null, 10000, 200);
    check("store: proforma persisted in proformas.json", !!saved, saved ? `id=${saved.proformaId} netAmtTax=${saved.netAmtTax}` : "");
    check("store: entry shape (pending, unpaid, proforma billType)", saved && saved.status === "pending" && saved.paymentStatus === false && saved.billMeta.billType === "proforma", saved && JSON.stringify({ status: saved.status, paymentStatus: saved.paymentStatus, billType: saved.billMeta.billType, billNo: saved.billMeta.billNo }));
    check("store: amounts recalculated (2 × 500)", saved && saved.netAmtTax === 1000, saved && String(saved.netAmtTax));
    check("store: items carried", saved && Array.isArray(saved.orderItems) && saved.orderItems.length === 1 && saved.orderItems[0].name === ITEM, "");
    check("store: caption says Proforma Invoice", saved && Array.isArray(saved.billMeta.printObj.captions) && saved.billMeta.printObj.captions.includes("Proforma Invoice"), saved && JSON.stringify(saved.billMeta.printObj.captions));

    // ---- dashboard isolation ----
    const dash = await page.evaluate(async () => {
      const content = await ipcRenderer.invoke("get-sale-content");
      const sales = await ipcRenderer.invoke("get-sales");
      return {
        contentRows: (content?.bills || []).filter(b => b.billType === "proforma" || b.name === "VERIFY-PROFORMA-CUST").length,
        salesRows: (Array.isArray(sales) ? sales : []).filter(b => b.billType === "proforma" || b.name === "VERIFY-PROFORMA-CUST").length
      };
    });
    check("dashboard: get-sale-content has no proforma rows", dash.contentRows === 0, String(dash.contentRows));
    check("dashboard: get-sales filtered too", dash.salesRows === 0, String(dash.salesRows));

    // ---- Order Manager shows the quote on the Proforma tab ----
    const rowShown = await waitFor(async () => omPage.evaluate(() =>
      [...document.querySelectorAll("#proformas-table .body.row")]
        .some(r => r.textContent.includes("VERIFY-PROFORMA-CUST"))), 15000);
    check("manager: quote row appears under Proforma Bills", !!rowShown);
    await omPage.locator("#proformas-table").screenshot({ path: path.join(SHOTS, "4-proforma-row.png") });

    // ---- details view ----
    await omPage.evaluate(() => {
      const row = [...document.querySelectorAll("#proformas-table .body.row")]
        .find(r => r.textContent.includes("VERIFY-PROFORMA-CUST"));
      row.querySelector("p").click();
    });
    await waitFor(async () => (await omPage.$("#details-title"))?.textContent === "Proforma Details", 10000);
    const details = await omPage.evaluate(() => ({
      title: document.getElementById("details-title").textContent,
      paymentHidden: document.getElementById("payment-history").classList.contains("hide"),
      editHidden: document.querySelector('.btn-container [data-cmd="edit"]').classList.contains("hide"),
      convertVisible: !document.querySelector('.btn-container [data-cmd="convert"]').classList.contains("hide")
    }));
    check("details: Proforma Details view", details.title === "Proforma Details" && details.paymentHidden && details.editHidden && details.convertVisible, JSON.stringify(details));
    await omPage.locator("#page-2").screenshot({ path: path.join(SHOTS, "5-proforma-details.png") });

    // ---- convert → sale page in new-from-proforma mode ----
    await omPage.evaluate(() => document.querySelector('.btn-container [data-cmd="convert"]').click());
    salePage = await app.waitForEvent("window", {
      predicate: p => p.url().includes("salePage.html"),
      timeout: 20000
    });
    salePage.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
    await salePage.waitForLoadState("domcontentloaded");
    await waitFor(async () => (await salePage.$('[data-name="name"]')) && (await salePage.$('[data-type="proceed"]')), 15000);

    // step 1 — customer prefilled, no Save-as-Order
    const convStep1 = await salePage.evaluate(() => ({
      name: document.querySelector('[data-name="name"]')?.value || "",
      saveOrderHidden: document.querySelector('footer [data-type="save-order"]')?.classList.contains("hide")
    }));
    check("convert: customer prefilled", convStep1.name === CUST, convStep1.name);
    check("convert: Save-as-Order hidden", convStep1.saveOrderHidden === true);
    await salePage.locator('[data-type="proceed"]').click();
    await waitFor(async () => await salePage.$("#bill-number-regular"), 10000);

    // step 2 — real bill number, regular type
    const convStep2 = await salePage.evaluate(() => ({
      billNo: document.querySelector('[data-name="billNo"]')?.value || "",
      billType: document.querySelector('input[data-name="billType"]:checked')?.value || "",
      billDate: document.querySelector('[data-name="billDate"]')?.value || ""
    }));
    check("convert: fresh numeric bill number", /^\d+$/.test(convStep2.billNo), convStep2.billNo);
    check("convert: bill type regular", convStep2.billType === "regular", convStep2.billType);
    await salePage.locator('[data-type="proceed"]').click();
    await waitFor(async () => await salePage.$("#add-item"), 10000);

    // step 3 — items prefilled
    const convItems = await salePage.evaluate(() => {
      const rows = [...document.querySelectorAll("#tbody .body.row:not(.row-control-div)")];
      return rows.map(r => ({
        name: r.querySelector("input[data-name='name']")?.value || "",
        qty: r.querySelector("input[data-name='qty']")?.value || "",
        rate: r.querySelector("input[data-name='standardSellPrice']")?.value || ""
      }));
    });
    check("convert: items prefilled (1 × 2 × 500)", convItems.length === 1 && convItems[0].name === ITEM && convItems[0].qty === "2" && convItems[0].rate === "500", JSON.stringify(convItems));
    await salePage.locator('[data-type="proceed"]').click();
    await waitFor(async () => await salePage.$("#summary-div"), 10000);
    await salePage.locator("#summary-div").screenshot({ path: path.join(SHOTS, "6-converted-summary.png") });

    // ---- save the real invoice ----
    const closed2 = salePage.waitForEvent("close", { timeout: 30000 }).catch(() => null);
    await salePage.locator('[data-type="save"]').click();
    check("convert: sale window closed after invoice save", !!(await closed2));
    salePage = null;

    // ---- quote gone, real sale exists ----
    const quoteGone = await waitFor(async () => !readProformas().some(o => o.name === CUST), 10000, 200);
    check("store: proforma removed after conversion", !!quoteGone, `remaining=${readProformas().length}`);
    // save_exit deletes the proforma entry before the sale row commits — poll the DB
    const realSale = await waitFor(async () => (await page.evaluate(async () => {
      const sales = await ipcRenderer.invoke("get-sales");
      return (Array.isArray(sales) ? sales : []).find(b => b.name === "VERIFY-PROFORMA-CUST") || null;
    })) || null, 10000, 300);
    check("sale: real invoice row in the DB", !!realSale, realSale && `billNo=${realSale.billNo} billType=${realSale.billType}`);
    check("sale: numeric billNo + regular type", !!realSale && /^\d+$/.test(String(realSale.billNo)) && realSale.billType === "regular", "");

    // ---- manager list refreshed: quote row gone, back on the list ----
    const rowGone = await waitFor(async () => omPage.evaluate(() =>
      document.getElementById("details-title") === null &&
      ![...document.querySelectorAll("#proformas-table .body.row")]
        .some(r => r.textContent.includes("VERIFY-PROFORMA-CUST"))), 15000);
    check("manager: converted quote leaves the list (back on page 1)", !!rowGone);

    // ---- renderer errors anywhere in the run ----
    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await app.close().catch(() => {});
    try { await restoreStore(); }
    catch (err) { console.error("STORE RESTORE FAILED:", err); }
    try { fs.rmSync(BACKUP, { recursive: true, force: true }); } catch (_) {}
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
