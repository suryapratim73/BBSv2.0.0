/**
 * customerPolicyLogic.js — pure logic for per-customer policies
 * (payment terms + automated email reminders). Jest-safe: no electron,
 * no fs, no network. All time math takes/returns Date objects so the
 * caller decides "now" (tests can pin it).
 */

const FREQUENCIES = ["daily", "weekly", "custom"];

const DEFAULT_POLICY = {
    dueDays: 30,
    creditLimit: 0,
    earlyPayDiscount: { percent: 0, withinDays: 0 },
    saleDiscount: 0,
    reminder: {
        enabled: false,
        onDueDate: true,
        repeat: { enabled: false, frequency: "daily", days: [], time: "10:00" }
    },
    template: {
        message: "Dear {name},\n\nThis is a payment reminder for bill {billNo} of Rs. {dueAmt}, due on {dueDate}.\n\nRegards,\n{biller}",
        includePDF: false,
        includePaymentLink: false,
        includeLedgerBalance: false
    }
};

function toInt(v, fallback) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function isTimeStr(v) {
    return typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Normalize a raw policy (from moreInfo.custPolicy or the modal) into a full policy. */
function normalizePolicy(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: "Policy must be an object." };
    }
    const warnings = [];
    const early = raw.earlyPayDiscount && typeof raw.earlyPayDiscount === "object" ? raw.earlyPayDiscount : {};
    const repeat = raw.reminder && raw.reminder.repeat && typeof raw.reminder.repeat === "object" ? raw.reminder.repeat : {};
    const template = raw.template && typeof raw.template === "object" ? raw.template : {};

    let frequency = repeat.frequency;
    if (!FREQUENCIES.includes(frequency)) {
        if (frequency !== undefined && frequency !== null) warnings.push(`Unknown repeat frequency "${frequency}" — using "daily".`);
        frequency = "daily";
    }
    const days = Array.isArray(repeat.days)
        ? [...new Set(repeat.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
        : [];
    const time = isTimeStr(repeat.time) ? repeat.time : "10:00";
    // Template locked (2026-11-02): user-supplied messages are ignored and the
    // default is always used, so reminder emails can't carry foul language until
    // a moderation mechanism lands in a future update.
    const message = DEFAULT_POLICY.template.message;

    const policy = {
        dueDays: clamp(toInt(raw.dueDays, DEFAULT_POLICY.dueDays), 0, 365),
        creditLimit: Math.max(0, toInt(raw.creditLimit, 0)),
        earlyPayDiscount: {
            percent: clamp(toInt(early.percent, 0), 0, 100),
            withinDays: Math.max(0, toInt(early.withinDays, 0))
        },
        saleDiscount: clamp(toInt(raw.saleDiscount, 0), 0, 100),
        reminder: {
            enabled: !!raw.reminder?.enabled,
            onDueDate: raw.reminder && typeof raw.reminder.onDueDate === "boolean" ? raw.reminder.onDueDate : true,
            repeat: {
                enabled: !!repeat.enabled,
                frequency,
                days,
                time
            }
        },
        template: {
            message,
            includePDF: !!template.includePDF,
            includePaymentLink: !!template.includePaymentLink,
            includeLedgerBalance: !!template.includeLedgerBalance
        }
    };
    return { ok: true, policy, warnings };
}

/** First reminder timestamp: due date at the policy's reminder time. */
function computeFirstSendAt(dueDate, timeStr) {
    const at = new Date(dueDate);
    const time = isTimeStr(timeStr) ? timeStr : "10:00";
    const [h, m] = time.split(":").map(Number);
    at.setHours(h, m, 0, 0);
    return at;
}

/**
 * Next send timestamp after a send at `lastSentAt`, per repeat settings.
 * Returns null when repeating is off. daily → +1 day; weekly → +7 days;
 * custom → next selected weekday (if no days chosen, behaves like daily).
 */
function computeNextSendAt(lastSentAt, repeat) {
    if (!repeat || !repeat.enabled) return null;
    const base = new Date(lastSentAt);
    const time = isTimeStr(repeat.time) ? repeat.time : "10:00";
    const [h, m] = time.split(":").map(Number);
    base.setHours(h, m, 0, 0);
    const days = new Set((repeat.days || []).map(Number));
    let next = new Date(base);
    let guard = 0;
    while (guard < 14) {
        next = new Date(next.getTime() + 24 * 3600 * 1000);
        guard++;
        if (repeat.frequency === "daily") break;
        if (repeat.frequency === "weekly" && next.getDay() === base.getDay()) break;
        if (repeat.frequency === "custom") {
            if (days.size === 0) break;                 // no weekdays picked → every day
            if (days.has(next.getDay())) break;
        }
    }
    return next;
}

/**
 * Fill the reminder template. `vars` may include {name}, {billNo}, {dueAmt},
 * {dueDate}, {balance}, {biller}. Ledger balance is appended only when the
 * template opts in — the default is a plain message.
 */
function buildReminderMessage(template, vars) {
    let msg = String((template && template.message) || DEFAULT_POLICY.template.message);
    for (const [key, val] of Object.entries(vars || {})) {
        if (val === undefined || val === null) continue;
        msg = msg.split(`{${key}}`).join(String(val));
    }
    if (template && template.includeLedgerBalance && vars && vars.balance !== undefined && vars.balance !== null) {
        msg += `\nCurrent outstanding balance: Rs. ${Number(vars.balance).toLocaleString("en-IN")}`;
    }
    if (template && template.includePaymentLink) {
        msg += "\n\nYou can also check your ledger and make payments from your customer portal.";
    }
    return msg;
}

module.exports = {
    FREQUENCIES,
    DEFAULT_POLICY,
    normalizePolicy,
    computeFirstSendAt,
    computeNextSendAt,
    buildReminderMessage
};
