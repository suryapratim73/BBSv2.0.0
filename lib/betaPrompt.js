/**
 * betaPrompt.js
 *
 * Pure decision logic for the Beta Program prompt — electron-free so jest can
 * test it directly (same pattern as lib/purchasePricing.js).
 *
 * The prompt offers a standard user a one-time opt-in to the Beta Program. It
 * is triggered when the user signs up / signs in to BBS Cloud, or when the
 * app runs while they stay signed in. The caller persists the dismissal
 * BEFORE showing, so the offer never auto-repeats across launches; the manual
 * menu item (BBS → Beta Program) bypasses this gate. Skipped when the user is
 * already a beta tester, the offer was already made, or they are not signed
 * in to BBS Cloud yet.
 */

// Id used in the dismissed_banners.json store (viewManager) — never re-use it.
const BETA_PROMPT_ID = "beta-program-prompt";

/**
 * Decide whether the beta prompt should be shown.
 * @param {Object} opts
 * @param {boolean} opts.isDev            — true when the user is already a beta tester
 * @param {boolean} opts.hasDeviceId      — global.deviceUUID is ready
 * @param {boolean} opts.cloudSignedIn    — the user is signed in to BBS Cloud
 * @param {boolean} opts.dismissedForever — the one-time offer was already made
 * @param {boolean} opts.shownThisSession — prompt already shown in this session
 * @returns {{show:boolean, reason:string}}
 */
function shouldShowBetaPrompt({ isDev, hasDeviceId, cloudSignedIn, dismissedForever, shownThisSession }) {
    if (isDev === true)       return { show: false, reason: "already-beta" };
    if (dismissedForever)     return { show: false, reason: "dismissed-forever" };
    if (shownThisSession)     return { show: false, reason: "already-shown-this-session" };
    if (!hasDeviceId)         return { show: false, reason: "no-device-id" };
    if (!cloudSignedIn)       return { show: false, reason: "not-signed-in" };
    return { show: true, reason: "" };
}

module.exports = { shouldShowBetaPrompt, BETA_PROMPT_ID };
