/**
 * feedbackPage.js — Feedback / Feature request / Error report window.
 *
 * Opened two ways:
 *   - BBS → Send Feedback: empty form, type selectable (Feedback / Feature request).
 *   - "Report" button on a red error toast: pre-filled error report, type locked
 *     to "error", message + metadata auto-filled, subject pre-set.
 *
 * Privacy: attachments and log lines are ONLY sent when the user adds them —
 * the log checkbox defaults to off and warns that logs can contain private
 * business data.
 */
const { ipcRenderer } = require("electron");

const MAX_ATTACHMENT_MB = 5;
const typeSelect = document.getElementById("fb-type");
const subjectInput = document.getElementById("fb-subject");
const messageArea = document.getElementById("fb-message");
const attachBtn = document.getElementById("fb-attach-btn");
const attachFile = document.getElementById("fb-attachment-file");
const attachInfo = document.getElementById("fb-attachment-info");
const attachPreview = document.getElementById("fb-attachment-preview");
const attachImg = document.getElementById("fb-attachment-img");
const removeAttachBtn = document.getElementById("fb-remove-attachment");
const includeLogs = document.getElementById("fb-include-logs");
const logsStatus = document.getElementById("fb-logs-status");
const metadataDetails = document.getElementById("fb-metadata-details");
const metadataView = document.getElementById("fb-metadata-view");
const sendBtn = document.getElementById("fb-send");
const statusLine = document.getElementById("fb-status");

let currentAttachment = null; // { url, type }
let logSnippet = null;        // only ever set after the user ticks the checkbox
let prefillMetadata = null;   // context captured at the error toast
let sending = false;

function setStatus(text, kind = "err") {
    statusLine.textContent = text;
    statusLine.className = `fb-status ${kind}`;
    statusLine.classList.remove("hide");
}
function clearStatus() {
    statusLine.textContent = "";
    statusLine.classList.add("hide");
}

/** Turn the error mode on: type locked to "error", contextual fields filled. */
function enterErrorMode(prefill) {
    document.getElementById("fb-title").textContent = "Report a problem";
    document.getElementById("fb-tagline").textContent = "Send an error report to BBS support — the important fields are filled for you.";
    typeSelect.value = "error";
    typeSelect.setAttribute("disabled", true);
    if (prefill.subject) subjectInput.value = prefill.subject;
    if (prefill.message) messageArea.value = prefill.message;
    if (prefill.metadata && typeof prefill.metadata === "object") {
        prefillMetadata = prefill.metadata;
        metadataView.textContent = JSON.stringify(prefillMetadata, null, 2);
        metadataDetails.classList.remove("hide");
    }
}

function applyPrefill(prefill) {
    if (!prefill || typeof prefill !== "object") return;
    if (prefill.mail_type === "error") enterErrorMode(prefill);
}

// Prefill can arrive in two ways: the window was created for the report
// (fetched on load) or it was already open (pushed via feedback-prefill).
(async function init() {
    applyPrefill(await ipcRenderer.invoke("get-feedback-prefill"));
})();
ipcRenderer.on("feedback-prefill", (event, prefill) => applyPrefill(prefill));

// ---- attachment ------------------------------------------------------------

attachBtn.addEventListener("click", () => attachFile.click());

attachFile.addEventListener("change", () => {
    const file = attachFile.files && attachFile.files[0];
    attachFile.value = ""; // allow re-picking the same file later
    if (!file) return;
    if (!/^image\//.test(file.type))
        return setStatus("Only image files can be attached.");
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024)
        return setStatus(`Attachment too large — max ${MAX_ATTACHMENT_MB} MB.`);
    clearStatus();
    const reader = new FileReader();
    reader.onload = () => {
        currentAttachment = {
            url: String(reader.result),
            type: file.type.split("/")[1] || "png"
        };
        attachImg.src = currentAttachment.url;
        attachPreview.classList.remove("hide");
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        attachInfo.textContent = `${file.name} (${sizeMB} MB) — attached`;
    };
    reader.readAsDataURL(file);
});

removeAttachBtn.addEventListener("click", () => {
    currentAttachment = null;
    attachImg.removeAttribute("src");
    attachPreview.classList.add("hide");
    attachInfo.textContent = "";
});

// ---- opt-in log snippet (privacy: only on explicit user action) ------------

includeLogs.addEventListener("change", async () => {
    if (!includeLogs.checked) {
        logSnippet = null;
        logsStatus.textContent = "";
        return;
    }
    logsStatus.textContent = "Reading logs…";
    const logs = await ipcRenderer.invoke("get-recent-log-lines");
    if (logs) {
        logSnippet = logs;
        logsStatus.textContent = `Included — last ${logs.split("\n").length} log lines.`;
    } else {
        logSnippet = null;
        includeLogs.checked = false;
        logsStatus.textContent = "No logs available.";
    }
});

// ---- submit ----------------------------------------------------------------

document.getElementById("feedback-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    clearStatus();
    const message = messageArea.value.trim();
    if (!message) {
        messageArea.focus();
        return setStatus("Message is required.");
    }
    const payload = {
        mail_type: typeSelect.value,
        subject: subjectInput.value.trim() || null,
        message
    };
    const metadata = {};
    if (prefillMetadata) Object.assign(metadata, prefillMetadata);
    if (logSnippet) metadata.logs = logSnippet;
    if (Object.keys(metadata).length)
        payload.metadata = metadata;
    if (currentAttachment)
        payload.attachments = currentAttachment;
    sending = true;
    sendBtn.setAttribute("disabled", true);
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
    const resp = await ipcRenderer.invoke("send-feedback-mail", payload);
    sending = false;
    sendBtn.removeAttribute("disabled");
    sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send';
    if (resp && resp.ok) {
        setStatus("Sent — thank you!", "ok");
        setTimeout(() => window.close(), 1200);
    } else {
        setStatus(resp && resp.error ? resp.error : "Failed to send. Please check your internet connection and try again.");
    }
});

document.getElementById("fb-cancel").addEventListener("click", () => window.close());
