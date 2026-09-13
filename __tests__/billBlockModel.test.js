const {
    BillPage,
    BillBlock,
    TextBlock,
    VariableBlock,
    ImageBlock,
    TableBlock,
    TotalsBlock,
    BillSection,
    HeaderBlock,
    BodyBlock,
    FooterBlock,
    SectionBlock,
    createInvoiceTemplate,
    STRUCTURAL_TYPES,
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    LEGACY_MSG,
    applyDOMStyles,
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

    test("TableBlock sumup column survives round-trip", () => {
        const block = new TableBlock({
            cols: [
                { label: "Name", variable: "name", width: 60 },
                { label: "Amount", variable: "total", width: 0, sumup: true },
            ],
        });
        const copy = roundTrip(block);
        expect(copy.cols[0].sumup).toBe(false);
        expect(copy.cols[1].sumup).toBe(true);
        expect(copy.cols[1].width).toBe(0);
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

describe("BillSection classes (Header/Body/Footer/Custom)", () => {
    test("section types registered and instance type getters resolve", () => {
        expect(new HeaderBlock().type).toBe("header");
        expect(new BodyBlock().type).toBe("body");
        expect(new FooterBlock().type).toBe("footer");
        expect(new SectionBlock().type).toBe("section");
        ["header", "body", "footer", "section"].forEach((type) => {
            expect(BillBlock.TYPES[type]).toBeDefined();
        });
    });

    test("a fresh Body comes pre-loaded with the items table", () => {
        const body = new BodyBlock();
        expect(body.blocks).toHaveLength(1);
        expect(body.blocks[0]).toBeInstanceOf(TableBlock);
        // an explicit blocks list is respected (no re-seeding)
        const empty = new BodyBlock({ blocks: [] });
        expect(empty.blocks).toHaveLength(0);
    });

    test("section round-trip preserves children, partitions and shape", () => {
        const section = new SectionBlock({
            name: "Stamp",
            shape: "circle",
            height: 80,
            cornerRadius: 12,
            padding: 8,
            partitions: [
                { direction: "col", range: 33, lWidth: 2 },
                { direction: "row", range: 50, lWidth: 1 },
            ],
            blocks: [{ type: "text", content: "inside" }],
        });
        const copy = roundTrip(section);
        expect(copy).toBeInstanceOf(SectionBlock);
        expect(copy.name).toBe("Stamp");
        expect(copy.shape).toBe("circle");
        expect(copy.height).toBe(80);
        expect(copy.cornerRadius).toBe(12);
        expect(copy.padding).toBe(8);
        expect(copy.partitions).toEqual(section.partitions);
        expect(copy.blocks).toHaveLength(1);
        expect(copy.blocks[0]).toBeInstanceOf(TextBlock);
        expect(copy.blocks[0].content).toBe("inside");
    });

    test("sections are structural: never empty, height measured by the engine", () => {
        const section = new SectionBlock({ blocks: [] });
        expect(section.isEmpty()).toBe(false);
        expect(section.measure()).toBeNull();
        expect(new HeaderBlock().isEmpty()).toBe(false);
    });

    test("nested sections round-trip through BillPage", () => {
        const page = new BillPage();
        const header = page.addBlock("header");
        header.addBlock("text").content = "My Shop";
        const body = page.addBlock("body");
        body.addBlock("variable").variable = "bill-copy";
        const inner = body.addBlock("section");
        inner.shape = "rounded";
        inner.addBlock("totals");
        page.addBlock("footer").addBlock("text").content = "Thank you";
        const copy = BillPage.fromJSON(JSON.parse(JSON.stringify(page.toJSON())));
        expect(copy.blocks.map((b) => b.type)).toEqual(["header", "body", "footer"]);
        expect(copy.blocks[0].blocks[0].content).toBe("My Shop");
        // a fresh Body comes pre-loaded with the items table
        expect(copy.blocks[1].blocks.map((b) => b.type)).toEqual([
            "table",
            "variable",
            "section",
        ]);
        expect(copy.blocks[1].blocks[2].shape).toBe("rounded");
        expect(copy.blocks[1].blocks[2].blocks[0].type).toBe("totals");
        expect(copy.blocks[2].blocks[0].content).toBe("Thank you");
    });

    test("section child operations (addBlock/getBlock/moveBlock/removeBlock)", () => {
        const section = new HeaderBlock();
        const a = section.addBlock("text");
        const b = section.addBlock("variable");
        expect(section.blocks.map((x) => x.id)).toEqual([a.id, b.id]);
        expect(section.getBlock(a.id)).toBe(a);
        section.moveBlock(b.id, -1);
        expect(section.blocks[0].id).toBe(b.id);
        section.removeBlock(a.id);
        expect(section.blocks).toHaveLength(1);
        expect(section.getBlock(a.id)).toBeUndefined();
        // unknown type still throws
        expect(() => section.addBlock("nope")).toThrow(/Unknown block type/);
    });

    test("section propsSchema exposes name/shape/height/partitions + common props", () => {
        const keys = BillSection.propsSchema.map((e) => e.key);
        expect(keys).toContain("name");
        expect(keys).toContain("shape");
        expect(keys).toContain("height");
        expect(keys).toContain("partitions");
        expect(keys).toContain("font.family");
        expect(keys).toContain("applyBorder");
        const shape = BillSection.propsSchema.find((e) => e.key === "shape");
        expect(shape.options).toEqual(["rectangle", "rounded", "circle", "ellipse"]);
    });
});

describe("structural sections & default template", () => {
    test("sections default to 0.5rem (8pt) margins/padding and a visible border", () => {
        const section = new SectionBlock();
        expect(section.padding).toBe(8);
        expect(section.margin).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
        expect(section.applyBorder).toBe(true);
    });

    test("BillPage margin defaults to 0.5rem; explicit margins still win", () => {
        expect(new BillPage().margin).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
        expect(new BillPage({ margin: { top: 3 } }).margin.top).toBe(3);
        expect(new BillPage({ margin: { top: 3 } }).margin.bottom).toBe(8);
    });

    test("header/body/footer are unique, canonically ordered, pinned and permanent", () => {
        const page = new BillPage();
        // added in a scrambled order — canonical slots win
        page.addBlock("footer");
        page.addBlock("body");
        const header = page.addBlock("header");
        expect(page.blocks.map((b) => b.type)).toEqual(["header", "body", "footer"]);
        expect(() => page.addBlock("header")).toThrow(/already exists/);
        // pinned: a structural section never moves
        page.moveBlock(header.id, 1);
        expect(page.blocks[0].type).toBe("header");
        // nothing may swap across a structural section
        const extra = page.addBlock("text");
        page.moveBlock(extra.id, -1); // target = footer -> refused
        expect(page.blocks[page.blocks.length - 1].id).toBe(extra.id);
        // permanent: removeBlock is a no-op for structural sections
        page.removeBlock(page.blocks[1].id);
        expect(page.blocks.map((b) => b.type)).toEqual(["header", "body", "footer", "text"]);
        expect(STRUCTURAL_TYPES).toEqual(["header", "body", "footer"]);
    });

    test("createInvoiceTemplate pre-builds the mandatory sections and fields", () => {
        const page = createInvoiceTemplate();
        expect(page.blocks.map((b) => b.type)).toEqual(["header", "body", "footer"]);
        const [header, body, footer] = page.blocks;

        // seller + buyer mandatory fields are baked into the header
        const vars = (s) => s.blocks.filter((b) => b.type === "variable").map((b) => b.variable);
        [
            "biller-name",
            "biller-address",
            "biller-gst",
            "bill-no-formatted",
            "date-slash",
            "customer-name",
            "customer-address",
            "customer-gst",
        ].forEach((key) => expect(vars(header)).toContain(key));

        // body carries the standard items table
        expect(body.blocks[0].type).toBe("table");
        expect(body.blocks[0].cols.map((c) => c.variable)).toEqual([
            "slno",
            "name",
            "qty",
            "rate",
            "total",
        ]);

        // footer carries totals + thanks + signatory
        expect(footer.blocks[0].type).toBe("totals");
        expect(footer.blocks[0].rows.map((r) => r.variable)).toEqual([
            "netAmtTax",
            "grand-total",
            "netDue",
        ]);
        expect(footer.blocks.some((b) => b.type === "text" && b.content === "Thank You!")).toBe(true);

        // Header 30% / Body 40% / Footer 30% of the usable page height
        const usable = 841.89 - 16;
        expect(header.height).toBeCloseTo(0.3 * usable - 16, 0);
        expect(body.height).toBeCloseTo(0.4 * usable - 16, 0);
        expect(footer.height).toBeCloseTo(0.3 * usable - 16, 0);

        // non-zero spacing everywhere
        expect(page.margin.top).toBe(8);
        [header, body, footer].forEach((s) => {
            expect(s.padding).toBe(8);
            expect(s.margin.top).toBe(8);
        });
    });

    test("applyDOMStyles shrinks the box width by horizontal margins", () => {
        const block = new TextBlock();
        block.margin = { top: 0, right: 15, bottom: 0, left: 5 };
        const el = { style: {} };
        applyDOMStyles(el, block, 579.28);
        expect(el.style.width).toBe("559.28px");
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
