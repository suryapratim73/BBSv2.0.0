const {
    BillPage,
    BillBlock,
    TextBlock,
    VariableBlock,
    ImageBlock,
    TableBlock,
    TotalsBlock,
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    LEGACY_MSG,
} = require("../lib/billBlockModel");
const default1 = require("../template/billTemplates/default1.json");
const default2 = require("../template/billTemplates/default2.json");

function roundTrip(block) {
    return BillBlock.fromJSON(JSON.parse(JSON.stringify(block.toJSON())));
}

describe("BillBlock classes", () => {
    test("TextBlock round-trip preserves unique + common props", () => {
        const block = new TextBlock({
            content: "Hello",
            font: { family: "Helvetica", size: 16, bold: true },
            margin: { top: 5 },
            padding: 4,
            applyBorder: true,
            background: "#ffffff",
            align: "center",
        });
        const copy = roundTrip(block);
        expect(copy).toBeInstanceOf(TextBlock);
        expect(copy.content).toBe("Hello");
        expect(copy.font).toEqual(block.font);
        expect(copy.margin).toEqual(block.margin);
        expect(copy.padding).toBe(4);
        expect(copy.applyBorder).toBe(true);
        expect(copy.background).toBe("#ffffff");
        expect(copy.align).toBe("center");
        expect(copy.id).toBe(block.id);
    });

    test("VariableBlock round-trip", () => {
        const block = new VariableBlock({ variable: "biller-name", prefix: "For ", suffix: " (Prop.)" });
        const copy = roundTrip(block);
        expect(copy).toBeInstanceOf(VariableBlock);
        expect(copy.variable).toBe("biller-name");
        expect(copy.prefix).toBe("For ");
        expect(copy.suffix).toBe(" (Prop.)");
    });

    test("ImageBlock round-trip", () => {
        const block = new ImageBlock({
            source: "seal",
            imgWidth: 20,
            imgHeight: 15,
            imgOpacity: 60,
            applyAspectRatio: true,
            aspectRatio: "4:3",
            imgTag: "seal-1",
        });
        const copy = roundTrip(block);
        expect(copy).toBeInstanceOf(ImageBlock);
        expect(copy.source).toBe("seal");
        expect(copy.imgWidth).toBe(20);
        expect(copy.imgHeight).toBe(15);
        expect(copy.imgOpacity).toBe(60);
        expect(copy.applyAspectRatio).toBe(true);
        expect(copy.aspectRatio).toBe("4:3");
        expect(copy.imgTag).toBe("seal-1");
    });

    test("TableBlock round-trip", () => {
        const block = new TableBlock({
            thHeight: 20,
            fSize: 10,
            rSpacing: 2,
            cellPadding: 3,
            drawGrid: false,
            cols: [
                { label: "S.N.", variable: "slno", width: 10 },
                { label: "Name", variable: "name", width: 50 },
                { label: "Amount", variable: "total", width: 40 },
            ],
        });
        const copy = roundTrip(block);
        expect(copy).toBeInstanceOf(TableBlock);
        expect(copy.cols).toEqual(block.cols);
        expect(copy.thHeight).toBe(20);
        expect(copy.fSize).toBe(10);
        expect(copy.rSpacing).toBe(2);
        expect(copy.cellPadding).toBe(3);
        expect(copy.drawGrid).toBe(false);
    });

    test("TotalsBlock round-trip", () => {
        const block = new TotalsBlock({
            rows: [
                { label: "GRAND TOTAL", variable: "grand-total", align: "right" },
                { label: "PAID", variable: "payment", align: "left" },
            ],
        });
        const copy = roundTrip(block);
        expect(copy).toBeInstanceOf(TotalsBlock);
        expect(copy.rows).toEqual(block.rows);
    });

    test("defaults are filled when props are omitted", () => {
        const block = new TextBlock({ content: "Hi" });
        expect(block.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(block.font.family).toBe("Times-Roman");
        expect(block.font.size).toBe(12);
        expect(block.font.bold).toBe(false);
        expect(block.align).toBe("left");
        expect(block.applyBorder).toBe(false);
        expect(block.background).toBe("");
    });

    test("fromJSON dispatches on type and rejects unknown/legacy shapes", () => {
        expect(BillBlock.fromJSON({ type: "text", content: "x" })).toBeInstanceOf(TextBlock);
        expect(BillBlock.fromJSON({ type: "table", cols: [] })).toBeInstanceOf(TableBlock);
        expect(() => BillBlock.fromJSON({ type: "magic" })).toThrow(/Unknown block type/);
        expect(() => BillBlock.fromJSON({ x: 1 })).toThrow(LEGACY_MSG);
        expect(() => BillBlock.fromJSON({ plan: {} })).toThrow(LEGACY_MSG);
        expect(() => BillBlock.fromJSON(null)).toThrow(/Invalid block data/);
    });

    test("setProp/getProp walk dot paths", () => {
        const block = new VariableBlock();
        block.setProp("font.size", 22);
        block.setProp("margin.top", 9);
        expect(block.getProp("font.size")).toBe(22);
        expect(block.getProp("margin.top")).toBe(9);
        expect(block.font.size).toBe(22);
    });

    test("each block type exposes a propsSchema list", () => {
        [TextBlock, VariableBlock, ImageBlock, TableBlock, TotalsBlock].forEach((Cls) => {
            expect(Array.isArray(Cls.propsSchema)).toBe(true);
            expect(Cls.propsSchema.length).toBeGreaterThan(0);
        });
    });
});

describe("BillPage", () => {
    test("round-trip preserves blocks and newDoc/filePath", () => {
        const page = new BillPage({
            size: "letter",
            margin: { top: 10, right: 10, bottom: 10, left: 10 },
            applyBorder: true,
            fFamily: "Courier",
            newDoc: false,
            filePath: "C:/templates/invoice.json",
        });
        page.addBlock("text").content = "Header";
        page.addBlock("table");
        const json = JSON.parse(JSON.stringify(page.toJSON()));
        const copy = BillPage.fromJSON(json);
        expect(copy.size).toBe("letter");
        expect(copy.margin).toEqual(page.margin);
        expect(copy.applyBorder).toBe(true);
        expect(copy.fFamily).toBe("Courier");
        expect(copy.newDoc).toBe(false);
        expect(copy.filePath).toBe("C:/templates/invoice.json");
        expect(copy.blocks).toHaveLength(2);
        expect(copy.blocks[0]).toBeInstanceOf(TextBlock);
        expect(copy.blocks[1]).toBeInstanceOf(TableBlock);
    });

    test("fromJSON rejects v1, unknown versions and bad shapes", () => {
        expect(() => BillPage.fromJSON({ version: 1 })).toThrow(LEGACY_MSG);
        expect(() => BillPage.fromJSON({ version: 1, blocks: [] })).toThrow(LEGACY_MSG);
        expect(() => BillPage.fromJSON({ version: 3, blocks: [] })).toThrow(/version/);
        expect(() => BillPage.fromJSON({ feilds: [] })).toThrow(LEGACY_MSG);
        expect(() => BillPage.fromJSON({ head: {} })).toThrow(LEGACY_MSG);
        expect(() => BillPage.fromJSON({})).toThrow(/Unsupported/);
        expect(() => BillPage.fromJSON(null)).toThrow(/Invalid/);
    });

    test("addBlock/getBlock/moveBlock/removeBlock", () => {
        const page = new BillPage();
        const a = page.addBlock("text");
        const b = page.addBlock("totals");
        expect(page.getBlock(a.id)).toBe(a);
        page.moveBlock(a.id, 1);
        expect(page.blocks[0].id).toBe(b.id);
        expect(page.blocks[1].id).toBe(a.id);
        page.removeBlock(b.id);
        expect(page.blocks).toHaveLength(1);
        expect(page.getBlock(b.id)).toBeUndefined();
        // moving out of range is a no-op
        page.moveBlock(a.id, -1);
        page.moveBlock(a.id, 1);
        expect(page.blocks).toHaveLength(1);
    });

    test("bundled default templates load through fromJSON", () => {
        [default1, default2].forEach((template) => {
            const page = BillPage.fromJSON(template);
            expect(page.version).toBe(2);
            expect(page.blocks.length).toBeGreaterThan(10);
            page.blocks.forEach((block) => {
                expect(["text", "variable", "image", "table", "totals"]).toContain(block.type);
            });
            // round-trip is stable (schema changes fail this test)
            const copy = BillPage.fromJSON(JSON.parse(JSON.stringify(page.toJSON())));
            expect(copy.blocks).toHaveLength(page.blocks.length);
        });
    });
});

describe("variable registry shape", () => {
    test("every palette group lists only registered keys, all keys have labels", () => {
        expect(VARIABLE_GROUPS.length).toBeGreaterThan(0);
        VARIABLE_GROUPS.forEach((group) => {
            expect(Array.isArray(group.keys)).toBe(true);
            expect(group.keys.length).toBeGreaterThan(0);
            group.keys.forEach((key) => {
                expect(VARIABLES[key]).toBeDefined();
                expect(typeof VARIABLES[key].label).toBe("string");
                expect(VARIABLES[key].group).toBe(group.group);
            });
        });
        expect(ALL_VARIABLE_KEYS).toHaveLength(Object.keys(VARIABLES).length);
    });
});
