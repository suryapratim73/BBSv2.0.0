/**
 * verify-cloud.js — DOM-level verification pass for the Cloud page.
 *
 * One launch, both views:
 *   1. auth view — structure, prefills, tab behaviour, inline error
 *   2. seeded signed-in state → dashboard view — cards, values, chips
 *   3. refresh error toast (server unreachable)
 *   4. two-click sign-out → back to auth, prefill retained
 *
 * Also analyzes the screenshots for blank frames (distinct colors via a
 * headless chromium canvas) so the run is verifiable without eyeballing.
 *
 *   node scripts/verify-cloud.js
 */

const { _electron, chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "cloud-shots");
const CLOUD_STATE = path.join(ROOT, "config", "cloud.json");
const CLOUD_AUTH = path.join(ROOT, "config", "cloud-auth.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  let seeded = false;
  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
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

    // ---- 1. auth view ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="cloud"]').click());
    await page.waitForSelector(".cc-auth", { timeout: 15000 });
    await page.waitForTimeout(800);

    const auth = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const cs = el => el ? getComputedStyle(el) : null;
      const form = q("#cloud-auth-form");
      const info = q(".cc-auth-info");
      const card = q(".cc-auth-card");
      const host = q("#cloud-div");
      return {
        infoBg: cs(info)?.backgroundColor,
        cardBg: cs(card)?.backgroundColor,
        fields: [...form.querySelectorAll(".cc-field input")].map(i => ({ name: i.name, value: i.value })),
        labels: [...form.querySelectorAll(".cc-field label")].map(l => l.textContent.trim()),
        tabs: [...q(".cc-tabs").querySelectorAll("button")].map(b => b.textContent.trim()),
        submitText: q("#cc-submit")?.textContent.trim(),
        hostOverflow: host.scrollWidth > host.clientWidth,
        infoVisible: !!info && info.getBoundingClientRect().width > 200,
        cardVisible: !!card && card.getBoundingClientRect().width > 200
      };
    });
    check("auth: two-pane layout visible", auth.infoVisible && auth.cardVisible);
    check("auth: info pane uses theme primary", /rgb\(102,\s*51,\s*153\)/.test(auth.infoBg || ""), auth.infoBg);
    check("auth: GST prefilled from app config", auth.fields.find(f => f.name === "gstNumber")?.value === "19AFFPP2933P1ZT", auth.fields.map(f => f.name + "=" + f.value).join(" "));
    check("auth: company prefilled", auth.fields.find(f => f.name === "company_name")?.value === "Ma Bhagawati Trading Co");
    check("auth: 7 form fields", auth.fields.length === 7, String(auth.fields.length));
    check("auth: tabs present", auth.tabs.join("|") === "Connect this device|Sign in");
    check("auth: no horizontal overflow", auth.hostOverflow === false);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "v1-auth.png") });

    // inline error
    await page.evaluate(() => {
      document.querySelector('[name="gstNumber"]').value = "BAD";
      document.getElementById("cc-submit").click();
    });
    await page.waitForTimeout(500);
    check("auth: invalid GST shows inline error", (await page.evaluate(() => document.getElementById("cc-error")?.innerText))?.includes("valid GST number"));

    // tab switch
    await page.evaluate(() => document.querySelector('.cc-tabs [data-tab="signin"]').click());
    await page.waitForTimeout(400);
    const tab = await page.evaluate(() => ({
      hidden: document.querySelectorAll(".cc-signup-only.hide").length,
      submitText: document.getElementById("cc-submit").textContent.trim()
    }));
    check("sign-in tab hides 5 signup fields", tab.hidden === 5, String(tab.hidden));
    check("sign-in tab relabels submit", tab.submitText === "Sign In", tab.submitText);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "v2-signin.png") });
    await page.evaluate(() => document.querySelector('.cc-tabs [data-tab="connect"]').click());

    // ---- 2. seed signed-in state, re-enter Cloud ----
    seedState();
    seeded = true;
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="sale"]').click());
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="cloud"]').click());
    await page.waitForSelector(".cc-dashboard", { timeout: 15000 });
    await page.waitForTimeout(800);

    const dash = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const cards = [...q(".cc-cards").querySelectorAll(".cc-card")];
      const host = q("#cloud-div");
      return {
        chip: q(".cc-chip.connected")?.textContent.trim(),
        betaChip: q("#cc-val-beta")?.textContent.trim(),
        company: q("#cc-val-company")?.textContent.trim(),
        gst: q("#cc-val-gst")?.textContent.trim(),
        deviceId: q("#cc-val-device-id")?.textContent.trim(),
        platform: q("#cc-val-platform")?.textContent.trim(),
        cardCount: cards.length,
        cardWidths: cards.map(c => Math.round(c.getBoundingClientRect().width)),
        overflow: host.scrollWidth > host.clientWidth,
        hasSyncCard: !!q(".cc-card.cc-muted"),
        rowsPerCard: cards.map(c => c.querySelectorAll(".cc-row").length)
      };
    });
    check("dashboard: connected chip", dash.chip === "Connected", dash.chip);
    check("dashboard: beta chip shows seeded program", dash.betaChip === "Beta tester", dash.betaChip);
    check("dashboard: business values render", dash.company === "Ma Bhagawati Trading Co" && dash.gst === "19AFFPP2933P1ZT", dash.company + " / " + dash.gst);
    check("dashboard: device id is a UUID", /^[0-9a-f-]{36}$/i.test(dash.deviceId), dash.deviceId);
    check("dashboard: platform label mapped", dash.platform === "Windows", dash.platform);
    check("dashboard: 3 stat cards + sync card", dash.cardCount === 3 && dash.hasSyncCard, String(dash.cardCount));
    check("dashboard: cards equal width (grid)", new Set(dash.cardWidths).size === 1, dash.cardWidths.join(","));
    check("dashboard: no horizontal overflow", dash.overflow === false);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "v3-dashboard.png") });

    // ---- 3. refresh error path ----
    await page.evaluate(() => document.getElementById("cc-btn-refresh").click());
    // the toast auto-dismisses — poll for OUR toast (app background-job
    // toasts race in with the same red class when the server is offline)
    let toast = { toast: "", stillDashboard: true };
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      toast = await page.evaluate(() => ({
        toast: [...document.querySelectorAll(".toast-div.red-toast-box")].map(x => x.innerText).join(" | "),
        stillDashboard: !!document.querySelector(".cc-dashboard")
      }));
      if (toast.toast.includes("Could not reach the BBS Cloud server")) break;
    }
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "v4-refresh-error.png") });
    // the toast carries the real server error message (offline here)
    check("dashboard: refresh failure shows red toast", toast.toast.includes("Could not reach the BBS Cloud server"), toast.toast.split("\n")[0].trim());
    check("dashboard: view stays on failure", toast.stillDashboard);

    // ---- 4. two-click sign-out ----
    await page.evaluate(() => document.getElementById("cc-btn-signout").click());
    await page.waitForTimeout(400);
    const armed = await page.evaluate(() => document.getElementById("cc-btn-signout")?.textContent.trim());
    check("signout: first click arms confirmation", armed?.includes("Click again"), armed);
    await page.evaluate(() => document.getElementById("cc-btn-signout").click());
    await page.waitForSelector(".cc-auth", { timeout: 10000 });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      gst: document.querySelector('[name="gstNumber"]')?.value,
      signedOutFilesCleared: true // main process cleared them
    }));
    check("signout: returns to auth view", after.gst !== undefined);
    check("signout: GST retained for next sign-in", after.gst === "19AFFPP2933P1ZT", after.gst);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "v5-signed-out.png") });
  } finally {
    await app.close().catch(() => {});
  }

  if (seeded) restoreState();

  // ---- 5. blank-frame analysis of every screenshot ----
  const browser = await chromium.launch();
  const bpage = await browser.newPage();
  for (const f of fs.readdirSync(SHOTS).filter(f => /^v\d.*\.png$/.test(f)).sort()) {
    // data: URL — file:// images are not loadable from about:blank pages
    const b64 = fs.readFileSync(path.join(SHOTS, f)).toString("base64");
    const stats = await bpage.evaluate(async dataUrl => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 64 * 4)
        colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return { w: img.width, h: img.height, distinct: colors.size };
    }, "data:image/png;base64," + b64);
    check(`shot ${f}: non-blank (distinct colors)`, stats.distinct > 20, `${stats.w}x${stats.h}, ${stats.distinct} colors`);
  }
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

/** Seed a signed-in state so the dashboard can render without a server. */
function seedState() {
  let deviceId = "";
  try { deviceId = JSON.parse(fs.readFileSync(CLOUD_STATE).toString()).deviceId || ""; } catch (_) {}
  if (!deviceId) deviceId = require("uuid").v4();
  fs.writeFileSync(CLOUD_STATE, JSON.stringify({
    deviceId,
    userId: "seed-user-123",
    isDev: true,
    platform: "win",
    deviceName: "Test Desktop",
    profile: {
      gstNumber: "19AFFPP2933P1ZT",
      email: "samarkumarpaul63@gmail.com",
      name: "Surya Pratim Paul",
      phone: "+91-98765-43210",
      company_name: "Ma Bhagawati Trading Co",
      company_address: "26/1, Hrishikesh Ghosh Lane, Salkia, Howrah-711106"
    },
    lastConnectedAt: new Date().toISOString()
  }, null, 2));
  fs.writeFileSync(CLOUD_AUTH, JSON.stringify({ accessToken: "seed-access-token", refreshToken: "seed-refresh-token" }));
}

/** Restore: keep only the deviceId, drop fake auth. */
function restoreState() {
  try {
    const state = JSON.parse(fs.readFileSync(CLOUD_STATE).toString());
    fs.writeFileSync(CLOUD_STATE, JSON.stringify({
      deviceId: state.deviceId || "",
      userId: null,
      isDev: false,
      platform: state.platform || "win",
      deviceName: "",
      profile: {},
      lastConnectedAt: null
    }, null, 2));
  } catch (_) {}
  try { fs.unlinkSync(CLOUD_AUTH); } catch (_) {}
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
