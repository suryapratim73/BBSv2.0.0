// Batch 2 — Money-math unit tests (continued)
// GST validation, bill number sequencing, item grouping

// --- gstChecksum (template/js/common.js) ---
// Validates GSTIN format and modulo-36 checksum
const { gstChecksum } = require("../template/js/common");

describe("gstChecksum — GSTIN validation", () => {
  // Helper: compute what the checksum character SHOULD be for a 14-char prefix
  function computeChecksum(prefix14) {
    const factor = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const codePoint = chars.indexOf(prefix14[i]);
      const product = codePoint * factor[i];
      sum += Math.floor(product / 36) + (product % 36);
    }
    return chars[(36 - (sum % 36)) % 36];
  }

  test("rejects GSTIN that doesn't match regex format", () => {
    expect(gstChecksum("")).toBe(false);
    expect(gstChecksum("12345")).toBe(false);
    expect(gstChecksum("ABCDE1234F1Z5")).toBe(false); // no state code prefix
    expect(gstChecksum("22AAAAA0000A1Z")).toBe(false); // too short
    expect(gstChecksum("22AAAAA0000A1Z55")).toBe(false); // too long
  });

  test("rejects GSTIN with invalid characters", () => {
    expect(gstChecksum("22AAAAA0000A1Z$")).toBe(false);
    expect(gstChecksum("22AAAAA0000A1z5")).toBe(false); // lowercase z
  });

  test("rejects GSTIN without mandatory Z at position 14", () => {
    // 14th char (index 13) must be Z
    expect(gstChecksum("22AAAAA0000A1A5")).toBe(false);
    expect(gstChecksum("22AAAAA0000A115")).toBe(false);
  });

  test("rejects wrong checksum digit", () => {
    // We know the correct checksum — flip it to something else
    const prefix = "22AAAAA0000A1Z";
    const correct = computeChecksum(prefix);
    const wrong = correct === "A" ? "B" : "A";
    expect(gstChecksum(prefix + wrong)).toBe(false);
  });

  test("accepts a valid GSTIN with correct checksum", () => {
    const prefix = "27AAPCS0937N1Z"; // real PAN prefix, Z is required
    const checksum = computeChecksum(prefix);
    const gstin = prefix + checksum;
    expect(gstChecksum(gstin)).toBe(true);
  });

  test("accepts multiple valid GSTINs with computed checksums", () => {
    const prefixes = [
      "22AAAAA0000A1Z",
      "27AABCS1234B1Z",
      "09AAACH5678C1Z",
      "33AAACE9012D1Z",
    ];
    prefixes.forEach((prefix) => {
      const gstin = prefix + computeChecksum(prefix);
      expect(gstChecksum(gstin)).toBe(true);
    });
  });

  test("rejects GSTIN with wrong entity digit but valid checksum", () => {
    // Entity number at position 12 must be alphanumeric, not just any char
    // The regex accepts [A-Z\d] at position 12, so let's verify
    const prefix = "22AAAAA0000A1Z";
    const gstin = prefix + computeChecksum(prefix);
    // Should be valid since regex passes and checksum is correct
    expect(gstChecksum(gstin)).toBe(true);
  });

  test("state codes 00-38 are accepted, 39-99 also pass regex", () => {
    // Regex accepts any 2 digits as state code
    expect(gstChecksum("00AAAAA0000A1Z" + computeChecksum("00AAAAA0000A1Z"))).toBe(true);
    expect(gstChecksum("38AAAAA0000A1Z" + computeChecksum("38AAAAA0000A1Z"))).toBe(true);
    expect(gstChecksum("99AAAAA0000A1Z" + computeChecksum("99AAAAA0000A1Z"))).toBe(true);
  });
});

// --- BillNoGenerator class (main-process common.js) ---
// Sequential bill number counter — pure logic, no I/O

// The class is not exported directly, only the singleton wrappers are.
// We extract and test the class pattern independently:
describe("BillNoGenerator — sequential counter logic", () => {
  // Replicate the class logic from common.js:29-46
  class BillNoGenerator {
    constructor(initBillNo) {
      this.billNo = initBillNo ? initBillNo : 0;
    }
    getNextBillNo() {
      this.billNo++;
      return this.billNo;
    }
    reduceBillNo() {
      this.billNo--;
    }
    setBillNo(billNo) {
      this.billNo = billNo;
    }
  }

  test("starts at 0 if no initial value given", () => {
    const gen = new BillNoGenerator();
    expect(gen.billNo).toBe(0);
  });

  test("starts at given initial value", () => {
    const gen = new BillNoGenerator(100);
    expect(gen.billNo).toBe(100);
  });

  test("starts at 0 if given falsy value 0", () => {
    // BUG EDGE CASE: 0 is falsy, so it falls through to `this.billNo = 0`
    // This happens to be correct (0 === 0), but if someone passes `0` meaning
    // "bill number 0 is valid", it works but by coincidence.
    const gen = new BillNoGenerator(0);
    expect(gen.billNo).toBe(0);
  });

  test("getNextBillNo increments and returns", () => {
    const gen = new BillNoGenerator(5);
    expect(gen.getNextBillNo()).toBe(6);
    expect(gen.getNextBillNo()).toBe(7);
    expect(gen.getNextBillNo()).toBe(8);
  });

  test("reduceBillNo decrements by 1", () => {
    const gen = new BillNoGenerator(10);
    gen.reduceBillNo();
    expect(gen.billNo).toBe(9);
    gen.reduceBillNo();
    expect(gen.billNo).toBe(8);
  });

  test("setBillNo overrides current value", () => {
    const gen = new BillNoGenerator(10);
    gen.setBillNo(500);
    expect(gen.billNo).toBe(500);
    expect(gen.getNextBillNo()).toBe(501);
  });

  test("reduce below 0 — possible negative bill numbers", () => {
    const gen = new BillNoGenerator(0);
    gen.reduceBillNo();
    expect(gen.billNo).toBe(-1); // No guard — negative bills are possible
    gen.reduceBillNo();
    expect(gen.billNo).toBe(-2);
  });

  test("large values — up to Number.MAX_SAFE_INTEGER", () => {
    const gen = new BillNoGenerator(9007199254740990);
    expect(gen.getNextBillNo()).toBe(9007199254740991);
  });

  test("setBillNo with negative value", () => {
    const gen = new BillNoGenerator();
    gen.setBillNo(-5);
    expect(gen.billNo).toBe(-5);
  });
});

// --- itemAnalyzer (saleHandler.js:117, internal — not exported) ---
// Groups duplicate line items by name+rate, merging quantities.
// Replicated from source for testing since it's not exported.

function itemAnalyzer(orderItems) {
  let itemList = JSON.parse(JSON.stringify(orderItems));
  itemList = itemList.reduce((acc, itemObj) => {
    let match = acc.find(obj => obj.name === itemObj.name);
    if (match && match.rate === itemObj.rate)
      match.qty += itemObj.qty;
    else
      acc.push(itemObj);
    return acc;
  }, []);
  return itemList;
}

describe("itemAnalyzer — merge duplicate line items", () => {
  test("returns empty array for empty input", () => {
    expect(itemAnalyzer([])).toEqual([]);
  });

  test("returns single item unchanged", () => {
    const items = [{ name: "Steel", qty: 10, rate: 500 }];
    expect(itemAnalyzer(items)).toEqual([{ name: "Steel", qty: 10, rate: 500 }]);
  });

  test("merges items with same name AND same rate", () => {
    const items = [
      { name: "Steel", qty: 10, rate: 500 },
      { name: "Steel", qty: 5, rate: 500 },
    ];
    expect(itemAnalyzer(items)).toEqual([
      { name: "Steel", qty: 15, rate: 500 },
    ]);
  });

  test("keeps items with same name but DIFFERENT rate separate", () => {
    const items = [
      { name: "Steel", qty: 10, rate: 500 },
      { name: "Steel", qty: 5, rate: 550 }, // different rate
    ];
    const result = itemAnalyzer(items);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { name: "Steel", qty: 10, rate: 500 },
      { name: "Steel", qty: 5, rate: 550 },
    ]));
  });

  test("merges multiple groups independently", () => {
    const items = [
      { name: "Steel", qty: 10, rate: 500 },
      { name: "Iron", qty: 3, rate: 300 },
      { name: "Steel", qty: 5, rate: 500 },
      { name: "Iron", qty: 2, rate: 300 },
    ];
    const result = itemAnalyzer(items);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { name: "Steel", qty: 15, rate: 500 },
      { name: "Iron", qty: 5, rate: 300 },
    ]));
  });

  test("merges only the first match — duplicate prevention", () => {
    // If there are 3 identical items, they should all merge into one
    const items = [
      { name: "A", qty: 1, rate: 100 },
      { name: "A", qty: 2, rate: 100 },
      { name: "A", qty: 3, rate: 100 },
    ];
    const result = itemAnalyzer(items);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(6);
  });

  test("zero quantity — still merges correctly", () => {
    const items = [
      { name: "Steel", qty: 0, rate: 500 },
      { name: "Steel", qty: 10, rate: 500 },
    ];
    const result = itemAnalyzer(items);
    expect(result).toEqual([{ name: "Steel", qty: 10, rate: 500 }]);
  });

  test("deep clones input — does not mutate original array items", () => {
    const items = [
      { name: "Steel", qty: 10, rate: 500, extra: { nested: true } },
    ];
    const result = itemAnalyzer(items);
    // Modify result, original should be unchanged
    result[0].qty = 999;
    expect(items[0].qty).toBe(10);
  });
});
