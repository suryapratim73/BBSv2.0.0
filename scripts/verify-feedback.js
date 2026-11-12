/**
 * Static verification of the Feedback form + error reporting feature:
 *   - mail goes to POST {server}/admin/mails/register via lib/feedbackMail.js
 *     with device_id (global.deviceUUID), mail_type, message, metadata, attachments.
 *   - validation limits (1 attachment, 5 MB image, 1 MB metadata) in
 *     lib/feedbackMailLogic.js.
 *   - BBS → Send Feedback menu item + notification-panel "Report" button wiring.
 *   - PRIVACY: log lines are only requested after the user ticks the
 *     include-logs checkbox (never on load); the form warns about private data.
 *
 * Pure static checks — no Electron required.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const mail = read("lib/feedbackMail.js");
const logic = read("lib/feedbackMailLogic.js");
const menu = read("menuTemplate.js");
const main = read("main.js");
const logHandler = read("logHandler.js");
const commonJs = read("template/js/common.js");
const commonCss = read("template/css/common.css");
const pageHtml = read("template/html/feedbackPage.html");
const pageJs = read("template/js/feedbackPage.js");
const mainPageJs = read("template/js/mainPage.js");
const mainPageHtml = read("template/html/mainPage.html");
const help = read("HELP.md");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(name); console.log(`\x1b[31m✗\x1b[0m ${name}`); }
}
const between = (str, from, to) => {
  const a = str.indexOf(from);
  const b = str.indexOf(to, a);
  return a === -1 || b === -1 ? "" : str.slice(a, b);
};

// ---- 1. Server call (lib/feedbackMail.js) ----
{
  const post = between(mail, "axios.post", "});");
  const sender = between(mail, "async function sendFeedbackMail", "// ---- Feedback window");
  check("mail endpoint is POST {server}/admin/mails/register", post.includes('cloudBaseURL() + "admin/mails/register"'));
  check("body carries device_id = global.deviceUUID (compulsory)", sender.includes("device_id: global.deviceUUID"));
  check("body carries mail_type + message (compulsory)", sender.includes("mail_type: payload.mail_type") && sender.includes("message: payload.message"));
  check("metadata enriched with app context (version/platform)", mail.includes("buildFeedbackMetadata") && mail.includes("appVersion: app.getVersion()"));
  check("user_id added only when cloud signed in", mail.includes("if (session.signedIn) body.user_id = session.userId"));
  check("device id missing → friendly error (no mail sent)", mail.includes("not registered yet"));
  check("sender returns {ok,data|error} and never throws", mail.includes("return { ok: false, error: formatFeedbackError(err)"));
  check("send-feedback-mail / get-feedback-prefill / get-recent-log-lines / open-feedback-window IPC registered", ["send-feedback-mail", "get-feedback-prefill", "get-recent-log-lines", "open-feedback-window"].every(c => mail.includes(c)));
  check("feedback window is a createModal page (maxWinCount 1, Feedback-Page)", mail.includes('label: "Feedback-Page"') && mail.includes("maxWinCount: 1"));
}

// ---- 2. Validation limits (lib/feedbackMailLogic.js) ----
{
  check("mail types = feedback|error|request", JSON.stringify(["feedback", "error", "request"]) === JSON.stringify(["feedback", "error", "request"]) && /MAIL_TYPES = \[[\s\S]*"feedback", "error", "request"\]/.test(logic));
  check("message is compulsory (trim + required)", logic.includes('!message.trim()') && logic.includes('"Message is required."'));
  check("metadata limited to 1 MB", logic.includes("MAX_METADATA_BYTES = 1 * 1024 * 1024"));
  check("attachment limited to 5 MB", logic.includes("MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024"));
  check("only 1 attachment allowed (arrays rejected)", logic.includes('Array.isArray(attachments)') && logic.includes('"Only 1 attachment is allowed."'));
  check("attachment must be an image dataURL with type", logic.includes('startsWith("data:image/")') && logic.includes("type"));
}

// ---- 3. Entry points ----
{
  check("BBS menu has Send Feedback (opens feedbackWindow)", /label: "Send Feedback"[\s\S]*feedbackWindow\(mainWindow\)/.test(menu));
  check("menuTemplate imports feedbackWindow", menu.includes('require("./lib/feedbackMail")'));
  check("main.js registers the feedback IPC", main.includes('registerFeedbackIPC') && main.includes('require("./lib/feedbackMail")'));
  check("logHandler exports decryptLogFile + getEncLogDir for reuse", logHandler.includes("exports.decryptLogFile") && logHandler.includes("exports.getEncLogDir"));
}

// ---- 4. Error-entry Report button (notification panel, mainPage.js) ----
{
  // Strip comments so commented-out code (the removed toast button) is ignored.
  const stripComments = (str) => str
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check("toast has no live report button (comment-only)", !/report-error-btn/.test(stripComments(between(commonJs, "function toastNotification", "exports.showToastNotification"))));
  check("toast duration back to default 2000ms (no 12s extension)", commonJs.includes("2000 + 200*index") && !commonJs.includes("12000"));
  check("no live .report-error-btn rules in common.css", !/\.report-error-btn/.test(stripComments(commonCss)));
  check("common.js exports openErrorReport", commonJs.includes("exports.openErrorReport = openErrorReport"));
  check("openErrorReport opens the pre-filled feedback window (open-feedback-window)", /function openErrorReport[\s\S]*open-feedback-window/.test(commonJs));
  check("prefill is error-typed with message + context metadata", commonJs.includes('mail_type:"error"') && commonJs.includes("callerStack") && commonJs.includes("metadata"));
  check("openErrorReport merges caller-supplied metadata", commonJs.includes("Object.assign(metadata,extraMetadata)"));
  check("openErrorReport stays main-process safe (ipcRenderer guarded)", /function openErrorReport[\s\S]*if\(!ipcRenderer\) return/.test(commonJs));
  check("mainPage.js destructures openErrorReport", /openErrorReport \} = require\("\.\.\/js\/common"\)/.test(mainPageJs));
  check("Error notification entries get the Report button", /job\.type==="Error"[\s\S]*report-error-btn-template/.test(mainPageJs));
  check("mainPage.html defines the report-error button template", mainPageHtml.includes('id="report-error-btn-template"') && mainPageHtml.includes('data-cmd="report-error"'));
  check("notificationAction handles report-error → openErrorReport", /cmd==="report-error"[\s\S]*openErrorReport\(/.test(mainPageJs));
  check("report prefill carries the notification context (label/tag/time)", /cmd==="report-error"[\s\S]*notification:\{[\s\S]*label: evObj\.label/.test(mainPageJs));
}

// ---- 5. Feedback page ----
{
  check("type select offers feedback/request/error", /<option value="feedback"[^>]*>Feedback<\/option>[\s\S]*<option value="request"[^>]*>Feature request<\/option>[\s\S]*<option value="error"[^>]*>Error report<\/option>/.test(pageHtml));
  check("message textarea required + max attachment note", pageHtml.includes('id="fb-message"') && pageHtml.includes("required") && pageHtml.includes("max 5 MB"));
  check("single image attachment via file picker (accept image/*)", pageHtml.includes('accept="image/*"'));
  check("PRIVACY warning text present (logs may contain private data)", /Privacy:[\s\S]*private business data/i.test(pageHtml));
  check("include-logs checkbox defaults off (no checked attr)", /<input type="checkbox" id="fb-include-logs"[^>]*>/.test(pageHtml) && !/<input type="checkbox" id="fb-include-logs"[^>]*checked/.test(pageHtml));
  check("error mode locks type to error + autofills", pageJs.includes('setAttribute("disabled", true)') && pageJs.includes("enterErrorMode"));
  check("prefill read on load + pushed updates while open", pageJs.includes('invoke("get-feedback-prefill")') && pageJs.includes('ipcRenderer.on("feedback-prefill"'));
  check("attachment size checked before read (5 MB)", pageJs.includes("MAX_ATTACHMENT_MB * 1024 * 1024") && pageJs.includes("Attachment too large"));
  // PRIVACY: log lines fetched ONLY inside the checkbox change handler, never at init
  const logInvokeIdx = pageJs.indexOf('invoke("get-recent-log-lines")');
  const logHandlerIdx = pageJs.indexOf('includeLogs.addEventListener("change"');
  check("log lines requested only after the user ticks the checkbox", logInvokeIdx !== -1 && logHandlerIdx !== -1 && logInvokeIdx > logHandlerIdx);
  check("logs dropped when the checkbox is unticked", pageJs.includes("logSnippet = null"));
  check("mail sent via send-feedback-mail with conditional metadata/attachments", pageJs.includes('invoke("send-feedback-mail"') && pageJs.includes("payload.attachments = currentAttachment"));
}

// ---- 6. HELP.md ----
{
  check("HELP.md documents Send Feedback + error reporting", /Send Feedback/.test(help) && /error report/i.test(help));
  check("HELP.md notes logs are opt-in/private", /log[^\n]*privat/i.test(help) || /privat[^\n]*log/i.test(help));
}

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed.length) {
  console.log("Failed:");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
