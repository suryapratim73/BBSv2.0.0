/**
 * drive-cloud.js — standalone Playwright driver for the Cloud Connect page.
 *
 * Launches the real Electron app (same recipe as e2e/fixtures.js) and drives
 * the Cloud page. Run with node, NOT with @playwright/test:
 *
 *   node scripts/drive-cloud.js ui          # auth view: validation, tabs, offline submit
 *   node scripts/drive-cloud.js dashboard   # signed-in view: seeded state, refresh, sign-out
 *
 * Screenshots land in test-results/cloud-shots/. Dashboard phase seeds
 * config/cloud.json + cloud-auth.json first (server is unreachable, so a real
 * register can't be tested) and restores/removes them afterwards.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "cloud-shots");
const CLOUD_STATE = path.join(ROOT, "config", "cloud.json");
const CLOUD_AUTH = path.join(ROOT, "config", "cloud-auth.json");
const ERROR_LOG = path.join(SHOTS, "renderer-errors.log");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const phase = process.argv[2] || "ui";
  fs.mkdirSync(SHOTS, { recursive: true });
  if (fs.existsSync(ERROR_LOG)) fs.unlinkSync(ERROR_LOG);

  if (phase === "dashboard") seedSignedInState();

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });

  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", err => pageErrors.push("pageerror: " + err.message + "\n" + (err.stack || "")));
  page.on("console", msg => {
    if (msg.type() === "error") pageErrors.push("console.error: " + msg.text());
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  try {
    await loginIfNeeded(page);

    // Open the Cloud page
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="cloud"]').click());
    await page.waitForSelector("#cloud-div", { timeout: 15000 });
    await page.waitForTimeout(1200);

    // screenshot helper: the cloud-div element only (readable, focused)
    const ss = async name => {
      await page.locator("#cloud-div").screenshot({ path: path.join(SHOTS, name) });
      console.log("screenshot:", name);
    };

    if (phase === "ui") {
      await page.waitForSelector(".cc-auth", { timeout: 10000 });
      const prefillGst = await page.evaluate(() => document.querySelector('#cloud-auth-form [name="gstNumber"]')?.value || "");
      const prefillCompany = await page.evaluate(() => document.querySelector('#cloud-auth-form [name="company_name"]')?.value || "");
      console.log("prefill GST:", prefillGst, "| prefill company:", prefillCompany);
      await ss("01-cloud-auth.png");

      // Invalid GST -> inline error, no network call
      await page.evaluate(() => {
        document.querySelector('#cloud-auth-form [name="gstNumber"]').value = "BADGST";
        document.getElementById("cc-submit").click();
      });
      await page.waitForTimeout(600);
      console.log("invalid-gst error:", await page.evaluate(() => document.getElementById("cc-error")?.innerText || "(none)"));
      await ss("02-invalid-gst.png");

      // Sign-in tab hides the signup-only fields
      await page.evaluate(() => document.querySelector('.cc-tabs [data-tab="signin"]').click());
      await page.waitForTimeout(400);
      const hidden = await page.evaluate(() => document.querySelectorAll(".cc-signup-only.hide").length);
      console.log("signin tab hidden signup fields:", hidden);
      await ss("03-signin-tab.png");

      // Back to connect, valid details, submit -> server unreachable error path
      await page.evaluate(() => document.querySelector('.cc-tabs [data-tab="connect"]').click());
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        document.querySelector('#cloud-auth-form [name="gstNumber"]').value = "19AFFPP2933P1ZT";
        document.querySelector('#cloud-auth-form [name="email"]').value = "samarkumarpaul63@gmail.com";
        document.getElementById("cc-submit").click();
      });
      // axios timeout is 8s; wait past it to catch the offline error
      await page.waitForTimeout(12000);
      const offlineErr = await page.evaluate(() => document.getElementById("cc-error")?.innerText || "");
      console.log("offline submit error:", offlineErr);
      await ss("04-offline-error.png");
    } else if (phase === "dashboard") {
      await page.waitForSelector(".cc-dashboard", { timeout: 10000 });
      await page.waitForTimeout(800);
      await ss("05-dashboard.png");

      // Refresh connection -> server unreachable -> red toast, view stays
      await page.evaluate(() => document.getElementById("cc-btn-refresh").click());
      await page.waitForTimeout(10000);
      await ss("06-refresh-error.png");

      // Two-click sign out
      await page.evaluate(() => document.getElementById("cc-btn-signout").click());
      await page.waitForTimeout(400);
      await ss("07-signout-armed.png");
      await page.evaluate(() => document.getElementById("cc-btn-signout").click());
      await page.waitForTimeout(1500);
      const backToAuth = await page.evaluate(() => Boolean(document.querySelector(".cc-auth")));
      console.log("signout returned to auth view:", backToAuth);
      await ss("08-after-signout.png");
    }
  } finally {
    fs.writeFileSync(ERROR_LOG, pageErrors.join("\n") || "(no renderer errors)");
    await app.close().catch(() => {});
  }

  if (phase === "dashboard") restoreCloudState();
  console.log("done. screenshots:", SHOTS);
}

async function loginIfNeeded(page) {
  // dismiss the feature tour / update prompt if they cover the UI
  await page.evaluate(() => {
    document.getElementById("tour-overlay")?.remove();
    document.getElementById("update-prompt-overlay")?.remove();
  });
  const loginForm = await page.$('[data-ui="login-form"]');
  if (!loginForm) {
    const beta = await page.$("#beta-program-modal");
    if (beta) {
      await page.evaluate(() => document.getElementById("bp-btn-later")?.click());
      await page.waitForTimeout(500);
    }
    return;
  }
  await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
  await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
  await page.locator('[data-ui="login-form"] button[type="submit"]').click();
  await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  // overlays may appear after login
  await page.evaluate(() => {
    document.getElementById("tour-overlay")?.remove();
    document.getElementById("update-prompt-overlay")?.remove();
    document.getElementById("bp-btn-later")?.click();
  });
  await page.waitForTimeout(500);
}

/** Seed a signed-in state so the dashboard can render without a server. */
function seedSignedInState() {
  let deviceId = "";
  try {
    deviceId = JSON.parse(fs.readFileSync(CLOUD_STATE).toString()).deviceId || "";
  } catch (_) { /* ui phase may not have run yet */ }
  if (!deviceId) {
    // same uuid.v4() contract as lib/cloudConnect.js
    deviceId = require("uuid").v4();
  }
  const state = {
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
  };
  fs.writeFileSync(CLOUD_STATE, JSON.stringify(state, null, 2));
  // file fallback for tokens — keytar has no entry, so getTokens() reads this
  fs.writeFileSync(CLOUD_AUTH, JSON.stringify({ accessToken: "seed-access-token", refreshToken: "seed-refresh-token" }));
  console.log("seeded cloud state (deviceId kept:", deviceId + ")");
}

/** Restore: keep only the deviceId (persistent identity), drop fake auth. */
function restoreCloudState() {
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
  } catch (_) { /* nothing to restore */ }
  try { fs.unlinkSync(CLOUD_AUTH); } catch (_) {}
  console.log("restored cloud state (fake auth removed)");
}

main().catch(err => {
  console.error("DRIVER FAILED:", err);
  process.exit(1);
});
