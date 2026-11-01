/**
 * verify-tooltip.js — live check of the shared JS hover tooltip (Playwright _electron).
 *
 * The old .hover::before popups were clipped by overflow containers and trapped
 * in stacking contexts; the new system is one fixed body-level #hover-tooltip
 * driven by delegated listeners in template/js/common.js. Checks:
 *   - mainPage: status-bar item (.top.right → popup ABOVE the bar, which used
 *     to be clipped by #app-status-bar overflow:hidden), dashboard buttons
 *     (.bottom → below, used to clip at the card edge), notification Clear.
 *   - checkOutPayments: filter + dropdown buttons (used to anchor all popups
 *     to the #filter box — now each popup sits at its own button).
 *   - attendaceModal: injected trigger (the mechanism, independent of data).
 *   - billLayout designer: opts out (data-hover-tooltip="off") — its tuned
 *     ::before popups still show via the scoped legacy CSS.
 * Every popup must be fully inside the window.
 *
 *   node scripts/verify-tooltip.js
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "tooltip-shots");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Bounding boxes of the trigger and the tooltip, plus viewport size. */
async function boxes(page, triggerSelector) {
  return page.evaluate(sel => {
    const t = document.querySelector(sel);
    const tip = document.getElementById("hover-tooltip");
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      trigger: t ? rect(t) : null,
      tip: tip ? rect(tip) : null,
      text: tip ? tip.textContent : null,
      shown: !!(tip && tip.classList.contains("visible")),
      vw: window.innerWidth,
      vh: window.innerHeight
    };
  }, triggerSelector);
}

function insideWindow(b, pad = 1) {
  return b.tip
    && b.tip.x >= -pad && b.tip.y >= -pad
    && b.tip.x + b.tip.w <= b.vw + pad
    && b.tip.y + b.tip.h <= b.vh + pad;
}

async function hoverAndCheck(page, shotName, triggerSelector, expectedText, placement, name) {
  const btn = await page.$(triggerSelector);
  if (!btn) { check(name, false, "trigger not found: " + triggerSelector); return false; }
  await page.hover(triggerSelector);
  await page.waitForTimeout(250);
  const b = await boxes(page, triggerSelector);
  // the tooltip must echo the trigger's CURRENT data-msg (status-bar messages
  // are dynamic — zen/weather state is persisted) and sit fully in-window
  const liveMsg = await page.evaluate(sel => {
    const t = document.querySelector(sel);
    return t ? (t.getAttribute("data-msg") || "").trim() : null;
  }, triggerSelector);
  const expectMsg = expectedText !== null ? expectedText : liveMsg;
  let ok = b.shown && b.trigger && b.tip && b.text === expectMsg && insideWindow(b);
  if (ok && placement) ok = placement(b);
  check(name, !!ok, ok ? "" : JSON.stringify({ ...b, liveMsg }));
  await page.screenshot({ path: path.join(SHOTS, shotName) });
  return !!ok;
}

async function openWindow(app, file) {
  const filePath = path.join(ROOT, "template", "html", file);
  await app.evaluate(({ BrowserWindow }, f) => {
    const w = new BrowserWindow({
      width: 1100,
      height: 750,
      show: true,
      webPreferences: { nodeIntegration: true, devTools: true, contextIsolation: false }
    });
    w.loadFile(f);
  }, filePath);
  await sleep(2500);
  const page = (await app.windows()).find(p => p.url().includes(file));
  return page;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

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

    // ---- mainPage: status bar (popup ABOVE the bar — was clipped entirely) ----
    await hoverAndCheck(page, "1-status-bar.png", "#zen-status", null, b =>
      b.tip.y + b.tip.h <= b.trigger.y, "status bar: tooltip above trigger, fully visible");

    // ---- mainPage: dashboard buttons (popup below — used to clip at the card edge) ----
    await hoverAndCheck(page, "2-dashboard.png", "#sale-purchase-btn-div>button[data-msg='Register a new purchase']",
      null, b => b.tip.y >= b.trigger.y + b.trigger.h - 1,
      "dashboard: Register Purchase tooltip below trigger, fully visible");

    // ---- mainPage: notification Clear (.left → aligns to trigger's left edge) ----
    // the panel is a collapsed 0-width drawer by default — its children sit
    // under the sidebar, so expand it first (same click a user makes)
    await page.click("#knob");
    await page.waitForTimeout(400);
    await hoverAndCheck(page, "3-clear.png", "#notification-div + .btn-div [data-msg='Clear all notifications'], .btn-div [data-msg='Clear all notifications']",
      null,
      // the Clear button sits at the far right of the expanded drawer, so a
      // left-aligned tip would overflow and the viewport clamp must pull it
      // back in (strict left-alignment is proven on the mid-window injected
      // trigger in attendaceModal)
      b => b.tip.x + b.tip.w >= b.vw - 9,
      "notification panel: Clear tooltip visible, clamped inside the right edge");

    // ---- checkOutPayments: dropdown buttons anchor to their own button ----
    const copPage = await openWindow(app, "checkOutPayments.html");
    if (!copPage) {
      check("checkOutPayments: window opened", false);
    } else {
      copPage.on("pageerror", err => pageErrors.push("checkOutPayments: " + String((err && err.stack) || err)));
      await hoverAndCheck(copPage, "4-outpayments-filter.png", "#filter-btn", null,
        b => b.tip.y >= b.trigger.y + b.trigger.h - 1, "checkOutPayments: filter button tooltip below, fully visible");
      await copPage.evaluate(() => document.getElementById("filter").classList.remove("hide"));
      const monthBtn = await copPage.$('#filter button[data-time="1"]');
      if (!monthBtn) {
        check("checkOutPayments: dropdown shown", false);
      } else {
        await monthBtn.hover();
        await copPage.waitForTimeout(250);
        const b = await boxes(copPage, '#filter button[data-time="1"]');
        // the popup must straddle ITS OWN button horizontally (old CSS put all
        // popups at the dropdown's bottom-left, far from the buttons)
        const nearOwn = b.shown && insideWindow(b)
          && b.tip.x + b.tip.w / 2 >= b.trigger.x && b.tip.x + b.tip.w / 2 <= b.trigger.x + b.trigger.w;
        check("checkOutPayments: dropdown button tooltip at its own button", !!nearOwn, JSON.stringify(b));
        await copPage.screenshot({ path: path.join(SHOTS, "5-outpayments-dropdown.png") });
      }
    }

    // ---- attendaceModal: injected trigger (mechanism independent of app data) ----
    const attPage = await openWindow(app, "attendaceModal.html");
    if (!attPage) {
      check("attendaceModal: window opened", false);
    } else {
      attPage.on("pageerror", err => pageErrors.push("attendaceModal: " + String((err && err.stack) || err)));
      await attPage.evaluate(() => {
        const mk = (id, cls, msg, text, left) => {
          const b = document.createElement("button");
          b.textContent = text;
          b.className = cls;
          b.setAttribute("data-msg", msg);
          b.id = id;
          // mid-window so viewport clamping never distorts the placement checks
          b.style.cssText = `position:absolute;left:${left}px;top:300px`;
          document.querySelector("main").appendChild(b);
        };
        mk("injected-trigger", "hover bottom", "Injected tooltip", "Injected", 400);
        mk("injected-left", "hover left", "Left aligned tooltip", "Left", 620);
      });
      await hoverAndCheck(attPage, "6-attendance.png", "#injected-trigger", null,
        b => b.tip.y >= b.trigger.y + b.trigger.h - 1, "attendaceModal: tooltip below trigger, fully visible");
      await hoverAndCheck(attPage, "6b-attendance-left.png", "#injected-left", null,
        b => Math.abs(b.tip.x - b.trigger.x) <= 2, "attendaceModal: .left tooltip aligned to the trigger's left edge");
    }

    // ---- billLayout designer: opts out of the JS tooltip, keeps its CSS popups ----
    const blPage = await openWindow(app, "billLayout.html");
    if (!blPage) {
      check("billLayout: window opened", false);
    } else {
      blPage.on("pageerror", err => pageErrors.push("billLayout: " + String((err && err.stack) || err)));
      const paletteBtn = await blPage.$('#palette .palette-btn[data-msg="Add new section"]');
      if (!paletteBtn) {
        check("billLayout: palette button found", false);
      } else {
        await paletteBtn.hover();
        await blPage.waitForTimeout(250);
        const b = await boxes(blPage, '#palette .palette-btn[data-msg="Add new section"]');
        check("billLayout: JS tooltip absent (designer opt-out)", b.tip === null, JSON.stringify(b));
        const pseudo = await blPage.evaluate(() => {
          const el = document.querySelector('#palette .palette-btn[data-msg="Add new section"]');
          const c = el ? getComputedStyle(el, "::before").content : "none";
          return String(c);
        });
        check("billLayout: legacy CSS popup still shows", pseudo !== "none" && pseudo !== "normal", pseudo);
        await blPage.screenshot({ path: path.join(SHOTS, "7-designer.png") });
      }
    }

    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await app.close().catch(() => {});
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
