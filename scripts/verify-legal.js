/**
 * verify-legal.js — DOM-level verification of the Legal window.
 *
 *   node scripts/verify-legal.js
 *
 *   1. The main-window sidebar carries NO Legal item (it is a standalone
 *      window, not a sidebar page — regression guard for the user's
 *      correction).
 *   2. The BBS menu carries "Legal"; firing the same chain the menu click
 *      runs (exTool.legalWindow(mainWindow)) opens a separate Legal window.
 *   3. The window hosts BOTH agreements in tabs — App EULA on the default
 *      tab, API Terms of Service on the second — with rendered markdown
 *      (headings, blockquotes, no raw markers) and a scrollable body.
 *   4. No renderer page errors in either window.
 *
 * Non-destructive: never signs in/out and never sends server traffic beyond
 * the app's own heartbeat. dismissed_banners.json is restored afterwards —
 * the beta auto-offer may fire during the run (the app is left signed in)
 * and the backup/restore keeps the user's once-only offer intact.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "legal-shots");
const DISMISSED = path.join(ROOT, "dismissed_banners.json"); // DEV store (viewManager getDismissedPath)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function readLegalState(page) {
  return page.evaluate(() => {
    const pane = tab => {
      const el = document.getElementById(`legal-pane-${tab}`);
      if (!el) return null;
      const doc = el.querySelector(".legal-doc");
      const text = doc ? doc.innerText : "";
      return {
        hidden: el.classList.contains("hide"),
        title: el.querySelector(".legal-doc-title")?.textContent.trim() || "",
        h1: doc ? doc.querySelectorAll("h1").length : 0,
        h2: doc ? doc.querySelectorAll("h2").length : 0,
        h3: doc ? doc.querySelectorAll("h3").length : 0,
        blockquote: doc ? doc.querySelectorAll("blockquote").length : 0,
        rawHashes: text.includes("###"),
        strayBackslash: text.includes("\\."),
        scrollable: doc ? doc.scrollHeight > doc.clientHeight : false,
        textLen: text.length
      };
    };
    return {
      tabLabels: [...document.querySelectorAll(".legal-tab")].map(b => b.textContent.trim()),
      selectedTab: document.querySelector(".legal-tab.selected")?.dataset.tab || "",
      app: pane("app"),
      api: pane("api")
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  // backup dismissed_banners.json — the beta auto-offer (app left signed in)
  // may persist its once-only dismissal during this run
  let dismissedBefore = null;
  if (fs.existsSync(DISMISSED)) dismissedBefore = fs.readFileSync(DISMISSED, "utf-8");

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  const mainErrors = [];
  page.on("pageerror", err => mainErrors.push(err.message));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let legalPage = null;
  let legalErrors = [];
  try {
    // ---- login ----
    if (await page.$('[data-ui="login-form"]')) {
      await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
      await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
      await page.locator('[data-ui="login-form"] button[type="submit"]').click();
      await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
      await page.waitForTimeout(2000);
    }

    // ---- 1. NOT a sidebar page ----
    const sidebarHasLegal = await page.evaluate(() =>
      !!document.querySelector('#nav-div [data-cmd="legal"]'));
    check("sidebar: no Legal nav item (standalone window, not a page)", sidebarHasLegal === false);

    // ---- 2. BBS menu carries "Legal" ----
    const menuHasLegal = await app.evaluate(({ Menu }) => {
      try {
        const menu = Menu.getApplicationMenu();
        const bbs = menu?.items.find(i => i.label === "BBS");
        return !!bbs?.submenu?.items.find(i => i.label === "Legal");
      } catch (_) { return false; }
    });
    check("menu: BBS → Legal item present", menuHasLegal);

    // ---- open the window through the exact menu chain (item.click()) ----
    const winPromise = app.waitForEvent("window", { timeout: 20000 }).catch(() => null);
    const opened = await app.evaluate(({ Menu }) => {
      try {
        const menu = Menu.getApplicationMenu();
        const bbs = menu?.items.find(i => i.label === "BBS");
        const item = bbs?.submenu?.items.find(i => i.label === "Legal");
        if (!item) return false;
        item.click(); // runs the same handler a real menu click runs
        return true;
      } catch (_) { return false; }
    });
    check("menu: Legal item click runs the open chain", opened);
    legalPage = await winPromise;
    if (!legalPage) {
      // fallback: the window event may have raced the launch — find it by URL
      const all = app.windows();
      for (const w of all)
        if (w !== page && w.url().includes("legalPage.html")) legalPage = w;
    }
    check("window: a separate Legal window opened", !!legalPage);
    if (legalPage) {
      legalPage.on("pageerror", err => legalErrors.push(err.message));
      await legalPage.waitForLoadState("domcontentloaded");
      await legalPage.waitForSelector(".legal-doc", { timeout: 10000 });
      await legalPage.waitForTimeout(600);

      check("window: title is Legal", (await legalPage.title()) === "Legal", await legalPage.title());

      // ---- 3. tabs: App EULA first, API Terms second ----
      let e = await readLegalState(legalPage);
      check("tabs: two tabs, App EULA then API Terms",
        e.tabLabels.length === 2 && e.tabLabels[0] === "App EULA" && e.tabLabels[1] === "API Terms of Service",
        e.tabLabels.join("|"));
      check("tabs: App EULA selected by default", e.selectedTab === "app", e.selectedTab);
      check("tabs: app pane visible, api pane hidden", e.app?.hidden === false && e.api?.hidden === true);
      check("app tab: EULA title shown",
        e.app?.title === "BBSv2 End User License Agreement", e.app?.title);
      check("app tab: headings render", e.app && (e.app.h1 + e.app.h2 + e.app.h3) >= 16,
        `h1=${e.app?.h1} h2=${e.app?.h2} h3=${e.app?.h3}`);
      check("app tab: no raw markdown markers", e.app?.rawHashes === false && e.app?.strayBackslash === false);
      check("app tab: body has real content and scrolls",
        e.app?.textLen > 500 && e.app?.scrollable === true, `len=${e.app?.textLen}`);
      await legalPage.locator("#legal-pane-app").screenshot({ path: path.join(SHOTS, "legal-app.png") });

      // switch to the API tab
      await legalPage.locator('.legal-tab[data-tab="api"]').click();
      await legalPage.waitForTimeout(400);
      e = await readLegalState(legalPage);
      check("tabs: API Terms selected after click", e.selectedTab === "api", e.selectedTab);
      // selected tab font color must be theme-secondary — common.css's global
      // `button.selected { color: var(--theme-primary) !important; }` would
      // otherwise paint primary-on-primary (invisible)
      const tabColors = await legalPage.evaluate(() => {
        const sel = document.querySelector(".legal-tab.selected");
        const probe = document.createElement("span");
        probe.style.color = "var(--theme-secondary)";
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { actual: getComputedStyle(sel).color, expected };
      });
      check("tabs: selected tab font is theme-secondary", tabColors.actual === tabColors.expected, JSON.stringify(tabColors));
      check("tabs: api pane visible, app pane hidden", e.api?.hidden === false && e.app?.hidden === true);
      check("api tab: Terms title shown",
        e.api?.title === "BBSv2 API Terms of Service & License Agreement", e.api?.title);
      check("api tab: headings render", e.api && (e.api.h1 + e.api.h2 + e.api.h3) >= 10,
        `h1=${e.api?.h1} h2=${e.api?.h2} h3=${e.api?.h3}`);
      check("api tab: blockquotes render", e.api && e.api.blockquote > 5, String(e.api?.blockquote));
      check("api tab: no raw markdown markers", e.api?.rawHashes === false && e.api?.strayBackslash === false);
      check("api tab: body has real content and scrolls",
        e.api?.textLen > 500 && e.api?.scrollable === true, `len=${e.api?.textLen}`);
      await legalPage.locator("#legal-pane-api").screenshot({ path: path.join(SHOTS, "legal-api.png") });
    }
  } finally {
    // restore dismissed_banners.json — keep the user's once-only beta offer intact
    if (dismissedBefore !== null) fs.writeFileSync(DISMISSED, dismissedBefore);
    else if (fs.existsSync(DISMISSED)) fs.unlinkSync(DISMISSED);
    await app.close().catch(() => {});
  }

  check("no renderer page errors during the run",
    mainErrors.length === 0 && legalErrors.length === 0,
    [...mainErrors, ...legalErrors].join(" | ").slice(0, 200));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
