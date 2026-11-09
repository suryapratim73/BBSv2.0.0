/**
 * scheduler.js — Scheduler engine (main process).
 *
 * One timer per pending event (dedup by id; edit/remove cancel the timer),
 * long-horizon events re-arm in a chain (fixes the old >24.8-day skip), and a
 * small action pipeline: notify (OS + in-app), print (silent via SumatraPDF/lp
 * or manual via the PDF viewer), task (self-filled, multi-device deferred).
 * A burst tracker watches bill saves and offers one-click automation.
 *
 * Pure logic lives in schedulerLogic.js (unit-tested); this file is the
 * electron glue: timers, IPC, notifications, print dispatch.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { exec } = require("child_process");
const { ipcMain, Notification, shell } = require("electron");
const uuid = require("uuid");
const { getSchedulerPath } = require("../template/js/common");
const { getMainWindow } = require("../createModal");
const { getBillsDir, getPDF_FileName, openFormatForDate } = require("../common");
const { printSilent } = require("../printHandler");
const { getCloudSession, refreshCloudConnection } = require("./cloudConnect");
const {
    normalizeStore,
    applyFlag,
    appendHistory,
    createTimerManager,
    createBurstTracker
} = require("./schedulerLogic");

const APP_ENV = process.env.APP_ENV || "DEV";
const BURST_WINDOW_MS = 30 * 60 * 1000;

const timers = createTimerManager();
const burst = createBurstTracker({ windowMs: BURST_WINDOW_MS });

// ---- store ----

function readStore() {
    const p = getSchedulerPath();
    if (!fs.existsSync(p)) return normalizeStore(null);
    try { return normalizeStore(JSON.parse(fs.readFileSync(p, "utf-8"))); }
    catch (_) { return normalizeStore(null); }
}

function writeStore(data) {
    fs.mkdirSync(path.dirname(getSchedulerPath()), { recursive: true });
    fs.writeFileSync(getSchedulerPath(), JSON.stringify(data, null, 2));
}

/** Current settings (burst threshold etc.) with defaults applied. */
function settings() {
    return readStore().settings;
}

// ---- timers ----

function armEvent(evObj) {
    timers.arm(evObj, firedEvent => runEvent(firedEvent));
}

function reschedule() {
    timers.disarmAll();
    readStore().schedules.forEach(armEvent);
}

// ---- action pipeline ----

/** Human body text per event type (fixes the old "undefined" notification). */
function eventBody(evObj) {
    if (evObj.type === "reminder") return evObj.note || evObj.label;
    if (evObj.type === "bill-payment") {
        const bill = evObj.billObj || {};
        if (evObj.billType === "purchase-select")
            return `${bill.name} Bill No ${bill.billNo} Amount Rs.${Math.round(bill.total || 0)} is due for payment.`;
        return `${bill.name} Bill No ${bill.billNo} Amount Rs.${Math.round(bill.netAmtTax || 0)} is due for collection.`;
    }
    if (evObj.action === "print")
        return `Scheduled print: ${(evObj.billObj || {}).name || evObj.label} Bill No ${(evObj.billObj || {}).billNo || ""}`;
    if (evObj.action === "mail")
        return `Email due: ${(evObj.billObj || {}).name || evObj.label} Bill No ${(evObj.billObj || {}).billNo || ""} → ${(evObj.mail && evObj.mail.to) || "customer email"}`;
    if (evObj.action === "task")
        return `Task due: ${(evObj.task && evObj.task.prompt) || evObj.label}`;
    return evObj.label;
}

function showEventNotification(evObj) {
    try {
        const notification = new Notification({
            title: evObj.label,
            body: eventBody(evObj)
        });
        notification.show();
        shell.beep();
        notification.on("click", () => {
            const win = getMainWindow();
            if (win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
        });
    } catch (_) { /* notifications unavailable — non-fatal */ }
}

/** Load a printable sale bill for a stored event (snapshot + fresh items). */
async function loadPrintableBill(evObj) {
    const { sale, customer } = require("../model/dbConfig");
    const { getAllSales, getBillModel, appLogger, getFivePercentOfMemory } = require("../common");
    const { deserializeSchema } = require("../model/schemaLoader");
    const { DataTypes } = require("sequelize");

    const bill = evObj.billObj || {};
    const billNo = String(bill.billNo || "");
    if (!billNo) throw new Error("Event has no bill attached.");

    // callers that already hold the sale row (e.g. customerReminders) pass it
    // directly — getAllSales only returns the CURRENT financial year, so an
    // older bill would otherwise be "not found".
    const row = evObj.saleRow
        || (await getAllSales(sale, 0, appLogger, getFivePercentOfMemory)).find(r => String(r.billNo) === billNo);
    if (!row) throw new Error(`Bill ${billNo} not found in sales.`);

    const cust = row.customerId
        ? (await customer.findOne({ where: { id: row.customerId } }))?.dataValues
        : null;

    // bill items live in the dynamic per-bill table (same setup as saleHandler)
    const appPath = APP_ENV === "PROD" ? path.resolve(require("electron").app.getPath("appData"), "./BBS/") : path.resolve(__dirname, "..");
    const dynamicSchemaPath = path.resolve(appPath, "./model/dynamicSchemas.json");
    let billItemSchema;
    if (fs.existsSync(dynamicSchemaPath)) {
        const dynamicSchemaJson = fs.readFileSync(dynamicSchemaPath, "utf-8");
        ({ billItemSchema } = deserializeSchema(dynamicSchemaJson, DataTypes));
    }
    const billModel = await getBillModel(row.customerId, billNo, bill.billDate || row.billDate, billItemSchema);
    const orderItems = (await billModel.findAll()).map(({ dataValues }) => dataValues);

    // The stored event carries the bill's creation-time snapshot (billMeta +
    // customer fields flattened); the DB supplies the current item rows.
    const billMeta = {
        ...bill,
        billNo: row.billNo,
        billDate: row.billDate,
        billType: row.billType,
        netAmt: row.netAmt,
        netAmtTax: row.billAmt,
        tax: row.tax,
        paymentStatus: row.paymentStatus,
        printObj: { captions: ["Original Buyer's Copy"] }
    };
    delete billMeta.name; // customer name, not a billMeta field
    const customerObj = {
        name: bill.name || row.name || (cust && cust.name) || "",
        address: bill.address,
        phones: bill.phones,
        gst: bill.gst,
        ...(cust || {})
    };
    return { billMeta, customer: customerObj, orderItems };
}

async function dispatchAction(evObj) {
    if (evObj.action === "print") {
        const printable = await loadPrintableBill(evObj);
        let { billMeta: { billNo, billDate }, customer: { name } } = printable;
        billDate = openFormatForDate(new Date(billDate));
        let fileName = getPDF_FileName(name, billDate, billNo, false);
        let pdfPath = path.resolve(getBillsDir(), fileName);
        if (!fs.existsSync(pdfPath)) throw new Error("Saved bill PDF not found.");
        const pr = evObj.print || {};
        if (pr.mode === "manual" || APP_ENV === "DEV") {
            // DEV: dry-run — tests/dev never touch a real printer
            if (APP_ENV !== "DEV") shell.openPath(pdfPath);
            return {
                ok: true,
                detail: APP_ENV === "DEV"
                    ? `Dry-run: would ${pr.mode === "manual" ? "open" : "print"} ${path.basename(pdfPath)}${pr.mode === "silent" ? " on \"" + (pr.printer || "default") + "\"" : ""}.`
                    : `PDF opened for manual print: ${path.basename(pdfPath)}`
            };
        }
        await new Promise((resolve, reject) => {
            printSilent(pdfPath, pr.printer, pr.copies, pr.paperSize, err =>
                err ? reject(err) : resolve());
        });
        return { ok: true, detail: `Printed ${path.basename(pdfPath)} (${pr.copies}x, ${pr.paperSize}) on "${pr.printer || "default"}".` };
    }
    if (evObj.action === "task") {
        return { ok: true, detail: "Task due — awaiting input." };
    }
    if (evObj.action === "mail") {
        return dispatchMail(evObj);
    }
    return { ok: true, detail: "Notification shown." };
}

/**
 * Email a bill PDF to its customer via the cloud API (context-menu
 * "Notify Customer" reference: POST /send-bill-to-customer). A cloud
 * signed-in user with a subscription is required — the server enforces
 * the subscription, the app enforces the sign-in (with a token refresh
 * on 401 per BBSv2-Client-API.md §3). DEV runs dry — no network, no
 * real email.
 */
async function dispatchMail(evObj) {
    const printable = await loadPrintableBill(evObj);
    let { billMeta: { billNo, billDate }, customer: { name } } = printable;
    billDate = openFormatForDate(new Date(billDate));
    let fileName = getPDF_FileName(name, billDate, billNo, false);
    let pdfPath = path.resolve(getBillsDir(), fileName);
    if (!fs.existsSync(pdfPath)) throw new Error("Saved bill PDF not found.");
    const bill = evObj.billObj || {};
    const customer = printable.customer || {};
    const to = (evObj.mail && evObj.mail.to) || customer.email || "";
    if (!to)
        throw new Error("No recipient email — set one in the event or add an email to the customer.");
    if (APP_ENV === "DEV")
        return { ok: true, detail: `Dry-run: would email ${fileName} to ${to}.` };

    const session = await getCloudSession();
    if (!session.signedIn)
        throw new Error("Not signed in to BBS Cloud — emails need a signed-in account with a subscription.");

    const host = process.env.UPDATE_REST || "code.mbtcverse.com";
    const base64File = fs.readFileSync(pdfPath).toString("base64");
    const payload = {
        to: [{ email_address: { address: to, name: customer.name || bill.name || "" } }],
        name: customer.name || bill.name || "",
        attachment: { fileName, content: base64File },
        biller: (process.presets && process.presets.biller) || ""
    };
    const post = token => axios.post(`https://${host}/send-bill-to-customer`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
    });
    try {
        await post(session.accessToken);
    } catch (err) {
        if (!(err && err.response && err.response.status === 401))
            throw new Error(String((err.response && err.response.data && err.response.data.error) || err.message));
        // token expired — refresh and retry once (API spec §3)
        await refreshCloudConnection();
        const fresh = await getCloudSession();
        if (!fresh.signedIn) throw new Error("Cloud session expired — sign in again to send emails.");
        await post(fresh.accessToken);
    }
    return { ok: true, detail: `Emailed ${fileName} to ${to}.` };
}

/** Fire a due event: run its action, log history, move it along. */
async function runEvent(evObj) {
    let result;
    try {
        result = await dispatchAction(evObj);
    } catch (err) {
        result = { ok: false, detail: String((err && err.message) || err) };
    }
    const data = readStore();
    appendHistory(data, {
        id: evObj.id,
        label: evObj.label,
        action: evObj.action,
        ok: result.ok,
        detail: result.detail
    });
    if (evObj.action === "task") {
        // tasks stay listed until the user fills the input and completes them
        data.schedules = data.schedules.map(existing =>
            existing.id === evObj.id ? { ...existing, fired: true } : existing);
    } else {
        data.schedules = data.schedules.filter(existing => existing.id !== evObj.id);
        data.expiredSchedules.push(evObj);
    }
    writeStore(data);
    notifyRenderer(data);
}

function notifyRenderer(data) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("notification", data.expiredSchedules, true);
    win.webContents.send("update-content");
}

// ---- burst automation (bill saves) ----

/** Called after a sale bill is saved with its printable snapshot. */
function noteBillSaved(printable, billNo) {
    const s = settings();
    if (!s.burstEnabled) return;
    const { count, shouldAsk } = burst.noteSaved(
        { billNo: String(billNo || ""), printable },
        Number(s.burstThreshold) || 5
    );
    if (shouldAsk) {
        const win = getMainWindow();
        win && win.webContents.send("scheduler-burst", {
            count,
            bills: burst.peek().map(b => b.bill.billNo)
        });
    }
}

async function runBurstPrint() {
    const { openFormatForDate, getPDF_FileName, getBillsDir } = require("../common");
    const s = settings();
    const batch = burst.take();
    const results = [];
    for (const { bill } of batch) {
        let ok = false, detail = "";
        let { printable:{billMeta:{billNo,billDate},customer:{name}} } = bill;
        billDate = openFormatForDate(new Date(billDate));
        let fileName = getPDF_FileName(name,billDate,billNo,false);
        let pdfPath = path.resolve(getBillsDir(),fileName);
        if(APP_ENV !== "DEV" && !fs.existsSync(pdfPath)) {
            results.push({ ok: false, detail: "Saved bill PDF not found." });
            continue;
        }
        try {
            if (s.burstPrintMode === "manual") {
                if (APP_ENV !== "DEV")
                    shell.openPath(pdfPath);
                ok = true;
                detail = APP_ENV === "DEV"
                    ? `Dry-run: would print bill ${bill.billNo}.`
                    : `Opened bill ${bill.billNo} for manual print.`;
            } else {
                console.log("Print silent mode")
                if (APP_ENV === "DEV") {
                    // dry-run — a fake verify bill has no real PDF, and the
                    // printer must never be touched in DEV
                    ok = true;
                    detail = `Dry-run: would print bill ${bill.billNo} (${s.copies}x, ${s.paperSize}) on "${s.burstPrinter || "default"}".`;
                } else {
                    await new Promise((resolve, reject) => {
                        printSilent(pdfPath, s.burstPrinter, s.copies, s.paperSize, err =>
                            err ? reject(err) : resolve());
                    });
                    ok = true;
                    detail = `Printed bill ${bill.billNo} (${s.copies}x, ${s.paperSize}) on "${s.burstPrinter || "default"}".`;
                }
            }
        } catch (err) {
            detail = String((err && err.message) || err);
        }
        results.push({ ok, detail });
        ipcMain.emit("file-monitor-remove-invoice",null,pdfPath);
    }
    const data = readStore();
    appendHistory(data, {
        label: `Burst print (${results.length} bills)`,
        action: "print",
        ok: results.every(r => r.ok),
        detail: results.map((r, i) => `Bill ${batch[i].bill.billNo}: ${r.ok ? "ok" : "FAILED — " + r.detail}`).join(" | ")
    });
    writeStore(data);
    notifyRenderer(data);
    return results;
}

function dismissBurst() {
    burst.dismiss();
}

// ---- IPC ----

function registerSchedulerIPC() {
}
ipcMain.handle("scheduler-get-state", async () => {
    const data = readStore();
    let printers = [];
    try {
        const win = getMainWindow();
        if (win) printers = (await win.webContents.getPrintersAsync())
            .map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
    } catch (_) { /* printer enumeration unavailable */ }
    return {
        schedules: data.schedules,
        expiredSchedules: data.expiredSchedules,
        history: data.history,
        settings: data.settings,
        printers
    };
});

// add ("a") / edit ("e") — sanitized + re-armed
ipcMain.handle("scheduler-save-event", (e, evObj, flag) => {
    const data = readStore();
    if (flag !== "e" && !evObj.id) evObj.id = uuid.v4();
    applyFlag(data, evObj, flag);
    writeStore(data);
    reschedule();
    notifyRenderer(data);
    return { ok: true, schedules: data.schedules };
});

ipcMain.handle("scheduler-remove-event", (e, id) => {
    timers.disarm(id);
    const data = readStore();
    data.schedules = data.schedules.filter(existing => existing.id !== id);
    writeStore(data);
    notifyRenderer(data);
    return { ok: true };
});

ipcMain.handle("scheduler-dismiss-expired", (e, id) => {
    const data = readStore();
    data.expiredSchedules = data.expiredSchedules.filter(existing => existing.id !== id);
    writeStore(data);
    notifyRenderer(data);
    return { ok: true };
});

ipcMain.handle("scheduler-clear-expired", () => {
    const data = readStore();
    data.expiredSchedules = [];
    writeStore(data);
    notifyRenderer(data);
    return { ok: true };
});

ipcMain.handle("scheduler-complete-task", (e, { id, answer }) => {
    const data = readStore();
    const ev = data.schedules.find(existing => existing.id === id);
    if (!ev) return { ok: false, error: "Task not found." };
    timers.disarm(id);
    data.schedules = data.schedules.filter(existing => existing.id !== id);
    appendHistory(data, {
        id: ev.id,
        label: ev.label,
        action: "task",
        ok: true,
        detail: `Input accepted: ${String(answer || "").slice(0, 200)}`
    });
    writeStore(data);
    notifyRenderer(data);
    return { ok: true };
});

ipcMain.handle("scheduler-clear-history", () => {
    const data = readStore();
    data.history = [];
    writeStore(data);
    return { ok: true };
});

ipcMain.handle("scheduler-set-settings", (e, patch) => {
    const data = readStore();
    data.settings = { ...data.settings, ...(patch || {}) };
    writeStore(data);
    return { ok: true, settings: data.settings };
});

ipcMain.handle("scheduler-run-burst-print", async () => {
    return { ok: true, results: await runBurstPrint() };
});

ipcMain.handle("scheduler-dismiss-burst", () => {
    dismissBurst();
    return { ok: true };
});

// DEV-only test hook — lets the verify script simulate a burst of bill
// saves without touching the database. Never registered in production.
// Queues a printable-shaped snapshot so runBurstPrint walks the same
// destructure/pdf path real saves do (an empty printable would crash it).
if (APP_ENV === "DEV")
    ipcMain.handle("scheduler-dev-note-bill-saved", (e, billNo) => {
        noteBillSaved({
            billMeta: { billNo: String(billNo), billDate: new Date() },
            customer: { name: "DEV" }
        }, String(billNo));
        return { ok: true };
    });

// ---- compat layer (old manage-schedule flags + get-notification) ----
// Used by app-update emits (main.js) and any remaining direct writers.
ipcMain.on("manage-schedule", (e, data, flag, showMsg, updateKey) => {
    const store = readStore();
    applyFlag(store, data, flag, updateKey);
    writeStore(store);
    reschedule();
    notifyRenderer(store);
});

ipcMain.on("get-notification", e => {
    try {
        const data = readStore();
        const { BrowserWindow } = require("electron");
        const win = BrowserWindow.fromId(e.frameId);
        win && win.webContents.send("notification", data.expiredSchedules);
    } catch (err) {
        console.warn("get-notification:", err);
    }
});

/** Remove all events tied to a bill (cancel-bill cleanup). */
function removeBillEvents({ billNo, billDate, customerId }) {
    const data = readStore();
    const before = data.schedules.length;
    data.schedules = data.schedules.filter(ev => {
        const bill = ev.billObj || {};
        const sameNo = String(bill.billNo) === String(billNo);
        const sameCust = customerId == null || bill.id === customerId;
        if (!sameNo || !sameCust) return true;
        timers.disarm(ev.id);
        return false;
    });
    if (data.schedules.length !== before) {
        writeStore(data);
        notifyRenderer(data);
    }
    return data.schedules.length !== before;
}

/** Drop expired events tied to a bill (mark-bill-as-paid cleanup). */
function removeExpiredBillEvents({ billNo, customerId }) {
    const data = readStore();
    const before = data.expiredSchedules.length;
    data.expiredSchedules = data.expiredSchedules.filter(ev => {
        const bill = ev.billObj || {};
        const sameNo = String(bill.billNo) === String(billNo);
        const sameCust = customerId == null || bill.id === customerId;
        return !(sameNo && sameCust);
    });
    if (data.expiredSchedules.length !== before) {
        writeStore(data);
        notifyRenderer(data);
    }
    return data.expiredSchedules.length !== before;
}

/** Startup: register IPCs and arm all pending events. */
function init() {
    reschedule();
}

module.exports = {
    init,
    reschedule,
    armEvent,
    noteBillSaved,
    runBurstPrint,
    dismissBurst,
    removeBillEvents,
    removeExpiredBillEvents,
    readStore,
    writeStore,
    addEvent: (evObj) => {
        const data = readStore();
        if (!evObj.id) evObj.id = uuid.v4();
        applyFlag(data, evObj, "a");
        writeStore(data);
        reschedule();
        return data;
    }
};
