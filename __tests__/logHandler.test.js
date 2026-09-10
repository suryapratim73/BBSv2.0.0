// logHandler hash-chain tests — _tamperChecker (current strict behavior)
// and _rebuildChain (repair's pure rebuild).
//
// repair_save_log_file itself is NOT unit-tested — it writes real files and
// is covered by in-app verification (flip a char → viewer → repair → reopen).

jest.mock("../viewManager", () => ({ getTemplatePath: () => "" }));
jest.mock("../createModal", () => ({ createModal: () => ({}), getMainWindow: () => null }));
jest.mock("../common", () => ({
  getSecret: async () => "test-secret",
  getDeviceSerials: async () => ({ motherboardSerial: "MB", diskSerial: "DK" }),
  appLogger: () => {},
  attempt: (fn, fallback) => {
    try {
      const result = fn();
      return result instanceof Promise ? result.catch(() => fallback) : result;
    } catch (_) { return fallback; }
  },
  getLocalDateStr: () => "2026-09-10",
  reopenTodaysLog: () => {},
}));

const crypto = require("crypto");
const { _tamperChecker, _rebuildChain } = require("../logHandler");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Build a valid chain of `count` entries. `genesisAt` marks extra genesis lines
 *  (hash:""), e.g. a chain restart in the middle of a day. */
function makeChain(count, genesisAt = []) {
  const raw = [];
  const entries = [];
  let lastHash = "";
  for (let i = 0; i < count; i++) {
    const entry = {
      ts: `2026-09-10T${String(i).padStart(2, "0")}:00:00.000Z`,
      title: "Test",
      message: `Entry ${i}`,
      user: "app",
      hash: (i === 0 || genesisAt.includes(i)) ? "" : lastHash,
    };
    const line = JSON.stringify(entry);
    raw.push(line);
    entries.push(entry);
    lastHash = sha256(line);
  }
  return { raw, entries };
}

function mutateLine(raw, i, replacer) {
  const out = raw.slice();
  out[i] = replacer(out[i]);
  return out;
}

// ===================== _tamperChecker =====================
// NOTE: current behavior is STRICT — an unparseable line breaks the chain walk
// (flagged tampered; repair drops such lines). The "skip corrupt lines across
// gaps" relaxation was explicitly left out for now.

describe("_tamperChecker", () => {
  test("valid chain passes", () => {
    const { raw } = makeChain(20);
    expect(_tamperChecker(raw, "test.txt").tampered).toBe(false);
  });

  test("mutating a middle line is detected", () => {
    const { raw } = makeChain(10);
    const broken = mutateLine(raw, 4, (line) => {
      const o = JSON.parse(line);
      o.message = "TAMPERED";
      return JSON.stringify(o); // newer neighbor still hashes the old bytes
    });
    expect(_tamperChecker(broken, "test.txt").tampered).toBe(true);
  });

  test("unparseable middle line is flagged by the strict checker", () => {
    const { raw } = makeChain(10);
    const broken = mutateLine(raw, 4, () => "{GARBLED NOT JSON");
    expect(_tamperChecker(broken, "test.txt").tampered).toBe(true);
  });

  test("genesis line corroborated by the newer neighbor passes", () => {
    const { raw } = makeChain(10, [4]); // restart at entry 4
    expect(_tamperChecker(raw, "test.txt").tampered).toBe(false);
  });

  test("genesis line NOT corroborated is flagged", () => {
    const { raw } = makeChain(10, [4]);
    // Break the forward link: entry 5's hash no longer points at entry 4's bytes.
    // Rehash entry 6 so only the genesis corroboration is left broken.
    const broken = mutateLine(raw, 5, (line) => {
      const o = JSON.parse(line);
      o.hash = "deadbeef";
      return JSON.stringify(o);
    });
    const l6 = JSON.parse(broken[6]);
    l6.hash = sha256(broken[5]);
    broken[6] = JSON.stringify(l6);
    expect(_tamperChecker(broken, "test.txt").tampered).toBe(true);
  });

  test("consecutive genesis lines (rapid restart) pass", () => {
    const { raw } = makeChain(10, [3, 4]);
    expect(_tamperChecker(raw, "test.txt").tampered).toBe(false);
  });

  test("newest line with empty hash passes (accepted blind spot)", () => {
    const { raw } = makeChain(10);
    const broken = mutateLine(raw, 9, (line) => {
      const o = JSON.parse(line);
      o.hash = "";
      return JSON.stringify(o); // nothing newer to corroborate it — accepted
    });
    expect(_tamperChecker(broken, "test.txt").tampered).toBe(false);
  });

  test("empty lines between entries are ignored", () => {
    const { raw } = makeChain(5);
    const withGaps = [];
    for (const line of raw) withGaps.push(line, "", "   ");
    expect(_tamperChecker(withGaps, "test.txt").tampered).toBe(false);
  });

  test("oldest line's hash field is never validated (cross-day link safety)", () => {
    const { raw } = makeChain(10);
    // The oldest line's stored hash links into the PREVIOUS day's file —
    // tamperChecker must ignore it. Changing line 0's bytes forces a
    // rehash cascade of every newer line so the in-file chain stays consistent.
    const lines = raw.slice();
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), hash: "garbage-link-into-yesterday" });
    for (let i = 1; i < lines.length; i++) {
      const o = JSON.parse(lines[i]);
      o.hash = sha256(lines[i - 1]);
      lines[i] = JSON.stringify(o);
    }

    expect(_tamperChecker(lines, "test.txt").tampered).toBe(false);
  });
});

// ===================== _rebuildChain =====================

describe("_rebuildChain", () => {
  test("drops empty, non-string, and unparseable lines without throwing", () => {
    const { raw } = makeChain(5);
    const input = [null, "", "   ", "{not json", 42, raw[0], undefined, raw[1], "{also bad"];
    const out = _rebuildChain(input);

    expect(out).toHaveLength(2);
    out.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  test("rehashes from the previous line's FINAL bytes; first line keeps its stored hash", () => {
    const { raw, entries } = makeChain(5);
    const broken = mutateLine(raw, 2, (line) => {
      const o = JSON.parse(line);
      o.hash = "broken";
      return JSON.stringify(o);
    });

    const out = _rebuildChain(broken);
    expect(out).toHaveLength(5);

    const objs = out.map((line) => JSON.parse(line));
    expect(objs[0].hash).toBe(entries[0].hash); // first line — link to previous day, untouched
    expect(objs[2].hash).not.toBe("broken");
    for (let i = 1; i < objs.length; i++) {
      expect(objs[i].hash).toBe(sha256(out[i - 1]));
    }
  });

  test("repaired chain passes tamperChecker", () => {
    const { raw } = makeChain(10);
    const broken = mutateLine(raw, 5, (line) => {
      const o = JSON.parse(line);
      o.hash = "tampered";
      return JSON.stringify(o);
    });

    expect(_tamperChecker(broken, "test.txt").tampered).toBe(true);

    const repaired = _rebuildChain(broken);
    expect(_tamperChecker(repaired, "test.txt").tampered).toBe(false);
  });

  test("chain with a garbled line is repaired (line dropped) and passes", () => {
    const { raw } = makeChain(10);
    const broken = raw.slice();
    broken[3] = "{GARBLED"; // torn-write artifact: unparseable middle line

    expect(_tamperChecker(broken, "test.txt").tampered).toBe(true);

    const repaired = _rebuildChain(broken);
    expect(repaired).toHaveLength(9);
    expect(_tamperChecker(repaired, "test.txt").tampered).toBe(false);
  });

  test("strips any _hash field from rebuilt entries", () => {
    const { raw } = makeChain(3);
    const input = raw.slice(0, 2).map((line) => {
      const o = JSON.parse(line);
      o._hash = "should-be-removed";
      return JSON.stringify(o);
    });

    const out = _rebuildChain(input);
    out.forEach((line) => expect(JSON.parse(line)._hash).toBeUndefined());
  });

  test("empty / whitespace-only input returns []", () => {
    expect(_rebuildChain([])).toEqual([]);
    expect(_rebuildChain(["", "   ", "\n"])).toEqual([]);
  });
});
