/**
 * feedbackMailLogic.js
 *
 * Pure validation + shaping for feedback / error-report mails sent to
 * the server's public `admin/mails/register` endpoint. No Electron,
 * no I/O — unit-testable in isolation (see __tests__/feedbackMailLogic.test.js).
 *
 * Server contract (route/adminRoutes.js `POST /admin/mails/register`):
 *   - compulsory: message (string, trimmed, non-empty)
 *   - device_id / mail_type / subject / metadata / attachments optional server-side,
 *     but the app always sends device_id (global.deviceUUID) and mail_type.
 *   - metadata: JSON object, app-enforced max 1 MB (may carry a user-approved
 *     log snippet — the renderer only requests logs when the user explicitly
 *     opts in, because logs can contain private business data).
 *   - attachments: a SINGLE JSON object { url: <image dataURL>, type: <png|jpg|…> }.
 *     Server rejects more than one attachment and sizes over 5 MB — the app
 *     enforces both client-side as well.
 */

const MAIL_TYPES = ["feedback", "error", "request"];

const MAX_MESSAGE_CHARS = 10000;
const MAX_SUBJECT_CHARS = 255;
const MAX_METADATA_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
// Log snippets inside metadata are capped well below the 1 MB metadata limit
// (privacy + size guard; logs are included only when the user opts in).
const MAX_LOG_SNIPPET_CHARS = 150000;

/** Approximate binary size of a base64 payload (4 chars ≈ 3 bytes). */
function base64Bytes(b64) {
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Validate + shape a raw renderer payload.
 * Returns { ok:true, payload } or { ok:false, error }.
 * The shaped payload contains only the sanitized optional fields — the
 * compulsory device_id/mail_type/message assembly happens in feedbackMail.js
 * (device_id must come from the main process).
 */
function validateFeedbackPayload(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return { ok: false, error: "Invalid payload." };
    const { mail_type, subject, message, metadata, attachments } = raw;
    if (typeof message !== "string" || !message.trim())
        return { ok: false, error: "Message is required." };
    const out = {
        mail_type: MAIL_TYPES.includes(mail_type) ? mail_type : "feedback",
        message: message.trim().slice(0, MAX_MESSAGE_CHARS)
    };
    if (subject !== undefined && subject !== null) {
        if (typeof subject !== "string")
            return { ok: false, error: "Subject must be a string." };
        if (subject.trim())
            out.subject = subject.trim().slice(0, MAX_SUBJECT_CHARS);
    }
    if (metadata !== undefined && metadata !== null) {
        if (typeof metadata !== "object" || Array.isArray(metadata))
            return { ok: false, error: "Metadata must be a JSON object." };
        if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES)
            return { ok: false, error: "Metadata too large (max 1 MB)." };
        out.metadata = metadata;
    }
    out.attachments = [],sizeSum = 0;
    for(const attachment of attachments){
        if (attachment !== undefined && attachment !== null) {
            if (typeof attachment.url !== "string" || !attachment.url.startsWith("data:image/"))
                return { ok: false, error: "Attachment must be an image dataURL." };
            const b64 = attachment.url.split(",")[1] || "";
            const byteSize = base64Bytes(b64);
            if (byteSize > MAX_ATTACHMENT_BYTES)
                return { ok: false, error: "Attachment too large (max 5 MB)." };
            sizeSum += byteSize;
            const mime = (attachment.url.match(/^data:image\/([\w+-]+)/) || [])[1] || "png";
            out.attachments.push({
                url: attachment.url,
                type: typeof attachment.type === "string" && attachment.type.trim()
                    ? attachment.type.trim().toLowerCase() : mime
            });
        }
    }
    if(sizeSum>MAX_ATTACHMENT_BYTES)
        return { ok:false, error:"Aggregated attachments size too large (max 5 MB)." }
    return { ok: true, payload: out };
}

/** Shape the server error into one user-friendly line. */
function formatFeedbackError(err) {
    const serverError = err && err.response && err.response.data && err.response.data.error;
    if (serverError) return String(serverError);
    if (err && err.code === "ECONNABORTED") return "The server did not respond in time. Please try again.";
    if (err && err.message) return String(err.message);
    return "Failed to send. Please check your internet connection and try again.";
}

module.exports = {
    MAIL_TYPES,
    MAX_MESSAGE_CHARS,
    MAX_SUBJECT_CHARS,
    MAX_METADATA_BYTES,
    MAX_ATTACHMENT_BYTES,
    MAX_LOG_SNIPPET_CHARS,
    base64Bytes,
    validateFeedbackPayload,
    formatFeedbackError
};
