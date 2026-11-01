// execCustomTemplate.test.js — the legacy custom-template engine after the
// C3 registry swap. The contract under test: every legacy fType prints the
// same output the hardcoded switch produced, shapes draw the right pdfkit
// path, partitions stay inside applyBorder, and the D2 `gst` column works.
const fs = require("fs");
const {
    main,
    createSections,
    createFeilds,
    createBody,
    getFont,
    searchSectionScope,
} = require("../lib/execCustomTemplate");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SALE_CONFIG = {
    biller: "Krishna Traders",
    address: "Main Road",
    gst: "19AAACK1234F1Z5",
    phones: ["9830000000"],
    email: "kt@example.com",
    bankDetails: [
        { bank: "SBI", branch: "Siliguri", accNo: "1234567890", ifsc: "SBIN0001234" },
        { bank: "HDFC", branch: "Bagdogra", accNo: "A2", ifsc: "I2" },
        { bank: "BOI", branch: "Matigara", accNo: "A3", ifsc: "I3" },
    ],
    billTemplate: { applyTemplate: false, file: "default2", applyEmblem: false, emblem: "" },
    defaultFontFamily: "Times-Roman",
    defaultFontSize: 12,
    margin: 10,
};

const billObj = {
    billMeta: {
        billNo: 101,
        billDate: "2026-09-13",
        billStatus: "open",
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
        printObj: { captions: ["Original Buyer's Copy", "Duplicate Copy"], copies: 1 },
    },
    customer: { name: "Surya Traders", address: "Siliguri", gst: "19XYZ", phones: [null, "9123456789"] },
    payment: { type: "Cash" },
    orderItems: [
        { name: "Item A", hsn: "1001", qty: 2, sellUnit: "Kg", rate: 100, cgst: 2.5, sgst: 2.5, igst: 0 },
        { name: "Item B", hsn: "1002", qty: 1, sellUnit: "Pc", rate: 700, cgst: 0, sgst: 0, igst: 5 },
    ],
};

/** A recording pdfkit stand-in (pattern from the deleted execBlockTemplate suite). */
function FakeDoc(overrides = {}) {
    const texts = [];
    const lines = [];
    const shapes = [];
    let lastMove = null;
    const doc = {
        page: {
            width: 595.28,
            height: 841.89,
            margins: { left: 10, right: 10, top: 10, bottom: 10 },
            ...overrides.page,
        },
        y: 0,
        _currentFont: "Times-Roman",
        font(f) { this._currentFont = f; return this; },
        fontSize() { return this; },
        lineWidth() { return this; },
        moveTo(x, y) { lastMove = [x, y]; return this; },
        lineTo(x, y) { lines.push([lastMove, [x, y]]); lastMove = [x, y]; return this; },
        stroke() { return this; },
        rect(x, y, w, h) { shapes.push(["rect", x, y, w, h]); return this; },
        roundedRect(x, y, w, h, r) { shapes.push(["roundedRect", x, y, w, h, r]); return this; },
        circle(cx, cy, r) { shapes.push(["circle", cx, cy, r]); return this; },
        ellipse(cx, cy, rx, ry) { shapes.push(["ellipse", cx, cy, rx, ry]); return this; },
        text(text, x, y, opts) {
            if (typeof x === "object") { opts = x; x = undefined; y = undefined; }
            texts.push({ text: String(text), x, y, opts, font: this._currentFont });
            if (x === undefined) this.y += this.currentLineHeight(); // flowing text advances y
            return this;
        },
        moveDown() { this.y += 14; return this; },
        underline(x, y, w, h) { doc._underline = [x, y, w, h]; return this; },
        currentLineHeight() { return 14; },
        widthOfString(s) { return String(s).length * 7; },
        heightOfString(s, opts) {
            // Same 7px/char model as widthOfString: wrapped height for a
            // given box width, in whole line-heights.
            const w = opts?.width;
            if (!w) return 0;
            return Math.ceil((String(s).length * 7) / w) * 14;
        },
        addPage() { doc._pages = (doc._pages || 1) + 1; return this; },
        image() { doc._images = (doc._images || 0) + 1; return this; },
        save() { doc._saved = true; return this; },
        end() { return this; },
    };
    doc._texts = texts;
    doc._lines = lines;
    doc._shapes = shapes;
    return doc;
}

/** Printed feild values (the doc.text call with x/y — the feild body). */
function printedTexts(doc) {
    return doc._texts.filter((t) => t.x !== undefined).map((t) => t.text);
}

function feild(fType, text = "", overrides = {}) {
    return {
        type: "variable",
        x: 0,
        y: 0,
        fSize: 12,
        fFamily: "Times-Roman",
        text,
        fWidth: 50,
        bold: false,
        italic: false,
        underline: false,
        fType,
        ...overrides,
    };
}

function baseTemplate(feilds = [], overrides = {}) {
    return {
        size: "a4",
        applyMargin: false,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        head: {},
        body: {},
        footer: {},
        feilds,
        sections: [],
        applyBorder: false,
        border: 1,
        newDoc: true,
        filePath: "",
        fFamily: "Times-Roman",
        ...overrides,
    };
}

// createFeilds reads the sale config from disk — serve the fixture.
const realReadFileSync = fs.readFileSync;
jest.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
    if (String(p).includes("saleConfig")) return JSON.stringify(SALE_CONFIG);
    return realReadFileSync(p, ...args);
});

// ---------------------------------------------------------------------------
// Parity table — every legacy fType prints the legacy switch output
// ---------------------------------------------------------------------------
describe("createFeilds — legacy fType parity", () => {
    // [fType, expected printed text] — the legacy switch semantics
    const parity = [
        ["date", "2026-09-13"],
        ["biller-name", "Krishna Traders"],
        ["biller-address", "Main Road"],
        ["biller-gst", "19AAACK1234F1Z5"],
        ["biller-phone", "9830000000"],
        ["customer-name", "Surya Traders"],
        ["customer-address", "Siliguri"],
        ["customer-gst", "19XYZ"],
        ["customer-phone", "9123456789"],
        ["pay-mode", "Cash"],
        ["pay-date", "2026-09-13"],
        ["pay-status", "Paid"],
        ["billStatus", "open"],
        ["page-no", "1"],
        ["net-CGST", "5"],
        ["net-SGST", "5"],
        ["net-IGST", "35"],
        ["ro", "0"],
        ["gtotal-words", "One thousand only."],
        ["bill-copy", "Original Buyer's Copy"],
        ["netTax", "45"],
        // legacy default case (numbers -> Math.round)
        ["billNo", "101"],
        ["netAmt", "950"],
        ["netAmtTax", "1000"],
        ["discVal", "50"],
    ];

    test.each(parity)("%s prints the legacy value", async (fType, expected) => {
        const doc = FakeDoc();
        await createFeilds(doc, baseTemplate([feild(fType)]), billObj);
        expect(printedTexts(doc)).toEqual([expected]);
    });

    test("prefix text keeps the legacy ': ' join", async () => {
        const doc = FakeDoc();
        await createFeilds(doc, baseTemplate([feild("billNo", "Bill No")]), billObj);
        expect(printedTexts(doc)).toEqual(["Bill No: 101"]);
    });

    test("free-text billMeta keys resolve through the generic fallback (2dp)", async () => {
        const doc = FakeDoc();
        await createFeilds(
            doc,
            baseTemplate([feild("customKey")]),
            { billMeta: { ...billObj.billMeta, customKey: 42.5 } }
        );
        expect(printedTexts(doc)).toEqual(["42.5"]);
    });

    test("missing data prints empty text, not a crash", async () => {
        const doc = FakeDoc();
        await createFeilds(
            doc,
            baseTemplate([feild("billNo"), feild("customer-name")]),
            { billMeta: {} }
        );
        expect(printedTexts(doc)).toEqual(["", ""]);
    });

    test("feild width % applies to the page width, underline uses the text", async () => {
        const doc = FakeDoc();
        await createFeilds(
            doc,
            baseTemplate([feild("billNo", "", { bold: true, italic: true, underline: true, fWidth: 60 })]),
            billObj
        );
        const printed = doc._texts.filter((t) => t.x !== undefined).pop();
        // Legacy quirk: bold/italic only change the computed fFamily — doc.font()
        // is never re-called with it before doc.text, so it prints in the
        // pre-transform font. Parity kept.
        expect(printed.font).toBe("Times-Roman");
        expect(printed.opts.width).toBe(358); // ceil(60% of 595.28)
        expect(doc._underline).toEqual([0, 0, 21, 14]); // widthOfString("101")*7, lineHeight 14
    });

    test("Arial fallback never re-applies doc.font (legacy temporary fix)", async () => {
        const doc = FakeDoc();
        await createFeilds(doc, baseTemplate([feild("biller-name", "", { fFamily: "Arial" })]), billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined).pop();
        expect(printed.font).toBe("Arial"); // font() ran before the fix
    });

    test("feilds inside a section use the section width", async () => {
        const doc = FakeDoc();
        const template = baseTemplate(
            [feild("biller-name", "", { x: 5, y: 5, fWidth: 50 })],
            { sections: [{ role: "section", x: 0, y: 0, width: 300, height: 100, applyBorder: false, border: 1, partitions: [], plan: {} }] }
        );
        await createFeilds(doc, template, billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined).pop();
        expect(printed.opts.width).toBe(150); // ceil(50% of 300)
    });
});

describe("createFeilds — biller-bank legacy branch", () => {
    test("each feild pops one bank in legacy order (reversed array, pop)", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([
            feild("biller-bank"),
            feild("biller-bank"),
            feild("biller-bank"),
        ]);
        await createFeilds(doc, template, billObj);
        const bankLines = doc._texts.filter((t) => t.x === undefined).map((t) => t.text);
        // banks reversed [BOI,HDFC,SBI] -> pop() => SBI, HDFC, BOI
        expect(bankLines).toEqual([
            "Bank Details: SBI",
            "Bank Details: Siliguri",
            "Account No: 1234567890",
            "IFSC SBIN0001234",
            "Bank Details: HDFC",
            "Bank Details: Bagdogra",
            "Account No: A2",
            "IFSC I2",
            "Bank Details: BOI",
            "Bank Details: Matigara",
            "Account No: A3",
            "IFSC I3",
        ]);
    });

    test("the separator line is moved to but never stroked (legacy quirk)", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([
            feild("biller-bank", "", { x: 12, y: 708, fWidth: 60, underline: true }),
        ]);
        await createFeilds(doc, template, billObj);
        // after the first pop 2 banks remain -> banks.length > 1 -> the line;
        // lineTo((x+fWidth, doc.y)) is a comma expression passing only doc.y.
        const sep = doc._lines.filter(([from]) => from[0] === 12);
        expect(sep.length).toBe(1);
        expect(sep[0][0]).toEqual([12, 70]); // moveDown() + 4 flowing texts, 14 each
        expect(sep[0][1]).toEqual([70, undefined]); // the comma-operator quirk
        // underline must be skipped for biller-bank
        expect(doc._underline).toBeUndefined();
    });

    test("the prefix still prints at the feild's slot (empty for typical feilds)", async () => {
        const doc = FakeDoc();
        await createFeilds(doc, baseTemplate([feild("biller-bank")]), billObj);
        expect(printedTexts(doc)).toEqual([""]);
    });
});

describe("createFeilds — align and flow", () => {
    test("space-between prints label and value as two calls, value right-aligned", async () => {
        const doc = FakeDoc();
        await createFeilds(doc, baseTemplate([feild("billNo", "Bill No", { align: "space-between" })]), billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined);
        expect(printed.map((t) => t.text)).toEqual(["Bill No: ", "101"]);
        const w = Math.ceil(50 * 595.28 * 0.01); // 298
        expect(printed[1].x).toBe(w - 21); // box edge minus widthOfString("101")
        expect(printed[1].y).toBe(0);
    });

    test("a wrapped string feild pushes the next feild below itself", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([
            feild("", "A".repeat(30), { type: "string", fWidth: 10 }),
            feild("", "Next", { type: "string", y: 20 }),
        ]);
        await createFeilds(doc, template, billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined);
        expect(printed.map((t) => t.text)).toEqual(["A".repeat(30), "Next"]);
        expect(printed[1].y).toBe(56); // 4 wrapped lines of 14
    });

    test("same-baseline siblings are never pushed", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([
            feild("", "A".repeat(30), { type: "string", fWidth: 10, x: 0 }),
            feild("", "Sibling", { type: "string", y: 0, x: 100 }),
        ]);
        await createFeilds(doc, template, billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined);
        expect(printed[1].y).toBe(0);
    });

    test("flow is scoped per host section", async () => {
        const doc = FakeDoc();
        const template = baseTemplate(
            [
                feild("", "A".repeat(30), { type: "string", fWidth: 10, x: 5, y: 0 }),
                feild("", "Other", { type: "string", x: 310, y: 20 }),
            ],
            {
                sections: [
                    { role: "section", x: 0, y: 0, width: 300, height: 100, applyBorder: false, border: 1, partitions: [], plan: {} },
                    { role: "section", x: 300, y: 0, width: 300, height: 100, applyBorder: false, border: 1, partitions: [], plan: {} },
                ],
            }
        );
        await createFeilds(doc, template, billObj);
        const printed = doc._texts.filter((t) => t.x !== undefined);
        expect(printed[1].y).toBe(20); // the wrap in section 1 doesn't reach section 2
    });
});

describe("createSections — shapes and partitions", () => {
    const sectionsTemplate = (sections, border = 1) => ({
        head: {},
        body: {},
        footer: {},
        sections,
        border,
    });

    test("rectangle is the default shape for legacy templates", () => {
        const doc = FakeDoc();
        createSections(doc, sectionsTemplate([{ x: 10, y: 22, width: 590, height: 750, applyBorder: true, partitions: [] }]));
        expect(doc._shapes).toEqual([["rect", 10, 22, 590, 750]]);
    });

    test("rounded draws roundedRect with the corner radius", () => {
        const doc = FakeDoc();
        createSections(doc, sectionsTemplate([
            { x: 8, y: 8, width: 579.28, height: 246, applyBorder: true, partitions: [], shape: "rounded", cornerRadius: 12 },
        ]));
        expect(doc._shapes).toEqual([["roundedRect", 8, 8, 579.28, 246, 12]]);
    });

    test("rounded clamps the radius to half the smaller side", () => {
        const doc = FakeDoc();
        createSections(doc, sectionsTemplate([
            { x: 0, y: 0, width: 40, height: 30, applyBorder: true, partitions: [], shape: "rounded", cornerRadius: 500 },
        ]));
        expect(doc._shapes).toEqual([["roundedRect", 0, 0, 40, 30, 15]]);
    });

    test("circle and ellipse draw at the section center", () => {
        const doc = FakeDoc();
        createSections(doc, sectionsTemplate([
            { x: 10, y: 20, width: 100, height: 60, applyBorder: true, partitions: [], shape: "circle" },
            { x: 10, y: 100, width: 100, height: 60, applyBorder: true, partitions: [], shape: "ellipse" },
        ]));
        expect(doc._shapes).toEqual([
            ["circle", 60, 50, 30],
            ["ellipse", 60, 130, 50, 30],
        ]);
    });

    test("partitions draw inside applyBorder only (legacy contract)", () => {
        const withBorder = FakeDoc();
        createSections(withBorder, sectionsTemplate([
            { x: 10, y: 225, width: 590, height: 405, applyBorder: true, partitions: [{ direction: "col", range: 49.15, lWidth: 1 }] },
        ]));
        expect(withBorder._lines.length).toBe(1);
        expect(withBorder._lines[0][0][0]).toBeCloseTo(299.985, 3); // 10 + 590*49.15%
        expect(withBorder._lines[0][0][1]).toBe(225);
        expect(withBorder._lines[0][1][0]).toBeCloseTo(299.985, 3);
        expect(withBorder._lines[0][1][1]).toBe(630);

        const withoutBorder = FakeDoc();
        createSections(withoutBorder, sectionsTemplate([
            { x: 10, y: 225, width: 590, height: 405, applyBorder: false, partitions: [{ direction: "col", range: 49.15, lWidth: 1 }] },
        ]));
        expect(withoutBorder._lines).toEqual([]);
    });
});

describe("createBody — table columns", () => {
    const bodyTemplate = (cols) => ({
        body: { plan: { fSize: 12, padding: 10, cols }, width: 575 },
    });

    test("legacy columns print (slno/unit/amt/netAmt/CGST/plain)", () => {
        const doc = FakeDoc();
        createBody(
            doc,
            { name: "Item A", hsn: "1001", qty: 2, sellUnit: "Kg", rate: 100, cgst: 2.5, sgst: 2.5, igst: 0 },
            300,
            1,
            bodyTemplate([
                { var: "slno", width: 10, xPos: 0 },
                { var: "unit", width: 10, xPos: 20 },
                { var: "amt", width: 10, xPos: 40 },
                { var: "netAmt", width: 10, xPos: 60 },
                { var: "CGST", width: 10, xPos: 80 },
                { var: "name", width: 20, xPos: 100 },
            ])
        );
        // xPos + padding = 10/30/50/70/90/110
        expect(doc._texts.map((t) => [t.text, t.x, t.y])).toEqual([
            ["1", 10, 300],
            ["Kg", 30, 300],
            ["200", 50, 300],
            ["10", 70, 300],
            ["5", 90, 300],
            ["Item A", 110, 300],
        ]);
    });

    test("gst column prints igst when present, else cgst * 2 (D2 contract)", () => {
        const doc = FakeDoc();
        createBody(
            doc,
            { rate: 100, qty: 2, cgst: 2.5, sgst: 2.5, igst: 0 },
            300,
            1,
            bodyTemplate([{ var: "gst", width: 10, xPos: 0 }])
        );
        expect(doc._texts[0].text).toBe("5");

        const doc2 = FakeDoc();
        createBody(
            doc2,
            { rate: 700, qty: 1, cgst: 0, sgst: 0, igst: 5 },
            300,
            1,
            bodyTemplate([{ var: "gst", width: 10, xPos: 0 }])
        );
        expect(doc2._texts[0].text).toBe("5");
    });
});

describe("getFont / searchSectionScope", () => {
    test("getFont port keeps the engine variants (no Arial quirk)", () => {
        expect(getFont("Times-Roman", false, false)).toBe("Times-Roman");
        expect(getFont("Times-Roman", true, false)).toBe("Times-Bold");
        expect(getFont("Times-Roman", false, true)).toBe("Times-Italic");
        expect(getFont("Times-Roman", true, true)).toBe("Times-BoldItalic");
        expect(getFont("Helvetica", true, false)).toBe("Helvetica-Bold");
    });

    test("searchSectionScope finds the containing section", () => {
        const template = {
            head: {},
            body: {},
            footer: {},
            sections: [{ role: "section", x: 10, y: 225, width: 590, height: 405 }],
        };
        expect(searchSectionScope(300, 300, template)).toMatchObject({ x: 10, y: 225 });
        expect(searchSectionScope(9999, 9999, template)).toBeUndefined();
    });
});

describe("main — end to end", () => {
    test("renders captions, feilds and item rows and returns the pdf path", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([feild("billNo")], {
            body: {
                x: 10,
                y: 225,
                width: 590,
                height: 405,
                applyBorder: false,
                border: 1,
                partitions: [],
                plan: {
                    fSize: 12,
                    padding: 10,
                    thHeight: 35,
                    rSpacing: 8,
                    cols: [
                        { label: "Sl No", var: "slno", width: 10, xPos: 0, yPos: 23.5 },
                        { label: "Item", var: "name", width: 45, xPos: 59, yPos: 23.5 },
                        { label: "Amount", var: "amt", width: 15, xPos: 324.5, yPos: 23.5 },
                    ],
                },
            },
        });
        const pdfPath = await main(doc, "/tmp/out.pdf", billObj, template);
        expect(pdfPath).toBe("/tmp/out.pdf");
        expect(doc._saved).toBe(true);
        const texts = printedTexts(doc);
        expect(texts).toContain("101"); // billNo feild
        expect(texts).toContain("1"); // slno row 1
        expect(texts).toContain("2"); // slno row 2
        expect(texts).toContain("Item A");
        expect(texts).toContain("Item B");
        expect(texts).toContain("200"); // amt row 1
        expect(texts).toContain("700"); // amt row 2
    });

    test("prints static parts only when the body has no plan (Blank starter)", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([feild("billNo")], { body: {} }); // no table
        const pdfPath = await main(doc, "/tmp/out.pdf", billObj, template);
        expect(pdfPath).toBe("/tmp/out.pdf");
        expect(doc._saved).toBe(true);
        expect(printedTexts(doc)).toContain("101");
        expect(printedTexts(doc)).not.toContain("Item A");
    });

    test("resets the page counter for repeated renders", async () => {
        const doc = FakeDoc();
        const template = baseTemplate([feild("page-no")], {
            body: {
                x: 10, y: 225, width: 590, height: 405,
                applyBorder: false, border: 1, partitions: [],
                plan: { fSize: 12, padding: 10, thHeight: 35, rSpacing: 8,
                    cols: [
                        { label: "Sl No", var: "slno", width: 10, xPos: 0, yPos: 23.5 },
                        { label: "Item", var: "name", width: 45, xPos: 59, yPos: 23.5 },
                    ] },
            },
        });
        // Two 2-caption renders advance the counter to 4; a fresh render
        // must start back at 1 (the designer preview re-renders repeatedly).
        await main(doc, "/tmp/a.pdf", billObj, template);
        await main(doc, "/tmp/b.pdf", billObj, template);
        await main(doc, "/tmp/c.pdf", billObj, template);
        const printed = printedTexts(doc);
        expect(printed.filter(text => text === "1").length).toBeGreaterThanOrEqual(3); // one per render
        expect(printed).not.toContain("3");
        expect(printed).not.toContain("4");
    });
});
