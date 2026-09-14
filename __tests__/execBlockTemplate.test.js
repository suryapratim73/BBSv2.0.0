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
    createInvoiceTemplate,
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
        this.lines = [];
        this.shapes = [];
        this.clips = 0;
        this.saves = 0;
        this.restores = 0;
        this._pendingMove = null;
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
    roundedRect(x, y, w, h, r) {
        this.shapes.push({ kind: "rounded", x, y, w, h, r, page: this.pageCount });
        return this;
    }
    ellipse(x, y, r1, r2) {
        this.shapes.push({ kind: "ellipse", x, y, r1, r2, page: this.pageCount });
        return this;
    }
    circle(x, y, radius) {
        this.shapes.push({ kind: "circle", x, y, radius, page: this.pageCount });
        return this;
    }
    clip() { this.clips++; return this; }
    fill() { return this; }
    stroke() { return this; }
    moveTo(x, y) { this._pendingMove = { x, y, page: this.pageCount }; return this; }
    lineTo(x, y) {
        if (this._pendingMove) {
            this.lines.push({ from: this._pendingMove, to: { x, y, page: this.pageCount } });
            this._pendingMove = null;
        }
        return this;
    }
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

    test("field width shrinks a block's wrap width to half its cell", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const block = page.addBlock("text");
        block.content = "Hello";
        block.width = 50;
        const doc = await runMain(page.toJSON(), makeBill());
        const cw = 595.28 - 20;
        expect(doc.texts[0].opts.width).toBeCloseTo(cw / 2, 5);
        expect(doc.texts[0].x).toBeCloseTo(10, 5);
    });

    test("field width positions the box by align inside its cell", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const right = page.addBlock("text");
        right.content = "R";
        right.width = 50;
        right.align = "right";
        const centre = page.addBlock("text");
        centre.content = "C";
        centre.width = 50;
        centre.align = "center";
        const doc = await runMain(page.toJSON(), makeBill());
        const cw = 595.28 - 20;
        expect(doc.texts[0].x).toBeCloseTo(10 + cw / 2, 5);
        expect(doc.texts[0].opts.width).toBeCloseTo(cw / 2, 5);
        expect(doc.texts[1].x).toBeCloseTo(10 + cw / 4, 5);
    });

    test("footer field width anchors the whole footer cell (measure + layout)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const footer = page.addBlock("footer");
        footer.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        footer.padding = 0;
        footer.applyBorder = false;
        footer.width = 50;
        footer.align = "right";
        const text = new TextBlock({ content: "F" });
        text.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        text.padding = 0;
        footer.blocks = [text];
        const doc = await runMain(page.toJSON(), makeBill());
        const cw = 595.28 - 20;
        expect(doc.texts[0].str).toBe("F");
        expect(doc.texts[0].x).toBeCloseTo(10 + cw / 2, 5);
        expect(doc.texts[0].opts.width).toBeCloseTo(cw / 2, 5);
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

describe("execBlockTemplate — sections (Header/Body/Footer)", () => {
    function sectionPage() {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const header = page.addBlock("header");
        header.addBlock("text").content = "INV HEADER";
        const body = page.addBlock("body");
        const table = body.blocks[0]; // preloaded items table
        table.thHeight = 20;
        table.fSize = 12;
        table.rSpacing = 2;
        table.cellPadding = 2;
        table.cols = [
            { label: "Sl", variable: "slno", width: 20 },
            { label: "Name", variable: "name", width: 80 },
        ];
        const footer = page.addBlock("footer");
        footer.addBlock("text").content = "THANK YOU";
        return page;
    }

    test("header + footer repeat on every page; body table pages once per row", async () => {
        const page = sectionPage();
        const doc = new FakeDoc(300, 200);
        await main(doc, "C:/fake.pdf", makeBill(20), page.toJSON(), saleConfig);
        expect(doc.ended).toBe(true);
        expect(doc.pageCount).toBeGreaterThan(1);
        expect(doc.texts.filter((t) => t.str === "INV HEADER")).toHaveLength(doc.pageCount);
        expect(doc.texts.filter((t) => t.str === "THANK YOU")).toHaveLength(doc.pageCount);
        const slnos = doc.texts.filter((t) => /^\d+$/.test(t.str)).map((t) => Number(t.str));
        expect(slnos).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        const names = doc.texts.filter((t) => /^Item /.test(t.str)).map((t) => t.str);
        expect(names).toEqual(Array.from({ length: 20 }, (_, i) => "Item " + (i + 1)));
    });

    test("bottom-anchored footer renders inside the page bounds on every page", async () => {
        const page = sectionPage();
        const doc = new FakeDoc(300, 200);
        await main(doc, "C:/fake.pdf", makeBill(20), page.toJSON(), saleConfig);
        const footers = doc.texts.filter((t) => t.str === "THANK YOU");
        expect(footers).toHaveLength(doc.pageCount);
        footers.forEach((t) => {
            // footer text sits below the table zone, within the page
            expect(t.y).toBeGreaterThan(100);
            expect(t.y).toBeLessThanOrEqual(200);
        });
    });

    test("section children resolve variables inside the section", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const header = page.addBlock("header");
        const copy = header.addBlock("variable");
        copy.variable = "bill-copy";
        page.addBlock("body");
        const doc = await runMain(page.toJSON(), makeBill(1));
        expect(doc.texts.map((t) => t.str)).toContain("Original Buyer's Copy");
    });

    test("partitions draw divider lines inside the section", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const body = page.addBlock("body");
        body.blocks[0].cols = [{ label: "Sl", variable: "slno", width: 100 }];
        body.partitions = [
            { direction: "col", range: 50, lWidth: 2 },
            { direction: "row", range: 50, lWidth: 1 },
        ];
        const doc = await runMain(page.toJSON(), makeBill(1));
        const colLines = doc.lines.filter((l) => l.from.x === l.to.x);
        const rowLines = doc.lines.filter((l) => l.from.y === l.to.y);
        expect(colLines.length).toBeGreaterThan(0);
        expect(rowLines.length).toBeGreaterThan(0);
    });

    test("custom section with circle shape + fixed height clips children", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const stamp = page.addBlock("section");
        stamp.shape = "circle";
        stamp.height = 60;
        stamp.name = "Stamp";
        stamp.addBlock("text").content = "PAID";
        const doc = await runMain(page.toJSON(), makeBill(1));
        expect(doc.texts.map((t) => t.str)).toContain("PAID");
        expect(doc.shapes.some((s) => s.kind === "circle")).toBe(true);
        expect(doc.clips).toBeGreaterThan(0);
        expect(doc.restores).toBe(doc.saves); // clip save/restore balanced
    });

    test("rounded custom section renders rounded frame without clipping", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const card = page.addBlock("section");
        card.shape = "rounded";
        card.cornerRadius = 8;
        card.addBlock("text").content = "NOTE";
        const doc = await runMain(page.toJSON(), makeBill(1));
        expect(doc.texts.map((t) => t.str)).toContain("NOTE");
        expect(doc.shapes.some((s) => s.kind === "rounded" && s.r === 8)).toBe(true);
        expect(doc.clips).toBe(0);
    });

    test("nested custom sections render their children in order", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const body = page.addBlock("body");
        const inner = body.addBlock("section");
        inner.addBlock("text").content = "DEEP";
        const doc = await runMain(page.toJSON(), makeBill(1));
        const texts = doc.texts.map((t) => t.str);
        expect(texts).toContain("DEEP");
    });

    test("section background (auto height) paints a box sized to the content", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const body = page.addBlock("body");
        body.blocks[0].cols = [{ label: "Sl", variable: "slno", width: 100 }];
        body.background = "#ffeecc";
        const doc = await runMain(page.toJSON(), makeBill(1));
        const fills = doc.rects.filter((r) => r.page === 1);
        expect(fills.length).toBeGreaterThan(0);
        expect(doc.texts.length).toBeGreaterThan(0);
    });

    test("empty sections still draw their box (border) and advance the cursor", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const header = page.addBlock("header");
        // isolate the padding math from the 0.5rem default section margins
        header.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        header.padding = 5;
        page.addBlock("text").content = "AFTER";
        const doc = await runMain(page.toJSON(), makeBill(1));
        expect(doc.texts.map((t) => t.str)).toEqual(["AFTER"]);
        // header box consumed padding.top + padding.bottom before AFTER
        expect(doc.texts[0].y).toBeCloseTo(10 + 5 + 5);
    });

    test("section columns: children flow in rows of N, row height = tallest cell", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const section = page.addBlock("section");
        section.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        section.padding = 5;
        section.applyBorder = false;
        section.columns = 2;
        section.addBlock("text").content = "LEFT"; // 12pt -> 14.4pt tall
        const tall = section.addBlock("text");
        tall.content = "RIGHT";
        tall.font.size = 20; // -> 24pt tall; the row takes this height
        section.addBlock("text").content = "BELOW";
        const doc = await runMain(page.toJSON(), makeBill(1));

        const texts = doc.texts.map((t) => t.str);
        expect(texts).toEqual(["LEFT", "RIGHT", "BELOW"]);
        // cell width = (595.28 - 20 - 2*5) / 2 = 282.64; cells at x = 15 / 297.64
        expect(doc.texts[0].x).toBeCloseTo(15);
        expect(doc.texts[0].y).toBeCloseTo(15);
        expect(doc.texts[1].x).toBeCloseTo(15 + 282.64);
        expect(doc.texts[1].y).toBeCloseTo(15); // same row top
        // next row starts below the TALLEST cell (24pt)
        expect(doc.texts[2].x).toBeCloseTo(15);
        expect(doc.texts[2].y).toBeCloseTo(15 + 24);
    });

    test("section columns: an empty cell collapses without breaking the row", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const section = page.addBlock("section");
        section.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        section.padding = 5;
        section.applyBorder = false;
        section.columns = 2;
        section.addBlock("text").content = "A";
        const missing = section.addBlock("variable");
        missing.variable = "noSuchKey"; // empty -> its cell collapses
        section.addBlock("text").content = "B";
        section.addBlock("text").content = "C";
        const doc = await runMain(page.toJSON(), makeBill(1));

        expect(doc.texts.map((t) => t.str)).toEqual(["A", "B", "C"]);
        // row 0 = [A, empty] -> 14.4pt; B starts the next row in cell 0
        expect(doc.texts[1].x).toBeCloseTo(15);
        expect(doc.texts[1].y).toBeCloseTo(15 + 14.4);
        // C shares B's row, in cell 1
        expect(doc.texts[2].x).toBeCloseTo(15 + 282.64);
        expect(doc.texts[2].y).toBeCloseTo(15 + 14.4);
    });

    test("section columns: auto-height background box measures row-wise", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const section = page.addBlock("section");
        section.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        section.padding = 5;
        section.applyBorder = false;
        section.columns = 2;
        section.background = "#ffeecc";
        section.addBlock("text").content = "A"; // row 0
        section.addBlock("text").content = "B"; // row 0
        section.addBlock("text").content = "C"; // row 1 (alone)
        const doc = await runMain(page.toJSON(), makeBill(1));

        // two rows of 14.4pt + 2*5 padding = 38.8pt box height
        const fill = doc.rects.find(
            (r) => Math.abs(r.w - 575.28) < 0.01 && Math.abs(r.h - 38.8) < 0.01
        );
        expect(fill).toBeTruthy();
        // and the content actually consumed the same rows
        expect(doc.texts[2].y).toBeCloseTo(15 + 14.4);
    });

    test("default invoice template: 30/40/30 zones, table pages inside the body zone", async () => {
        const page = createInvoiceTemplate();
        const doc = await runMain(page.toJSON(), makeBill(20));
        expect(doc.pageCount).toBeGreaterThan(1);
        // header + footer content repeat on every page
        expect(doc.texts.filter((t) => t.str === "TAX INVOICE")).toHaveLength(doc.pageCount);
        expect(doc.texts.filter((t) => t.str === "Thank You!")).toHaveLength(doc.pageCount);
        // every row exactly once, in order (slno column sits at x = 8 (page)
        // + 8 (section margin) + 8 (padding) + 2 (cellPadding) = 26;
        // qty/rate/amount cells are numeric too, so filter by column)
        const slnoRows = doc.texts.filter(
            (t) => /^\d+$/.test(t.str) && Math.abs(t.x - 26) < 0.01
        );
        const slnos = slnoRows.map((t) => Number(t.str));
        expect(slnos).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        // rows never spill past the body zone (footer zone starts at ~586pt)
        slnoRows.forEach((t) => expect(t.y).toBeLessThan(586));
        // footer content is anchored below the body zone
        doc.texts
            .filter((t) => t.str === "Thank You!")
            .forEach((t) => expect(t.y).toBeGreaterThan(586));
        // the body's border frame is drawn on every page, including break pages.
        // The box honors the section's 8pt horizontal margins: x = 8 (page) +
        // 8 (margin.left) = 16, w = 595.28 − 16 (page) − 16 (margins) = 563.28.
        // The fixed box builds the shape path twice per page — once for the
        // border stroke, once for the clip — and FakeDoc records both rect()
        // calls (real pdfkit rect() is a pure path builder, so no doubling).
        const bodyFrames = doc.rects.filter(
            (r) =>
                Math.abs(r.x - 16) < 0.01 &&
                Math.abs(r.w - (595.28 - 32)) < 0.01 &&
                Math.abs(r.h - 314) < 0.01
        );
        expect(bodyFrames).toHaveLength(doc.pageCount * 2);
    });

    test("section box honors margin.left/right (frame and children inset)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const card = page.addBlock("section");
        card.margin = { top: 0, right: 15, bottom: 0, left: 5 };
        card.padding = 0;
        card.addBlock("text").content = "NOTE";
        const doc = await runMain(page.toJSON(), makeBill(1));
        const frame = doc.rects.find((r) => Math.abs(r.w - 555.28) < 0.01);
        expect(frame).toBeTruthy();
        expect(frame.x).toBeCloseTo(15); // 10 (page) + 5 (margin.left)
        expect(frame.w).toBeCloseTo(595.28 - 20 - 5 - 15);
        const note = doc.texts.find((t) => t.str === "NOTE");
        expect(note.x).toBeCloseTo(15);
    });

    test("text block frame honors margin.left/right", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const text = page.addBlock("text");
        text.content = "FRAMED";
        text.margin = { top: 0, right: 15, bottom: 0, left: 5 };
        text.applyBorder = true;
        text.border = 1;
        text.padding = 0;
        const doc = await runMain(page.toJSON(), makeBill(1));
        const frame = doc.rects.find((r) => Math.abs(r.w - 555.28) < 0.01);
        expect(frame).toBeTruthy();
        expect(frame.x).toBeCloseTo(15);
        const t = doc.texts.find((x) => x.str === "FRAMED");
        expect(t.x).toBeCloseTo(15);
    });

    test("table honors margin.left/right (grid box + column positions)", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const table = page.addBlock("table");
        table.margin = { top: 0, right: 15, bottom: 0, left: 5 };
        table.cellPadding = 2;
        table.cols = [
            { label: "Sl", variable: "slno", width: 50 },
            { label: "Name", variable: "name", width: 50 },
        ];
        const doc = await runMain(page.toJSON(), makeBill(1));
        const grid = doc.rects.find((r) => Math.abs(r.w - 555.28) < 0.01);
        expect(grid).toBeTruthy();
        expect(grid.x).toBeCloseTo(15);
        const slno = doc.texts.find((t) => t.str === "1");
        expect(slno.x).toBeCloseTo(17); // 15 (box) + 2 (cellPadding)
        const name = doc.texts.find((t) => t.str === "Item 1");
        expect(name.x).toBeCloseTo(15 + 555.28 / 2 + 2);
    });

    test("table sumup column absorbs the remaining width", async () => {
        const page = new BillPage({ margin: { top: 10, right: 10, bottom: 10, left: 10 } });
        const table = page.addBlock("table");
        table.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        table.cellPadding = 0;
        table.cols = [
            { label: "Sl", variable: "slno", width: 30 },
            { label: "Name", variable: "name", width: 30 },
            { label: "Amt", variable: "total", width: 0, sumup: true },
        ];
        const doc = await runMain(page.toJSON(), makeBill(1));
        // 30 + 30 fixed, the sumup column takes the remaining 40%:
        // x = 10 (page) + 2 × (575.28 × 0.3) = 355.168
        const amt = doc.texts.find((t) => t.str === "Amt");
        expect(amt.x).toBeCloseTo(10 + 2 * (575.28 * 0.3));
        const slno = doc.texts.find((t) => t.str === "1");
        expect(slno.x).toBeCloseTo(10);
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

        test(`${file} renders its partition lines (legacy header/footer dividers)`, async () => {
            const template = JSON.parse(
                fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf8")
            );
            const page = BillPage.fromJSON(template);
            const doc = new FakeDoc();
            await main(doc, "C:/fake.pdf", makeBill(12), page.toJSON(), saleConfig);
            // col partitions are vertical strokes, row partitions horizontal
            const verticals = doc.lines.filter(
                (l) => l.from.x === l.to.x && l.from.y !== l.to.y
            );
            const horizontals = doc.lines.filter(
                (l) => l.from.y === l.to.y && l.from.x !== l.to.x
            );
            expect(verticals.length).toBeGreaterThanOrEqual(2);
            expect(horizontals.length).toBeGreaterThanOrEqual(1);
            // both layouts carry a col-50 partition down the middle of the
            // content area: left margin + half of (A4 width − side margins)
            expect(
                verticals.some((l) => Math.abs(l.from.x - 297.64) < 0.5)
            ).toBe(true);
        });
    });
});
