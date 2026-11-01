// Scheduler — pure engine unit tests (lib/schedulerLogic.js)
// Covers the timer manager (one timer per id, cancel-on-edit, >24.8-day
// re-arm chain), flag guards (the old null-entry bug), event sanitization,
// burst tracking and store normalization.

const {
    MAX_INTERVAL_MS,
    DEFAULT_SETTINGS,
    normalizeStore,
    sanitizeEvent,
    applyFlag,
    appendHistory,
    createTimerManager,
    createBurstTracker,
    isDue
} = require("../lib/schedulerLogic");

function fakeTimerHost(){
    // minimal injectable setTimer/clearTimer pair + controllable clock
    let nextHandle = 1;
    const pending = new Map(); // handle -> {cb}
    return {
        now: Date.now(),
        pending,
        setTimer(cb){
            const handle = nextHandle++;
            pending.set(handle, { cb });
            return handle;
        },
        clearTimer(handle){
            pending.delete(handle);
        },
        fire(handle){
            const entry = pending.get(handle);
            if(!entry) throw new Error(`no timer ${handle}`);
            pending.delete(handle);
            entry.cb();
        }
    };
}

describe("createTimerManager — one timer per event id", () => {
    test("arming the same id twice keeps a single timer", () => {
        const host = fakeTimerHost();
        const tm = createTimerManager({ setTimer: host.setTimer, clearTimer: host.clearTimer, now: () => host.now });
        const ev = { id: "a", time: new Date(host.now + 60000).toISOString() };
        tm.arm(ev, () => {});
        tm.arm(ev, () => {});
        expect(tm.count()).toBe(1);
    });

    test("disarm cancels the pending timer", () => {
        const host = fakeTimerHost();
        const tm = createTimerManager({ setTimer: host.setTimer, clearTimer: host.clearTimer, now: () => host.now });
        let fired = false;
        tm.arm({ id: "a", time: new Date(host.now + 60000).toISOString() }, () => { fired = true; });
        tm.disarm("a");
        expect(tm.count()).toBe(0);
        expect(host.pending.size).toBe(0);
        expect(fired).toBe(false);
    });

    test("an overdue event fires immediately without a timer", () => {
        const host = fakeTimerHost();
        const tm = createTimerManager({ setTimer: host.setTimer, clearTimer: host.clearTimer, now: () => host.now });
        let fired = 0;
        tm.arm({ id: "a", time: new Date(host.now - 1000).toISOString() }, () => { fired++; });
        expect(fired).toBe(1);
        expect(tm.count()).toBe(0);
    });

    test("a long-horizon event re-arms in a chain until it is due", () => {
        const host = fakeTimerHost();
        const tm = createTimerManager({ setTimer: host.setTimer, clearTimer: host.clearTimer, now: () => host.now });
        const dueAt = host.now + MAX_INTERVAL_MS + 120000; // ~24.8 days + 2 min
        let fired = 0;
        tm.arm({ id: "a", time: new Date(dueAt).toISOString() }, () => { fired++; });

        const firstHandle = [...host.pending.keys()][0];
        expect(firstHandle).toBeDefined();
        // firing the short timer while still early re-arms instead of firing
        host.fire(firstHandle);
        expect(fired).toBe(0);
        expect(tm.count()).toBe(1);

        // clock reaches the due time → the re-armed timer fires the event
        host.now = dueAt + 1000;
        host.fire([...host.pending.keys()][0]);
        expect(fired).toBe(1);
        expect(tm.count()).toBe(0);
    });
});

describe("applyFlag — store mutations are guarded", () => {
    const base = () => ({ schedules: [], expiredSchedules: [], history: [], settings: { ...DEFAULT_SETTINGS } });

    test('"a" sanitizes and pushes a valid event', () => {
        const data = base();
        applyFlag(data, { label: "Pay rent", type: "reminder", time: new Date().toISOString() }, "a");
        expect(data.schedules).toHaveLength(1);
        expect(data.schedules[0].label).toBe("Pay rent");
        expect(data.schedules[0].action).toBe("notify");
    });

    test('"a" with an invalid event is a no-op', () => {
        const data = base();
        applyFlag(data, { label: "", time: "not-a-date" }, "a");
        expect(data.schedules).toHaveLength(0);
    });

    test('"e" merges fields onto the existing event by id', () => {
        const data = base();
        applyFlag(data, { id: "a", label: "Old", time: new Date().toISOString() }, "a");
        applyFlag(data, { id: "a", label: "New label", type: "reminder", time: new Date().toISOString() }, "e");
        expect(data.schedules).toHaveLength(1);
        expect(data.schedules[0].label).toBe("New label");
    });

    test('"r" removes the event by id', () => {
        const data = base();
        applyFlag(data, { id: "a", label: "X", time: new Date().toISOString() }, "a");
        applyFlag(data, "a", "r");
        expect(data.schedules).toHaveLength(0);
    });

    test('"exp" of an unknown id is a no-op (the old null-entry bug)', () => {
        const data = base();
        applyFlag(data, "missing-id", "exp");
        expect(data.expiredSchedules).toHaveLength(0);
        expect(data.expiredSchedules.some(ev => ev === undefined || ev === null)).toBe(false);
    });

    test('"exp" moves a known event to expiredSchedules', () => {
        const data = base();
        applyFlag(data, { id: "a", label: "X", time: new Date().toISOString() }, "a");
        applyFlag(data, "a", "exp");
        expect(data.schedules).toHaveLength(0);
        expect(data.expiredSchedules).toHaveLength(1);
    });

    test('"exp-u" with a new time moves the event back to schedules', () => {
        const data = base();
        applyFlag(data, { id: "a", label: "X", time: new Date().toISOString() }, "a");
        applyFlag(data, "a", "exp");
        applyFlag(data, { id: "a", time: new Date(Date.now() + 60000).toISOString() }, "exp-u", "time");
        expect(data.expiredSchedules).toHaveLength(0);
        expect(data.schedules).toHaveLength(1);
    });
});

describe("sanitizeEvent — whitelist + validation", () => {
    test("accepts a valid reminder and applies defaults", () => {
        const { ok, ev } = sanitizeEvent({ label: "Call supplier", type: "reminder", time: new Date().toISOString() });
        expect(ok).toBe(true);
        expect(ev.action).toBe("notify");
        expect(ev.color).toBe("#4B0082");
        expect(ev.billObj).toEqual({});
    });

    test("forces print mode to silent/manual and copies to at least 1", () => {
        const { ok, ev } = sanitizeEvent({
            label: "P", type: "print", action: "print", time: new Date().toISOString(),
            print: { mode: "sideways", printer: "X", copies: 0, paperSize: "A5" }
        });
        expect(ok).toBe(true);
        expect(ev.print.mode).toBe("silent");
        expect(ev.print.copies).toBe(1);
        expect(ev.print.paperSize).toBe("A5");
    });

    test("rejects a missing label", () => {
        expect(sanitizeEvent({ label: "  ", time: new Date().toISOString() }).ok).toBe(false);
    });

    test("rejects an invalid time", () => {
        expect(sanitizeEvent({ label: "X", time: "yesterday-ish" }).ok).toBe(false);
    });

    test("only keeps task.answer empty on creation (input is written on completion)", () => {
        const { ev } = sanitizeEvent({ label: "T", type: "task", action: "task", time: new Date().toISOString(), task: { prompt: "Count cash", answer: "leak" } });
        expect(ev.task.prompt).toBe("Count cash");
        expect(ev.task.answer).toBe("");
    });

    test("keeps the mail type/action and trims a mail.to (blank = customer on record)", () => {
        const { ok, ev } = sanitizeEvent({
            label: "Email bill", type: "mail", action: "mail", time: new Date().toISOString(),
            mail: { to: "  shop@example.com  " }
        });
        expect(ok).toBe(true);
        expect(ev.type).toBe("mail");
        expect(ev.action).toBe("mail");
        expect(ev.mail.to).toBe("shop@example.com");
        expect(sanitizeEvent({ label: "M", type: "mail", action: "mail", time: new Date().toISOString() }).ev.mail).toEqual({ to: "" });
        expect(sanitizeEvent({ label: "M", type: "mail", action: "mail", time: new Date().toISOString(), mail: "junk" }).ev.mail).toEqual({ to: "" });
    });
});

describe("createBurstTracker — ask exactly once per burst", () => {
    test("asks once when the threshold is reached and not again for extra saves", () => {
        let now = 1000000;
        const b = createBurstTracker({ now: () => now, windowMs: 60000 });
        for(let i = 0; i < 5; i++)
            expect(b.noteSaved({ billNo: String(i) }, 5).shouldAsk).toBe(i === 4);
        expect(b.noteSaved({ billNo: "5" }, 5).shouldAsk).toBe(false);
    });

    test("take() drains the buffer and resets the asked flag", () => {
        let now = 1000000;
        const b = createBurstTracker({ now: () => now, windowMs: 60000 });
        for(let i = 0; i < 5; i++) b.noteSaved({ billNo: String(i) }, 5);
        expect(b.take()).toHaveLength(5);
        expect(b.peek()).toHaveLength(0);
        expect(b.isAsked()).toBe(false);
    });

    test("dismiss() resets without firing", () => {
        let now = 1000000;
        const b = createBurstTracker({ now: () => now, windowMs: 60000 });
        for(let i = 0; i < 5; i++) b.noteSaved({ billNo: String(i) }, 5);
        b.dismiss();
        expect(b.peek()).toHaveLength(0);
        expect(b.isAsked()).toBe(false);
    });

    test("saves outside the window age out of the buffer", () => {
        let now = 1000000;
        const b = createBurstTracker({ now: () => now, windowMs: 60000 });
        b.noteSaved({ billNo: "1" }, 5);
        now += 60001;
        expect(b.noteSaved({ billNo: "2" }, 5).count).toBe(1);
    });
});

describe("normalizeStore — tolerant reads", () => {
    test("handles null and garbage", () => {
        expect(normalizeStore(null).schedules).toEqual([]);
        expect(normalizeStore("junk").schedules).toEqual([]);
    });

    test("drops null schedule entries left by the old bug", () => {
        const data = normalizeStore({ schedules: [null, { id: "a", label: "X", time: new Date().toISOString() }, undefined] });
        expect(data.schedules).toHaveLength(1);
        expect(data.schedules[0].id).toBe("a");
    });

    test("applies default settings over partial ones", () => {
        const data = normalizeStore({ settings: { burstThreshold: 9 } });
        expect(data.settings.burstThreshold).toBe(9);
        expect(data.settings.burstEnabled).toBe(DEFAULT_SETTINGS.burstEnabled);
    });
});

describe("appendHistory — capped at 200 entries", () => {
    test("drops the oldest entries beyond the cap", () => {
        const data = { history: [] };
        for(let i = 0; i < 250; i++)
            appendHistory(data, { id: String(i), label: `run ${i}` });
        expect(data.history).toHaveLength(200);
        expect(data.history[0].label).toBe("run 50");
        expect(data.history[199].label).toBe("run 249");
    });
});

describe("isDue", () => {
    test("compares event time against now", () => {
        expect(isDue({ time: new Date(Date.now() - 1).toISOString() })).toBe(true);
        expect(isDue({ time: new Date(Date.now() + 60000).toISOString() })).toBe(false);
    });
});
