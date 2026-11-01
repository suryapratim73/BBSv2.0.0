const {
    FREQUENCIES,
    DEFAULT_POLICY,
    normalizePolicy,
    computeFirstSendAt,
    computeNextSendAt,
    buildReminderMessage
} = require("../lib/customerPolicyLogic");

describe("normalizePolicy", () => {
    test("fills defaults for an empty object", () => {
        const verdict = normalizePolicy({});
        expect(verdict.ok).toBe(true);
        expect(verdict.policy.dueDays).toBe(30);
        expect(verdict.policy.creditLimit).toBe(0);
        expect(verdict.policy.earlyPayDiscount).toEqual({ percent: 0, withinDays: 0 });
        expect(verdict.policy.saleDiscount).toBe(0);
        expect(verdict.policy.reminder.enabled).toBe(false);
        expect(verdict.policy.reminder.onDueDate).toBe(true);
        expect(verdict.policy.reminder.repeat).toEqual({ enabled: false, frequency: "daily", days: [], time: "10:00" });
        expect(verdict.policy.template.message).toBe(DEFAULT_POLICY.template.message);
        expect(verdict.policy.template.includePDF).toBe(false);
    });

    test("rejects non-objects", () => {
        expect(normalizePolicy(null).ok).toBe(false);
        expect(normalizePolicy("nope").ok).toBe(false);
        expect(normalizePolicy([1, 2]).ok).toBe(false);
        expect(normalizePolicy(undefined).ok).toBe(false);
    });

    test("repairs and clamps numbers", () => {
        const verdict = normalizePolicy({
            dueDays: "45",
            creditLimit: -5,
            saleDiscount: 250,
            earlyPayDiscount: { percent: "7", withinDays: "3" }
        });
        expect(verdict.ok).toBe(true);
        expect(verdict.policy.dueDays).toBe(45);
        expect(verdict.policy.creditLimit).toBe(0); // negatives clamp to 0
        expect(verdict.policy.saleDiscount).toBe(100); // >100 clamps
        expect(verdict.policy.earlyPayDiscount).toEqual({ percent: 7, withinDays: 3 });
    });

    test("keeps dueDays within 0..365", () => {
        expect(normalizePolicy({ dueDays: 999 }).policy.dueDays).toBe(365);
        expect(normalizePolicy({ dueDays: -3 }).policy.dueDays).toBe(0);
    });

    test("repairs unknown repeat frequency and warns", () => {
        const verdict = normalizePolicy({
            reminder: { repeat: { enabled: true, frequency: "hourly", time: "9:05" } }
        });
        expect(verdict.ok).toBe(true);
        expect(verdict.policy.reminder.repeat.frequency).toBe("daily");
        expect(verdict.warnings.length).toBeGreaterThan(0);
    });

    test("keeps valid custom weekdays and drops bad ones", () => {
        const verdict = normalizePolicy({
            reminder: { repeat: { enabled: true, frequency: "custom", days: [1, 3, 99, "5", -2] } }
        });
        expect(verdict.policy.reminder.repeat.days).toEqual([1, 3, 5]);
    });

    test("fixes bad time strings and keeps HH:MM", () => {
        expect(normalizePolicy({ reminder: { repeat: { time: "25:00" } } }).policy.reminder.repeat.time).toBe("10:00");
        expect(normalizePolicy({ reminder: { repeat: { time: "nope" } } }).policy.reminder.repeat.time).toBe("10:00");
        expect(normalizePolicy({ reminder: { repeat: { time: "23:59" } } }).policy.reminder.repeat.time).toBe("23:59");
        expect(normalizePolicy({ reminder: { repeat: { time: "7:00" } } }).policy.reminder.repeat.time).toBe("7:00");
    });

    test("ignores custom messages — template locked until moderation lands", () => {
        expect(normalizePolicy({ template: { message: "Pay {billNo}!" } }).policy.template.message).toBe(DEFAULT_POLICY.template.message);
        expect(normalizePolicy({ template: { message: "   " } }).policy.template.message).toBe(DEFAULT_POLICY.template.message);
    });

    test("round-trips a full policy unchanged except the locked message", () => {
        const full = {
            dueDays: 20,
            creditLimit: 50000,
            earlyPayDiscount: { percent: 2, withinDays: 10 },
            saleDiscount: 5,
            reminder: { enabled: true, onDueDate: true, repeat: { enabled: true, frequency: "custom", days: [0, 6], time: "18:30" } },
            template: { message: "Hi {name}, pay bill {billNo}.", includePDF: true, includePaymentLink: false, includeLedgerBalance: true }
        };
        expect(normalizePolicy(full).policy).toEqual({
            ...full,
            template: { ...full.template, message: DEFAULT_POLICY.template.message }
        });
    });
});

describe("computeFirstSendAt", () => {
    test("sets the policy time on the due date", () => {
        const due = new Date(2026, 9, 30, 12, 0, 0);
        const at = computeFirstSendAt(due, "10:00");
        expect(at.getFullYear()).toBe(2026);
        expect(at.getMonth()).toBe(9);
        expect(at.getDate()).toBe(30);
        expect(at.getHours()).toBe(10);
        expect(at.getMinutes()).toBe(0);
    });

    test("falls back to 10:00 on a bad time", () => {
        const at = computeFirstSendAt(new Date(2026, 9, 30), "bogus");
        expect(at.getHours()).toBe(10);
    });
});

describe("computeNextSendAt", () => {
    const last = new Date(2026, 9, 28, 14, 0, 0); // a Wednesday

    test("returns null when repeat is off", () => {
        expect(computeNextSendAt(last, { enabled: false })).toBeNull();
        expect(computeNextSendAt(last, null)).toBeNull();
    });

    test("daily → same time next day", () => {
        const next = computeNextSendAt(last, { enabled: true, frequency: "daily", time: "10:00" });
        expect(next.getDate()).toBe(29);
        expect(next.getHours()).toBe(10);
        expect(next.getMinutes()).toBe(0);
    });

    test("weekly → same weekday next week", () => {
        const next = computeNextSendAt(last, { enabled: true, frequency: "weekly", time: "09:15" });
        expect(next.getDay()).toBe(last.getDay());
        expect(next.getTime()).toBe(new Date(2026, 10, 4, 9, 15, 0).getTime()); // Nov 4 (Wed)
        expect(next.getHours()).toBe(9);
        expect(next.getMinutes()).toBe(15);
    });

    test("custom → next selected weekday", () => {
        // last was Wednesday (getDay 3); Thursday (4) selected → next day
        const thu = computeNextSendAt(last, { enabled: true, frequency: "custom", days: [4], time: "10:00" });
        expect(thu.getDay()).toBe(4);
        expect(thu.getTime()).toBe(new Date(2026, 9, 29, 10, 0, 0).getTime());

        // Monday (1) selected → next Monday Nov 2 (month rolls over)
        const mon = computeNextSendAt(last, { enabled: true, frequency: "custom", days: [1], time: "10:00" });
        expect(mon.getDay()).toBe(1);
        expect(mon.getTime()).toBe(new Date(2026, 10, 2, 10, 0, 0).getTime());
    });

    test("custom with no days → every day", () => {
        const next = computeNextSendAt(last, { enabled: true, frequency: "custom", days: [], time: "10:00" });
        expect(next.getDate()).toBe(29);
    });
});

describe("buildReminderMessage", () => {
    const vars = { name: "Acme", billNo: "B-101", dueAmt: "12,345", dueDate: "28/10/2026", balance: 30000, biller: "BBS" };

    test("replaces all placeholders", () => {
        const msg = buildReminderMessage({ message: "{name} owes {dueAmt} for {billNo} by {dueDate}. — {biller}" }, vars);
        expect(msg).toBe("Acme owes 12,345 for B-101 by 28/10/2026. — BBS");
    });

    test("plain default: no balance line unless opted in", () => {
        const plain = buildReminderMessage({ includeLedgerBalance: false }, vars);
        expect(plain).not.toContain("outstanding balance");
        const rich = buildReminderMessage({ includeLedgerBalance: true }, vars);
        expect(rich).toContain("outstanding balance: Rs. 30,000");
    });

    test("appends the portal note when payment link is included", () => {
        expect(buildReminderMessage({ includePaymentLink: true }, vars)).toContain("customer portal");
        expect(buildReminderMessage({ includePaymentLink: false }, vars)).not.toContain("customer portal");
    });

    test("leaves unknown placeholders untouched", () => {
        const msg = buildReminderMessage({ message: "hi {nope}" }, vars);
        expect(msg).toBe("hi {nope}");
    });

    test("uses the default message when none given", () => {
        const msg = buildReminderMessage(null, vars);
        expect(msg).toContain("payment reminder for bill B-101");
    });
});

describe("FREQUENCIES", () => {
    test("lists the three supported frequencies", () => {
        expect(FREQUENCIES).toEqual(["daily", "weekly", "custom"]);
    });
});
