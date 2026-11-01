/**
 * verify-overview.js — live Overview merge run (Playwright _electron).
 * Drives the real app through the merged recipe-driven dashboard:
 *   default 3-band layout → widget rendering (cards, combined graph, order
 *   table pagination, scheduler carousel, file-monitor queue, cloud usage) →
 *   customize editor → save + re-render round-trip → restore default.
 *
 *   node scripts/verify-overview.js
 *
 * APP_ENV=DEV. The run saves a temporary recipe into config/overviewRecipe.json,
 * so that file is snapshotted before the run and restored afterwards. No DB
 * writes happen — the Overview page is read-only.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "overview-shots");
const BACKUP = path.join(ROOT, "test-results", "overview-backup");
const RECIPE_JSON = path.join(ROOT, "config", "overviewRecipe.json");

const DEFAULT_RECIPE = {
  version: 1,
  rows: [
    { row: 1, cells: [{ col: "full", widgets: ["cloud-usage"] }] },
    {
      row: 2,
      cells: [
        { col: "left", widgets: ["net-turnover", "net-purchase"] },
        { col: "right", widgets: ["sale-purchase-graph"] }
      ]
    },
    {
      row: 3,
      cells: [
        { col: "left", widgets: ["order-table"] },
        { col: "right", widgets: ["scheduler"] }
      ]
    }
  ]
};

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

// snapshot / restore the recipe file only (the run is read-only otherwise)
function snapshotRecipe() {
  fs.rmSync(BACKUP, { recursive: true, force: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  if (fs.existsSync(RECIPE_JSON)) fs.cpSync(RECIPE_JSON, path.join(BACKUP, "overviewRecipe.json"));
}
// idempotent — the failure path calls this from BOTH the catch and the
// finally block; a second call must never delete a just-restored user recipe
let recipeRestored = false;
function restoreRecipe() {
  if (recipeRestored) return;
  recipeRestored = true;
  const src = path.join(BACKUP, "overviewRecipe.json");
  if (fs.existsSync(src)) fs.cpSync(src, RECIPE_JSON);
  else fs.rmSync(RECIPE_JSON, { force: true });
  fs.rmSync(BACKUP, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  snapshotRecipe();

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

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
    // dismiss any leftover overlays once more after login
    await page.evaluate(() => {
      document.getElementById("tour-overlay")?.remove();
      document.getElementById("update-prompt-overlay")?.remove();
      const later = document.getElementById("bp-btn-later");
      if (later && later.offsetParent !== null) later.click();
    });

    // ---- overview renders ----
    const overviewReady = await waitFor(async () =>
      (await page.$("#overview-div .ov-band")) !== null, 20000);
    check("overview: bands rendered", !!overviewReady);
    if (!overviewReady) {
      const dump = await page.evaluate(() => (document.getElementById("overview-div")?.innerHTML || "no overview-div").slice(0, 400));
      check("overview: bands rendered (dump)", false, dump);
      throw new Error("overview bands missing");
    }

    // ---- nav ----
    const nav = await page.evaluate(() => ({
      sale: !!document.querySelector('#nav-div [data-cmd="sale"]'),
      purchase: !!document.querySelector('#nav-div [data-cmd="purchase"]'),
      overview: !!document.querySelector('#nav-div [data-cmd="overview"]'),
      cloud: !!document.querySelector('#nav-div [data-cmd="cloud"]'),
      scheduler: !!document.querySelector('#nav-div [data-cmd="scheduler"]')
    }));
    check("nav: Sale and Purchase items removed", !nav.sale && !nav.purchase, JSON.stringify(nav));
    check("nav: Overview/Cloud/Scheduler remain", nav.overview && nav.cloud && nav.scheduler);

    // ---- default recipe IPC ----
    const recipe = await page.evaluate(async () => await ipcRenderer.invoke("get-overview-recipe"));
    check("recipe: IPC returns a valid recipe", recipe && recipe.recipe && Array.isArray(recipe.recipe.rows) && recipe.recipe.rows.length >= 1, JSON.stringify(recipe).slice(0, 200));

    // ---- pin the default layout for the run (the user may have their own
    // recipe saved — the on-disk file is snapshotted and restored anyway) ----
    const pinned = await page.evaluate(async (recipe) => {
      const res = await ipcRenderer.invoke("save-overview-recipe", recipe);
      return res && res.ok;
    }, DEFAULT_RECIPE);
    check("layout: default recipe pinned for the run", pinned === true);
    await page.evaluate(() => window.renderOverviewPage());
    const pinnedBack = await waitFor(async () => {
      const widgets = await page.evaluate(() => {
        const band = document.querySelector('.ov-band[data-row="1"]');
        return band ? [...band.querySelectorAll('[data-col="full"] .ov-widget')].map(w => w.dataset.widget) : [];
      });
      return JSON.stringify(widgets) === JSON.stringify(["cloud-usage"]) ? widgets : null;
    }, 10000, 200);
    check("layout: pinned default renders", !!pinnedBack, JSON.stringify(pinnedBack));

    // ---- default layout in the DOM ----
    const layout = await page.evaluate(() => {
      const band = i => document.querySelector(`.ov-band[data-row="${i}"]`);
      const widgetsIn = (bandEl, col) => bandEl
        ? [...bandEl.querySelectorAll(`.ov-cell[data-col="${col}"] .ov-widget`)].map(w => w.dataset.widget)
        : [];
      return {
        band1full: widgetsIn(band(1), "full"),
        band2left: widgetsIn(band(2), "left"),
        band2right: widgetsIn(band(2), "right"),
        band3left: widgetsIn(band(3), "left"),
        band3right: widgetsIn(band(3), "right"),
        bands: document.querySelectorAll(".ov-band").length
      };
    });
    check("layout: 3 bands", layout.bands === 3, String(layout.bands));
    check("layout: row 1 full = cloud-usage", JSON.stringify(layout.band1full) === JSON.stringify(["cloud-usage"]), JSON.stringify(layout.band1full));
    check("layout: row 2 left = net-turnover + net-purchase", JSON.stringify(layout.band2left) === JSON.stringify(["net-turnover", "net-purchase"]), JSON.stringify(layout.band2left));
    check("layout: row 2 right = sale-purchase-graph", JSON.stringify(layout.band2right) === JSON.stringify(["sale-purchase-graph"]), JSON.stringify(layout.band2right));
    check("layout: row 3 left = order-table", JSON.stringify(layout.band3left) === JSON.stringify(["order-table"]), JSON.stringify(layout.band3left));
    check("layout: row 3 right = scheduler", JSON.stringify(layout.band3right) === JSON.stringify(["scheduler"]), JSON.stringify(layout.band3right));
    await page.locator("#overview-div").screenshot({ path: path.join(SHOTS, "1-default-layout.png") });

    // ---- cards (default layout mounts net-turnover + net-purchase) ----
    const cards = await page.evaluate(() => {
      const text = wid => document.querySelector(`.ov-widget[data-widget="${wid}"] .ov-card-value`)?.textContent || "";
      return { turnover: text("net-turnover"), purchase: text("net-purchase") };
    });
    check("cards: default cards formatted", Object.values(cards).every(v => /^Rs\. [\d,]+$/.test(v)), JSON.stringify(cards));

    // ---- combined chart ----
    const chart = await page.evaluate(() => {
      const canvas = document.querySelector('.ov-widget[data-widget="sale-purchase-graph"] canvas');
      if (!canvas) return { width: 0, drawn: false };
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted++;
      return { width: canvas.width, drawn: painted > 100 };
    });
    check("chart: canvas sized and painted", chart.width > 0 && chart.drawn, JSON.stringify(chart));

    // ---- order table pagination ----
    const orders = await page.evaluate(async () => (await ipcRenderer.invoke("get-orders")) || []);
    const pager = await page.evaluate(() => {
      const w = document.querySelector('.ov-widget[data-widget="order-table"]');
      return {
        rows: w.querySelectorAll(".tbody .body.row").length,
        info: w.querySelector(".ov-page-info")?.textContent || "",
        prevDisabled: w.querySelector('[data-cmd="prev"]')?.disabled,
        nextDisabled: w.querySelector('[data-cmd="next"]')?.disabled
      };
    });
    check("orders: page shows ≤ 5 rows", pager.rows <= 5, `${pager.rows} rows of ${orders.length} orders`);
    check("orders: pager info present", pager.info.length > 0, pager.info);
    if (orders.length > 5) {
      check("orders: next enabled", pager.nextDisabled === false);
      await page.evaluate(() => document.querySelector('.ov-widget[data-widget="order-table"] [data-cmd="next"]').click());
      const page2 = await waitFor(async () => (await page.evaluate(() =>
        document.querySelector('.ov-widget[data-widget="order-table"] .ov-page-info')?.textContent || "")) !== pager.info, 5000, 150);
      check("orders: next page advances", !!page2);
    } else {
      check("orders: next disabled at last page", pager.nextDisabled === true, `prev=${pager.prevDisabled} next=${pager.nextDisabled}`);
    }

    // ---- scheduler widget ----
    const sched = await page.evaluate(() => {
      const w = document.querySelector('.ov-widget[data-widget="scheduler"]');
      return {
        div: !!w.querySelector("#scheduler-div"),
        date: w.querySelector("#dt-div h1")?.textContent || "",
        month: w.querySelector("#dt-div p")?.textContent || ""
      };
    });
    check("scheduler: widget mounted with date header", sched.div && /^\d{1,2}$/.test(sched.date) && sched.month.length > 0, JSON.stringify(sched));

    // ---- cloud usage widget ----
    const cloud = await page.evaluate(async () => {
      const w = document.querySelector('.ov-widget[data-widget="cloud-usage"]');
      const usage = await ipcRenderer.invoke("get-cloud-usage");
      return {
        credit: w.querySelector('[data-field="credit"]')?.textContent || "",
        emails: w.querySelector('[data-field="emails"]')?.textContent || "",
        note: w.querySelector(".ov-cloud-note")?.textContent || "",
        usageOk: usage && typeof usage.ok === "boolean"
      };
    });
    check("cloud: widget shows balance + emails fields", cloud.credit.length > 0 && cloud.emails.length > 0, JSON.stringify({ credit: cloud.credit, emails: cloud.emails }));
    check("cloud: usage IPC answers (ok or error)", cloud.usageOk, cloud.note);

    // ---- widget-data IPC ----
    const wd = await page.evaluate(async () => await ipcRenderer.invoke("get-overview-widget-data"));
    check("widget-data: IPC returns numeric aggregates", wd && wd.ok === true &&
      [wd.monthSale, wd.yearSale, wd.netTurnover, wd.netPurchase].every(v => typeof v === "number") &&
      Array.isArray(wd.saleObjs) && Array.isArray(wd.purchaseObjs), wd && JSON.stringify({ monthSale: wd.monthSale, yearSale: wd.yearSale, netTurnover: wd.netTurnover, netPurchase: wd.netPurchase }));

    // ---- customize → save → re-render round-trip ----
    // New layout: row 1 full = file-monitor; row 2 left stacks all four cards;
    // rows 2-right and 3 stay untouched. This mounts the widgets that the
    // default layout omits (file-monitor, monthly/yearly cards) so they can
    // be verified too.
    await page.evaluate(() => document.querySelector('.ov-toolbar [data-cmd="ov-customize"]').click());
    const editor = await waitFor(async () => (await page.$(".ov-band-editor")) !== null, 8000);
    check("customize: editor opens with 3 band editors", !!editor && (await page.evaluate(() => document.querySelectorAll(".ov-band-editor").length)) === 3);

    // row 1: keep full width, swap cloud-usage → file-monitor
    await page.evaluate(() => {
      const band = document.querySelector('.ov-band-editor[data-row="1"]');
      const sel = band.querySelector('[data-slot="full"] select');
      sel.value = "file-monitor";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // row 2 left: stack monthly-sale + yearly-sale onto the existing cards
    await page.evaluate(() => {
      const band = document.querySelector('.ov-band-editor[data-row="2"]');
      const left = band.querySelector('[data-slot="left"]');
      left.querySelector(".ov-add-btn").click();
      left.querySelector(".ov-add-btn").click();
    });
    await page.evaluate(() => {
      const band = document.querySelector('.ov-band-editor[data-row="2"]');
      const sels = [...band.querySelectorAll('[data-slot="left"] select')];
      sels[sels.length - 2].value = "monthly-sale";
      sels[sels.length - 2].dispatchEvent(new Event("change", { bubbles: true }));
      sels[sels.length - 1].value = "yearly-sale";
      sels[sels.length - 1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator(".ov-customize-bar").screenshot({ path: path.join(SHOTS, "2-customize-editor.png") });
    await page.evaluate(() => document.querySelector('[data-cmd="ov-customize-save"]').click());

    const savedRecipe = await waitFor(async () => {
      const r = await page.evaluate(async () => await ipcRenderer.invoke("get-overview-recipe"));
      const rows = r && r.recipe && r.recipe.rows;
      const row1 = rows && rows.find(row => row.row === 1);
      const row2 = rows && rows.find(row => row.row === 2);
      return row1 && row1.cells.some(c => c.col === "full" && c.widgets[0] === "file-monitor") &&
        row2 && row2.cells.some(c => c.col === "left" && JSON.stringify(c.widgets) === JSON.stringify(["net-turnover", "net-purchase", "monthly-sale", "yearly-sale"]))
        ? r.recipe : null;
    }, 8000, 200);
    check("customize: saved recipe persisted", !!savedRecipe, savedRecipe && JSON.stringify(savedRecipe.rows.slice(0, 2)));
    check("customize: saved recipe keeps row 2-right and row 3 intact",
      !!savedRecipe &&
      JSON.stringify(savedRecipe.rows.find(r => r.row === 2).cells.find(c => c.col === "right").widgets) === JSON.stringify(["sale-purchase-graph"]) &&
      JSON.stringify(savedRecipe.rows.find(r => r.row === 3).cells.map(c => c.widgets)) === JSON.stringify([["order-table"], ["scheduler"]]));

    // re-rendered with the new layout
    const relayout = await waitFor(async () => {
      const l = await page.evaluate(() => {
        const band = i => document.querySelector(`.ov-band[data-row="${i}"]`);
        const widgetsIn = (bandEl, col) => bandEl
          ? [...bandEl.querySelectorAll(`.ov-cell[data-col="${col}"] .ov-widget`)].map(w => w.dataset.widget)
          : [];
        return {
          row1full: widgetsIn(band(1), "full"),
          row2left: widgetsIn(band(2), "left")
        };
      });
      return JSON.stringify(l.row1full) === JSON.stringify(["file-monitor"]) &&
        JSON.stringify(l.row2left) === JSON.stringify(["net-turnover", "net-purchase", "monthly-sale", "yearly-sale"]) ? l : null;
    }, 8000, 200);
    check("customize: page re-rendered with new layout", !!relayout, JSON.stringify(relayout));
    await page.locator("#overview-div").screenshot({ path: path.join(SHOTS, "3-relayout.png") });

    // ---- file-monitor widget (mounted by the customize round-trip) ----
    const fm = await page.evaluate(async () => {
      const w = document.querySelector('.ov-widget[data-widget="file-monitor"]');
      const queue = await ipcRenderer.invoke("get-file-monitor-queue");
      const rejected = await ipcRenderer.invoke("file-monitor-remove-invoice", "C:\\Windows\\notepad.exe");
      return {
        head: !!w.querySelector("h3"),
        rows: w.querySelectorAll(".ov-fm-row").length,
        emptyNote: w.querySelector(".ov-fm-empty")?.textContent || "",
        listRenders: (queue || []).length > 0 ? w.querySelectorAll(".ov-fm-row").length === queue.length : w.querySelector(".ov-fm-empty") !== null,
        rejectOk: rejected && rejected.ok === false
      };
    });
    check("file-monitor: widget renders the queue", fm.head && fm.listRenders, `rows=${fm.rows} note="${fm.emptyNote}"`);
    check("file-monitor: outside-bills path rejected", fm.rejectOk === true);

    // ---- all four cards (monthly/yearly mounted by the round-trip) ----
    const allCards = await page.evaluate(() => {
      const text = wid => document.querySelector(`.ov-widget[data-widget="${wid}"] .ov-card-value`)?.textContent || "";
      return { monthly: text("monthly-sale"), yearly: text("yearly-sale"), turnover: text("net-turnover"), purchase: text("net-purchase") };
    });
    check("cards: all four formatted", Object.values(allCards).every(v => /^Rs\. [\d,]+$/.test(v)), JSON.stringify(allCards));

    // ---- row bands: add / remove / 1-band minimum ----
    await page.evaluate(() => document.querySelector('.ov-toolbar [data-cmd="ov-customize"]').click());
    const reopened = await waitFor(async () => await page.$(".ov-band-editor"), 8000);
    check("rows: customize reopens", !!reopened);

    // remove row 2 → rows 1 and 3 remain, renumbered to Row 1 / Row 2
    await page.evaluate(() => document.querySelector('.ov-band-editor[data-row="2"] .ov-row-remove').click());
    const afterRemove = await page.evaluate(() => ({
      count: document.querySelectorAll(".ov-band-editor").length,
      heads: [...document.querySelectorAll(".ov-band-editor-head p")].map(p => p.textContent),
      rowIds: [...document.querySelectorAll(".ov-band-editor")].map(b => b.dataset.row),
      disabled: [...document.querySelectorAll(".ov-row-remove")].map(b => b.disabled)
    }));
    check("rows: removing a band keeps 2 and renumbers", afterRemove.count === 2 &&
      JSON.stringify(afterRemove.heads) === JSON.stringify(["Row 1", "Row 2"]) &&
      JSON.stringify(afterRemove.rowIds) === JSON.stringify(["1", "2"]), JSON.stringify(afterRemove));
    check("rows: remove buttons enabled with 2 bands", afterRemove.disabled.every(d => d === false));

    // remove again → 1 band, its remove button disabled (the minimum)
    await page.evaluate(() => document.querySelector(".ov-band-editor .ov-row-remove").click());
    const oneBand = await page.evaluate(() => ({
      count: document.querySelectorAll(".ov-band-editor").length,
      disabled: document.querySelector(".ov-row-remove")?.disabled
    }));
    check("rows: cannot remove the last band", oneBand.count === 1 && oneBand.disabled === true, JSON.stringify(oneBand));

    // add rows back — new bands start empty
    await page.evaluate(() => document.querySelector('[data-cmd="ov-add-row"]').click());
    const twoBands = await page.evaluate(() => {
      const bands = [...document.querySelectorAll(".ov-band-editor")];
      const added = bands[bands.length - 1];
      return {
        count: bands.length,
        addedEmpty: added.querySelectorAll("select").length === 3 &&
          [...added.querySelectorAll("select")].every(s => s.value === ""),
        disabled: [...document.querySelectorAll(".ov-row-remove")].map(b => b.disabled)
      };
    });
    check("rows: add row appends an empty band", twoBands.count === 2 && twoBands.addedEmpty, JSON.stringify(twoBands));
    check("rows: remove buttons re-enabled", twoBands.disabled.every(d => d === false));
    await page.evaluate(() => document.querySelector('[data-cmd="ov-add-row"]').click());
    check("rows: add row again → 3 bands", (await page.evaluate(() => document.querySelectorAll(".ov-band-editor").length)) === 3);
    await page.locator("#overview-div").screenshot({ path: path.join(SHOTS, "4-band-editor.png") });

    // cancel discards the band edits — the saved round-trip layout stays
    await page.evaluate(() => document.querySelector('[data-cmd="ov-customize-cancel"]').click());
    const cancelBack = await waitFor(async () => {
      const l = await page.evaluate(() => {
        const band = document.querySelector('.ov-band[data-row="1"]');
        return band ? [...band.querySelectorAll('[data-col="full"] .ov-widget')].map(w => w.dataset.widget) : [];
      });
      return JSON.stringify(l) === JSON.stringify(["file-monitor"]) ? l : null;
    }, 8000, 200);
    check("rows: cancel re-renders the saved layout", !!cancelBack, JSON.stringify(cancelBack));

    // ---- restore the default recipe through the app's save IPC ----
    const restored = await page.evaluate(async (recipe) => {
      const res = await ipcRenderer.invoke("save-overview-recipe", recipe);
      return res && res.ok;
    }, DEFAULT_RECIPE);
    check("customize: default recipe restored via save IPC", restored === true);
    const backToDefault = await waitFor(async () => {
      const r = await page.evaluate(async () => await ipcRenderer.invoke("get-overview-recipe"));
      const row1 = r && r.recipe && r.recipe.rows.find(row => row.row === 1);
      return row1 && row1.cells[0] && row1.cells[0].col === "full" && row1.cells[0].widgets[0] === "cloud-usage" ? r : null;
    }, 8000, 200);
    check("customize: saved default verified", !!backToDefault);
    // and the page renders it again on demand
    await page.evaluate(() => window.renderOverviewPage());
    const defaultAgain = await waitFor(async () => {
      const l = await page.evaluate(() => {
        const band = document.querySelector('.ov-band[data-row="1"]');
        const widgetsIn = col => band ? [...band.querySelectorAll(`.ov-cell[data-col="${col}"] .ov-widget`)].map(w => w.dataset.widget) : [];
        return widgetsIn("full");
      });
      return JSON.stringify(l) === JSON.stringify(["cloud-usage"]) ? l : null;
    }, 8000, 200);
    check("customize: default layout renders again", !!defaultAgain, JSON.stringify(defaultAgain));

    // ---- renderer errors anywhere in the run ----
    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await app.close().catch(() => {});
    restoreRecipe();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => {
  console.error("VERIFY FAILED:", err);
  console.error("renderer errors so far:", pageErrors.slice(0, 5));
  restoreRecipe();
  process.exit(1);
});
