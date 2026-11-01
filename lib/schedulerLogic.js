/**
 * schedulerLogic.js — pure scheduler logic (no electron imports, unit-tested).
 *
 * Everything here operates on plain data / injectable timers so it can run
 * under node:test. lib/scheduler.js is the electron glue: real timers, IPC,
 * OS notifications, and the print dispatch.
 */

// Node's setInterval/setTimeout clamp delays above 2^31-1 ms (~24.8 days) to
// 1ms. Long-horizon events are armed for at most this long and re-armed when
// the short timer fires — the chain walks a month-long event to its due time.
const MAX_INTERVAL_MS = 2147483647 - 60000;

const DEFAULT_SETTINGS = {
    burstEnabled: true,
    burstThreshold: 5,
    burstPrintMode: "silent", // silent | manual
    burstPrinter: "",
    copies: 1,
    paperSize: "A4"
};

const EVENT_TYPES = ["reminder", "bill-payment", "order-bill", "print", "task", "mail"];

/** Normalize a raw scheduler.json object into its safe shape. */
function normalizeStore(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    return {
        schedules: Array.isArray(data.schedules)
            ? data.schedules.filter(ev => ev && typeof ev === "object" && ev.id)
            : [],
        expiredSchedules: Array.isArray(data.expiredSchedules)
            ? data.expiredSchedules.filter(ev => ev && typeof ev === "object")
            : [],
        history: Array.isArray(data.history) ? data.history : [],
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
    };
}

/** Validate + whitelist an event before it is stored. Returns {ok, error, ev}. */
function sanitizeEvent(rawEv) {
    if (!rawEv || typeof rawEv !== "object")
        return { ok: false, error: "Event data missing." };
    const ev = {
        id: typeof rawEv.id === "string" && rawEv.id ? rawEv.id : "",
        label: String(rawEv.label || "").trim(),
        type: EVENT_TYPES.includes(rawEv.type) ? rawEv.type : "reminder",
        action: ["notify", "print", "task", "mail"].includes(rawEv.action) ? rawEv.action : "notify",
        time: rawEv.time,
        tag: rawEv.tag || "",
        color: rawEv.color || "#4B0082",
        note: rawEv.note || "",
        billType: rawEv.billType || "",
        billObj: rawEv.billObj && typeof rawEv.billObj === "object" ? rawEv.billObj : {},
        user: rawEv.user && typeof rawEv.user === "object" ? rawEv.user : {},
        task: rawEv.task && typeof rawEv.task === "object"
            ? { prompt: String(rawEv.task.prompt || ""), answer: "" }
            : { prompt: "", answer: "" },
        print: rawEv.print && typeof rawEv.print === "object"
            ? {
                mode: rawEv.print.mode === "manual" ? "manual" : "silent",
                printer: rawEv.print.printer || "",
                copies: Number(rawEv.print.copies) > 0 ? Number(rawEv.print.copies) : 1,
                paperSize: rawEv.print.paperSize || "A4"
            }
            : { mode: "silent", printer: "", copies: 1, paperSize: "A4" },
        mail: rawEv.mail && typeof rawEv.mail === "object"
            ? { to: String(rawEv.mail.to || "").trim() }   // "" = customer's email on record
            : { to: "" },
        fired: rawEv.fired === true // tasks: due-time notification has fired
    };
    if (!ev.label) return { ok: false, error: "Label is required." };
    if (!ev.time || isNaN(new Date(ev.time).getTime()))
        return { ok: false, error: "Event time is invalid." };
    return { ok: true, ev };
}

/**
 * Apply a manage-schedule style flag to a normalized store (mutates + returns it).
 * flag: a (add) | r (remove from schedules) | e (edit) | exp (move to expired)
 *       exp-a (push to expired) | exp-all (drop tag from expired)
 *       exp-r (remove expired) | exp-u (update expired; time → back to schedules)
 * Guarded: exp of an unknown id is a no-op (never pushes undefined — the old
 * null-entry bug).
 */
function applyFlag(data, evObj, flag, updateKey) {
    if (flag === "a") {
        const { ok, ev } = sanitizeEvent(evObj);
        if (ok) data.schedules.push(ev);
        return data;
    }
    if (flag === "e") {
        const { ok, ev } = sanitizeEvent(evObj);
        if (!ok) return data;
        data.schedules = data.schedules.map(existing =>
            existing.id === ev.id ? { ...existing, ...ev } : existing);
        return data;
    }
    if (flag === "r") {
        data.schedules = data.schedules.filter(existing => existing.id !== evObj);
        return data;
    }
    if (flag === "exp") {
        const idx = data.schedules.findIndex(existing => existing.id === evObj);
        if (idx === -1) return data; // already gone — no-op, no undefined push
        data.expiredSchedules.push(data.schedules[idx]);
        data.schedules.splice(idx, 1);
        return data;
    }
    if (flag === "exp-a") {
        const { ok, ev } = sanitizeEvent(evObj);
        if (ok) data.expiredSchedules.push(ev);
        return data;
    }
    if (flag === "exp-all") {
        data.expiredSchedules = data.expiredSchedules.filter(existing => existing.tag !== evObj);
        return data;
    }
    if (flag === "exp-r") {
        data.expiredSchedules = data.expiredSchedules.filter(existing => existing.id !== evObj);
        return data;
    }
    if (flag === "exp-u") {
        const idx = data.expiredSchedules.findIndex(existing => existing.id === evObj.id);
        if (idx === -1) return data;
        const existing = data.expiredSchedules[idx];
        existing[updateKey] = evObj[updateKey];
        if (updateKey === "time") {
            data.expiredSchedules.splice(idx, 1);
            data.schedules.push(existing);
        }
        return data;
    }
    return data;
}

/** Append a run record to history (kept to the last 200). */
function appendHistory(data, record) {
    data.history.push({
        id: record.id || "",
        label: record.label || "",
        action: record.action || "notify",
        time: record.time || new Date().toISOString(),
        ok: record.ok !== false,
        detail: record.detail || ""
    });
    if (data.history.length > 200) data.history.splice(0, data.history.length - 200);
    return data;
}

/**
 * Timer manager — ONE armed timer per event id. Inject setTimer/clearTimer/now
 * for tests. Overdue events fire immediately; long-horizon events re-arm in a
 * chain until their real due time (fixes the old 24.8-day skip bug).
 */
function createTimerManager(opts = {}) {
    const setTimer = opts.setTimer || setTimeout;
    const clearTimer = opts.clearTimer || clearTimeout;
    const now = opts.now || Date.now;
    const timers = new Map(); // id -> timer handle

    function arm(event, cb) {
        disarm(event.id);
        const dueMs = new Date(event.time).getTime() - now();
        if (dueMs <= 0) {
            cb(event); // already due — fire now
            return;
        }
        const timer = setTimer(() => {
            timers.delete(event.id);
            if (now() < new Date(event.time).getTime())
                arm(event, cb); // still early (long horizon) — re-arm chain
            else
                cb(event);
        }, Math.min(dueMs, MAX_INTERVAL_MS));
        timers.set(event.id, timer);
    }
    function disarm(id) {
        const timer = timers.get(id);
        if (timer) {
            clearTimer(timer);
            timers.delete(id);
        }
    }
    function disarmAll() {
        for (const id of [...timers.keys()]) disarm(id);
    }
    return {
        arm,
        disarm,
        disarmAll,
        armed: id => timers.has(id),
        count: () => timers.size,
        MAX_INTERVAL_MS
    };
}

/**
 * Burst tracker — a "burst" is `threshold` saves inside `windowMs`.
 * noteSaved returns {count, shouldAsk}; shouldAsk is true only once per burst
 * (until take()/dismiss() resets), so the user is asked exactly once.
 */
function createBurstTracker(opts = {}) {
    const now = opts.now || Date.now;
    const windowMs = opts.windowMs || 30 * 60 * 1000;
    let buffer = [];
    let asked = false;

    return {
        noteSaved(bill, threshold) {
            buffer.push({ savedAt: now(), bill });
            buffer = buffer.filter(b => now() - b.savedAt <= windowMs);
            const shouldAsk = !asked && threshold > 0 && buffer.length >= threshold;
            if (shouldAsk) asked = true;
            return { count: buffer.length, shouldAsk };
        },
        take() {
            const out = buffer;
            buffer = [];
            asked = false;
            return out;
        },
        dismiss() {
            buffer = [];
            asked = false;
        },
        peek: () => buffer,
        isAsked: () => asked
    };
}

/** Due-check helpers shared by engine + tests. */
function isDue(ev, now = Date.now()) {
    return new Date(ev.time).getTime() - now <= 0;
}

module.exports = {
    MAX_INTERVAL_MS,
    DEFAULT_SETTINGS,
    EVENT_TYPES,
    normalizeStore,
    sanitizeEvent,
    applyFlag,
    appendHistory,
    createTimerManager,
    createBurstTracker,
    isDue
};
