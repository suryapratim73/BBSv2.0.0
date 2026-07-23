// BillManager v2 unit tests — object-based pool
describe("BillManager v2 — object pool logic", () => {
  class TestBillManager {
    constructor({ seed = 0, poolSize = 10, pool = [] } = {}) {
      this.poolSize = poolSize;
      this._seed = seed;
      this.pool = pool.map(function(o) {
        return { billNo: o.billNo, isConsumed: !!o.isConsumed, date: o.date || null, windowId: o.windowId || null };
      });
      this._cleanup();
      this._refill();
    }

    _available() { return this.pool.filter(function(e) { return !e.isConsumed && !e.windowId; }).sort(function(a, b) { return a.billNo - b.billNo; }); }
    _consumed() { return this.pool.filter(function(e) { return e.isConsumed; }).sort(function(a, b) { return a.billNo - b.billNo; }); }
    _highest() { var h = 0; for (var i = 0; i < this.pool.length; i++) { if (this.pool[i].billNo > h) h = this.pool[i].billNo; } return h; }

    _cleanup() {
      var today = new Date().toISOString().split("T")[0];
      var consumed = this._consumed();
      var highestConsumed = consumed.length > 0 ? consumed[consumed.length - 1].billNo : 0;
      this.pool = this.pool.filter(function(e) {
        if (e.isConsumed || e.windowId) return true;
        // Only flush released entries (have date) that are stale
        if (e.date && e.billNo < highestConsumed && e.date !== today) return false;
        return true;
      });
    }

    _refill() {
      var highest = this._highest();
      if (highest === 0) highest = this._seed;
      while (this._available().length < this.poolSize) {
        highest++;
        this.pool.push({ billNo: highest, isConsumed: false, date: null, windowId: null });
      }
    }

    get currentMax() {
      var c = this._consumed();
      return c.length > 0 ? c[c.length - 1].billNo : 0;
    }

    allocate(sessionId) {
      for (var i = 0; i < this.pool.length; i++) {
        if (this.pool[i].windowId === sessionId) return this.pool[i].billNo;
      }
      this._cleanup();
      if (this._available().length < 5) this._refill();
      var entry = this._available()[0];
      entry.windowId = sessionId;
      return entry.billNo;
    }

    consume(sessionId) {
      for (var i = 0; i < this.pool.length; i++) {
        if (this.pool[i].windowId === sessionId) {
          this.pool[i].isConsumed = true;
          this.pool[i].windowId = null;
          return;
        }
      }
    }

    release(sessionId) {
      for (var i = 0; i < this.pool.length; i++) {
        if (this.pool[i].windowId === sessionId) {
          this.pool[i].windowId = null;
          this.pool[i].date = new Date().toISOString().split("T")[0];
          return;
        }
      }
    }
  }

  // ---- Init ----

  test("initializes pool from seed", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    expect(mgr.pool).toHaveLength(10);
    expect(mgr.pool[0].billNo).toBe(101);
    expect(mgr.pool[9].billNo).toBe(110);
    expect(mgr.pool[0].isConsumed).toBe(false);
  });

  test("restores persisted pool objects", () => {
    const mgr = new TestBillManager({
      seed: 200,
      pool: [
        { billNo: 201, isConsumed: true, date: null },
        { billNo: 202, isConsumed: false, date: null },
        { billNo: 203, isConsumed: true, date: null },
      ],
      poolSize: 10,
    });
    // Pool keeps consumed entries + refills to 10 available
    var avail = mgr._available();
    expect(avail).toHaveLength(10);
    // 202 is the only original available entry
    expect(avail.some(function(e) { return e.billNo === 202; })).toBe(true);
    // 201 and 203 are consumed
    var consumed = mgr._consumed();
    expect(consumed.some(function(e) { return e.billNo === 201; })).toBe(true);
    expect(consumed.some(function(e) { return e.billNo === 203; })).toBe(true);
  });

  // ---- Allocate ----

  test("allocate returns smallest available", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    expect(mgr.allocate("w1")).toBe(101);
    expect(mgr.allocate("w2")).toBe(102);
    expect(mgr.allocate("w3")).toBe(103);
  });

  test("page refresh returns same number", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const first = mgr.allocate("sale-5"); // 101
    const second = mgr.allocate("sale-5"); // same window
    expect(second).toBe(first);
  });

  test("currentMax reflects highest consumed", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    mgr.allocate("w1"); mgr.consume("w1"); // 101
    mgr.allocate("w2"); mgr.consume("w2"); // 102
    mgr.allocate("w3"); mgr.consume("w3"); // 103
    expect(mgr.currentMax).toBe(103);
  });

  // ---- Release ----

  test("same-day release gets reused", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    mgr.allocate("w1"); // 101
    mgr.allocate("w2"); // 102
    mgr.release("w1"); // 101 back — same day

    const next = mgr.allocate("w3");
    expect(next).toBe(101);
  });

  test("prior-day release flushed, not reused", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    mgr.allocate("w1"); // 101
    mgr.allocate("w2"); mgr.consume("w2"); // 102 consumed
    mgr.release("w1"); // 101 released
    // Simulate yesterday's date on the released entry
    mgr.pool.find(function(e) { return e.billNo === 101; }).date = "2020-01-01";

    // 101 is unconsumed, below highest consumed (102), and stale → flushed
    const next = mgr.allocate("w3");
    expect(next).toBe(103); // not 101
  });

  // ---- Multi-window ----

  test("multi-window: out-of-order complete + cancel — no duplicates", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const a = mgr.allocate("sale-A"); // 101
    const b = mgr.allocate("sale-B"); // 102

    mgr.consume("sale-A"); // A completes
    mgr.release("sale-B"); // B cancels

    const c = mgr.allocate("sale-C");
    expect(c).toBe(102); // B's number reused, not a duplicate
  });

  // ---- Refill ----

  test("refills when available drops below 5", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    for (var i = 0; i < 7; i++) mgr.allocate("w" + i);
    expect(mgr._available().length).toBeGreaterThanOrEqual(5);
  });

  test("refills when available drops below 5, generating new numbers", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 3 });
    mgr.allocate("w1"); mgr.consume("w1"); // 101 consumed
    mgr.allocate("w2"); mgr.consume("w2"); // 102 consumed
    mgr.allocate("w3"); mgr.consume("w3"); // 103 consumed
    // All 3 consumed, 0 available → needs refill
    mgr.allocate("w4"); // triggers refill, gets the first new number
    expect(mgr._available().length).toBeGreaterThanOrEqual(2); // 2 left after allocate
  });
});
