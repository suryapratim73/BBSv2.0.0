// getBillNo lives in lib/common.js (main-only, reads real config + process.presets)
jest.mock("../lib/common", () => ({
    getBillNo: (billNo) => "FMT-" + billNo,
}));

const {
    resolveVariable,
    resolveColumnVar,
    getFont,
    coerceOrderItems,
    VARIABLES,
    VARIABLE_GROUPS,
} = require("../lib/billBlockModel");

const billObj = {
    billMeta: {
        billNo: 101,
        billDate: new Date(2026, 8, 13),
        billType: "sale",
        billStatus: "open",
        orderRef: "OR-1",
        ewayBill: "EWB-1",
        mode: "counter",
        target: "retail",
        autoBill: false,
        stateNcode: "WB-19",
        placeOfSupply: "West Bengal",
        deliveryType: "transporter",
        shipTo: "Ramesh Store",
        shipAddr: "Kolkata",
        shipPh: "99999",
        shipGST: "19ABCDE1234F1Z5",
        transportName: "Fast Truckers",
        transportId: "TR-1",
        transportAddress: "Delhi",
        transportContact: "88888",
        transportGST: "07ABCDE1234F1Z5",
        netQty: 5,
        netAmt: 950,
        netTax: 45,
        netAmtTax: 1000,
        netDue: 0,
        netPayment: 1000,
        paymentStatus: true,
        discVal: 50,
        delCharge: 0,
        scrapTDSAmt: 10,
        payment: [{ type: "Cash", payment: 1000 }],
        printObj: {
            captions: ["Original Buyer's Copy", "Duplicate Copy"],
            copies: 1,
            printer: "Default",
            paperSize: "A4",
            printOrientation: "portrait",
        },
    },
    customer: {
        name: "Surya Traders",
        address: "Siliguri",
        gst: "19XYZ",
        phones: [null, "9123456789"],
    },
    payment: { type: "Cash" },
    orderItems: [
        { name: "Item A", hsn: "1001", qty: 2, quantity: 2, sellUnit: "Kg", rate: 100, cgst: 2.5, sgst: 2.5, igst: 0 },
        { name: "Item B", hsn: "1002", qty: 1, quantity: 1, sellUnit: "Pc", rate: 700, cgst: 0, sgst: 0, igst: 5 },
    ],
};

const saleConfig = {
    biller: "Krishna Traders",
    address: "Main Road",
    gst: "19AAACK1234F1Z5",
    phones: ["9830000000"],
    email: "kt@example.com",
    bankDetails: [{ bank: "SBI", branch: "Siliguri", accNo: "1234567890", ifsc: "SBIN0001234" }],
    billTemplate: {
        applyTemplate: false,
        file: "default2",
        applyEmblem: true,
        emblem: "template/img/logo.png",
        applySeal: true,
        seal: "template/img/seal.png",
    },
    unitMap: [{ Kg: 1 }, { Gm: 0.001 }],
    defaultFontFamily: "Times-Roman",
    defaultFontSize: 12,
};

describe("resolveVariable — registry keys", () => {
    test("bill keys", () => {
        expect(resolveVariable("billNo", billObj, saleConfig)).toBe("101");
        expect(resolveVariable("bill-no-formatted", billObj, saleConfig)).toBe("FMT-101");
        expect(resolveVariable("date", billObj, saleConfig)).toBe("2026-09-13");
        expect(resolveVariable("date-slash", billObj, saleConfig)).toBe("13/09/2026");
        expect(resolveVariable("billType", billObj, saleConfig)).toBe("sale");
        expect(resolveVariable("billStatus", billObj, saleConfig)).toBe("open");
        expect(resolveVariable("orderRef", billObj, saleConfig)).toBe("OR-1");
        expect(resolveVariable("ewayBill", billObj, saleConfig)).toBe("EWB-1");
        expect(resolveVariable("stateNcode", billObj, saleConfig)).toBe("WB-19");
        expect(resolveVariable("placeOfSupply", billObj, saleConfig)).toBe("West Bengal");
        expect(resolveVariable("deliveryType", billObj, saleConfig)).toBe("transporter");
        expect(resolveVariable("shipTo", billObj, saleConfig)).toBe("Ramesh Store");
        expect(resolveVariable("shipAddr", billObj, saleConfig)).toBe("Kolkata");
        expect(resolveVariable("shipPh", billObj, saleConfig)).toBe("99999");
        expect(resolveVariable("shipGST", billObj, saleConfig)).toBe("19ABCDE1234F1Z5");
        expect(resolveVariable("transportName", billObj, saleConfig)).toBe("Fast Truckers");
        expect(resolveVariable("transportId", billObj, saleConfig)).toBe("TR-1");
        expect(resolveVariable("transportAddress", billObj, saleConfig)).toBe("Delhi");
        expect(resolveVariable("transportContact", billObj, saleConfig)).toBe("88888");
        expect(resolveVariable("transportGST", billObj, saleConfig)).toBe("07ABCDE1234F1Z5");
        expect(resolveVariable("netQty", billObj, saleConfig)).toBe("5");
        expect(resolveVariable("netAmt", billObj, saleConfig)).toBe("950");
        expect(resolveVariable("netTax", billObj, saleConfig)).toBe("45");
        expect(resolveVariable("netAmtTax", billObj, saleConfig)).toBe("1000");
        expect(resolveVariable("netDue", billObj, saleConfig)).toBe("0");
        expect(resolveVariable("netPayment", billObj, saleConfig)).toBe("1000");
        expect(resolveVariable("paymentStatus", billObj, saleConfig)).toBe("true");
        expect(resolveVariable("discVal", billObj, saleConfig)).toBe("50");
        expect(resolveVariable("delCharge", billObj, saleConfig)).toBe("0");
        expect(resolveVariable("scrapTDSAmt", billObj, saleConfig)).toBe("10");
        expect(resolveVariable("ro", billObj, saleConfig)).toBe("0");
        expect(resolveVariable("payment", billObj, saleConfig)).toEqual(["Cash: 1000"]);
    });

    test("biller keys come from saleConfig", () => {
        expect(resolveVariable("biller-name", billObj, saleConfig)).toBe("Krishna Traders");
        expect(resolveVariable("biller-address", billObj, saleConfig)).toBe("Main Road");
        expect(resolveVariable("biller-gst", billObj, saleConfig)).toBe("19AAACK1234F1Z5");
        expect(resolveVariable("biller-phone", billObj, saleConfig)).toBe("9830000000");
        expect(resolveVariable("biller-email", billObj, saleConfig)).toBe("kt@example.com");
        expect(resolveVariable("biller-bank", billObj, saleConfig)).toEqual([
            "SBI | Siliguri | A/c 1234567890 | IFSC SBIN0001234",
        ]);
    });

    test("customer keys come from billObj.customer", () => {
        expect(resolveVariable("customer-name", billObj, saleConfig)).toBe("Surya Traders");
        expect(resolveVariable("customer-address", billObj, saleConfig)).toBe("Siliguri");
        expect(resolveVariable("customer-gst", billObj, saleConfig)).toBe("19XYZ");
        expect(resolveVariable("customer-phone", billObj, saleConfig)).toBe("9123456789");
    });

    test("payment keys keep legacy semantics", () => {
        expect(resolveVariable("pay-mode", billObj, saleConfig)).toBe("Cash");
        expect(resolveVariable("pay-date", billObj, saleConfig)).toBe("2026-09-13");
        expect(resolveVariable("pay-status", billObj, saleConfig)).toBe("Paid");
        expect(resolveVariable("pay-status", { billMeta: { paymentStatus: false } }, saleConfig)).toBe("Unpaid");
        // no payment key on the bill -> pay-mode is blank
        expect(resolveVariable("pay-mode", { billMeta: {} }, saleConfig)).toBe("");
    });

    test("tax keys reduce from orderItems", () => {
        expect(resolveVariable("net-CGST", billObj, saleConfig)).toBe("5");
        expect(resolveVariable("net-SGST", billObj, saleConfig)).toBe("5");
        expect(resolveVariable("net-IGST", billObj, saleConfig)).toBe("35");
    });

    test("print keys use ctx", () => {
        expect(resolveVariable("bill-copy", billObj, saleConfig, { captionIndex: 0 })).toBe("Original Buyer's Copy");
        expect(resolveVariable("bill-copy", billObj, saleConfig, { captionIndex: 1 })).toBe("Duplicate Copy");
        expect(resolveVariable("bill-copy", billObj, saleConfig, { captionIndex: 5 })).toBe("");
        expect(resolveVariable("page-no", billObj, saleConfig, { pageNo: 3 })).toBe("3");
        expect(resolveVariable("page-no", billObj, saleConfig)).toBe("1");
        expect(resolveVariable("print-copies", billObj, saleConfig)).toBe("1");
        expect(resolveVariable("print-printer", billObj, saleConfig)).toBe("Default");
        expect(resolveVariable("print-paper-size", billObj, saleConfig)).toBe("A4");
        expect(resolveVariable("print-orientation", billObj, saleConfig)).toBe("portrait");
    });

    test("computed keys", () => {
        expect(resolveVariable("gtotal-words", billObj, saleConfig)).toBe("One thousand only.");
        expect(resolveVariable("pan", billObj, saleConfig)).toBe("AAACK1234F");
        expect(resolveVariable("sub-total", billObj, saleConfig)).toBe("1000");
        expect(resolveVariable("total-before-tax", billObj, saleConfig)).toBe("1900");
        expect(resolveVariable("total-discount", billObj, saleConfig)).toBe("950");
        expect(resolveVariable("scrap-tds", billObj, saleConfig)).toBe("10");
        expect(resolveVariable("grand-total", billObj, saleConfig)).toBe("1010");
        // discVal >= 100 guards division by zero
        const fullDiscount = { billMeta: { netAmt: 950, discVal: 100 } };
        expect(resolveVariable("total-before-tax", fullDiscount, saleConfig)).toBe("");
        expect(resolveVariable("total-discount", fullDiscount, saleConfig)).toBe("");
        // scrap-tds collapses when 0
        expect(resolveVariable("scrap-tds", { billMeta: { scrapTDSAmt: 0 } }, saleConfig)).toBe("");
    });

    test("place-of-jurisdiction guards process.presets", () => {
        expect(resolveVariable("place-of-jurisdiction", billObj, saleConfig)).toBe("");
        process.presets = { placeOfJurisdiction: "Siliguri" };
        try {
            expect(resolveVariable("place-of-jurisdiction", billObj, saleConfig)).toBe(
                "Subject to Siliguri Jurisdiction only."
            );
        } finally {
            delete process.presets;
        }
    });
});

describe("resolveVariable — generic fallback", () => {
    test("unknown keys resolve straight from billMeta (the zero-code-extension guarantee)", () => {
        expect(resolveVariable("futureField", { billMeta: { futureField: 42 } }, saleConfig)).toBe("42");
        expect(resolveVariable("futureField", { billMeta: { futureField: "abc" } }, saleConfig)).toBe("abc");
        expect(resolveVariable("futureField", { billMeta: {} }, saleConfig)).toBe("");
    });

    test("arrays become lines, objects and missing data become empty", () => {
        expect(resolveVariable("tags", { billMeta: { tags: ["a", "b"] } }, saleConfig)).toEqual(["a", "b"]);
        expect(resolveVariable("tags", { billMeta: { tags: [1, null, "x"] } }, saleConfig)).toEqual(["1", "x"]);
        expect(resolveVariable("weird", { billMeta: { weird: { x: 1 } } }, saleConfig)).toBe("");
        expect(resolveVariable("nothing", {}, {})).toBe("");
        expect(resolveVariable("customer-name", {}, {})).toBe("");
        expect(resolveVariable("biller-name", {}, {})).toBe("");
    });

    test("Date values format through openFormatForDate", () => {
        expect(
            resolveVariable("someDate", { billMeta: { someDate: new Date(2026, 8, 13) } }, saleConfig)
        ).toBe("2026-09-13");
    });
});

describe("resolveColumnVar", () => {
    const itemA = billObj.orderItems[0];

    test("legacy columns", () => {
        expect(resolveColumnVar("slno", itemA, 0)).toBe(1);
        expect(resolveColumnVar("slno", itemA, 4)).toBe(5);
        expect(resolveColumnVar("unit", itemA, 0)).toBe("Kg");
        expect(resolveColumnVar("qty", itemA, 0)).toBe(2);
        expect(resolveColumnVar("rate", itemA, 0)).toBe(100);
        expect(resolveColumnVar("amt", itemA, 0)).toBe(200);
        expect(resolveColumnVar("netAmt", itemA, 0)).toBe(10);
        expect(resolveColumnVar("CGST", itemA, 0)).toBe(5);
        expect(resolveColumnVar("SGST", itemA, 0)).toBe(5);
        expect(resolveColumnVar("IGST", itemA, 0)).toBe(0);
        // plain data columns fall back to lowercased itemObj keys
        expect(resolveColumnVar("name", itemA, 0)).toBe("Item A");
        expect(resolveColumnVar("hsn", itemA, 0)).toBe("1001");
    });

    test("new computed columns", () => {
        // unit-price = rate × unitMap multiplier
        expect(resolveColumnVar("unit-price", itemA, 0, saleConfig)).toBe(100);
        expect(resolveColumnVar("unit-price", itemA, 0, { unitMap: [{ Kg: 0.5 }] })).toBe(50);
        expect(resolveColumnVar("unit-price", itemA, 0, {})).toBe(100);
        expect(resolveColumnVar("unit-price", { ...itemA, sellUnit: "Box" }, 0, saleConfig)).toBe(100);
        // amount = unit-price × qty
        expect(resolveColumnVar("amount", itemA, 0, saleConfig)).toBe(200);
        // total = rate × qty × (1 + tax)
        expect(resolveColumnVar("total", itemA, 0)).toBe(210);
        expect(resolveColumnVar("total", billObj.orderItems[1], 1)).toBe(735);
    });

    test("quantity fallback when qty is absent", () => {
        const item = { name: "X", rate: 50, quantity: 3, cgst: 0, sgst: 0, igst: 0 };
        expect(resolveColumnVar("qty", item, 0)).toBe(3);
        expect(resolveColumnVar("amt", item, 0)).toBe(150);
    });
});

describe("getFont port", () => {
    test("Times-Roman variants", () => {
        expect(getFont("Times-Roman", false, false)).toBe("Times-Roman");
        expect(getFont("Times-Roman", true, false)).toBe("Times-Bold");
        expect(getFont("Times-Roman", false, true)).toBe("Times-Italic");
        expect(getFont("Times-Roman", true, true)).toBe("Times-BoldItalic");
    });
    test("other families append suffixes", () => {
        expect(getFont("Helvetica", true, false)).toBe("Helvetica-Bold");
        expect(getFont("Helvetica", false, true)).toBe("Helvetica-Oblique");
        expect(getFont("Helvetica", true, true)).toBe("Helvetica-BoldOblique");
        expect(getFont("Courier", false, false)).toBe("Courier");
    });
    test("Arial maps to Times-Roman (legacy quirk)", () => {
        expect(getFont("Arial", false, false)).toBe("Times-Roman");
    });
    test("missing family defaults to Times-Roman", () => {
        expect(getFont(undefined, false, false)).toBe("Times-Roman");
    });
});

describe("coerceOrderItems", () => {
    test("numeric string fields become numbers (legacy port)", () => {
        const items = [
            { name: "A", rate: "100", qty: "2", cgst: "2.5", sgst: "2.5", igst: "0", quantity: "2" },
            { name: "B", rate: 50, qty: 1 },
        ];
        coerceOrderItems(items);
        expect(items[0].rate).toBe(100);
        expect(items[0].qty).toBe(2);
        expect(items[0].cgst).toBe(2.5);
        expect(items[0].sgst).toBe(2.5);
        expect(items[0].igst).toBe(0);
        expect(items[0].quantity).toBe(2);
        expect(items[1].rate).toBe(50);
    });
});

describe("registry coverage", () => {
    test("every registry key resolves without throwing on the full fixture", () => {
        VARIABLE_GROUPS.forEach((group) => {
            group.keys.forEach((key) => {
                expect(() => resolveVariable(key, billObj, saleConfig, { pageNo: 1, captionIndex: 0 })).not.toThrow();
            });
        });
        expect(Object.keys(VARIABLES).length).toBeGreaterThan(60);
    });
});
