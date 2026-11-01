/**
 * verify-cloud-live.js — real end-to-end Cloud Connect run against the live
 * server (code.mbtcverse.com). Unlike verify-cloud.js, NOTHING is seeded:
 * the app does a genuine POST /device/register through the UI, stores real
 * tokens (keychain or file fallback), and renders the dashboard from real
 * server data. Leaves the app signed in.
 *
 *   node scripts/verify-cloud-live.js
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "cloud-shots");
const CLOUD_STATE = path.join(ROOT, "config", "cloud.json");

// the business this app belongs to (its real cloud account)
const GST = "19AFFPP2933P1ZT";
const EMAIL = "samarkumarpaul63@gmail.com";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
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

    // ---- open Cloud, auth view ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="cloud"]').click());
    await page.waitForSelector(".cc-auth", { timeout: 15000 });
    await page.waitForTimeout(800);

    const prefill = await page.evaluate(() => ({
      gst: document.querySelector('[name="gstNumber"]')?.value || "",
      company: document.querySelector('[name="company_name"]')?.value || ""
    }));
    check("auth: GST prefilled from app config", prefill.gst === GST, prefill.gst);
    check("auth: company prefilled", prefill.company === "Ma Bhagawati Trading Co", prefill.company);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "live-1-auth.png") });

    // ---- real register through the UI ----
    await page.locator('[name="email"]').fill(EMAIL);
    await page.evaluate(() => document.getElementById("cc-submit").click());
    await page.waitForSelector(".cc-dashboard", { timeout: 30000 });
    await page.waitForTimeout(1000);

    const dash = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      return {
        chip: q(".cc-chip.connected")?.textContent.trim(),
        beta: q("#cc-val-beta")?.textContent.trim(),
        company: q("#cc-val-company")?.textContent.trim(),
        gst: q("#cc-val-gst")?.textContent.trim(),
        email: q("#cc-val-email")?.textContent.trim(),
        deviceId: q("#cc-val-device-id")?.textContent.trim(),
        userId: q("#cc-val-user-id")?.textContent.trim(),
        platform: q("#cc-val-platform")?.textContent.trim(),
        last: q("#cc-val-last")?.textContent.trim()
      };
    });
    check("live: dashboard reached after real register", !!dash.chip);
    check("live: connected chip", dash.chip === "Connected", dash.chip);
    check("live: business values from local profile", dash.company === "Ma Bhagawati Trading Co" && dash.gst === GST, dash.company + " / " + dash.gst);
    check("live: email registered", dash.email === EMAIL, dash.email);
    check("live: server userId shown", /^[0-9a-f-]{36}$/i.test(dash.userId), dash.userId);
    check("live: platform Windows", dash.platform === "Windows", dash.platform);
    check("live: beta chip reflects server isDev", dash.beta === "Beta tester" || dash.beta === "Standard", dash.beta);
    check("live: last-connected populated", dash.last !== "" && dash.last !== "—", dash.last);
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "live-2-dashboard.png") });

    // ---- refresh against the live server → success toast ----
    await page.evaluate(() => document.getElementById("cc-btn-refresh").click());
    let toast = "";
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      toast = await page.evaluate(() =>
        [...document.querySelectorAll(".toast-div.blue-toast-box")].map(x => x.innerText).join(" | "));
      if (toast.includes("Connection refreshed")) break;
    }
    check("live: refresh shows success toast", toast.includes("Connection refreshed"), toast.split("\n")[0].trim());
    await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, "live-3-refreshed.png") });
  } finally {
    await app.close().catch(() => {});
  }

  // the app is now genuinely signed in — show the persisted state
  try {
    const state = JSON.parse(fs.readFileSync(CLOUD_STATE).toString());
    console.log("\ncloud.json now:", JSON.stringify({
      deviceId: state.deviceId, userId: state.userId, isDev: state.isDev,
      deviceName: state.deviceName, profile: state.profile, lastConnectedAt: state.lastConnectedAt
    }, null, 2));
  } catch (_) { console.log("\n(cloud.json unreadable)"); }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
