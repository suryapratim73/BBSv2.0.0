/**
 * verify-eula.js — DOM-level verification of both EULA flows.
 *
 *   node scripts/verify-eula.js
 *
 *   1. API EULA: Cloud Connect signup (Connect tab) shows the API terms with
 *      one OK button; OK proceeds to a REAL live-server register → dashboard.
 *   2. App EULA on the update presenter: the update tour's checkForUpdate
 *      shows the app terms (one OK) BEFORE the update highlights welcome
 *      modal; OK reveals the highlights; closing the presenter marks the
 *      version seen. Nothing is marked seen before acceptance.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "cloud-shots");
const EMAIL = "samarkumarpaul63@gmail.com";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Shared assertions for any open EULA page. */
async function assertEulaPage(page, opts) {
  const e = await page.evaluate(() => {
    const overlay = document.getElementById("eula-overlay");
    const body = overlay?.querySelector(".eula-body");
    return {
      present: !!overlay,
      title: overlay?.querySelector(".eula-title")?.textContent.trim() || "",
      buttons: [...(overlay?.querySelectorAll("button") || [])].map(b => b.textContent.trim()),
      h2: body?.querySelectorAll("h2").length || 0,
      h3: body?.querySelectorAll("h3").length || 0,
      h1: body?.querySelectorAll("h1").length || 0,
      li: body?.querySelectorAll("ul li").length || 0,
      nestedUl: body?.querySelectorAll("ul ul").length || 0,
      blockquote: body?.querySelectorAll("blockquote").length || 0,
      glyphQuotes: [...(body?.querySelectorAll("blockquote") || [])].filter(b => b.textContent.includes("•")).length,
      strong: body?.querySelectorAll("strong").length || 0,
      backslashDot: (body?.innerText || "").includes("\\."),
      strayHashes: (body?.innerText || "").includes("###"),
      scrollable: body ? body.scrollHeight > body.clientHeight : false
    };
  });
  check(`${opts.label}: overlay shown`, e.present);
  check(`${opts.label}: correct title`, e.title === opts.title, e.title);
  check(`${opts.label}: exactly one button, labelled OK`,
    e.buttons.length === 1 && e.buttons[0] === "OK", e.buttons.join("|"));
  check(`${opts.label}: headings render`, (e.h1 + e.h2 + e.h3) >= opts.minHeadings, `h1=${e.h1} h2=${e.h2} h3=${e.h3}`);
  if (opts.expectUlLi !== false)
    check(`${opts.label}: bullet lists render`, e.li > 10, String(e.li));
  if (opts.expectNestedUl)
    check(`${opts.label}: nested list (§4) renders`, e.nestedUl > 0, String(e.nestedUl));
  if (opts.expectBlockquote) {
    check(`${opts.label}: blockquote sections render`, e.blockquote > 5, String(e.blockquote));
    // the API EULA's bullets are "* " inside "> " quotes — rendered as glyphs
    check(`${opts.label}: blockquoted bullets render as glyphs`, e.glyphQuotes > 5, String(e.glyphQuotes));
  }
  check(`${opts.label}: bold lead-ins render`, e.strong > 10, String(e.strong));
  check(`${opts.label}: no visible escape backslashes`, e.backslashDot === false);
  check(`${opts.label}: no raw markdown heading markers`, e.strayHashes === false);
  check(`${opts.label}: body is scrollable`, e.scrollable);
  await page.locator("#eula-overlay").screenshot({ path: path.join(SHOTS, opts.shot) });
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
  page.on("pageerror", err => pageErrors.push(err.message));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let updtConfPath = null;
  let updtConfBefore = null;
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

    // ---- 1. API EULA on cloud signup (live server round trip) ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="cloud"]').click());
    await page.waitForSelector("#cloud-div", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // signed in from earlier runs → sign out (two-click) to reach signup
    if (await page.$(".cc-dashboard")) {
      await page.evaluate(() => document.getElementById("cc-btn-signout").click());
      await page.waitForTimeout(300);
      await page.evaluate(() => document.getElementById("cc-btn-signout").click());
      await page.waitForSelector(".cc-auth", { timeout: 10000 });
      await page.waitForTimeout(600);
    }

    await page.locator('[name="email"]').fill(EMAIL);
    await page.evaluate(() => document.getElementById("cc-submit").click());
    await page.waitForSelector("#eula-overlay", { timeout: 10000 });
    await page.waitForTimeout(600);
    await assertEulaPage(page, {
      label: "api-eula",
      title: "BBSv2 API Terms of Service & License Agreement",
      minHeadings: 10,
      expectUlLi: false, // its bullets live inside blockquotes
      expectBlockquote: true,
      expectNestedUl: false,
      shot: "eula-api.png"
    });

    // OK → the real register runs → dashboard (live server)
    await page.evaluate(() => document.getElementById("eula-ok").click());
    await page.waitForSelector(".cc-dashboard", { timeout: 30000 });
    check("api-eula: OK proceeds to real register → dashboard", true);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "eula-api-after.png") });

    // ---- 2. App EULA gates the update presenter (tour highlights) ----
    // update.md holds v2.22.4 highlights. Reset the seen flag so the
    // presenter is offered, then invoke the renderer's checkForUpdate.
    const appData = await app.evaluate(({ app: a }) => a.getPath("appData"));
    updtConfPath = path.join(appData, "BBS", "updtConf.json");
    updtConfBefore = fs.existsSync(updtConfPath) ? fs.readFileSync(updtConfPath, "utf-8") : null;
    const updtConfObj = updtConfBefore ? JSON.parse(updtConfBefore) : {};
    updtConfObj.updateSeenVersion = "";
    fs.mkdirSync(path.dirname(updtConfPath), { recursive: true });
    fs.writeFileSync(updtConfPath, JSON.stringify(updtConfObj, null, 2));

    // nodeIntegration is on, so the page's require() returns the SAME
    // common.js module instance the app loaded — its checkForUpdate runs live.
    const COMMON_ABS = path.join(ROOT, "template", "js", "common.js");
    const invokeErr = await page.evaluate(commonPath => {
        try {
            const mod = window.require(commonPath);
            if (typeof mod.checkForUpdate !== "function") return "no checkForUpdate export";
            mod.checkForUpdate();
            return "";
        } catch (e) { return String((e && e.message) || e); }
    }, COMMON_ABS);
    check("app-eula-tour: checkForUpdate invoked", invokeErr === "", invokeErr);

    await page.waitForSelector("#eula-overlay", { timeout: 10000 });
    await page.waitForTimeout(600);
    await assertEulaPage(page, {
      label: "app-eula-tour",
      title: "BBSv2 End User License Agreement",
      minHeadings: 16,
      expectBlockquote: false,
      expectNestedUl: true,
      shot: "eula-app-tour.png"
    });

    // EULA precedes the highlights — the welcome modal must not exist yet
    const welcomeBeforeOk = await page.evaluate(() => !!document.getElementById("welcome-modal"));
    check("app-eula-tour: highlights held until acceptance", welcomeBeforeOk === false);

    // nothing marked seen before acceptance (fail-closed)
    const seenWhileGate = (() => {
      try { return JSON.parse(fs.readFileSync(updtConfPath, "utf-8")).updateSeenVersion; }
      catch (_) { return ""; }
    })();
    check("app-eula-tour: update not marked seen before acceptance", seenWhileGate !== "2.22.4", String(seenWhileGate));

    // OK → EULA closes, highlights (welcome modal) appear
    await page.evaluate(() => document.getElementById("eula-ok").click());
    await page.waitForSelector("#welcome-modal", { timeout: 10000 });
    const welcome = await page.evaluate(() => ({
      version: document.querySelector(".welcome-version")?.textContent.trim() || "",
      text: document.querySelector(".welcome-text")?.textContent || ""
    }));
    check("app-eula-tour: OK shows the update highlights", true);
    check("app-eula-tour: highlights show the new version", welcome.version === "v2.22.4", welcome.version);
    check("app-eula-tour: highlight bullets present",
      welcome.text.includes("Duplicate bill number fixed"), welcome.text.slice(0, 60));
    check("app-eula-tour: EULA closed after OK", !(await page.$("#eula-overlay")));
    await page.locator("#welcome-modal").screenshot({ path: path.join(SHOTS, "eula-app-tour-after.png") });

    // closing the presenter marks the version seen — no repeat next launch
    await page.evaluate(() => document.querySelector("#welcome-modal .welcome-btn-skip")?.click());
    await page.waitForTimeout(400);
    const seenAfter = (() => {
      try { return JSON.parse(fs.readFileSync(updtConfPath, "utf-8")).updateSeenVersion; }
      catch (_) { return ""; }
    })();
    check("app-eula-tour: closing highlights marks update seen", seenAfter === "2.22.4", String(seenAfter));
  } finally {
    // restore the pre-test updtConf state
    if (updtConfPath) {
      try {
        if (updtConfBefore !== null) fs.writeFileSync(updtConfPath, updtConfBefore);
        else fs.unlinkSync(updtConfPath);
      } catch (_) { /* best-effort restore */ }
    }
    await app.close().catch(() => {});
  }

  check("no renderer page errors during the run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
