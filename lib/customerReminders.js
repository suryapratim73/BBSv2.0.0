/**
 * customerReminders.js — per-customer automated payment reminders.
 *
 * Every 10 minutes the engine looks at each customer with a saved policy
 * whose reminder is enabled + an email on file, finds their unpaid bills,
 * and sends a reminder when one is due (due date at the policy time, then
 * daily/weekly/selected-weekdays repeats). State per bill lives in
 * config/customerReminders.json (`{ "<customerId>_<entryNo>": {...} }`) so
 * restarts never double-send.
 *
 * Sending goes through BBS Cloud (POST /send-payment-reminder) with the
 * Bearer + single 401-refresh retry used by the scheduler's dispatchMail
 * (API spec §3). DEV runs dry — no network, no real email. The server
 * endpoint is client-wired-only until the server side lands (like
 * /device/usage); everything else works without it.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { app, ipcMain } = require("electron");
const { Op } = require("sequelize");
const { sale, customer } = require("../model/dbConfig");
const { appLogger } = require("../common");
const { getCloudSession, refreshCloudConnection } = require("./cloudConnect");
const { loadPrintableBill, billPDF } = require("./scheduler");
const { normalizePolicy, computeFirstSendAt, computeNextSendAt, buildReminderMessage } = require("./customerPolicyLogic");

const APP_ENV = process.env.APP_ENV || "DEV";
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const FIRST_CHECK_DELAY = 30 * 1000;   // after app-ready

function statePath() {
    return APP_ENV === "PROD"
        ? path.resolve(app.getPath("appData"), "./BBS/config/customerReminders.json")
        : path.resolve(__dirname, "../config/customerReminders.json");
}

function readState() {
    try {
        return JSON.parse(fs.readFileSync(statePath(), "utf-8"));
    } catch (_) {
        return {};
    }
}

function writeState(state) {
    try {
        fs.mkdirSync(path.dirname(statePath()), { recursive: true });
        fs.writeFileSync(statePath(), JSON.stringify(state, null, 4));
    } catch (err) {
        appLogger({ title: "Reminder state write failed", message: String(err), func: "customerReminders.writeState" });
    }
}

/** Tolerant date parser for billDate values (ISO string / Date / DD-MM-YYYY). */
function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v !== "string" && typeof v !== "number") return null;
    const d = new Date(v);
    if (!isNaN(d)) return d;
    const m = String(v).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) {
        const parsed = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

function toObject(moreInfo) {
    if (moreInfo && typeof moreInfo === "object") return moreInfo;
    if (typeof moreInfo === "string") {
        try { return JSON.parse(moreInfo); } catch (_) { /* fall through */ }
    }
    return {};
}

async function postReminder(payload) {
    const host = process.env.UPDATE_REST || "code.mbtcverse.com";
    const post = token => axios.post(`https://${host}/send-payment-reminder`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
    });
    try {
        await post((await getCloudSession()).accessToken);
    } catch (err) {
        if (!(err && err.response && err.response.status === 401)) throw err;
        await refreshCloudConnection();
        const fresh = await getCloudSession();
        if (!fresh.signedIn)
            throw new Error("Cloud session expired — sign in again to send reminders.");
        await post(fresh.accessToken);
    }
}

/**
 * Scan customers with reminder policies and send anything due.
 * Returns a summary object for the IPC/log (DEV runs dry).
 */
async function checkReminders() {
    const dryRun = APP_ENV === "DEV";
    const now = new Date();
    const state = readState();
    const summary = { dryRun, sent: [], skipped: 0, postponed: 0, errors: [] };
    const liveKeys = new Set();

    const customers = (await customer.findAll()).map(({ dataValues }) => dataValues);
    const allSales = (await sale.findAll()).map(({ dataValues }) => dataValues);

    for (const cust of customers) {
        const verdict = normalizePolicy(toObject(cust.moreInfo)?.custPolicy);
        if (!verdict.ok) continue; // no saved policy (or unparsable) — nothing to remind
        const policy = verdict.policy;
        if (!policy.reminder.enabled) continue;
        const email = toObject(cust.moreInfo).email || cust.email || "";
        if (!email) continue; // no recipient — nothing to send to

        const unpaid = allSales.filter(b =>
            String(b.customerId) === String(cust.id) &&
            (b.paymentStatus === false || b.paymentStatus === null || b.paymentStatus === undefined));
        if (!unpaid.length) continue;

        const custBalance = unpaid.reduce((a, b) => a + Math.max(0, Number(b.billAmt) - Number(b.payment)), 0);

        for (const bill of unpaid) {
            const key = `${cust.id}_${bill.entryNo}`;
            liveKeys.add(key);
            const rec = state[key] || {};
            const dueDate = toDate(bill.billDate);
            if (!dueDate) {
                summary.skipped++;
                continue; // unparsable bill date — skip rather than mis-send
            }
            dueDate.setDate(dueDate.getDate() + Number(policy.dueDays || 0));

            let nextSendAt = rec.nextSendAt ? toDate(rec.nextSendAt) : null;
            if (!nextSendAt) {
                if (!policy.reminder.onDueDate) {
                    // only repeats matter, but we've never sent — start at the due date anyway
                    nextSendAt = computeFirstSendAt(dueDate, policy.reminder.repeat.time);
                } else {
                    nextSendAt = computeFirstSendAt(dueDate, policy.reminder.repeat.time);
                }
                if (!nextSendAt) { summary.skipped++; continue; }
                if (nextSendAt <= now) nextSendAt = now; // already past due — send on this check
            }
            if (nextSendAt > now) continue; // not yet time

            try {
                const dueAmt = Math.max(0, Math.round((Number(bill.billAmt) || 0) - (Number(bill.payment) || 0)));
                const vars = {
                    name: cust.name || "",
                    billNo: String(bill.billNo || ""),
                    dueAmt: dueAmt.toLocaleString("en-IN"),
                    dueDate: dueDate.toLocaleDateString("en-GB"),
                    balance: Math.round(custBalance),
                    biller: (process.presets && process.presets.biller) || ""
                };
                let attachment = null;
                if (policy.template.includePDF) {
                    const printable = await loadPrintableBill({ billObj: { billNo: String(bill.billNo), billDate: bill.billDate, name: cust.name }, saleRow: bill });
                    const pdfPath = await billPDF(printable);
                    if (pdfPath)
                        attachment = { fileName: path.basename(pdfPath), content: fs.readFileSync(pdfPath).toString("base64") };
                }
                const message = buildReminderMessage(policy.template, vars);
                const payload = {
                    to: [{ email_address: { address: email, name: cust.name || "" } }],
                    name: cust.name || "",
                    subject: `Payment reminder — bill ${vars.billNo}`,
                    message,
                    attachment,
                    biller: vars.biller
                };

                if (dryRun) {
                    // DEV: never hit the network
                } else {
                    const session = await getCloudSession();
                    if (!session.signedIn)
                        throw new Error("Not signed in to BBS Cloud — reminders need a signed-in account.");
                    try {
                        await postReminder(payload);
                    } catch (sendErr) {
                        if (!(sendErr && sendErr.response && sendErr.response.status === 429)) throw sendErr;
                        // Server rate-limited — park the record 30 min out so the 10-min
                        // engine doesn't double-send before the heartbeat flush retries it.
                        rec.nextSendAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
                        state[key] = rec;
                        pendingReminders.push({
                            key, rec,
                            repeat: policy.reminder.repeat,
                            email, name: cust.name || "",
                            subject: payload.subject, message, attachment, biller: vars.biller,
                            billNo: vars.billNo
                        });
                        summary.postponed++;
                        appLogger({
                            title: "Reminder postponed (429)",
                            message: `${cust.name} — bill ${vars.billNo} queued for heartbeat retry`,
                            func: "customerReminders.checkReminders"
                        });
                        continue; // not sent — leave sentCount/lastSentAt untouched
                    }
                }
                rec.lastSentAt = now.toISOString();
                rec.sentCount = (rec.sentCount || 0) + 1;
                rec.nextSendAt = computeNextSendAt(now, policy.reminder.repeat);
                if (!rec.nextSendAt) rec.nextSendAt = null; // no repeat → reminder is done
                state[key] = rec;
                summary.sent.push({
                    customer: cust.name,
                    billNo: vars.billNo,
                    via: dryRun ? "dry-run" : "email",
                    next: rec.nextSendAt ? new Date(rec.nextSendAt).toISOString() : null
                });
                appLogger({
                    title: dryRun ? "Reminder (dry-run)" : "Reminder sent",
                    message: `${cust.name} — bill ${vars.billNo}, due ${vars.dueDate} (send #${rec.sentCount})`,
                    func: "customerReminders.checkReminders"
                });
            } catch (err) {
                summary.errors.push(`${cust.name} — bill ${bill.billNo}: ${(err && err.message) || err}`);
                appLogger({ title: "Reminder error", message: String((err && err.message) || err), func: "customerReminders.checkReminders" });
            }
        }
    }

    // drop state for bills that are paid/gone so a fresh bill cycle starts clean
    for (const key of Object.keys(state)) {
        if (!liveKeys.has(key)) delete state[key];
    }
    writeState(state);
    return summary;
}

// ---- rate-limit postpone queue (flushed from main.js heartBeatFn) ----
// { key, rec, repeat, email, name, subject, message, attachment, biller, billNo }
const pendingReminders = [];

/** Heartbeat retry for reminder emails the cloud rate-limited (HTTP 429).
 *  Success marks the record sent exactly like checkReminders would; another
 *  429 leaves the item queued for the next heartbeat; other errors drop it —
 *  the 10-min engine re-derives due reminders from state anyway. */
async function flushPendingReminders() {
    if (pendingReminders.length === 0) return;
    const state = readState();
    let wrote = false;
    for (let i = 0; i < pendingReminders.length; ) {
        const item = pendingReminders[i];
        try {
            await postReminder({
                to: [{ email_address: { address: item.email, name: item.name } }],
                name: item.name,
                subject: item.subject,
                message: item.message,
                attachment: item.attachment,
                biller: item.biller
            });
            const now = new Date();
            const rec = { ...item.rec, lastSentAt: now.toISOString(), sentCount: (item.rec.sentCount || 0) + 1 };
            rec.nextSendAt = computeNextSendAt(now, item.repeat);
            if (!rec.nextSendAt) rec.nextSendAt = null; // no repeat → reminder is done
            state[item.key] = rec;
            wrote = true;
            pendingReminders.splice(i, 1);
            appLogger({
                title: "Postponed reminder sent",
                message: `${item.name} — bill ${item.billNo} (heartbeat retry #${rec.sentCount})`,
                func: "customerReminders.flushPendingReminders"
            });
        } catch (err) {
            if (err && err.response && err.response.status === 429) { i++; continue; } // still rate-limited — next heartbeat
            pendingReminders.splice(i, 1);
            appLogger({ title: "Postponed reminder failed", message: String((err && err.message) || err), func: "customerReminders.flushPendingReminders" });
        }
    }
    if (wrote) writeState(state);
}

let engineTimer = null;
let engineStarted = false;

function startReminderEngine() {
    if (engineStarted) return;
    engineStarted = true;
    const tick = () => checkReminders().catch(err =>
        appLogger({ title: "Reminder engine error", message: String(err && err.message || err), func: "customerReminders.tick" }));
    setTimeout(tick, FIRST_CHECK_DELAY);
    engineTimer = setInterval(tick, CHECK_INTERVAL);
}

function registerCustomerReminderIPC() {
    ipcMain.handle("check-customer-reminders", async () => checkReminders());
}

module.exports = { checkReminders, startReminderEngine, registerCustomerReminderIPC, flushPendingReminders };
