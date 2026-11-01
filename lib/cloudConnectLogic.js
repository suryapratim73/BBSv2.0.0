/**
 * cloudConnectLogic.js
 *
 * Pure decision/validation logic for Cloud Connect — electron/axios-free so
 * jest can test it directly (same pattern as lib/betaPrompt.js).
 *
 * Implements the client-side rules of BBSv2-Client-API.md §2:
 *   - GSTIN is the account identity (one business = one account, many devices)
 *   - signup and login are the same call (POST /device/register)
 *   - server-side validation rules are mirrored here for a friendly UI
 */

// GSTIN pattern from BBSv2-Client-API.md §2 (server-side regex, case-insensitive)
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Length limits from the API spec
const MAX_PHONE_LENGTH = 20;
const MAX_DEVICE_NAME_LENGTH = 255;

/**
 * Normalize + validate the signup/login payload. Returns either
 * `{ ok:false, error }` or `{ ok:true, payload }` with every field trimmed
 * and the GST uppercased (the server matches accounts by GST, case-insensitively).
 * @param {Object} raw — raw fields from the renderer form
 */
function validateCloudPayload(raw = {}) {
    const p = typeof raw === "object" && raw !== null ? raw : {};
    const payload = {
        gstNumber: String(p.gstNumber || "").trim().toUpperCase(),
        email: String(p.email || "").trim(),
        name: String(p.name || "").trim(),
        phone: String(p.phone || "").trim(),
        company_name: String(p.company_name || "").trim(),
        company_address: String(p.company_address || "").trim(),
        device_name: String(p.device_name || "").trim()
    };
    if (!GST_PATTERN.test(payload.gstNumber))
        return { ok: false, error: "Enter a valid GST number, e.g. 27AAPFU0939F1ZV." };
    if (payload.email && !EMAIL_PATTERN.test(payload.email))
        return { ok: false, error: "Enter a valid email address." };
    if (payload.phone.length > MAX_PHONE_LENGTH)
        return { ok: false, error: `Phone number must be ${MAX_PHONE_LENGTH} characters or less.` };
    if (payload.device_name.length > MAX_DEVICE_NAME_LENGTH)
        return { ok: false, error: `Device name must be ${MAX_DEVICE_NAME_LENGTH} characters or less.` };
    return { ok: true, payload };
}

/**
 * Map an axios error to a user-facing message (API spec §2 error table).
 * @param {Object} err — axios error with optional err.response
 */
function formatCloudError(err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    if (status === 409)
        return "This email address is already used by another business account.";
    if (status === 400) {
        const detail = Array.isArray(data?.details) && data.details.length
            ? data.details.join(" ")
            : (typeof data?.error === "string" ? data.error : "");
        return detail || "The server rejected the request. Please check the details and try again.";
    }
    if (status === 500)
        return "The BBS Cloud server ran into a problem. Please try again later.";
    if (!status)
        return "Could not reach the BBS Cloud server. Check your internet connection and try again.";
    return typeof data?.error === "string" ? data.error : `BBS Cloud error (${status}). Please try again.`;
}

/**
 * Shape main-process state for the renderer. `signedIn` requires both a
 * stored user id and a stored access token — either alone is signed out.
 * @param {Object} state   — on-disk state from config/cloud.json
 * @param {Object} tokens  — { accessToken, refreshToken } from the keychain
 * @param {Object} prefill — { gst, companyName } from app presets
 */
function toPublicState(state = {}, tokens = {}, prefill = {}) {
    const profile = state.profile && typeof state.profile === "object" ? state.profile : {};
    return {
        signedIn: Boolean(state.userId && tokens.accessToken),
        deviceId: state.deviceId || "",
        userId: state.userId || "",
        isDev: state.isDev === true,
        profile: {
            gstNumber: profile.gstNumber || "",
            email: profile.email || "",
            name: profile.name || "",
            phone: profile.phone || "",
            company_name: profile.company_name || "",
            company_address: profile.company_address || ""
        },
        deviceName: state.deviceName || "",
        platform: state.platform || "",
        lastConnectedAt: state.lastConnectedAt || "",
        prefill: {
            gst: typeof prefill.gst === "string" ? prefill.gst : "",
            companyName: typeof prefill.companyName === "string" ? prefill.companyName : ""
        }
    };
}

/** Fresh on-disk state skeleton. The deviceId is created once and never
 *  regenerated — losing it would create a duplicate device row server-side
 *  (BBSv2-Client-API.md §9). */
function defaultCloudState(deviceId = "", platform = "") {
    return {
        deviceId,
        userId: null,
        isDev: false,
        platform,
        deviceName: "",
        profile: {},
        lastConnectedAt: null
    };
}

module.exports = {
    GST_PATTERN,
    EMAIL_PATTERN,
    MAX_PHONE_LENGTH,
    MAX_DEVICE_NAME_LENGTH,
    validateCloudPayload,
    formatCloudError,
    toPublicState,
    defaultCloudState
};
