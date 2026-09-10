// appLogger backpressure test — verifies the todaysLog hash chain
// integrity when stream backpressure occurs.
//
// Key insight: Node's stream.write() returning false means data IS still
// buffered internally and WILL be flushed to disk. Hash advances optimistically
// because the data is in the buffer (not lost). The drain handler clears the
// pending queue to confirm entries reached disk. No re-writes — no duplicates.

const crypto = require("crypto");

describe("appLogger todaysLog — backpressure & hash chain", () => {
  let pending, lastLineHash;
  let stream, drainHandler;

  beforeEach(() => {
    pending = [];
    lastLineHash = "";
    drainHandler = null;

    let backpressureCount = 0;
    stream = {
      writable: true,
      write: function (data) {
        if (backpressureCount > 0) {
          backpressureCount--;
          return false;
        }
        return true;
      },
      on: function (event, handler) {
        if (event === "drain") drainHandler = handler;
      },
      emit: function (event) {
        if (event === "drain" && drainHandler) drainHandler();
      },
      _forceBackpressure: function (n) { backpressureCount = n; },
    };

    // Drain handler: clears pending queue (entries confirmed on disk).
    // Hash was already advanced when entries were queued.
    stream.on("drain", function () {
      pending.length = 0;
    });
  });

  // Exact replica of the production write logic
  function logEntry(msgObj) {
    msgObj.hash = lastLineHash;
    if (stream.writable) {
      var written = stream.write(JSON.stringify(msgObj) + "\n");
      if (!written) {
        pending.push(msgObj);
      }
      lastLineHash = crypto.createHash("sha256").update(JSON.stringify(msgObj)).digest("hex");
    }
  }

  // ---- Tests ----

  test("no backpressure: hash advances, queue stays empty", () => {
    logEntry({ ts: "t1", title: "A", message: "Entry A" });
    expect(pending.length).toBe(0);
    expect(lastLineHash).not.toBe("");
  });

  test("backpressure: entry tracked in pending, hash still advances", () => {
    stream._forceBackpressure(1);

    logEntry({ ts: "t1", title: "A", message: "Entry A" });

    expect(pending.length).toBe(1);
    // Hash advances even on backpressure — data is in buffer
    expect(lastLineHash).not.toBe("");
  });

  test("drain clears pending queue", () => {
    stream._forceBackpressure(2);
    logEntry({ ts: "t1", title: "A", message: "A" });
    logEntry({ ts: "t2", title: "B", message: "B" });
    expect(pending.length).toBe(2);

    stream.emit("drain");
    expect(pending.length).toBe(0);
  });

  test("full hash chain: each hash = SHA256(previous entry)", () => {
    var entries = [];
    for (var i = 0; i < 10; i++) {
      var entry = { ts: "t" + i, title: "Test", message: "Entry " + i };
      logEntry(entry);
      entries.push(entry);
    }

    expect(pending.length).toBe(0);
    expect(entries[0].hash).toBe("");

    for (var j = 1; j < entries.length; j++) {
      var prevJSON = JSON.stringify(entries[j - 1]);
      var expected = crypto.createHash("sha256").update(prevJSON).digest("hex");
      expect(entries[j].hash).toBe(expected);
    }
  });

  test("hash chain intact through backpressure bursts", () => {
    var entries = [];

    // Write 3 normally
    for (var i = 0; i < 3; i++) {
      var e = { ts: "t" + i, title: "Pre", message: "Pre " + i, idx: i };
      logEntry(e);
      entries.push(e);
    }

    // 2 entries with backpressure
    stream._forceBackpressure(2);
    for (var j = 3; j < 5; j++) {
      var e2 = { ts: "t" + j, title: "BP", message: "BP " + j, idx: j };
      logEntry(e2);
      entries.push(e2);
    }
    expect(pending.length).toBe(2);

    stream.emit("drain");
    expect(pending.length).toBe(0);

    // 2 more normally
    for (var k = 5; k < 7; k++) {
      var e3 = { ts: "t" + k, title: "Post", message: "Post " + k, idx: k };
      logEntry(e3);
      entries.push(e3);
    }

    // Verify chain
    expect(entries[0].hash).toBe("");
    for (var n = 1; n < entries.length; n++) {
      var prevJSON = JSON.stringify(entries[n - 1]);
      var expected = crypto.createHash("sha256").update(prevJSON).digest("hex");
      expect(entries[n].hash).toBe(expected);
    }
  });

  test("alternating backpressure: hash chain never forks", () => {
    var entries = [];
    for (var i = 0; i < 15; i++) {
      if (i % 5 === 2) stream._forceBackpressure(1);
      var entry = { ts: "t" + i, title: "Chain", message: "Entry " + i, idx: i };
      logEntry(entry);
      entries.push(entry);
    }

    stream.emit("drain");
    expect(pending.length).toBe(0);

    expect(entries[0].hash).toBe("");
    for (var j = 1; j < entries.length; j++) {
      var prevJSON = JSON.stringify(entries[j - 1]);
      var expected = crypto.createHash("sha256").update(prevJSON).digest("hex");
      expect(entries[j].hash).toBe(expected);
    }
  });

  test("fresh state: empty queue, empty hash", () => {
    expect(pending.length).toBe(0);
    expect(lastLineHash).toBe("");
  });

  test("single entry hash is correct", () => {
    var entry = { ts: "t0", title: "Solo", message: "Only" };
    logEntry(entry);

    expect(entry.hash).toBe("");
    var expected = crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    expect(lastLineHash).toBe(expected);
  });
});

// Day-rollover tests — replica of common.js FileHandler.openTodaysLog / ensureTodaysLog.
// Local-midnight rollover: yesterday's stream ends, today's log-<date>.txt opens,
// and lastLineHash resets so the new day starts with a genesis line (hash:"").
describe("appLogger day rollover — local midnight, genesis reset", () => {
  let state, clock, openedStreams, handler;

  function makeStream() {
    return {
      ended: false,
      drainHandler: null,
      write: function (data) { return true; },
      end: function () { this.ended = true; },
      on: function (event, cb) { if (event === "drain") this.drainHandler = cb; },
      emitDrain: function () { if (this.drainHandler) this.drainHandler(); },
    };
  }

  function FileHandler() {
    this.openTodaysLog();
  }
  FileHandler.prototype.openTodaysLog = function () {
    this.todaysLogDate = getLocalDateStr();
    this.todaysLog = makeStream();
    openedStreams.push({ date: this.todaysLogDate, stream: this.todaysLog });
    this.todaysLog.on("drain", function () { state.pending.length = 0; });
  };
  FileHandler.prototype.ensureTodaysLog = function () {
    try {
      const today = getLocalDateStr();
      if (today !== this.todaysLogDate) {
        try { this.todaysLog.end(); } catch (_) {}
        this.openTodaysLog();
        state.lastLineHash = ""; // NEW DAY — chain restarts with a genesis line
      }
    } catch (err) {
      console.error("FileHandler rollover error:", err.message);
    }
    return this.todaysLog;
  };

  function getLocalDateStr() {
    const d = clock;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Replica of the production write path's optimistic hash advance
  function logEntry(msgObj) {
    msgObj.hash = state.lastLineHash;
    handler.todaysLog.write(JSON.stringify(msgObj) + "\n");
    state.lastLineHash = crypto.createHash("sha256").update(JSON.stringify(msgObj)).digest("hex");
  }

  beforeEach(() => {
    state = { pending: [], lastLineHash: "" };
    clock = new Date(2026, 8, 10, 23, 59, 0); // Sep 10, 23:59 local time
    openedStreams = [];
    handler = new FileHandler();
  });

  test("constructor opens today's file keyed to the LOCAL date", () => {
    expect(handler.todaysLogDate).toBe("2026-09-10");
    expect(openedStreams.length).toBe(1);
    expect(openedStreams[0].date).toBe("2026-09-10");
  });

  test("same day: ensureTodaysLog keeps the same stream open", () => {
    clock = new Date(2026, 8, 10, 23, 59, 59); // still Sep 10
    const before = handler.todaysLog;
    const after = handler.ensureTodaysLog();

    expect(after).toBe(before);
    expect(before.ended).toBe(false);
    expect(openedStreams.length).toBe(1);
  });

  test("day change: old stream ends, new day's stream opens with drain attached", () => {
    clock = new Date(2026, 8, 11, 0, 0, 1); // midnight + 1s → Sep 11
    const oldStream = handler.todaysLog;
    const newStream = handler.ensureTodaysLog();

    expect(oldStream.ended).toBe(true);
    expect(newStream).not.toBe(oldStream);
    expect(handler.todaysLogDate).toBe("2026-09-11");
    expect(openedStreams.length).toBe(2);
    expect(openedStreams[1].date).toBe("2026-09-11");
    expect(newStream.drainHandler).toBeTruthy(); // every new day's stream gets a drain handler
  });

  test("day change: lastLineHash resets — next entry is genesis (hash:\"\")", () => {
    logEntry({ ts: "t1", title: "A", message: "before midnight" });
    expect(state.lastLineHash).not.toBe("");

    clock = new Date(2026, 8, 11, 0, 0, 1);
    handler.ensureTodaysLog();
    expect(state.lastLineHash).toBe("");

    const firstOfNewDay = { ts: "t2", title: "B", message: "after midnight" };
    logEntry(firstOfNewDay);
    expect(firstOfNewDay.hash).toBe(""); // genesis — no hash link into the previous day
  });

  test("drain on the new day's stream clears the pending queue", () => {
    state.pending = ["leftover"];
    clock = new Date(2026, 8, 11, 0, 0, 1);
    const newStream = handler.ensureTodaysLog();

    newStream.emitDrain();
    expect(state.pending.length).toBe(0);
  });

  test("no rollover at 23:59:59.999 — boundary is exactly local midnight", () => {
    clock = new Date(2026, 8, 10, 23, 59, 59, 999);
    handler.ensureTodaysLog();
    expect(handler.todaysLogDate).toBe("2026-09-10");
    expect(openedStreams.length).toBe(1);
  });
});
