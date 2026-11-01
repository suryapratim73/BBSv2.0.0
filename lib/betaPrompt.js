/**
 * betaPrompt.js
 *
 * Pure decision logic for the Beta Program prompt — electron-free so jest can
 * test it directly (same pattern as lib/purchasePricing.js).
 *
 * The prompt asks the user to join the Beta Program once per launch. It is
 * skipped when the user is already a beta tester, asked not to be reminded
 * again, hasn't logged in yet (no GST) or the device id isn't ready.
 */

// Id used in the dismissed_banners.json store (viewManager) — never re-use it.
const BETA_PROMPT_ID = "beta-program-prompt";

/**
 * Decide whether the beta prompt should be shown.
 * @param {Object} opts
 * @param {boolean} opts.isDev            — true when the user is already a beta tester
 * @param {boolean} opts.hasDeviceId      — global.deviceUUID is ready
 * @param {boolean} opts.hasGst           — a business (GST) is logged in
 * @param {boolean} opts.dismissedForever — user checked "Don't ask me again" earlier
 * @param {boolean} opts.shownThisSession — prompt already shown in this session
 * @returns {{show:boolean, reason:string}}
 */
function shouldShowBetaPrompt({ isDev, hasDeviceId, hasGst, dismissedForever, shownThisSession }) {
    if (isDev === true)       return { show: false, reason: "already-beta" };
    if (dismissedForever)     return { show: false, reason: "dismissed-forever" };
    if (shownThisSession)     return { show: false, reason: "already-shown-this-session" };
    if (!hasDeviceId)         return { show: false, reason: "no-device-id" };
    if (!hasGst)              return { show: false, reason: "no-gst" };
    return { show: true, reason: "" };
}

module.exports = { shouldShowBetaPrompt, BETA_PROMPT_ID };
