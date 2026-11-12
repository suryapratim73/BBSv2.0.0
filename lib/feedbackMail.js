/**
 * feedbackMail.js
 *
 * Feedback + error-report mails for the BBSv2 desktop app.
 *
 *   - Renderer "Feedback" page (template/html/feedbackPage.html) lets the
 *     user send feedback / feature requests, with an optional single image
 *     attachment and an OPT-IN log snippet. Opened from BBS → Send Feedback.
 *   - Error entries in the notification panel (mainPage.js, Overview) carry a
 *     "Report" button that opens the same page pre-filled as an error report
 *     (mail_type locked to "error", message/metadata auto-filled).
 *
 * Both are the same "feedback mail" on the wire: POST
 *   {server}/admin/mails/register
 * with { device_id, user_id?, mail_type, subject?, message, metadata?, attachments? }.
 * The endpoint is PUBLIC (no auth) per route/adminRoutes.js.
 *
 * Privacy: metadata may contain a log snippet ONLY when the user ticks the
 * "include logs" checkbox in the form — logs can hold private business data,
 * so the renderer never requests them otherwise.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { ipcMain, app } = require("electron");
const { createModal, getMainWindow, getTargetWindow } = require("../createModal");
const { getTemplatePath } = require("../viewManager");
const {
    validateFeedbackPayload,
    formatFeedbackError,
    MAX_LOG_SNIPPET_CHARS
} = require("./feedbackMailLogic");
const {
    ensureSecret,
    getKekRootCandidates,
    getDeviceSerials,
    getLocalDateStr,
    appLogger
} = require("../common");
const { decryptLogFile, getEncLogDir } = require("../logHandler");
const { getCloudSession } = require("./cloudConnect");

/** Cloud server — same host as cloudConnect (UPDATE_REST wins when set). */
function cloudBaseURL() {
    return process.env.UPDATE_REST || "https://code.mbtcverse.com/";
}

/** App context merged into every mail's metadata so reports are actionable. */
function buildFeedbackMetadata(metadata) {
    const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    return {
        ...base,
        app: {
            appVersion: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            appEnv: process.env.APP_ENV || "DEV",
            versions: {
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node
            }
        }
    };
}

/** POST the shaped mail to the server. Returns { ok, data|error[, status] }. */
async function sendFeedbackMail(raw) {
    const verdict = validateFeedbackPayload(raw);
    if (!verdict.ok) return { ok: false, error: verdict.error, status: 400 };
    if (!global.deviceUUID)
        return { ok: false, error: "Your app is not registered yet. Please restart the app and try again." };
    const payload = verdict.payload;
    const body = {
        device_id: global.deviceUUID,
        mail_type: payload.mail_type,
        message: payload.message,
        metadata: buildFeedbackMetadata(payload.metadata)
    };
    if (payload.subject) body.subject = payload.subject;
    if (payload.attachments) body.attachments = payload.attachments;
    const session = await getCloudSession();
    if (session.signedIn) body.user_id = session.userId;
    try {
        const resp = await axios.post(cloudBaseURL() + "admin/mails/register", body, { timeout: 15000 });
        return { ok: true, data: resp.data };
    } catch (err) {
        console.log(err)
        appLogger({
            title: "Feedback Mail Error",
            message: String(err),
            func: "feedbackMail.sendFeedbackMail"
        });
        return { ok: false, error: formatFeedbackError(err), status: err && err.response && err.response.status };
    }
}

/** Last `limit` non-empty log lines (today's plaintext file first, else the
 *  newest .enc decrypted with the multi-KEK candidate chain). PRIVACY: called
 *  only after the user explicitly opts in from the feedback form. */
async function getRecentLogLines(limit = 50) {
    try {
        const dir = getEncLogDir();
        const todays = path.join(dir, `log-${getLocalDateStr()}.txt`);
        let text = "";
        if (fs.existsSync(todays))
            text = fs.readFileSync(todays, "utf8");
        else {
            const encs = fs.existsSync(dir)
                ? fs.readdirSync(dir).filter(file => file.endsWith(".enc")).sort() : [];
            const last = encs[encs.length - 1];
            if (!last) return "";
            const secret = await ensureSecret();
            const { motherboardSerial, diskSerial } = await getDeviceSerials();
            if (!motherboardSerial || !diskSerial || !process.presets.gst)
                return "";
            const kekCandidates = getKekRootCandidates(process.presets.gst, diskSerial, motherboardSerial)
                .map(({ gst, diskSerial: d, motherboardSerial: m }) =>
                    crypto.pbkdf2Sync(secret, gst + m + d, 100000, 32, "sha256"));
            for (const kek of kekCandidates) {
                text = await decryptLogFile(path.join(dir, last), kek);
                if (text) break;
            }
        }
        const lines = text.split("\n")
            .map(line => line.trim())
            .filter(line => line !== "")
            .slice(-limit)
            .join("\n");
        return lines.slice(0, MAX_LOG_SNIPPET_CHARS);
    } catch (err) {
        appLogger({
            title: "Feedback Log Snippet Error",
            message: String(err),
            func: "feedbackMail.getRecentLogLines"
        });
        return "";
    }
}

// ---- Feedback window -------------------------------------------------------

let pendingPrefill = null;

/** Open (or focus + update) the Feedback page. `prefill` is non-null only for
 *  error reports — a plain menu open never overwrites the form. */
function openFeedbackWindow(prefill, parentWindow) {
    let win = null;
    try { win = getTargetWindow("Feedback-Page"); } catch (_) { /* not open */ }
    if (win && prefill) {
        win.focus();
        win.webContents.send("feedback-prefill", prefill);
        return win;
    }
    if (win) {
        win.focus();
        return win;
    }
    pendingPrefill = prefill || null;
    const modal = createModal({
        width: 640,
        height: 700,
        resizable: true,
        title: "Feedback",
        parent: parentWindow || getMainWindow()
    }, getTemplatePath("feedbackPage"), { maxWinCount: 1, label: "Feedback-Page" });
    modal.on("closed", () => { pendingPrefill = null; });
    return modal;
}

// ---- IPC -------------------------------------------------------------------

function registerFeedbackIPC() {
    ipcMain.handle("send-feedback-mail", async (event, payload) => sendFeedbackMail(payload));
    ipcMain.handle("get-feedback-prefill", async () => pendingPrefill);
    ipcMain.handle("get-recent-log-lines", async () => getRecentLogLines(50));
    ipcMain.on("open-feedback-window", (event, prefill) => {
        openFeedbackWindow(prefill && typeof prefill === "object" ? prefill : null);
    });
}

module.exports = {
    registerFeedbackIPC,
    sendFeedbackMail,
    openFeedbackWindow,
    feedbackWindow: mainWindow => openFeedbackWindow(null, mainWindow)
};
