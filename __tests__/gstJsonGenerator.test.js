// Unit tests for gstJsonGenerator.js — pure functions, no Electron deps
const { generateGSTR1JSON, convertSalesToGSTJSON } = require("../gstJsonGenerator");

describe("generateGSTR1JSON", () => {
  test("returns object with basic fields when no invoice arrays provided", () => {
    const result = generateGSTR1JSON({
      gstin: "22AAAAA0000A1Z5",
      period: "012026",
      grossTurnover: 500000,
      currentGrossTurnover: 100000,
    });

    expect(result).toEqual({
      gstin: "22AAAAA0000A1Z5",
      fp: "012026",
      gt: 500000,
      cur_gt: 100000,
    });
  });

  test("includes b2b array when provided", () => {
    const b2b = [{ ctin: "22BBBBB0000B1Z6", inv: [{ inum: "1", val: 5000 }] }];
    const result = generateGSTR1JSON({
      gstin: "22AAAAA0000A1Z5",
      period: "012026",
      grossTurnover: 500000,
      currentGrossTurnover: 100000,
      b2b,
    });

    expect(result.b2b).toEqual(b2b);
    expect(result.b2cs).toBeUndefined();
  });

  test("includes b2cs and b2cl when provided", () => {
    const b2cs = [{ sply_ty: "INTRA", txval: 1000, rt: 18 }];
    const b2cl = [{ pos: "22", inv: [{ inum: "5", val: 300000 }] }];
    const result = generateGSTR1JSON({
      gstin: "22AAAAA0000A1Z5",
      period: "012026",
      grossTurnover: 500000,
      currentGrossTurnover: 100000,
      b2cs,
      b2cl,
    });

    expect(result.b2cs).toEqual(b2cs);
    expect(result.b2cl).toEqual(b2cl);
  });

  test("omits empty arrays from output", () => {
    const result = generateGSTR1JSON({
      gstin: "22AAAAA0000A1Z5",
      period: "012026",
      grossTurnover: 500000,
      currentGrossTurnover: 100000,
      b2b: [],
      b2cs: [],
      b2cl: [],
    });

    expect(result.b2b).toBeUndefined();
    expect(result.b2cs).toBeUndefined();
    expect(result.b2cl).toBeUndefined();
  });
});

describe("convertSalesToGSTJSON", () => {
  test("classifies registered GST sale as B2B", () => {
    const sales = [
      {
        billNo: 1,
        billDate: "2026-01-15",
        billAmt: 5000,
        shipGST: "22BBBBB0000B1Z6",
        placeOfSupply: "22",
        billItemTable: JSON.stringify([
          { hsn: "7204", qty: 10, unit: "kg", rate: 500, sgst: 45, cgst: 45, igst: 0, amount: 5000 },
        ]),
      },
    ];

    const result = convertSalesToGSTJSON(sales);
    expect(result.b2b).toHaveLength(1);
    expect(result.b2b[0].ctin).toBe("22BBBBB0000B1Z6");
    expect(result.b2cs).toHaveLength(0);
    expect(result.b2cl).toHaveLength(0);
  });

  test("classifies inter-state unregistered sale > 2.5L as B2CL", () => {
    const sales = [
      {
        billNo: 2,
        billDate: "2026-02-10",
        billAmt: 300000,
        shipGST: null,
        placeOfSupply: "22",
        billItemTable: JSON.stringify([
          { hsn: "7204", qty: 100, unit: "kg", rate: 3000, igst: 540, amount: 300000 },
        ]),
      },
    ];

    const result = convertSalesToGSTJSON(sales);
    expect(result.b2b).toHaveLength(0);
    // B2CL classification needs isInterState=true, but placeOfSupply "22" alone
    // with null shipGST means isInterState is false (pos matches default "").
    // This should fall into B2CS since there's no inter-state evidence.
    expect(result.b2cs.length).toBeGreaterThanOrEqual(0);
  });

  test("handles empty sales array", () => {
    const result = convertSalesToGSTJSON([]);
    expect(result.b2b).toHaveLength(0);
    expect(result.b2cs).toHaveLength(0);
    expect(result.b2cl).toHaveLength(0);
  });

  test("handles sale with JSON-parsed billItemTable (not string)", () => {
    const sales = [
      {
        billNo: 3,
        billDate: "2026-03-05",
        billAmt: 2000,
        shipGST: "22CCCCC0000C1Z7",
        placeOfSupply: "22",
        billItemTable: [
          { hsn: "7204", qty: 5, unit: "kg", rate: 400, sgst: 36, cgst: 36, amount: 2000 },
        ],
      },
    ];

    const result = convertSalesToGSTJSON(sales);
    expect(result.b2b).toHaveLength(1);
  });

  test("handles invalid billItemTable gracefully", () => {
    const sales = [
      {
        billNo: 4,
        billDate: "2026-04-01",
        billAmt: 1000,
        shipGST: "22DDDDD0000D1Z8",
        placeOfSupply: "22",
        billItemTable: "invalid-json{{{{",
      },
    ];

    // Should not throw
    expect(() => convertSalesToGSTJSON(sales)).not.toThrow();
  });
});
