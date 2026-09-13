// getBillNo (lib/common.js) reads real config + process.presets — mock it.
// The engine require()s common lazily inside drawImage only.
jest.mock("../lib/common", () => ({
    getBillNo: (billNo) => "FMT-" + billNo,
}));

const {
    main,
    renderPage,
    renderTable,
    imageDrawable,
} = require("../lib/execBlockTemplate");
const {
    BillPage,
    TextBlock,
    VariableBlock,
    ImageBlock,
    TableBlock,
    TotalsBlock,
} = require("../lib/billBlockModel");

/** Minimal pdfkit stand-in: tracks cursor, fonts, texts, images, rects, pages. */
class FakeDoc {
    constructor(pageWidth = 595.28, pageHeight = 841.89) {
        this.page = { width: pageWidth, height: pageHeight };
        this.pageCount = 1;
        this.y = 0;
        this.x = 0;
        this.fontSizeVal = 12;
        this.ended = false;
        this.texts = [];
        this.images = [];
        this.rects = [];
        this.saves = 0;
        this.restores = 0;
    }
    addPage() {
        this.pageCount++;
        this.page = { width: this.page.width, height: this.page.height };
        this.y = 0;
        return this;
    }
    font(f) { this.fontFamily = f; return this; }
    fontSize(s) { this.fontSizeVal = s; return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    opacity() { return this; }
    currentLineHeight() { return this.fontSizeVal * 1.2; }
    heightOfString(text) {
        const lines = String(text).split("\n").length;
        return lines * this.currentLineHeight();
    }
    widthOfString(text) { return String(text).length * this.fontSizeVal * 0.5; }
    text(str, x, y, opts = {}) {
        this.texts.push({ str: String(str), x, y, opts, page: this.pageCount });
        this.x = x !== undefined ? x : this.x;
        this.y = (y !== undefined ? y : this.y) + this.heightOfString(str);
        return this;
    }
    underline() { return this; }
    image(data, x, y, opts = {}) {
        this.images.push({ data, x, y, opts, page: this.pageCount });
        return this;
    }
    rect(x, y, w, h) { this.rects.push({ x, y, w, h, page: this.pageCount }); return this; }
    fill() { return this; }
    stroke() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    save() { this.saves++; return this; }
    restore() { this.restores++; return this; }
    end() { this.ended = true; return this; }
}

const saleConfig = {
    defaultFontFamily: "Times-Roman",
    defaultFontSize: 12,
    unitMap: [{ Kg: 1 }, { Pc: 1 }],
    billTemplate: {
        applyEmblem: false,
        emblem: "",
        applySeal: false,
        seal: "",
    },
};

function makeBill(items = 1) {
    return {
        billMeta: {
            billNo: 7,
            netAmtTax: 1000,
            printObj: { captions: ["Original Buyer's Copy"] },
        },
        orderItems: Array.from({ length: items }, (_, i) => ({
            name: "Item " + (i + 1),
            hsn: "1001",
            qty: 1,
            sellUnit: "Kg",
            rate: 100,
            cgst: 0,
            sgst: 0,
            igst: 0,
        })),
    };
}

function runMain(template, billObj, doc = new FakeDoc(), cfg = saleConfig) {
    return main(doc, "C:/fake.pdf", billObj, template, cfg).then(() => doc);
}

describe("execBlockTemplate — layout engine", () => {
    test("draws text blocks in order with cursor math and returns pdfPath", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        page.addBlock("text").content = "Hello";
        const second = page.addBlock("text");
        second.content = "World";
        second.margin.top = 5;
        const doc = new FakeDoc();
        const pdfPath = await main(doc, "C:/fake.pdf", makeBill(), page.toJSON(), saleConfig);
        expect(pdfPath).toBe("C:/fake.pdf");
        expect(doc.ended).toBe(true);
        const [hello, world] = doc.texts;
        expect(hello.str).toBe("Hello");
        expect(hello.y).toBe(10);
        // second starts after hello's line height + its top margin
        expect(world.str).toBe("World");
        expect(world.y).toBeCloseTo(10 + 14.4 + 5);
    });

    test("empty variables collapse entirely (no margin, no gap)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        page.addBlock("text").content = "A";
        const missing = page.addBlock("variable");
        missing.variable = "noSuchKey";
        missing.margin.top = 30;
        const last = page.addBlock("text");
        last.content = "B";
        const doc = await runMain(page.toJSON(), makeBill());
        expect(doc.texts.map((t) => t.str)).toEqual(["A", "B"]);
        expect(doc.texts[1].y).toBeCloseTo(10 + 14.4); // no 30pt gap
    });

    test("empty totals rows collapse; blocks after them shift up", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const totals = page.addBlock("totals");
        totals.rows = [{ label: "X", variable: "noSuchKey", align: "right" }];
        const last = page.addBlock("text");
        last.content = "END";
        const doc = await runMain(page.toJSON(), makeBill());
        expect(doc.texts.map((t) => t.str)).toEqual(["END"]);
        expect(doc.texts[0].y).toBe(10);
    });

    test("totals with data render label: value on the right", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const totals = page.addBlock("totals");
        totals.rows = [{ label: "GRAND TOTAL", variable: "grand-total", align: "right" }];
        const doc = await runMain(page.toJSON(), makeBill());
        expect(doc.texts).toHaveLength(1);
        expect(doc.texts[0].str).toBe("GRAND TOTAL: 1000");
    });

    test("page border draws a rect when applyBorder is on", async () => {
        const page = new BillPage({ applyBorder: true, border: 2 });
        page.addBlock("text").content = "X";
        const doc = await runMain(page.toJSON(), makeBill());
        expect(doc.rects.length).toBeGreaterThan(0);
        expect(doc.rects[0].w).toBeCloseTo(595.28 - 2);
    });

    test("multi-caption bills paginate and repeat blocks per caption", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const copy = page.addBlock("variable");
        copy.variable = "bill-copy";
        page.addBlock("text").content = "BODY";
        const billObj = makeBill();
        billObj.billMeta.printObj.captions = ["Original Buyer's Copy", "Duplicate Copy"];
        const doc = new FakeDoc();
        await main(doc, "C:/fake.pdf", billObj, page.toJSON(), saleConfig);
        expect(doc.pageCount).toBe(2);
        expect(doc.texts.filter((t) => t.str === "BODY")).toHaveLength(2);
        expect(doc.texts.filter((t) => t.str === "Original Buyer's Copy")).toHaveLength(1);
        expect(doc.texts.filter((t) => t.str === "Duplicate Copy")).toHaveLength(1);
    });

    test("page-no variable follows the page counter", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const no = page.addBlock("variable");
        no.variable = "page-no";
        const doc = await runMain(page.toJSON(), makeBill());
        expect(doc.texts[0].str).toBe("1");
    });

    test("a block taller than the page draws anyway (no infinite re-page)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const big = page.addBlock("text");
        big.content = "HUGE";
        big.font.size = 800; // taller than the 200pt page
        const doc = new FakeDoc(300, 200);
        await main(doc, "C:/fake.pdf", makeBill(), page.toJSON(), saleConfig);
        expect(doc.ended).toBe(true);
        expect(doc.pageCount).toBe(1);
        expect(doc.texts[0].str).toBe("HUGE");
    });
});

describe("execBlockTemplate — table", () => {
    function tablePage() {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const header = page.addBlock("text");
        header.content = "INVOICE HEADER";
        header.margin.bottom = 5;
        const table = page.addBlock("table");
        table.thHeight = 20;
        table.fSize = 12;
        table.rSpacing = 2;
        table.cellPadding = 2;
        table.margin.top = 5;
        table.cols = [
            { label: "Sl", variable: "slno", width: 20 },
            { label: "Name", variable: "name", width: 80 },
        ];
        return page;
    }

    test("table page-breaks re-enter renderPage with row continuation", async () => {
        const page = tablePage();
        const doc = new FakeDoc(300, 200);
        await main(doc, "C:/fake.pdf", makeBill(20), page.toJSON(), saleConfig);
        expect(doc.ended).toBe(true);
        // ~7 rows per page (page height 200): 20 rows -> 3 pages
        expect(doc.pageCount).toBe(3);
        // header block + table header repeat on every page
        expect(doc.texts.filter((t) => t.str === "INVOICE HEADER")).toHaveLength(3);
        expect(doc.texts.filter((t) => t.str === "Sl")).toHaveLength(3);
        // every row exactly once, in order
        const slnos = doc.texts.filter((t) => /^\d+$/.test(t.str)).map((t) => Number(t.str));
        expect(slnos).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        const names = doc.texts.filter((t) => /^Item /.test(t.str)).map((t) => t.str);
        expect(names).toEqual(Array.from({ length: 20 }, (_, i) => "Item " + (i + 1)));
        // continuation rows start near the top of the new page (after header+table header)
        const firstPageRows = doc.texts.filter((t) => t.page === 2 && /^\d+$/.test(t.str));
        expect(firstPageRows.length).toBeGreaterThan(0);
    });

    test("single page table draws grid rects", async () => {
        const page = tablePage();
        const doc = new FakeDoc();
        await main(doc, "C:/fake.pdf", makeBill(2), page.toJSON(), saleConfig);
        expect(doc.rects.length).toBeGreaterThan(0);
    });

    test("column variables resolve through the registry (unit-price with unitMap)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const table = page.addBlock("table");
        table.cols = [
            { label: "Unit Price", variable: "unit-price", width: 50 },
            { label: "Total", variable: "total", width: 50 },
        ];
        const billObj = makeBill(1);
        billObj.orderItems[0] = { ...billObj.orderItems[0], rate: 100, cgst: 2.5, sgst: 2.5 };
        const doc = await runMain(page.toJSON(), billObj);
        const values = doc.texts.map((t) => t.str);
        expect(values).toContain("100"); // unit-price = 100 × 1
        expect(values).toContain("105"); // total = 100 × 1.05
    });

    test("renderTable helper is directly callable with an explicit layout", async () => {
        const page = tablePage();
        const table = page.getBlock(page.blocks.find((b) => b.type === "table").id);
        const doc = new FakeDoc(300, 400);
        doc.font("Times-Roman").fontSize(12);
        const result = await renderTable(
            doc,
            table,
            { billObj: makeBill(2), saleConfig, pageNo: 1, captionIndex: 0 },
            { y: 10, left: 10, top: 10, contentWidth: 280, bottomY: 390 },
            page,
            0
        );
        expect(result.pageBroken).toBe(false);
        expect(result.nextY).toBeGreaterThan(10);
    });
});

describe("execBlockTemplate — images", () => {
    function imagePage() {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const emblem = page.addBlock("image");
        emblem.source = "emblem";
        const seal = page.addBlock("image");
        seal.source = "seal";
        const tail = page.addBlock("text");
        tail.content = "TAIL";
        return page;
    }

    test("gate off -> emblem and seal collapse, no image calls", async () => {
        const doc = await runMain(imagePage().toJSON(), makeBill());
        expect(doc.images).toHaveLength(0);
        expect(doc.texts.map((t) => t.str)).toEqual(["TAIL"]);
        expect(doc.texts[0].y).toBe(10);
    });

    test("gate on but file unset -> still collapses", async () => {
        const cfg = {
            ...saleConfig,
            billTemplate: { ...saleConfig.billTemplate, applyEmblem: true, emblem: "", applySeal: true, seal: "" },
        };
        const doc = await runMain(imagePage().toJSON(), makeBill(), new FakeDoc(), cfg);
        expect(doc.images).toHaveLength(0);
        expect(doc.texts.map((t) => t.str)).toEqual(["TAIL"]);
    });

    test("imageDrawable maps sources to their gates", () => {
        const emblem = new ImageBlock({ source: "emblem" });
        const seal = new ImageBlock({ source: "seal" });
        const ctx = { saleConfig };
        expect(imageDrawable(emblem, ctx)).toBe(false);
        expect(imageDrawable(seal, ctx)).toBe(false);
        const on = {
            billTemplate: { ...saleConfig.billTemplate, applyEmblem: true, emblem: "x.png", applySeal: true, seal: "s.png" },
        };
        expect(imageDrawable(emblem, { saleConfig: on })).toBe(true);
        expect(imageDrawable(seal, { saleConfig: on })).toBe(true);
        expect(imageDrawable(new ImageBlock({ source: "other" }), ctx)).toBe(false);
        expect(imageDrawable(emblem, { saleConfig: {} })).toBe(false);
    });
});

describe("execBlockTemplate — direct renderPage", () => {
    test("renderPage is callable standalone with blockStart/rowStart opts", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        page.addBlock("text").content = "SKIP";
        page.addBlock("text").content = "DRAW";
        const doc = new FakeDoc();
        await renderPage(doc, page, { billObj: makeBill(), saleConfig, pageNo: 1, captionIndex: 0 }, { blockStart: 1, rowStart: 0 });
        expect(doc.texts.map((t) => t.str)).toEqual(["DRAW"]);
    });
});

describe("execBlockTemplate — bundled templates", () => {
    const fs = require("fs");
    const path = require("path");
    const TEMPLATE_DIR = path.resolve(__dirname, "../template/billTemplates");

    ["default1.json", "default2.json"].forEach((file) => {
        test(`${file} loads and renders end-to-end without throwing`, async () => {
            const template = JSON.parse(
                fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf8")
            );
            const page = BillPage.fromJSON(template);
            const doc = new FakeDoc();
            await main(doc, "C:/fake.pdf", makeBill(12), page.toJSON(), saleConfig);
            expect(doc.ended).toBe(true);
            expect(doc.texts.length).toBeGreaterThan(0);
        });
    });
});
