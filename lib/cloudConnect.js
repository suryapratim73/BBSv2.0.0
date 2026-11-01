/**
 * cloudConnect.js
 *
 * Cloud Connect + remote Dashboard backend for the BBSv2 desktop app.
 * Implements the client side of BBSv2-Client-API.md §2-3:
 *   - device identity: UUID v4 generated once, persisted in config/cloud.json
 *   - signup/login:    POST /device/register (one call for both, matched by GST)
 *   - tokens:          accessToken/refreshToken in the OS keychain (keytar),
 *                      with a config/cloud-auth.json fallback
 *   - sign out / refresh connection
 *
 * The renderer talks to this module only through the IPC channels registered
 * by registerCloudIPC() — main.js calls it once and stays otherwise untouched.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const uuid = require("uuid");
const keytar = require("keytar");
const { ipcMain } = require("electron");
const { appLogger, getBaseDir } = require("../common");
const {
    validateCloudPayload,
    formatCloudError,
    toPublicState,
    defaultCloudState
} = require("./cloudConnectLogic");

// keytar service name — matches the app's existing keychain entry convention
const SERVICE_NAME = "BBSv2_ERP";
const ACCESS_TOKEN_ACCOUNT = "CloudAccessToken";
const REFRESH_TOKEN_ACCOUNT = "CloudRefreshToken";

/** Cloud server — code.mbtcverse.com (user-hosted; the API is served on
 *  HTTPS 443, port 3030 is not exposed directly). UPDATE_REST wins when set,
 *  so packaged builds can still override the host. */
function cloudBaseURL() {
    return process.env.UPDATE_REST || "https://code.mbtcverse.com/";
}

/** The API spec accepts "win" | "linux". */
function cloudPlatform() {
    if (process.platform === "win32") return "win";
    if (process.platform === "linux") return "linux";
    return process.platform;
}

function stateFilePath() {
    return path.join(getBaseDir(), "config", "cloud.json");
}

function authFallbackFilePath() {
    return path.join(getBaseDir(), "config", "cloud-auth.json");
}

// ---- state (config/cloud.json) -------------------------------------------

function getCloudState() {
    try {
        const state = JSON.parse(fs.readFileSync(stateFilePath()).toString());
        if (!state || typeof state !== "object") throw new Error("bad state file");
        return { ...defaultCloudState("", cloudPlatform()), ...state };
    } catch (_) {
        return defaultCloudState("", cloudPlatform());
    }
}

function saveCloudState(partial) {
    try {
        fs.writeFileSync(stateFilePath(), JSON.stringify({ ...getCloudState(), ...partial }, null, 2));
    } catch (err) {
        appLogger({
            title: "Cloud Connect State Save Error",
            message: String(err),
            func: "cloudConnect.saveCloudState"
        });
    }
}

/** UUID v4 — the device's permanent identity on the server. Generated once,
 *  persisted, and never regenerated (BBSv2-Client-API.md §9). */
function loadOrCreateDeviceId() {
    const state = getCloudState();
    if (state.deviceId) return state.deviceId;
    const deviceId = uuid.v4();
    saveCloudState({ deviceId });
    return deviceId;
}

// ---- tokens (OS keychain with a file fallback) ----------------------------

async function storeTokens(accessToken, refreshToken) {
    try {
        if (accessToken) await keytar.setPassword(SERVICE_NAME, ACCESS_TOKEN_ACCOUNT, accessToken);
        if (refreshToken) await keytar.setPassword(SERVICE_NAME, REFRESH_TOKEN_ACCOUNT, refreshToken);
        // marker file so a later keytar failure falls back to nothing, not stale tokens
        fs.writeFileSync(authFallbackFilePath(), JSON.stringify({ keychain: true }));
    } catch (err) {
        // keytar unavailable (no keyring) — fall back to the file store
        fs.writeFileSync(authFallbackFilePath(), JSON.stringify({
            accessToken: accessToken || null,
            refreshToken: refreshToken || null
        }));
        appLogger({
            title: "Cloud Connect Token Store Fallback",
            message: String(err),
            func: "cloudConnect.storeTokens"
        });
    }
}

async function getTokens() {
    try {
        const accessToken = await keytar.getPassword(SERVICE_NAME, ACCESS_TOKEN_ACCOUNT);
        if (accessToken)
            return {
                accessToken,
                refreshToken: (await keytar.getPassword(SERVICE_NAME, REFRESH_TOKEN_ACCOUNT)) || null
            };
    } catch (_) { /* fall through to the file store */ }
    try {
        const parsed = JSON.parse(fs.readFileSync(authFallbackFilePath()).toString());
        return {
            accessToken: parsed.accessToken || null,
            refreshToken: parsed.refreshToken || null
        };
    } catch (_) {
        return { accessToken: null, refreshToken: null };
    }
}

async function clearTokens() {
    try {
        await keytar.deletePassword(SERVICE_NAME, ACCESS_TOKEN_ACCOUNT);
        await keytar.deletePassword(SERVICE_NAME, REFRESH_TOKEN_ACCOUNT);
    } catch (_) { /* keytar unavailable — the file store is cleared below */ }
    try {
        fs.writeFileSync(authFallbackFilePath(), JSON.stringify({}));
    } catch (_) { /* nothing else to do */ }
}

// ---- server calls ----------------------------------------------------------

/** Signup and login are the same server call — the account is matched by GST
 *  (BBSv2-Client-API.md §2). Returns { ok, data|error[, status] }. */
async function registerDevice(rawPayload) {
    const verdict = validateCloudPayload(rawPayload);
    if (!verdict.ok) return { ok: false, error: verdict.error, status: 400 };
    const payload = verdict.payload;
    const deviceId = loadOrCreateDeviceId();
    const prevState = getCloudState();
    const prevProfile = prevState.profile && typeof prevState.profile === "object" ? prevState.profile : {};
    try {
        const resp = await axios.post(cloudBaseURL() + "device/register", {
            deviceId,
            ...payload,
            device_name: payload.device_name || os.hostname(),
            platform: cloudPlatform()
        }, { timeout: 8000 });
        const data = resp.data && typeof resp.data === "object" ? resp.data : {};
        await storeTokens(data.accessToken, data.refreshToken);
        saveCloudState({
            userId: data.userId || null,
            isDev: data.isDev === true,
            // sign-in sends only GST + email — keep richer details this
            // device already knows instead of overwriting them with empties
            profile: {
                gstNumber: payload.gstNumber,
                email: payload.email,
                name: payload.name || prevProfile.name || "",
                phone: payload.phone || prevProfile.phone || "",
                company_name: payload.company_name || prevProfile.company_name || "",
                company_address: payload.company_address || prevProfile.company_address || ""
            },
            deviceName: payload.device_name || prevState.deviceName || os.hostname(),
            platform: cloudPlatform(),
            lastConnectedAt: new Date().toISOString()
        });
        return { ok: true, data: await rendererState() };
    } catch (err) {
        appLogger({
            title: "Cloud Connect Register Error",
            message: String(err),
            func: "cloudConnect.registerDevice"
        });
        return { ok: false, error: formatCloudError(err), status: err?.response?.status };
    }
}

/** Re-sync with the server. /device/register is idempotent and safe to call
 *  repeatedly — it returns the existing pair while valid and refreshes it
 *  once the access token expires (API spec §2 "Token reuse"). */
async function refreshCloudConnection() {
    const state = getCloudState();
    if (!state.userId) return { ok: false, error: "You are not signed in to BBS Cloud." };
    const profile = state.profile && typeof state.profile === "object" ? state.profile : {};
    return registerDevice({ ...profile, device_name: state.deviceName });
}

async function cloudSignout() {
    await clearTokens();
    // keep deviceId + profile so the next sign-in is pre-filled
    saveCloudState({ userId: null, isDev: false, lastConnectedAt: null });
    return { ok: true, data: await rendererState() };
}

async function rendererState() {
    const tokens = await getTokens();
    return toPublicState(getCloudState(), tokens, {
        gst: typeof process.presets?.gst === "string" ? process.presets.gst : "",
        companyName: typeof process.presets?.biller === "string" ? process.presets.biller : ""
    });
}

/** Cloud session for other main-process modules (the scheduler's email gate):
 *  signedIn requires a userId + a stored access token. */
async function getCloudSession() {
    const state = getCloudState();
    const tokens = await getTokens();
    return {
        signedIn: Boolean(state.userId && tokens.accessToken),
        userId: state.userId || null,
        accessToken: tokens.accessToken || null
    };
}

/** Device usage for the Overview cloud widget: GET /device/usage?id={deviceId}
 *  → { creditBalance, emailsSent }. Bearer auth with a single 401-refresh
 *  retry, same contract as the scheduler's email gate (API spec §3).
 *  Returns { ok, data|error } — never throws; the widget degrades to "—". */
async function getDeviceUsage() {
    const session = await getCloudSession();
    if (!session.signedIn)
        return { ok: false, error: "You are not signed in to BBS Cloud." };
    const deviceId = loadOrCreateDeviceId();
    const get = token => axios.get(cloudBaseURL() + "device/usage", {
        params: { id: deviceId },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000
    });
    try {
        const resp = await get(session.accessToken);
        const data = resp.data && typeof resp.data === "object" ? resp.data : {};
        return { ok: true, data: {
            creditBalance: typeof data.creditBalance === "number" ? data.creditBalance : null,
            emailsSent: typeof data.emailsSent === "number" ? data.emailsSent : null
        } };
    } catch (err) {
        if (err && err.response && err.response.status === 401) {
            // token expired — refresh and retry once
            const refreshed = await refreshCloudConnection();
            if (refreshed.ok) {
                try {
                    const resp = await get((await getCloudSession()).accessToken);
                    const data = resp.data && typeof resp.data === "object" ? resp.data : {};
                    return { ok: true, data: {
                        creditBalance: typeof data.creditBalance === "number" ? data.creditBalance : null,
                        emailsSent: typeof data.emailsSent === "number" ? data.emailsSent : null
                    } };
                } catch (retryErr) {
                    return { ok: false, error: formatCloudError(retryErr), status: retryErr?.response?.status };
                }
            }
            return { ok: false, error: refreshed.error || "Token refresh failed." };
        }
        return { ok: false, error: formatCloudError(err), status: err?.response?.status };
    }
}

// ---- IPC -------------------------------------------------------------------

function registerCloudIPC() {
    ipcMain.handle("cloud-get-state", async () => {
        loadOrCreateDeviceId(); // create the persistent device id on first visit
        return rendererState();
    });
    ipcMain.handle("cloud-register", async (event, payload) => registerDevice(payload));
    ipcMain.handle("cloud-refresh", async () => refreshCloudConnection());
    ipcMain.handle("cloud-signout", async () => cloudSignout());
    ipcMain.handle("get-cloud-usage", async () => getDeviceUsage());
}

module.exports = { registerCloudIPC, getCloudSession, getDeviceUsage, refreshCloudConnection };
