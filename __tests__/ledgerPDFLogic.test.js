const {
    processSalePurchaseEntry,
    processPaymentEntry,
    processOutPaymentEntry,
    prepareEntryRows
} = require("../scripts/makePDF.default");

const D = (iso) => new Date(iso);

describe("processPaymentEntry — entry date is the row date", () => {
    test("cash payment uses the ledger entry's date, not today", () => {
        const row = processPaymentEntry({
            itemList: JSON.stringify({ paymode: "cash" }),
            payments: 100,
            date: D("2026-04-10")
        });
        expect(row.date.toISOString()).toBe(D("2026-04-10").toISOString());
        expect(row.amount).toBe("100 Cr");
        expect(row.dr).toBe(0);
        expect(row.cr).toBe(100);
    });

    test("cheque payment uses the entry date even when pay-dt differs", () => {
        const row = processPaymentEntry({
            itemList: JSON.stringify({ paymode: "cheque", chkNo: "CHK1", "pay-dt": "2026-01-01" }),
            payments: 250,
            date: D("2026-04-12")
        });
        expect(row.date.toISOString()).toBe(D("2026-04-12").toISOString());
        expect(row.particular).toBe("Payment received by cheque: CHK1");
    });

    test("bank transfer particular uses bankTrnRef", () => {
        const row = processPaymentEntry({
            itemList: JSON.stringify({ paymode: "bank", bankTrnRef: "UTR9" }),
            payments: 75,
            date: D("2026-04-13")
        });
        expect(row.particular).toBe("Payment received by bank: UTR9");
    });

    test("malformed itemList returns null instead of throwing", () => {
        expect(processPaymentEntry({ itemList: "not-json", payments: 5, date: D("2026-04-14") })).toBeNull();
    });
});

describe("processOutPaymentEntry — entry date is the row date", () => {
    test("out-payment uses entry date and Dr direction", () => {
        const row = processOutPaymentEntry({
            itemList: JSON.stringify({ ref: "cash", payDate: "2026-02-02" }),
            payments: 300,
            date: D("2026-05-01")
        });
        expect(row.date.toISOString()).toBe(D("2026-05-01").toISOString());
        expect(row.amount).toBe("300 Dr");
        expect(row.dr).toBe(300);
        expect(row.cr).toBe(0);
    });
});

describe("processSalePurchaseEntry", () => {
    test("sale is Dr with billAmt minus payments", () => {
        const row = processSalePurchaseEntry({ type: "sale", billNo: 7, billAmt: 1000, payments: 200, date: D("2026-04-15") });
        expect(row.amount).toBe("800 Dr");
        expect(row.dr).toBe(800);
        expect(row.cr).toBe(0);
    });

    test("purchase is Cr", () => {
        const row = processSalePurchaseEntry({ type: "purchase", billNo: 9, billAmt: 500, payments: 100, date: D("2026-04-16") });
        expect(row.amount).toBe("400 Cr");
        expect(row.dr).toBe(0);
        expect(row.cr).toBe(400);
    });
});

describe("prepareEntryRows", () => {
    test("sorts by entry date and keeps running balance per row", () => {
        const rows = prepareEntryRows([
            { type: "sale", billNo: 2, billAmt: 1000, payments: 0, date: D("2026-04-20"), balance: 1000, itemList: "[]" },
            { type: "sale", billNo: 1, billAmt: 500, payments: 0, date: D("2026-04-10"), balance: 500, itemList: "[]" }
        ]);
        expect(rows.map(r => r.particular)).toEqual(["Sale: Bill Number:1", "Sale: Bill Number:2"]);
        expect(rows.map(r => r.balance)).toEqual([500, 1000]);
    });

    test("renders a legacy opening-balance typed entry with its balance", () => {
        const rows = prepareEntryRows([
            { type: "opening-balance", date: D("2026-04-01"), balance: 4000, itemList: "[]" },
            { type: "sale", billNo: 1, billAmt: 500, payments: 0, date: D("2026-04-10"), balance: 4500, itemList: "[]" }
        ]);
        expect(rows[0]).toMatchObject({ particular: "Opening balance", amount: "—", dr: 0, cr: 0, balance: 4000 });
        expect(rows[0].date.toISOString()).toBe(D("2026-04-01").toISOString());
    });

    test("skips unknown entry types", () => {
        const rows = prepareEntryRows([
            { type: "mystery", date: D("2026-04-05"), balance: 1, itemList: "[]" },
            { type: "sale", billNo: 1, billAmt: 500, payments: 0, date: D("2026-04-10"), balance: 500, itemList: "[]" }
        ]);
        expect(rows).toHaveLength(1);
    });

    test("totals across a mixed period reconcile with the running balance", () => {
        const rows = prepareEntryRows([
            { type: "sale", billNo: 1, billAmt: 1000, payments: 200, date: D("2026-04-10"), balance: 800, itemList: "[]" },
            { type: "payment", itemList: JSON.stringify({ paymode: "cash" }), payments: 300, date: D("2026-04-12"), balance: 500 },
            { type: "out-payment", itemList: JSON.stringify({ ref: "cash" }), payments: 100, date: D("2026-04-14"), balance: 600 }
        ]);
        const dr = rows.reduce((s, r) => s + r.dr, 0);
        const cr = rows.reduce((s, r) => s + r.cr, 0);
        expect(dr - cr).toBe(600);
        expect(rows.at(-1).balance).toBe(600);
    });
});
