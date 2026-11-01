/**
 * test-cloud-api.js — raw HTTP test of every BBSv2-Client-API.md endpoint
 * against the live cloud server (code.mbtcverse.com).
 *
 *   node scripts/test-cloud-api.js
 *
 * Uses the app's persisted deviceId (config/cloud.json) and the owner's real
 * business identity, so the checks exercise the same rows the app will use.
 * Does NOT touch app state files or the keychain — pure HTTP. Side effects on
 * the server (by design, per the doc):
 *   - /device/register creates/updates the business's account + device row
 *   - /device/beta-register opts the business's user into beta
 *   - /api/sync/data upserts one small test key (__client_smoke_test__)
 *   - /api/auth/refresh may rotate the token pair
 * The app re-registers on its next launch, so token rotation is self-healing.
 */

const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");

const BASE = process.env.CLOUD_BASE_URL || "https://code.mbtcverse.com/";
const ROOT = path.join(__dirname, "..");

// the business this app belongs to (its real cloud account)
const GST = "19AFFPP2933P1ZT";
const EMAIL = "samarkumarpaul63@gmail.com";
const OTHER_GST = "27AAPFU0939F1ZV"; // doc example — only used for the 409 check
const SYNC_KEY = "__client_smoke_test__";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** GET/POST returning { status, body (string|object), headers } — no throw on 4xx/5xx. */
async function call(method, url, { data, headers, responseType = "json", timeout = 20000 } = {}) {
  try {
    const resp = await axios({
      method,
      url: BASE + url.replace(/^\//, ""),
      data,
      headers: { "Content-Type": "application/json", ...headers },
      responseType,
      timeout,
      validateStatus: () => true,
      maxContentLength: 1024 * 1024 // never download a full installer in a test
    });
    return { status: resp.status, body: resp.data, headers: resp.headers };
  } catch (err) {
    // maxContentLength exceeded (large binary) is itself a good sign for /download/update
    if (String(err.message).includes("maxContentLength")) return { status: 200, body: null, headers: {}, truncated: true };
    return { status: err.response?.status || 0, body: err.response?.data, headers: err.response?.headers || {}, error: err.message };
  }
}

function loadDeviceId() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "cloud.json")).toString());
    return state.deviceId || "";
  } catch (_) {
    return "";
  }
}

function isJwt(s) { return typeof s === "string" && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s); }
function isHex128(s) { return typeof s === "string" && /^[0-9a-f]{128}$/i.test(s); }

async function main() {
  const deviceId = loadDeviceId();
  console.log("base:", BASE, "| deviceId:", deviceId || "(missing!)", "\n");

  // ---- 0. liveness ----
  const root = await call("GET", "/");
  check("GET / serves the site", root.status === 200, "status " + root.status);
  const version = await call("GET", "/version");
  check("GET /version returns JSON version info",
    version.status === 200 && typeof version.body === "object" && typeof version.body.version === "string",
    version.body?.version || String(version.status));

  // ---- 1. /device/register validation ----
  const empty = await call("POST", "/device/register", { data: {} });
  check("register: empty body → 400", empty.status === 400, JSON.stringify(empty.body).slice(0, 120));

  const badGst = await call("POST", "/device/register", { data: { deviceId, gstNumber: "BAD" } });
  check("register: invalid GST → 400", badGst.status === 400, JSON.stringify(badGst.body).slice(0, 120));

  const badDevice = await call("POST", "/device/register", { data: { deviceId: "not-a-uuid", gstNumber: GST } });
  check("register: invalid deviceId → 400", badDevice.status === 400, JSON.stringify(badDevice.body).slice(0, 120));

  // ---- 2. real register ----
  const reg = await call("POST", "/device/register", {
    data: {
      deviceId,
      gstNumber: GST,
      email: EMAIL,
      name: "Surya Pratim Paul",
      company_name: "Ma Bhagawati Trading Co",
      device_name: os.hostname(),
      platform: "win"
    }
  });
  check("register: real device → 200", reg.status === 200, "status " + reg.status + " " + JSON.stringify(reg.body).slice(0, 200));
  const ok200 = reg.status === 200 && typeof reg.body === "object";
  check("register: returns userId", ok200 && typeof reg.body.userId === "string" && reg.body.userId.length > 0, ok200 ? reg.body.userId : "—");
  check("register: echoes deviceId", ok200 && reg.body.deviceId === deviceId, ok200 ? reg.body.deviceId : "—");
  check("register: accessToken is a JWT", ok200 && isJwt(reg.body.accessToken), ok200 ? (reg.body.accessToken || "").slice(0, 30) + "…" : "—");
  check("register: refreshToken is 128 hex", ok200 && isHex128(reg.body.refreshToken), ok200 ? "len " + String(reg.body.refreshToken || "").length : "—");
  check("register: isDev is boolean", ok200 && typeof reg.body.isDev === "boolean", ok200 ? String(reg.body.isDev) : "—");

  // ---- 3. token reuse (idempotent re-register) + email conflict ----
  const reg2 = await call("POST", "/device/register", { data: { deviceId, gstNumber: GST, email: EMAIL } });
  check("register: repeat call returns the same pair (token reuse)",
    reg2.status === 200 && reg.body.accessToken === reg2.body?.accessToken,
    "same=" + (reg.body.accessToken === reg2.body?.accessToken));

  // must run AFTER the real register: now the email belongs to the real GST,
  // so submitting it under another GST must be rejected (409) — and a
  // rejection has no side effects
  const conflict = await call("POST", "/device/register", {
    data: { deviceId, gstNumber: OTHER_GST, email: EMAIL }
  });
  check("register: email of another GST → 409", conflict.status === 409, JSON.stringify(conflict.body).slice(0, 120));

  // ---- 4. beta ----
  const beta = await call("POST", "/device/beta-register", { data: { deviceId } });
  check("beta-register: real device → 200 isDev true",
    beta.status === 200 && beta.body?.isDev === true, "status " + beta.status + " " + JSON.stringify(beta.body).slice(0, 120));

  const betaBad = await call("POST", "/device/beta-register", { data: { deviceId: "nope" } });
  check("beta-register: bad deviceId → 400", betaBad.status === 400, JSON.stringify(betaBad.body).slice(0, 120));

  const status1 = await call("GET", "/device/status?id=" + deviceId);
  check("status: real device → 200 isDev true",
    status1.status === 200 && status1.body?.isDev === true, JSON.stringify(status1.body).slice(0, 120));

  const statusBad = await call("GET", "/device/status");
  check("status: missing id → 400", statusBad.status === 400, JSON.stringify(statusBad.body).slice(0, 120));

  // ---- 5. auth refresh ----
  const refresh = await call("POST", "/api/auth/refresh", { data: { refresh_token: reg.body.refreshToken } });
  check("auth/refresh: valid refresh token → 200 + new accessToken",
    refresh.status === 200 && isJwt(refresh.body?.accessToken), "status " + refresh.status);
  const accessToken = refresh.body?.accessToken || reg.body.accessToken;

  const refreshBad = await call("POST", "/api/auth/refresh", { data: { refresh_token: "bogus" } });
  check("auth/refresh: bogus token → 401", refreshBad.status === 401, "status " + refreshBad.status);

  // ---- 6. update download (channel-gated) ----
  // 200 binary = a build exists; 404 JSON = none approved — both are correct behaviour
  const dlProd = await call("GET", `/download/update?platform=win&id=${deviceId}&channel=production`);
  const prodOk = (dlProd.status === 200 && !dlProd.body?.error) || dlProd.status === 404;
  check("download/update: production channel → 200 binary or 404 JSON",
    prodOk, "status " + dlProd.status + (dlProd.status === 200 ? " ct=" + (dlProd.headers["content-type"] || "?") + (dlProd.truncated ? " (large binary)" : "") : " " + JSON.stringify(dlProd.body).slice(0, 100)));

  const dlDev = await call("GET", `/download/update?platform=win&id=${deviceId}&channel=dev`);
  const devOk = (dlDev.status === 200 && !dlDev.body?.error) || dlDev.status === 404;
  check("download/update: dev channel (beta user) → 200 binary or 404 JSON",
    devOk, "status " + dlDev.status + (dlDev.status === 404 ? " " + JSON.stringify(dlDev.body).slice(0, 100) : ""));

  const dlBad = await call("GET", `/download/update?platform=bogus&id=${deviceId}`);
  check("download/update: bogus platform → 400", dlBad.status === 400, "status " + dlBad.status + " " + JSON.stringify(dlBad.body).slice(0, 100));

  // ---- 7. sync ----
  const syncNoAuth = await call("GET", "/api/sync/data");
  check("sync: GET without token → 401", syncNoAuth.status === 401, "status " + syncNoAuth.status);

  const syncPut = await call("POST", "/api/sync/data", {
    data: { data_key: SYNC_KEY, data_value: { note: "client smoke test", at: new Date().toISOString() } },
    headers: { Authorization: "Bearer " + accessToken }
  });
  check("sync: POST upsert with Bearer → 200", syncPut.status === 200, "status " + syncPut.status + " " + JSON.stringify(syncPut.body).slice(0, 120));

  const syncGet = await call("GET", "/api/sync/data", { headers: { Authorization: "Bearer " + accessToken } });
  const syncGetOk = syncGet.status === 200 && JSON.stringify(syncGet.body).includes(SYNC_KEY);
  check("sync: GET with Bearer contains the upserted key", syncGetOk, "status " + syncGet.status + " " + JSON.stringify(syncGet.body).slice(0, 160));

  // ---- 8. legacy routes smoke (invalid payload → 400 proves they exist) ----
  const silent = await call("POST", "/silent-register", { data: {} });
  check("legacy /silent-register responds (400 on bad body)", silent.status === 400, "status " + silent.status);
  const appLogs = await call("POST", "/app-logs", { data: {} });
  check("legacy /app-logs responds (400 on bad body)", appLogs.status === 400, "status " + appLogs.status);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("failed:", failed.map(f => f.name).join(" | "));
    process.exit(1);
  }
}

main().catch(err => { console.error("TEST CRASHED:", err); process.exit(1); });
