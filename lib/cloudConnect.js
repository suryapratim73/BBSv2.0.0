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
    validateTotpPayload,
    formatCloudError,
    toPublicState,
    defaultCloudState
} = require("./cloudConnectLogic");

// keytar service name — matches the app's existing keychain entry convention
const SERVICE_NAME = "BBSv2_ERP";
const ACCESS_TOKEN_ACCOUNT = "CodemintCloudAccessToken";
const REFRESH_TOKEN_ACCOUNT = "CodemintCloudRefreshToken";

/** Cloud server — code.mbtcverse.com (user-hosted; the API is served on
 *  HTTPS 443, port 3030 is not exposed directly). UPDATE_REST (set in .env)
 *  wins when set, so packaged builds can still override the host. DEV now
 *  uses the same live server — the old 192.168.0.110:3030 dev box is dead. */
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

/** The device's permanent identity on the server = global.deviceUUID, the
 *  hardware-bound uuid.v5 derived from (secret, GST, serials) — one id per
 *  machine, stable across installs/reinstalls, so per-machine install limits
 *  (email↔deviceId binding) work even for silent installs without signup.
 *  The stored value is a mirror: it is overwritten whenever it differs from
 *  the hardware id (migrating legacy v4 ids from older builds), and it only
 *  serves as a placeholder while the hardware id is still pending. */
function loadOrCreateDeviceId() {
    const hardwareId = global.deviceUUID;
    if (hardwareId) {
        const state = getCloudState();
        if (state.deviceId !== hardwareId) saveCloudState({ deviceId: hardwareId });
        return hardwareId;
    }
    const state = getCloudState();
    return state.deviceId || null;
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

/** Signup and login are the same server call — the account is matched by Email
 *  (BBSv2-Client-API.md §2). Returns { ok, data|error[, status] }. */
async function registerDevice(rawPayload) {
    const verdict = validateCloudPayload(rawPayload);
    if (!verdict.ok) return { ok: false, error: verdict.error, status: 400 };
    const payload = verdict.payload;
    const deviceId = global.deviceUUID; console.log({deviceId})
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
        if(data.accessToken && data.refreshToken)
            await storeTokens(data.accessToken, data.refreshToken);
        saveCloudState({
            userId: data.userId || null,
            isDev: data.isDev === true,
            authSet:data.authSet,
            verification_expires:data?.verification_expires,
            profile: {
                gstNumber: payload.gstNumber,
                email: payload.email,
                name: payload.name || prevProfile.name || "",
                phone: payload.phone || prevProfile.phone || "",
                company_name: payload.company_name || prevProfile.company_name || "",
                company_address: payload.company_address || prevProfile.company_address || "",
                totp_secret:data.totp_secret || null
            },
            deviceName: payload.device_name || prevState.deviceName || os.hostname(),
            platform: cloudPlatform(),
            lastConnectedAt: new Date().toISOString()
        });
        // Sign-in/sign-up completed with tokens stored — notify main.js so it
        // can offer the Beta Program prompt while the server's beta status is fresh.
        if (data.accessToken && data.refreshToken && onSignedInHook)
            onSignedInHook(data.isDev === true);
        return { ok: true, data: await rendererState(), authSet:data.authSet, verification_expires:data?.verification_expires };
    } catch (err) {
        appLogger({
            title: "Cloud Connect Register Error",
            message: String(err),
            func: "cloudConnect.registerDevice"
        });
        console.log(err);
        return { ok: false, error: formatCloudError(err), status: err?.response?.status };
    }
}

/** Step 2 of signup: the bbs://verify-email?token=… link from the
 *  verification email. POST /api/auth/verify-email →
 *  { message, user, totp: { secret, qrCode, manualEntry } }. The TOTP data is
 *  persisted so the renderer can show the QR even after a cold-start
 *  protocol launch. */
async function verifyEmailToken(token) {
    if (!token || typeof token !== "string")
        return { ok: false, error: "Missing verification token." };
    try {
        const resp = await axios.post(cloudBaseURL() + "api/auth/verify-email", { token }, { timeout: 8000 });
        const data = resp.data && typeof resp.data === "object" ? resp.data : {};
        const totp = data.totp && typeof data.totp === "object" ? data.totp : null;
        saveCloudState({
            pendingTotp: totp ? {
                secret: typeof totp.secret === "string" ? totp.secret : "",
                qrCode: typeof totp.qrCode === "string" ? totp.qrCode : "",
                manualEntry: typeof totp.manualEntry === "string" ? totp.manualEntry : "",
                user: data.user && typeof data.user === "object" ? data.user : null
            } : null
        });
        return { ok: true, data: await rendererState() };
    } catch (err) {
        appLogger({
            title: "Cloud Connect Verify Email Error",
            message: String(err),
            func: "cloudConnect.verifyEmailToken"
        });
        return { ok: false, error: formatCloudError(err), status: err?.response?.status };
    }
}

/** Step 3 of signup: the user scanned the QR, picked a password and entered
 *  their authenticator code. POST /api/auth/verify-totp → { token } (JWT).
 *  The JWT is kept in cloud.json for now — the access/refresh exchange is a
 *  later step. */
async function verifyTotp(rawPayload) {
    const verdict = validateTotpPayload(rawPayload);
    if (!verdict.ok) return { ok: false, error: verdict.error, status: 400 };
    const { password, totpCode } = verdict.payload;
    const state = getCloudState();
    const pending = state.pendingTotp && typeof state.pendingTotp === "object" ? state.pendingTotp : null;
    const email = (pending && pending.user && pending.user.email)
        || (state.profile && state.profile.email) || null;
    try {
        const resp = await axios.post(cloudBaseURL() + "api/auth/verify-totp", {
            email,
            password,
            totp_code: totpCode
        }, { timeout: 8000 });
        const data = resp.data && typeof resp.data === "object" ? resp.data : {};
        const jwt = typeof data.token === "string" ? data.token
            : (typeof data.jwt === "string" ? data.jwt : null);
        if (!jwt)
            return { ok: false, error: "The server did not return a JWT token." };
        // Step 4b: swap the JWT for the API access/refresh pair so the device
        // is signed in (userId + accessToken) in one go. Best-effort — servers
        // without /device/jwt-exchange fall back to the stored JWT, where
        // signed-in state arrives on the next register call, as before.
        let exchanged = false;
        try {
            const exResp = await axios.post(cloudBaseURL() + "device/jwt-exchange", { token: jwt }, { timeout: 8000 });
            const exData = exResp.data && typeof exResp.data === "object" ? exResp.data : {};
            if (exData.accessToken && exData.refreshToken) {
                await storeTokens(exData.accessToken, exData.refreshToken);
                saveCloudState({
                    pendingTotp: null,
                    jwt,
                    userId: exData.userId || (data.user && data.user.id) || state.userId,
                    isDev: exData.isDev === true,
                    authSet: true,
                    lastConnectedAt: new Date().toISOString()
                });
                exchanged = true;
                // JWT exchange signed the device in — offer the Beta prompt now.
                if (onSignedInHook)
                    onSignedInHook(exData.isDev === true);
            }
        } catch (exErr) {
            appLogger({
                title: "Cloud Connect JWT Exchange Error",
                message: String(exErr),
                func: "cloudConnect.verifyTotp"
            });
        }
        if (!exchanged) {
            // userId comes from the server's sanitized user — the local state
            // has no userId until the access/refresh exchange lands
            saveCloudState({ pendingTotp: null, jwt, userId: (data.user && data.user.id) || state.userId });
        }
        return { ok: true, data: await rendererState() };
    } catch (err) {
        appLogger({
            title: "Cloud Connect Verify TOTP Error",
            message: String(err),
            func: "cloudConnect.verifyTotp"
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
    const deviceId = global.deviceUUID;
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
    ipcMain.handle("cloud-verify-totp", async (event, payload) => verifyTotp(payload));
    ipcMain.handle("get-cloud-usage", async () => getDeviceUsage());
}

/** main.js registers a callback that fires whenever a sign-in/sign-up
 *  completes (tokens stored) — used to offer the Beta Program prompt. */
let onSignedInHook = null;
function setOnSignedIn(fn) {
    if (typeof fn !== "function") { onSignedInHook = null; return; }
    onSignedInHook = fn;
}

module.exports = { registerCloudIPC, verifyEmailToken, getCloudSession, getDeviceUsage, refreshCloudConnection, setOnSignedIn };
