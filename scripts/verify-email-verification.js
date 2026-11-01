/**
 * verify-email-verification.js — verification pass for the email
 * verification flow (signup steps 2-4).
 *
 *   node scripts/verify-email-verification.js
 *
 * Sections:
 *   A. protocol URL → token parsing (the exact shapes the OS delivers,
 *      incl. the trailing-slash form Windows sends)
 *   B. lib/cloudConnect offline, with electron/keytar/axios mocked and the
 *      state dir pointed at a TEMP folder — the real config/cloud.json is
 *      never written (verified by content hash at the end):
 *        - verifyEmailToken: missing token, server 400, network failure,
 *          success → pendingTotp persisted to state + public shape
 *        - verifyTotp (via the real cloud-verify-totp IPC handler):
 *          validation rejections, server 400, missing-JWT response, success
 *          → jwt persisted + pendingTotp cleared; the posted request shape
 *          { email, password, totp_code } is asserted (server contract);
 *          the JWT→pair exchange to device/jwt-exchange is asserted too
 *          (request shape, keychain store, signed-in state) with a fallback
 *          case for servers without the endpoint
 *   C. live API contract (code.mbtcverse.com), side-effect free:
 *        - verify-email with a bogus token / empty body → 400
 *        - verify-totp with a bogus payload → 4xx, never 200
 *        - gated real flow: set VERIFY_TOKEN=<token from a real email> to
 *          also verify the 200 success shape (CONSUMES the token server-side)
 *
 * The warm protocol forward (bbs:// link → running app) needs a live app and
 * was verified manually; the renderer TOTP card is covered by the manual
 * flow. No app state files or keychain entries are touched.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const BASE = process.env.CLOUD_BASE_URL || "https://code.mbtcverse.com/";
const ROOT = path.join(__dirname, "..");
const REAL_STATE = path.join(ROOT, "config", "cloud.json");

// ---- mocks (installed BEFORE requiring lib/cloudConnect) -------------------

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "bbs-verify-email-"));
fs.mkdirSync(path.join(TEMP, "config"), { recursive: true });

const ipcHandlers = new Map();
const keytarCalls = [];   // setPassword calls, asserted by the exchange checks
const keytarStore = new Map(); // in-memory keychain so getPassword sees setPassword
const mockAxios = { post: async () => { throw new Error("no axios mock set"); } };
const axios = require("axios"); // real axios, captured before the override

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return { ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) } };
  if (request === "keytar")
    return {
      setPassword: async (service, account, password) => { keytarCalls.push({ service, account, password }); keytarStore.set(account, password); },
      getPassword: async (service, account) => keytarStore.get(account) || null,
      deletePassword: async () => {}
    };
  if (request === "axios") return mockAxios;
  if (request === "../common")
    return { appLogger: () => {}, getBaseDir: () => TEMP }; // isolate state writes
  return realLoad.apply(this, arguments);
};

const cloudConnect = require("../lib/cloudConnect");
const logic = require("../lib/cloudConnectLogic");

// ---- helpers ---------------------------------------------------------------

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function skip(name, detail = "") {
  console.log(`SKIP  ${name}${detail ? " — " + detail : ""}`);
}

function isJwt(s) { return typeof s === "string" && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s); }

function tempState() {
  try { return JSON.parse(fs.readFileSync(path.join(TEMP, "config", "cloud.json")).toString()); } catch (_) { return {}; }
}

function setMockPost(impl) { mockAxios.post = impl; }

function axiosError(status, data) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

async function call(method, url, { data } = {}) {
  try {
    const resp = await axios({
      method,
      url: BASE + url.replace(/^\//, ""),
      data,
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
      validateStatus: () => true
    });
    return { status: resp.status, body: resp.data };
  } catch (err) {
    return { status: err.response?.status || 0, body: err.response?.data, error: err.message };
  }
}

async function main() {
  const realStateBefore = fs.existsSync(REAL_STATE) ? fs.readFileSync(REAL_STATE).toString() : "(missing)";
  console.log("base:", BASE, "| temp state:", TEMP, "\n");

  // ---- A. protocol URL → token parsing (mirrors main.js handleProtocolUrl) --
  const parse = url => { try { return new URL(url).searchParams.get("token"); } catch (_) { return null; } };
  check("url: plain form bbs://verify-email?token=x", parse("bbs://verify-email?token=abc123") === "abc123");
  check("url: trailing-slash form Windows delivers", parse("bbs://verify-email/?token=abc123") === "abc123");
  check("url: extra params keep the token", parse("bbs://verify-email?token=abc123&x=1") === "abc123");
  check("url: missing token → null", parse("bbs://verify-email") === null);

  // ---- B. module behaviour (offline, temp state) ----------------------------
  const okTotpResponse = {
    message: "Registration completed. Please setup TOTP authentication.",
    user: { id: "user-123", email: "accounts@example.com" },
    totp: { secret: "JBSWY3DPEHPK3PXP", qrCode: "data:image/png;base64,QRXYZ", manualEntry: "JBSWY3DPEHPK3PXP" }
  };

  const missingToken = await cloudConnect.verifyEmailToken("");
  check("verify-email: missing token rejected without a call", missingToken.ok === false && missingToken.error.includes("Missing"), missingToken.error);

  setMockPost(async () => { throw axiosError(400, { error: "Invalid or expired token" }); });
  const badToken = await cloudConnect.verifyEmailToken("bogus");
  check("verify-email: server 400 → ok:false with mapped error", badToken.ok === false && badToken.error.includes("Invalid or expired token"), badToken.error);
  check("verify-email: 400 saves no pendingTotp", !tempState().pendingTotp, JSON.stringify(tempState().pendingTotp || null));

  setMockPost(async () => { throw { message: "ECONNREFUSED" }; });
  const offline = await cloudConnect.verifyEmailToken("bogus");
  check("verify-email: network failure → connection message", offline.ok === false && offline.error.includes("Could not reach"), offline.error);

  setMockPost(async () => ({ data: okTotpResponse }));
  const good = await cloudConnect.verifyEmailToken("good-token");
  const saved = tempState();
  check("verify-email: success → ok:true", good.ok === true);
  check("verify-email: pendingTotp persisted (secret, qrCode, manualEntry, user)",
    saved.pendingTotp?.secret === "JBSWY3DPEHPK3PXP" && saved.pendingTotp?.qrCode === "data:image/png;base64,QRXYZ"
    && saved.pendingTotp?.manualEntry === "JBSWY3DPEHPK3PXP" && saved.pendingTotp?.user?.id === "user-123",
    JSON.stringify(saved.pendingTotp || {}).slice(0, 140));
  check("verify-email: public state exposes pendingTotp", good.data.pendingTotp?.qrCode === "data:image/png;base64,QRXYZ" && good.data.pendingTotp?.manualEntry === "JBSWY3DPEHPK3PXP");

  // verifyTotp is reached through the real IPC channel, like the renderer
  cloudConnect.registerCloudIPC();
  check("ipc: cloud-verify-totp registered", ipcHandlers.has("cloud-verify-totp"));
  const invokeTotp = payload => ipcHandlers.get("cloud-verify-totp")({}, payload);

  setMockPost(async () => { throw new Error("should not be called"); });
  check("verify-totp: short password rejected locally", (await invokeTotp({ password: "short", confirmPassword: "short", totpCode: "123456" })).ok === false);
  check("verify-totp: mismatched passwords rejected locally", (await invokeTotp({ password: "password123", confirmPassword: "different1", totpCode: "123456" })).ok === false);
  check("verify-totp: non-6-digit code rejected locally", (await invokeTotp({ password: "password123", confirmPassword: "password123", totpCode: "12345" })).ok === false);

  setMockPost(async () => { throw axiosError(400, { error: "Wrong code" }); });
  const totpBad = await invokeTotp({ password: "password123", confirmPassword: "password123", totpCode: "000000" });
  check("verify-totp: server 400 → mapped error", totpBad.ok === false && totpBad.error.includes("Wrong code"), totpBad.error);

  setMockPost(async () => ({ data: { ok: true } }));
  const noJwt = await invokeTotp({ password: "password123", confirmPassword: "password123", totpCode: "123456" });
  check("verify-totp: response without JWT → ok:false", noJwt.ok === false && noJwt.error.includes("JWT"), noJwt.error);

  const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoidXNlci0xMjMifQ.sig";
  let lastTotpPost = null;
  setMockPost(async (url, body) => {
    if (String(url).includes("verify-totp")) lastTotpPost = body;
    // no access/refresh pair in the response → the exchange falls back to
    // the stored JWT (server without /device/jwt-exchange)
    return { data: { token: TEST_JWT } };
  });
  const totpGood = await invokeTotp({ password: "password123", confirmPassword: "password123", totpCode: "123456" });
  const after = tempState();
  check("verify-totp: posts { email, password, totp_code } to the server",
    lastTotpPost && lastTotpPost.email === "accounts@example.com" && lastTotpPost.password === "password123" && lastTotpPost.totp_code === "123456",
    JSON.stringify(lastTotpPost));
  check("verify-totp: success → ok:true", totpGood.ok === true);
  check("verify-totp: jwt saved to state and exposed", isJwt(after.jwt) && totpGood.data.jwt === after.jwt, (after.jwt || "").slice(0, 40) + "…");
  check("verify-totp: pendingTotp cleared", after.pendingTotp === null);
  check("verify-totp: fallback — exchange returned no pair → still signed-out, JWT kept",
    totpGood.data.signedIn === false && isJwt(after.jwt));

  // exchange path: re-seed pendingTotp, mock the pair response, and assert
  // the device ends up signed in with tokens in the keychain
  fs.writeFileSync(path.join(TEMP, "config", "cloud.json"), JSON.stringify({
    deviceId: "dev-1",
    pendingTotp: { user: { id: "user-123", email: "accounts@example.com" }, secret: "JBSWY3DPEHPK3PXP" }
  }));
  let lastExchangePost = null;
  setMockPost(async (url, body) => {
    if (String(url).includes("verify-totp")) lastTotpPost = body;
    if (String(url).includes("jwt-exchange")) {
      lastExchangePost = body;
      return { data: { accessToken: "acc-token", refreshToken: "ref-token", userId: "user-123", isDev: true, authSet: true } };
    }
    return { data: { token: TEST_JWT } };
  });
  const totpEx = await invokeTotp({ password: "password123", confirmPassword: "password123", totpCode: "654321" });
  const afterEx = tempState();
  check("verify-totp: exchange posts { token } to device/jwt-exchange",
    lastExchangePost && lastExchangePost.token === TEST_JWT, JSON.stringify(lastExchangePost));
  check("verify-totp: exchange pair stored in the keychain",
    keytarCalls.some(c => c.account === "CodemintCloudAccessToken" && c.password === "acc-token")
    && keytarCalls.some(c => c.account === "CodemintCloudRefreshToken" && c.password === "ref-token"),
    JSON.stringify(keytarCalls.map(c => c.account)));
  check("verify-totp: exchange success → signed in (authSet, userId from server)",
    totpEx.ok === true && totpEx.data.signedIn === true && afterEx.authSet === true
    && afterEx.userId === "user-123" && afterEx.pendingTotp === null);

  // ---- C. live API contract (side-effect free) ------------------------------
  const root = await call("GET", "/");
  check("live: server reachable", root.status === 200, "status " + root.status);

  const bogus = await call("POST", "/api/auth/verify-email", { data: { token: "bogus-token" } });
  check("live: verify-email bogus token → 400", bogus.status === 400, "status " + bogus.status + " " + JSON.stringify(bogus.body).slice(0, 100));

  const empty = await call("POST", "/api/auth/verify-email", { data: {} });
  check("live: verify-email empty body → 400", empty.status === 400, "status " + empty.status + " " + JSON.stringify(empty.body).slice(0, 100));

  const totpGarbage = await call("POST", "/api/auth/verify-totp", {
    data: { email: "bogus@example.com", password: "password123", totp_code: "000000" }
  });
  check("live: verify-totp bogus payload → 4xx (never 200)",
    totpGarbage.status >= 400 && totpGarbage.status < 500, "status " + totpGarbage.status + " " + JSON.stringify(totpGarbage.body).slice(0, 100));

  if (process.env.VERIFY_TOKEN) {
    const real = await call("POST", "/api/auth/verify-email", { data: { token: process.env.VERIFY_TOKEN } });
    const totp = real.body?.totp;
    check("live: REAL token → 200 + totp { secret, qrCode, manualEntry }",
      real.status === 200 && typeof totp?.secret === "string" && typeof totp?.qrCode === "string" && typeof totp?.manualEntry === "string",
      "status " + real.status + " " + JSON.stringify(real.body).slice(0, 160));
  } else {
    skip("live: REAL token flow (set VERIFY_TOKEN=<token from a real email> — consumes the token server-side)");
  }

  // ---- D. safety: the real app state file was never written -----------------
  const realStateAfter = fs.existsSync(REAL_STATE) ? fs.readFileSync(REAL_STATE).toString() : "(missing)";
  check("safety: real config/cloud.json untouched", realStateAfter === realStateBefore,
    "before=" + realStateBefore.length + "B after=" + realStateAfter.length + "B");

  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("failed:", failed.map(f => f.name).join(" | "));
    process.exit(1);
  }
}

main().catch(err => { console.error("VERIFY CRASHED:", err); process.exit(1); });
