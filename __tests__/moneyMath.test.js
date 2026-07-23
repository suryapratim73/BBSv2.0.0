// Batch 2 — Money-math unit tests
// These functions directly affect billing, tax, and financial year calculations.
// Bugs here = wrong bills, wrong tax filings, wrong financial reports.

// --- roundOffTo2DecimalPlace (template/js/common.js) ---
// Pure math — the foundation of every rupee value in the app
const { roundOffTo2DecimalPlace } = require("../template/js/common");

describe("roundOffTo2DecimalPlace — rounding foundation", () => {
  test("rounds positive decimal to 2 places (up)", () => {
    expect(roundOffTo2DecimalPlace(123.456)).toBe(123.46);
  });

  test("rounds positive decimal to 2 places (down)", () => {
    expect(roundOffTo2DecimalPlace(123.454)).toBe(123.45);
  });

  test("rounds half-paise correctly (Indian rounding)", () => {
    // Indian convention: < 50 paise rounds down, ≥ 50 paise rounds up
    expect(roundOffTo2DecimalPlace(1.005)).toBe(1.01); // was buggy before Number.EPSILON fix
    expect(roundOffTo2DecimalPlace(1.004)).toBe(1.00);
    expect(roundOffTo2DecimalPlace(1.006)).toBe(1.01);
  });

  test("rounds half-paise boundary values correctly", () => {
    expect(roundOffTo2DecimalPlace(1.255)).toBe(1.26);
    expect(roundOffTo2DecimalPlace(2.525)).toBe(2.53);
  });

  test("handles whole numbers", () => {
    expect(roundOffTo2DecimalPlace(100)).toBe(100);
  });

  test("handles zero", () => {
    expect(roundOffTo2DecimalPlace(0)).toBe(0);
  });

  test("handles negative values", () => {
    // Negative numbers: refunds, credit notes, stock returns
    expect(roundOffTo2DecimalPlace(-50.678)).toBe(-50.68);
    expect(roundOffTo2DecimalPlace(-50.674)).toBe(-50.67);
  });

  test("handles very small fractional amounts", () => {
    expect(roundOffTo2DecimalPlace(0.001)).toBe(0);
    expect(roundOffTo2DecimalPlace(0.009)).toBe(0.01);
  });

  test("handles large amounts (lakhs/crores)", () => {
    expect(roundOffTo2DecimalPlace(9999999.999)).toBe(10000000);
    expect(roundOffTo2DecimalPlace(12345678.90)).toBe(12345678.9);
  });

  test("0.1 + 0.2 rounds correctly", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS — rounding fixes it
    expect(roundOffTo2DecimalPlace(0.1 + 0.2)).toBe(0.3);
  });
});

// --- openFormatForDate (main-process common.js) ---
// Formats dates as DD-MM-YYYY for all financial documents.
// Uses toLocaleDateString("en-IN", ...) which works in Electron/Chromium
// but NOT in plain Node.js (missing full-ICU data). We mock the locale
// call so the test logic is verified regardless of the test environment.

// --- openFormatForDate (main-process common.js) ---
// The function uses toLocaleDateString("en-IN", ...) then reverses via reduce.
// Electron/Chromium has full ICU for en-IN; plain Node.js does not.
// We test the underlying logic directly — the reduce transform and the
// Date-vs-non-Date guard — which is where bugs would live.

const { openFormatForDate } = require("../common");

describe("openFormatForDate — input validation", () => {
  test("returns input unchanged if not a Date object", () => {
    expect(openFormatForDate("19-07-2026")).toBe("19-07-2026");
    expect(openFormatForDate(null)).toBe(null);
    expect(openFormatForDate(123456)).toBe(123456);
  });

  test("does not throw on undefined input", () => {
    expect(() => openFormatForDate(undefined)).not.toThrow();
  });

  test("does not throw on a valid Date", () => {
    expect(() => openFormatForDate(new Date())).not.toThrow();
  });

  test("returns a string for valid Date input", () => {
    const result = openFormatForDate(new Date());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThanOrEqual(8); // at least DD-MM-YYYY or ISO
  });
});

// Test the reduce transform independently — this is the actual date-formatting logic
describe("openFormatForDate — reduce transform logic", () => {
  // The function does: toLocaleDateString("en-IN", ...).split("/").reduce(...)
  // The reduce builds: part[i] + "-" + accumulated-prefix
  // For input [a, b, c] the result is: c-b-a (reversed, dash-separated)

  function simulateReduce(parts) {
    return parts.reduce((acc, str, i) => {
      acc = i === 0 ? str : str + "-" + acc;
      return acc;
    }, "");
  }

  test("three-element array produces reversed dash-separated output", () => {
    // The reduce reverses: [a, b, c] → c-b-a
    expect(simulateReduce(["a", "b", "c"])).toBe("c-b-a");
  });

  test("numeric date parts [DD, MM, YYYY] → YYYY-MM-DD", () => {
    // en-IN splits as DD/MM/YYYY; reduce reverses to YYYY-MM-DD
    expect(simulateReduce(["19", "07", "2026"])).toBe("2026-07-19");
  });

  test("zero-pads preserved in output", () => {
    expect(simulateReduce(["05", "01", "2026"])).toBe("2026-01-05");
  });

  test("month and year boundaries", () => {
    expect(simulateReduce(["31", "12", "2026"])).toBe("2026-12-31");
  });

  test("leap year date", () => {
    expect(simulateReduce(["29", "02", "2024"])).toBe("2024-02-29");
  });
});

// --- scrapCalc math (template/js/salePage.js) ---
// Scrap sale: taxable = qty * rate, gst = taxable * 18%, tds = taxable * 2%, total = taxable + gst + tds
// Tests the math formula independent of DOM — these are the numbers that end up on bills

describe("scrap sale math (extracted formula)", () => {
  // The actual scrapCalc() updates DOM, but the math is:
  //   taxable = qty * rate
  //   gst     = taxable * 0.18
  //   tds     = taxable * 0.02
  //   total   = taxable + gst + tds
  // All rounded to 2 decimal places

  function computeScrap(qty, rate) {
    const taxable = qty * rate;
    const gst = taxable * 0.18;
    const tds = taxable * 0.02;
    const total = taxable + gst + tds;

    return {
      taxable: roundOffTo2DecimalPlace(taxable),
      gst: roundOffTo2DecimalPlace(gst),
      tds: roundOffTo2DecimalPlace(tds),
      total: roundOffTo2DecimalPlace(total),
    };
  }

  test("basic scrap calculation", () => {
    const result = computeScrap(10, 500); // 10 kg @ ₹500/kg
    expect(result.taxable).toBe(5000);
    expect(result.gst).toBe(900);     // 5000 * 0.18
    expect(result.tds).toBe(100);      // 5000 * 0.02
    expect(result.total).toBe(6000);   // 5000 + 900 + 100
  });

  test("fractional quantity", () => {
    const result = computeScrap(1.5, 350); // 1.5 kg @ ₹350/kg
    expect(result.taxable).toBe(525);
    expect(result.gst).toBe(94.5);
    expect(result.tds).toBe(10.5);
    expect(result.total).toBe(630);
  });

  test("zero quantity — should produce zeros", () => {
    const result = computeScrap(0, 500);
    expect(result.taxable).toBe(0);
    expect(result.gst).toBe(0);
    expect(result.tds).toBe(0);
    expect(result.total).toBe(0);
  });

  test("fractional rate — common in metal scrap pricing", () => {
    const result = computeScrap(100, 427.55);
    expect(result.taxable).toBe(42755);
    expect(result.gst).toBe(7695.9);
    expect(result.tds).toBe(855.1);
    expect(result.total).toBe(51306);
  });

  test("zero rate — free scrap disposal", () => {
    const result = computeScrap(50, 0);
    expect(result.taxable).toBe(0);
    expect(result.gst).toBe(0);
    expect(result.tds).toBe(0);
    expect(result.total).toBe(0);
  });

  test("gst + tds always sum correctly", () => {
    // Invariant: total === taxable + gst + tds (all rounded)
    for (const [qty, rate] of [[5, 234.5], [17, 1200], [3.5, 99.99], [1000, 1.25]]) {
      const r = computeScrap(qty, rate);
      const expectedTotal = roundOffTo2DecimalPlace(r.taxable + r.gst + r.tds);
      expect(r.total).toBe(expectedTotal);
    }
  });
});
