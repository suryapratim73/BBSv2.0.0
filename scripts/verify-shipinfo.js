/**
 * verify-shipinfo.js — live ship-to address manager run (Playwright _electron).
 *
 * Opens the Customer Portal through its real menu opener (Sale → Customer
 * Portal), picks the first customer, opens the Shipping Addresses modal, and
 * exercises the full flow: add a typo entry, fix it with Edit, remove a
 * second entry with the two-step Remove, save, then check the round-trip —
 * IPC persistence, the global customer cache (`get-customers`), and modal
 * hydration on reopen.
 *
 *   node scripts/verify-shipinfo.js
 *
 * APP_ENV=DEV. Side effect, fully restored: the chosen customer's shipInfos
 * (moreInfo.shipInfos) is snapshotted via IPC before the run and written
 * back after.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "shipinfo-shots");

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

// same shape the manager normalizes to, for expectation comparisons
const normEntry = e => ({
  name: String((e && e.name) ?? "").trim(),
  shipTo: String((e && e.shipTo) ?? "").trim(),
  shipAddr: String((e && e.shipAddr) ?? "").trim(),
  shipPh: String((e && e.shipPh) ?? "").trim(),
  shipGST: String((e && e.shipGST) ?? "").trim()
});
const entryEq = (a, b) => JSON.stringify(normEntry(a)) === JSON.stringify(normEntry(b));

const ADD_A = { name: "Verify ShipCo", shipTo: "Verify Typo", shipAddr: "1 Wrong Lane, Nowhere", shipPh: "9990000000", shipGST: "27ABCDE1234F1Z5" };
const FIX_A = { name: "Verify ShipCo", shipTo: "Verify Fixed", shipAddr: "1 Right Lane, Somewhere", shipPh: "9990000000", shipGST: "27ABCDE1234F1Z5" };
const ADD_B = { name: "Verify ShipCo 2", shipTo: "Verify Second", shipAddr: "2 Lane", shipPh: "8880000000", shipGST: "" };

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let portalPage = null;
  let shipBefore = [];
  let custId = null;
  let custName = null;

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
    portalPage.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
    await portalPage.waitForLoadState("domcontentloaded");
    const listReady = await waitFor(async () =>
      (await portalPage.$(".customer-div")) !== null, 20000);
    check("portal: window opened with customer list", !!listReady);
    if (!listReady) throw new Error("customer portal list missing");

    // ---- pick the first customer ----
    const pick = await portalPage.evaluate(() => {
      const target = customerList[0];
      if (!target) return null;
      const div = document.querySelector(`.customer-div[data-cust-id="${target.id}"]`);
      if (!div) return null;
      div.click();
      return { id: target.id, name: target.name };
    });
    check("portal: picked a customer", !!pick, pick ? pick.name : "none");
    if (!pick) throw new Error("no customer to test with");
    custId = pick.id;
    custName = pick.name;

    const btnVisible = await waitFor(async () =>
      (await portalPage.$("#btn-container [data-cmd='ship-info']")) !== null, 15000);
    check("portal: Shipping Addresses button on the bar", !!btnVisible);

    // ---- snapshot the customer's current shipInfos for restore ----
    shipBefore = await portalPage.evaluate(async id => (await ipcRenderer.invoke("get-ship-infos", id)) || [], custId);
    check("prep: shipInfos snapshot taken", Array.isArray(shipBefore), `entries=${shipBefore.length}`);

    // ---- open the modal ----
    await portalPage.locator("#btn-container [data-cmd='ship-info']").click();
    const modal = await waitFor(async () =>
      (await portalPage.$("#ship-info-modal .ship-info-form")) !== null, 10000);
    check("shipinfo: modal opens from the button", !!modal);
    if (!modal) throw new Error("ship-info modal missing");

    const opened = await portalPage.evaluate(() => {
      const form = document.querySelector("#ship-info-modal .ship-info-form");
      return {
        name: form.querySelector(".ship-info-name").textContent,
        rows: document.querySelectorAll("#ship-info-modal .ship-info-row").length,
        emptyHidden: form.querySelector(".ship-info-empty").hidden
      };
    });
    check("shipinfo: modal shows the customer name", opened.name === custName, opened.name);
    check("shipinfo: modal hydrates existing entries", opened.rows === shipBefore.length, `rows=${opened.rows} expected=${shipBefore.length}`);
    check("shipinfo: empty message matches list", shipBefore.length === 0 ? opened.emptyHidden === false : opened.emptyHidden === true, `emptyHidden=${opened.emptyHidden}`);

    // ---- add entry A (the typo we will fix later) ----
    await portalPage.evaluate(() => {
      document.querySelector("#ship-info-modal .ship-info-list-head button").click(); // "+ Add Address"
    });
    const editorShown = await portalPage.evaluate(() => {
      const e = document.querySelector("#ship-info-modal .ship-info-editor");
      return { hidden: e.hidden, title: document.querySelector("#ship-info-modal .ship-info-editor-title").textContent };
    });
    check("shipinfo: Add Address reveals the editor", editorShown.hidden === false && editorShown.title === "Add shipping address", JSON.stringify(editorShown));
    await portalPage.evaluate(a => {
      const e = document.querySelector("#ship-info-modal .ship-info-editor");
      e.querySelector("input[name='shipTo']").value = a.shipTo;
      e.querySelector("input[name='shipAddr']").value = a.shipAddr;
      e.querySelector("input[name='shipPh']").value = a.shipPh;
      e.querySelector("input[name='shipGST']").value = a.shipGST;
      [...document.querySelectorAll("#ship-info-modal .ship-info-editor-btns button")]
        .find(b => b.textContent.includes("Save entry")).click();
    }, ADD_A);
    const afterA = await portalPage.evaluate(() => ({
      rows: document.querySelectorAll("#ship-info-modal .ship-info-row").length,
      last: document.querySelector("#ship-info-modal .ship-info-row:last-child .ship-info-row-name")?.textContent
    }));
    check("shipinfo: new entry appears in the list", afterA.rows === shipBefore.length + 1 && afterA.last === ADD_A.shipTo, JSON.stringify(afterA));

    // ---- auto-save: add persists immediately (no Save button) ----
    const persistedAdd = await waitFor(async () =>
      await portalPage.evaluate(async (arg) => {
        const infos = (await ipcRenderer.invoke("get-ship-infos", arg.id)) || [];
        const last = infos[infos.length - 1];
        if (infos.length !== arg.n + 1) return null;
        if (!last || last.shipTo !== arg.shipTo || last.shipAddr !== arg.shipAddr || last.shipPh !== arg.shipPh || last.shipGST !== arg.shipGST || last.name !== arg.name) return null;
        return { len: infos.length, last };
      }, { id: custId, n: shipBefore.length, ...ADD_A, name: String(custName) }), 15000);
    check("shipinfo: add auto-saves immediately (no Save button)", !!persistedAdd, JSON.stringify(persistedAdd).slice(0, 220));

    // ---- add entry B (removed later) ----
    await portalPage.evaluate(() => {
      document.querySelector("#ship-info-modal .ship-info-list-head button").click(); // "+ Add Address"
    });
    await portalPage.evaluate(b => {
      const e = document.querySelector("#ship-info-modal .ship-info-editor");
      e.querySelector("input[name='shipTo']").value = b.shipTo;
      e.querySelector("input[name='shipAddr']").value = b.shipAddr;
      e.querySelector("input[name='shipPh']").value = b.shipPh;
      e.querySelector("input[name='shipGST']").value = b.shipGST;
      [...document.querySelectorAll("#ship-info-modal .ship-info-editor-btns button")]
        .find(x => x.textContent.includes("Save entry")).click();
    }, ADD_B);
    const afterB = await portalPage.evaluate(() =>
      document.querySelectorAll("#ship-info-modal .ship-info-row").length);
    check("shipinfo: second entry added", afterB === shipBefore.length + 2, `rows=${afterB}`);

    // ---- edit entry A (fix the typo) ----
    await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      rows[n].querySelectorAll("button")[0].click(); // Edit
    }, shipBefore.length);
    const editHyd = await portalPage.evaluate(() => {
      const e = document.querySelector("#ship-info-modal .ship-info-editor");
      return {
        hidden: e.hidden,
        title: document.querySelector("#ship-info-modal .ship-info-editor-title").textContent,
        shipTo: e.querySelector("input[name='shipTo']").value,
        shipAddr: e.querySelector("input[name='shipAddr']").value,
        shipPh: e.querySelector("input[name='shipPh']").value,
        shipGST: e.querySelector("input[name='shipGST']").value
      };
    });
    check("shipinfo: Edit fills the editor with the row's values", !editHyd.hidden && editHyd.title === "Edit shipping address" && editHyd.shipTo === ADD_A.shipTo && editHyd.shipAddr === ADD_A.shipAddr && editHyd.shipPh === ADD_A.shipPh && editHyd.shipGST === ADD_A.shipGST, JSON.stringify(editHyd));
    await portalPage.evaluate(f => {
      const e = document.querySelector("#ship-info-modal .ship-info-editor");
      e.querySelector("input[name='shipTo']").value = f.shipTo;
      e.querySelector("input[name='shipAddr']").value = f.shipAddr;
      [...document.querySelectorAll("#ship-info-modal .ship-info-editor-btns button")]
        .find(x => x.textContent.includes("Save entry")).click();
    }, FIX_A);
    const afterEdit = await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      return { rows: rows.length, name: rows[n].querySelector(".ship-info-row-name").textContent, sub: rows[n].querySelector(".ship-info-row-sub")?.textContent ?? "" };
    }, shipBefore.length);
    check("shipinfo: edit updates the row in place", afterEdit.rows === shipBefore.length + 2 && afterEdit.name === FIX_A.shipTo && afterEdit.sub.includes(FIX_A.shipAddr), JSON.stringify(afterEdit));
    await portalPage.screenshot({ path: path.join(SHOTS, "1-modal-after-edit.png") });

    // ---- auto-save: edit persists immediately ----
    const persistedEdit = await waitFor(async () =>
      await portalPage.evaluate(async (arg) => {
        const infos = (await ipcRenderer.invoke("get-ship-infos", arg.id)) || [];
        const entry = infos[arg.n];
        if (!entry || entry.shipTo !== arg.shipTo || entry.shipAddr !== arg.shipAddr) return null;
        return { shipTo: entry.shipTo, shipAddr: entry.shipAddr };
      }, { id: custId, n: shipBefore.length, shipTo: FIX_A.shipTo, shipAddr: FIX_A.shipAddr }), 15000);
    check("shipinfo: edit auto-saves immediately", !!persistedEdit, JSON.stringify(persistedEdit));

    // ---- remove entry B with the two-step button ----
    await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      rows[n].querySelectorAll("button")[1].click(); // Remove (arms)
    }, shipBefore.length + 1);
    const armed = await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      const btn = rows[n].querySelectorAll("button")[1];
      return { text: btn.textContent, armed: btn.dataset.armed };
    }, shipBefore.length + 1);
    check("shipinfo: Remove is two-step (arms first)", armed.armed === "1" && armed.text === "Sure?", JSON.stringify(armed));
    await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      rows[n].querySelectorAll("button")[1].click(); // Remove (confirm)
    }, shipBefore.length + 1);
    const afterRemove = await portalPage.evaluate(() => ({
      rows: document.querySelectorAll("#ship-info-modal .ship-info-row").length,
      names: [...document.querySelectorAll("#ship-info-modal .ship-info-row-name")].map(p => p.textContent)
    }));
    check("shipinfo: confirmed remove deletes the row", afterRemove.rows === shipBefore.length + 1 && !afterRemove.names.includes(ADD_B.shipTo), JSON.stringify(afterRemove));
    await portalPage.screenshot({ path: path.join(SHOTS, "2-modal-after-remove.png") });

    // ---- auto-save: remove persists immediately ----
    const persistedRemove = await waitFor(async () =>
      await portalPage.evaluate(async (arg) => {
        const infos = (await ipcRenderer.invoke("get-ship-infos", arg.id)) || [];
        if (infos.length !== arg.n + 1) return null;
        if (infos.some(i => i.shipTo === arg.gone)) return null;
        return { len: infos.length, names: infos.map(i => i.shipTo) };
      }, { id: custId, n: shipBefore.length, gone: ADD_B.shipTo }), 15000);
    check("shipinfo: remove auto-saves immediately", !!persistedRemove, JSON.stringify(persistedRemove));

    // ---- no Save/Cancel footer — every change already auto-saved ----
    const noFooter = await portalPage.evaluate(() => {
      const form = document.querySelector("#ship-info-modal .ship-info-form");
      return ![...form.children].some(c => c.classList.contains("btn-container"));
    });
    check("shipinfo: modal has no Save/Cancel footer (auto-save on change)", noFooter === true);

    // ---- persisted via IPC ----
    const saved = await portalPage.evaluate(async id => (await ipcRenderer.invoke("get-ship-infos", id)) || [], custId);
    // modal-created entries carry `name` = the customer's name (mirrors saleHandler)
    const expected = [...shipBefore.map(normEntry), { ...normEntry(FIX_A), name: String(custName) }];
    const persisted = Array.isArray(saved) && saved.length === expected.length &&
      expected.every((e, i) => entryEq(saved[i], e));
    check("shipinfo: final list persisted via IPC", persisted, JSON.stringify(saved).slice(0, 300));

    // ---- global customer cache (get-customers) is fresh ----
    const cacheOk = await page.evaluate(async (arg) => {
      const list = await ipcRenderer.invoke("get-customers");
      const c = (list || []).find(x => String(x.id) === String(arg.id));
      if (!c) return false;
      let mi = c.moreInfo;
      if (typeof mi === "string") { try { mi = JSON.parse(mi); } catch (_) { return false; } }
      if (!mi || !Array.isArray(mi.shipInfos)) return false;
      return mi.shipInfos.length === arg.expLen && mi.shipInfos[arg.expLen - 1].shipTo === arg.lastShipTo;
    }, { id: custId, expLen: expected.length, lastShipTo: FIX_A.shipTo });
    check("shipinfo: global customer cache refreshed", cacheOk === true);

    // ---- close (cover click in real use) before the reopen check ----
    await portalPage.evaluate(() => closeModal());
    await waitFor(async () => (await portalPage.$("#ship-info-modal")) === null, 10000);

    // ---- reopen → hydration round-trip ----
    await portalPage.locator("#btn-container [data-cmd='ship-info']").click();
    await waitFor(async () => (await portalPage.$("#ship-info-modal .ship-info-form")) !== null, 10000);
    const hydrated = await portalPage.evaluate(n => {
      const rows = [...document.querySelectorAll("#ship-info-modal .ship-info-row")];
      return {
        rows: rows.length,
        fixedRow: rows[n] ? rows[n].querySelector(".ship-info-row-name").textContent : null
      };
    }, shipBefore.length);
    check("shipinfo: reopen hydrates the saved list", hydrated.rows === expected.length && hydrated.fixedRow === FIX_A.shipTo, JSON.stringify(hydrated));
    await portalPage.screenshot({ path: path.join(SHOTS, "3-modal-reopened.png") });
    await portalPage.evaluate(() => closeModal());

    // ---- portal errors so far ----
    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    // restore the customer's original shipInfos through the app (if we got one)
    if (portalPage && !portalPage.isClosed()) {
      await portalPage.evaluate(async (arg) => {
        await ipcRenderer.invoke("set-ship-infos", arg.id, arg.shipInfos);
      }, { id: custId, shipInfos: shipBefore }).catch(() => {});
    }
    await app.close().catch(() => {});
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
