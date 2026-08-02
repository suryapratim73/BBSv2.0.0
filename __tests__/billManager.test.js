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
      if (!sessionId) return 0;
      for (var i = 0; i < this.pool.length; i++) {
        if (this.pool[i].windowId === sessionId) return this.pool[i].billNo;
      }
      this._cleanup();
      if (this._available().length < 5) this._refill();
      var entry = this._available()[0];
      entry.windowId = sessionId;
      return entry.billNo;
    }

    consume(sessionId, billNo) {
      if (!sessionId) return;
      for (var i = 0; i < this.pool.length; i++) {
        if (this.pool[i].windowId === sessionId && this.pool[i].billNo === Number(billNo)) {
          this.pool[i].isConsumed = true;
          this.pool[i].windowId = null;
          return;
        }
      }
    }

    release(sessionId) {
      if (!sessionId) return;
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
    mgr.allocate("w1"); mgr.consume("w1", 101); // 101
    mgr.allocate("w2"); mgr.consume("w2", 102); // 102
    mgr.allocate("w3"); mgr.consume("w3", 103); // 103
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
    mgr.allocate("w2"); mgr.consume("w2", 102); // 102 consumed
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

    mgr.consume("sale-A", 101); // A completes
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
    mgr.allocate("w1"); mgr.consume("w1", 101); // 101 consumed
    mgr.allocate("w2"); mgr.consume("w2", 102); // 102 consumed
    mgr.allocate("w3"); mgr.consume("w3", 103); // 103 consumed
    // All 3 consumed, 0 available → needs refill
    mgr.allocate("w4"); // triggers refill, gets the first new number
    expect(mgr._available().length).toBeGreaterThanOrEqual(2); // 2 left after allocate
  });

  // ---- Type safety (string billNo from IPC / form inputs) ----

  test("allocate always returns a number", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const billNo = mgr.allocate("w1");
    expect(typeof billNo).toBe("number");
  });

  test("consume accepts string billNo and matches number pool entry", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const billNo = mgr.allocate("w1"); // 101 (number)
    mgr.consume("w1", String(billNo)); // pass as string — should still match
    expect(mgr.pool.find(function(e) { return e.billNo === 101; }).isConsumed).toBe(true);
  });

  test("consume with non-matching string billNo does NOT consume", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    mgr.allocate("w1"); // reserves 101
    mgr.consume("w1", "999"); // wrong billNo as string
    expect(mgr.pool.find(function(e) { return e.billNo === 101; }).isConsumed).toBe(false);
    expect(mgr.pool.find(function(e) { return e.billNo === 101; }).windowId).toBe("w1"); // still reserved
  });

  test("verify-then-consume flow works with string billNo from IPC", () => {
    // Simulates the save_exit flow: allocate() at sale start, then
    // verify-then-consume at save, where billNo arrives as string from IPC
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const sessionId = "sale-42";

    // Step 1: Sale starts — get-sale-bill-number allocates
    const allocated = mgr.allocate(sessionId); // 101 (number)

    // Step 2: Save — billNo arrives as string from renderer IPC
    const billNoFromRenderer = String(allocated); // "101"

    // Step 3: Verify — allocate(sessionId) returns the reserved number
    const verified = mgr.allocate(sessionId);
    expect(verified).toBe(Number(billNoFromRenderer)); // must match after Number() cast

    // Step 4: Consume or release
    if (verified === Number(billNoFromRenderer)) {
      mgr.consume(sessionId, billNoFromRenderer);
    } else {
      mgr.release(sessionId);
    }

    expect(mgr.pool.find(function(e) { return e.billNo === 101; }).isConsumed).toBe(true);
  });

  test("verify-then-release flow works when numbers mismatch", () => {
    // Edge case: the reserved number changed (e.g., pool corruption, out-of-band reset)
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    const sessionId = "sale-99";

    // Allocate and then manually corrupt the reservation
    mgr.allocate(sessionId); // reserves 101
    // Simulate corruption: wipe windowId, another window takes 101
    mgr.pool.find(function(e) { return e.billNo === 101; }).windowId = null;
    mgr.allocate("other-window"); // takes 101

    // Now sessionId "sale-99" allocates again — gets 102 (101 is taken)
    const allocated = mgr.allocate(sessionId);
    expect(allocated).toBe(102);

    // Renderer still thinks billNo is "101" (string)
    const billNoFromRenderer = "101";

    // Verify step fails — mismatch
    const verified = mgr.allocate(sessionId); // returns 102 (reserved for this session)
    expect(verified).not.toBe(Number(billNoFromRenderer)); // 102 !== 101

    // Release the wrongly-reserved number
    mgr.release(sessionId);

    // 102 should now be released (not consumed), 101 is still reserved by other-window
    var entry102 = mgr.pool.find(function(e) { return e.billNo === 102; });
    expect(entry102.isConsumed).toBe(false);
    expect(entry102.windowId).toBe(null);
    expect(entry102.date).toBeTruthy(); // released entry has date
  });

  test("pool entry billNo is always stored as number", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 5 });
    for (var i = 0; i < mgr.pool.length; i++) {
      expect(typeof mgr.pool[i].billNo).toBe("number");
    }
  });

  test("sessionId type mismatch — null/undefined does not crash", () => {
    const mgr = new TestBillManager({ seed: 100, poolSize: 10 });
    // These should not throw
    expect(mgr.allocate(null)).toBe(0);
    expect(mgr.allocate(undefined)).toBe(0);
    expect(mgr.allocate("")).toBe(0);
    mgr.consume(null, 101); // should not throw
    mgr.consume(undefined, 101); // should not throw
    mgr.release(null); // should not throw
    mgr.release(undefined); // should not throw
  });
});
