// billElementClasses.test.js — element class library for the bill layout
// designer. The contract under test: classes serialize to the byte-exact
// legacy template JSON (lib/execCustomTemplate.js) and draw the legacy
// per-element canvases. No DOM tests — paint recipes run against FakeCtx.
const {
    Element,
    Section,
    Header,
    Body,
    Footer,
    Field,
    TextField,
    VariableField,
    ImageField,
    Table,
    Page,
    buildStarter,
    mainSectionBand,
    MAIN_SECTION_BANDS,
} = require("../lib/billElementClasses");
const { VARIABLES, resolveVariable } = require("../lib/billVariableRegistry");

/** Minimal recording 2d-context. */
function fakeCtx() {
    const calls = { moveTo: [], lineTo: [], arc: [], arcTo: [], rect: [], ellipse: [], fillText: [], stroke: [], fill: [], closePath: [] };
    const ctx = {
        font: "",
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        beginPath() {},
        moveTo(x, y) { calls.moveTo.push([x, y]); },
        lineTo(x, y) { calls.lineTo.push([x, y]); },
        arc(...a) { calls.arc.push(a); },
        arcTo(...a) { calls.arcTo.push(a); },
        rect(...a) { calls.rect.push(a); },
        ellipse(...a) { calls.ellipse.push(a); },
        closePath() { calls.closePath.push(1); },
        stroke() { calls.stroke.push(1); },
        fill() { calls.fill.push(1); },
        fillText(text, x, y) { calls.fillText.push([text, x, y]); },
        measureText(text) { return { width: text.length * 7 }; },
        clearRect() {},
        strokeRect() {},
        fillRect() {},
        strokeText() {},
    };
    ctx.calls = calls;
    return ctx;
}

describe("Page — legacy template contract", () => {
    test("a blank page serializes byte-exact to initPageObj", () => {
        expect(new Page().toJSON()).toEqual({
            size: "a4",
            applyMargin: false,
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
            head: {},
            body: {},
            footer: {},
            feilds: [],
            sections: [],
            applyBorder: false,
            border: 1,
            newDoc: true,
            filePath: "",
            fFamily: "Times-Roman",
        });
        expect(Page.blank().toJSON()).toEqual(new Page().toJSON());
    });

    test("elemRemoval strips runtime keys recursively", () => {
        const dirty = {
            role: "section",
            elem: "CANVAS",
            parentNode: "DIV",
            id: "abc",
            partitions: [
                { direction: "col", range: 50, lWidth: 1, elem: "X", id: "p1" },
            ],
            plan: { thHeight: 32, cols: [{ label: "A", var: "a", width: 10, parentNode: null }] },
        };
        expect(Page.elemRemoval(dirty)).toEqual({
            role: "section",
            partitions: [{ direction: "col", range: 50, lWidth: 1 }],
            plan: { thHeight: 32, cols: [{ label: "A", var: "a", width: 10 }] },
        });
        expect(Page.elemRemoval({})).toEqual({});
        expect(Page.elemRemoval([])).toEqual({});
    });

    test("elemRemoval dispatches class instances through toJSON", () => {
        const page = new Page();
        page.head = new Header({ x: 1, y: 2, width: 3, height: 4, applyBorder: true });
        page.feilds.push(new VariableField({ x: 5, y: 6, text: "Bill No: ", fType: "billNo" }));
        const json = page.toJSON();
        expect(json.head).toEqual({
            role: "head",
            name: "head",
            applyBorder: true,
            border: 1,
            partitions: [],
            plan: {},
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            shape: "rectangle",
            cornerRadius: 8,
        });
        expect(json.feilds[0]).toEqual({
            type: "variable",
            x: 5,
            y: 6,
            zIndex: 100,
            fSize: 16,
            fFamily: "Times-Roman",
            text: "Bill No: ",
            fWidth: 50,
            bold: false,
            italic: false,
            underline: false,
            fType: "billNo",
        });
        // class-only conveniences must never leak into saved templates
        expect(Object.keys(json.head)).not.toContain("padding");
        expect(Object.keys(json.head)).not.toContain("margin");
        expect(Object.keys(json.head)).not.toContain("zIndex");
        expect(Object.keys(json.feilds[0])).not.toContain("elem");
    });

    test("empty role sections stay {} (legacy load check Object.keys > 1)", () => {
        const page = new Page({ head: {} });
        expect(page.toJSON().head).toEqual({});
    });
});

describe("Section subclasses", () => {
    test("Header/Body/Footer fix the role", () => {
        expect(new Header({}).toJSON().role).toBe("head");
        expect(new Body({}).toJSON().role).toBe("body");
        expect(new Footer({}).toJSON().role).toBe("footer");
        expect(new Header({}).toJSON().name).toBe("head");
        expect(new Section({ name: "Page Border" }).toJSON().role).toBe("section");
    });

    test("shape + cornerRadius ride along for the engine, legacy keys only", () => {
        const json = new Section({ x: 1, y: 2, width: 590, height: 750, shape: "rounded", cornerRadius: 12 }).toJSON();
        expect(json.shape).toBe("rounded");
        expect(json.cornerRadius).toBe(12);
        expect(Object.keys(json).sort()).toEqual(
            ["applyBorder", "border", "cornerRadius", "height", "name", "partitions", "plan", "role", "shape", "width", "x", "y"].sort()
        );
    });
});

describe("Field subclasses", () => {
    test("string feild emits the legacy text keys", () => {
        expect(new TextField({ x: 12, y: 50, text: "Total in words", italic: true }).toJSON()).toEqual({
            type: "string",
            x: 12,
            y: 50,
            zIndex: 100,
            fSize: 16,
            fFamily: "Times-Roman",
            text: "Total in words",
            fWidth: 50,
            bold: false,
            italic: true,
            underline: false,
        });
    });

    test("variable feild adds fType", () => {
        const json = new VariableField({ x: 305, y: 37, text: "Invoice No: ", fType: "billNo", bold: true, fSize: 14 }).toJSON();
        expect(json.fType).toBe("billNo");
        expect(json.type).toBe("variable");
        expect(json.bold).toBe(true);
        expect(json.fSize).toBe(14);
    });

    test("image feild emits the legacy image keys instead of text keys", () => {
        const json = new ImageField({ x: 10, y: 10, imgWidth: 15, imgHeight: 20, imgOpacity: 80 }).toJSON();
        expect(json).toEqual({
            type: "image",
            x: 10,
            y: 10,
            zIndex: 100,
            imgWidth: 15,
            imgHeight: 20,
            imgOpacity: 80,
            imgTag: "",
            applyAspectRatio: false,
            aspectRatio: "1:1",
        });
        expect(json.fType).toBeUndefined();
        expect(json.text).toBeUndefined();
    });

    test("zIndex defaults to 100 like legacy insertFeild", () => {
        expect(new Field({}).zIndex).toBe(100);
    });
});

describe("Table — plan materialization", () => {
    test("cols carry var keys and cumulative xPos/yPos in pts", () => {
        const table = new Table(
            { thHeight: 32, fSize: 16, cols: [{ label: "Sl No", var: "slno", width: 10 }, { label: "Item", var: "name", width: 45 }, { label: "Qty", var: "qty", width: 15 }] },
            590
        );
        const plan = table.toJSON(590);
        expect(plan.thHeight).toBe(32);
        expect(plan.fSize).toBe(16);
        expect(plan.rSpacing).toBe(8);
        expect(plan.padding).toBe(10);
        expect(plan.cols.map((c) => c.xPos)).toEqual([0, 59, 324.5]);
        expect(plan.cols.map((c) => c.yPos)).toEqual([24, 24, 24]);
        expect(plan.cols.map((c) => c.var)).toEqual(["slno", "name", "qty"]);
        // engine reads stored xPos/yPos — they must be plain legacy numbers
        expect(plan.cols[1].xPos).toBe(59);
        // legacy plan cols have no `variable` key
        expect(Object.keys(plan.cols[0])).not.toContain("variable");
    });

    test("col widths never mutate and sum to the section width", () => {
        const cols = [{ label: "A", var: "a", width: 10 }, { label: "B", var: "b", width: 90 }];
        const plan = new Table({ cols }, 590).toJSON(590);
        expect(plan.cols.map((c) => c.xPos)).toEqual([0, 59]);
        expect(cols[0].width).toBe(10);
    });
});

describe("fromJSON — legacy files round-trip, v2 files rejected", () => {
    test("old saved templates load (extra runtime keys ignored)", () => {
        const page = Page.fromJSON({
            size: "a4",
            applyMargin: false,
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
            head: {
                role: "head",
                name: "head",
                applyBorder: true,
                border: 1,
                partitions: [{ direction: "col", range: 49.15, lWidth: 1 }],
                plan: { thHeight: 35, fSize: 12, rSpacing: 8, padding: 10, cols: [{ label: "Sl No", var: "slno", width: 3.39, xPos: 0, yPos: 23.5 }] },
                x: 10, y: 22, width: 590, height: 203,
                iWidth: 590, iHeight: 203, parentNode: null, elem: null,
            },
            body: {},
            footer: {},
            feilds: [
                { type: "variable", x: 305, y: 37, zIndex: 100, fSize: 14, fFamily: "Times-Roman", text: "Invoice No: ", fWidth: 30, bold: true, italic: false, underline: false, fType: "billNo", elem: null, id: "f1" },
            ],
            sections: [],
            applyBorder: false,
            border: 1,
            newDoc: false,
            filePath: "C:\\templates\\old.json",
            fFamily: "Times-Roman",
        });
        const json = page.toJSON();
        expect(json.head.role).toBe("head");
        // plan cols from old files keep their stored xPos/yPos
        expect(json.head.plan.cols[0]).toEqual({ label: "Sl No", var: "slno", width: 3.39, xPos: 0, yPos: 23.5 });
        expect(json.feilds[0].fType).toBe("billNo");
        expect(json.feilds[0].id).toBeUndefined();
        expect(json.feilds[0].elem).toBeUndefined();
        expect(json.head.iWidth).toBeUndefined();
        expect(json.head.parentNode).toBeUndefined();
        expect(json.filePath).toBe("C:\\templates\\old.json");
    });

    test("v2 block templates are rejected with a clear message", () => {
        expect(() => Element.fromJSON({ version: 2, blocks: [] })).toThrow(/v2/);
        expect(() => Page.fromJSON({ version: 2, blocks: [] })).toThrow(/v2/);
        expect(() => Section.fromJSON({ version: 2 })).toThrow(/v2/);
        expect(() => Element.fromJSON(null)).toThrow(/Invalid/);
    });
});

describe("drawShapePath — shape paint recipes", () => {
    const shapeCalls = (shape, overrides = {}) => {
        const section = new Section({ width: 100, height: 60, shape, ...overrides });
        const ctx = fakeCtx();
        section.drawShapePath(ctx);
        return ctx.calls;
    };

    test("rectangle is the default", () => {
        const calls = shapeCalls("rectangle");
        expect(calls.rect).toEqual([[0, 0, 100, 60]]);
        expect(calls.arc).toHaveLength(0);
    });

    test("rounded draws four clamped arcTo corners, no rect", () => {
        const calls = shapeCalls("rounded", { cornerRadius: 8 });
        expect(calls.arcTo).toHaveLength(4);
        expect(calls.rect).toHaveLength(0);
        // first corner: r=8 at (100,0) -> (100,8)
        expect(calls.arcTo[0]).toEqual([100, 0, 100, 8, 8]);
    });

    test("rounded corner radius clamps to half the smaller side", () => {
        const calls = shapeCalls("rounded", { cornerRadius: 500, width: 40, height: 30 });
        // r = min(500, 20, 15) = 15
        expect(calls.arcTo[0]).toEqual([40, 0, 40, 15, 15]);
    });

    test("circle arcs at the center with half the smaller side", () => {
        const calls = shapeCalls("circle");
        expect(calls.arc).toEqual([[50, 30, 30, 0, 2 * Math.PI]]);
        expect(calls.rect).toHaveLength(0);
    });

    test("ellipse draws full radii", () => {
        const calls = shapeCalls("ellipse");
        expect(calls.ellipse).toEqual([[50, 30, 50, 30, 0, 0, 2 * Math.PI]]);
    });
});

describe("drawPartitions — legacy grid lines", () => {
    test("col and row partitions use % of the section box", () => {
        const section = new Section({
            width: 590,
            height: 405,
            partitions: [
                { direction: "col", range: 49.15, lWidth: 1 },
                { direction: "row", range: 8.64, lWidth: 2 },
            ],
        });
        const ctx = fakeCtx();
        section.drawPartitions(ctx);
        expect(ctx.calls.moveTo[0][0]).toBeCloseTo(289.985);
        expect(ctx.calls.moveTo[0][1]).toBe(0);
        expect(ctx.calls.moveTo[1][0]).toBe(0);
        expect(ctx.calls.moveTo[1][1]).toBeCloseTo(34.992);
        expect(ctx.calls.lineTo[0][0]).toBeCloseTo(289.985);
        expect(ctx.calls.lineTo[0][1]).toBe(405);
        expect(ctx.calls.lineTo[1][0]).toBe(590);
        expect(ctx.calls.lineTo[1][1]).toBeCloseTo(34.992);
        expect(ctx.lineWidth).toBe(2);
    });
});

describe("drawTable — legacy header + column grid", () => {
    const page = { fFamily: "Times-Roman" };

    test("labels fill at xPos + padding and cols accumulate xPos/yPos", () => {
        const cols = [
            { label: "Sl No", var: "slno", width: 3.39 },
            { label: "Product", var: "name", width: 32.2 },
        ];
        const section = new Section({ width: 590, height: 405, plan: new Table({ cols, thHeight: 35, fSize: 12, padding: 10 }) });
        const ctx = fakeCtx();
        section.drawTable(ctx, page);
        // xPos: 0 and 3.39% of 590 = 20.001; yPos = (35+12)/2 = 23.5
        expect(ctx.calls.fillText).toEqual([
            ["Sl No", 10, 23.5],
            ["Product", 30.001, 23.5],
        ]);
        // mutation lands on the Table's own col objects (the input cols are copied)
        const planCols = section.plan.cols;
        expect(planCols[0].xPos).toBe(0);
        expect(planCols[1].xPos).toBe(20.001);
        expect(planCols[1].yPos).toBe(23.5);
        expect(ctx.font).toBe("bold 12px Times-Roman");
        // header line + one vertical per column
        expect(ctx.calls.moveTo[0]).toEqual([0, 35]);
        expect(ctx.calls.moveTo[1][0]).toBeCloseTo(20.001);
        expect(ctx.calls.moveTo[1][1]).toBe(0);
        expect(ctx.calls.moveTo[2][0]).toBeCloseTo(209.981);
        expect(ctx.calls.moveTo[2][1]).toBe(0);
        expect(ctx.calls.lineTo[0]).toEqual([590, 35]);
        expect(ctx.calls.lineTo[1][0]).toBeCloseTo(20.001);
        expect(ctx.calls.lineTo[1][1]).toBe(405);
        expect(ctx.calls.lineTo[2][0]).toBeCloseTo(209.981);
        expect(ctx.calls.lineTo[2][1]).toBe(405);
    });

    test("net width over 100% alerts and draws nothing", () => {
        const alertSpy = jest.fn();
        const originalAlert = global.alert;
        global.alert = alertSpy;
        try {
            const section = new Section({
                width: 590,
                height: 405,
                plan: new Table({ cols: [{ label: "A", var: "a", width: 60 }, { label: "B", var: "b", width: 60 }] }),
            });
            const ctx = fakeCtx();
            section.drawTable(ctx, page);
            expect(alertSpy).toHaveBeenCalledWith("Net column widths cannot exceed width of it's host.");
            expect(ctx.calls.fillText).toHaveLength(0);
        } finally {
            global.alert = originalAlert;
        }
    });
});

describe("buildStarter — the four templates", () => {
    const starters = ["blank", "sections", "default1", "default2"];
    const appDefault = { a4: { width: 595.28, height: 841.89 } };

    test("every starter builds a serializable Page whose variable feilds all resolve through the registry", () => {
        starters.forEach((name) => {
            const page = buildStarter(name, appDefault);
            expect(page).toBeInstanceOf(Page);
            const json = page.toJSON();
            expect(json.version).toBeUndefined();
            expect(json.blocks).toBeUndefined();
            const fTypes = json.feilds.filter((f) => f.type === "variable").map((f) => f.fType);
            if (name === "blank") {
                expect(fTypes).toEqual([]);
                return;
            }
            expect(fTypes.length).toBeGreaterThan(0);
            fTypes.forEach((fType) => {
                expect(VARIABLES[fType]).toBeDefined();
                expect(() => resolveVariable(fType, {}, {}, { pageNo: 1, captionIndex: 0 })).not.toThrow();
            });
        });
    });

    test("blank is an empty a4 page", () => {
        const json = buildStarter("blank").toJSON();
        expect(json.head).toEqual({});
        expect(json.body).toEqual({});
        expect(json.footer).toEqual({});
        expect(json.feilds).toEqual([]);
        expect(json.sections).toEqual([]);
    });

    test("sections — three bordered bands at the legacy gutters", () => {
        const json = buildStarter("sections", appDefault).toJSON();
        expect(json.head).toMatchObject({ role: "head", x: 8, y: 8, width: 579.28, height: 246, applyBorder: true });
        expect(json.body).toMatchObject({ role: "body", x: 8, y: 262, width: 579.28, height: 330, applyBorder: true });
        expect(json.footer).toMatchObject({ role: "footer", x: 8, y: 600, width: 579.28, height: 234, applyBorder: true });
        expect(json.body.plan.cols.map((c) => c.var)).toEqual(["slno", "name", "qty", "rate", "amt"]);
        expect(json.body.plan.cols.reduce((a, c) => a + c.width, 0)).toBe(100);
        expect(json.feilds.length).toBe(17);
        expect(json.feilds[0]).toMatchObject({ type: "string", text: "TAX INVOICE", bold: true });
        const fTypes = json.feilds.filter((f) => f.type === "variable").map((f) => f.fType);
        expect(fTypes).toContain("biller-name");
        expect(fTypes).toContain("grand-total");
    });

    test("default1 — borderRect, head/body/footer, tax mini box at legacy coordinates", () => {
        const json = buildStarter("default1").toJSON();
        expect(json.sections[0]).toMatchObject({ name: "Page Border", x: 10, y: 22, width: 590, height: 750, applyBorder: true });
        expect(json.head).toMatchObject({ role: "head", x: 10, y: 22, width: 590, height: 203 });
        expect(json.head.partitions).toContainEqual({ direction: "col", range: 49.15, lWidth: 1 });
        expect(json.body).toMatchObject({ role: "body", x: 10, y: 225, width: 590, height: 405 });
        // body verticals: 3.39/35.59/41.53/49.15/55.08/60.34/68.64/75.42/82.20/88.98% + the y=260 row
        [3.39, 35.59, 41.53, 49.15, 55.08, 60.34, 68.64, 75.42, 82.2, 88.98].forEach((range) => {
            expect(json.body.partitions).toContainEqual({ direction: "col", range, lWidth: 1 });
        });
        expect(json.body.partitions).toContainEqual({ direction: "row", range: 8.64, lWidth: 1 });
        // table: 10 legacy columns summing to 100
        expect(json.body.plan.thHeight).toBe(35);
        expect(json.body.plan.cols.map((c) => c.var)).toEqual(
            ["slno", "name", "hsn", "qty", "unit", "rate", "amt", "CGST", "SGST", "netAmt"]
        );
        expect(json.body.plan.cols.reduce((a, c) => a + c.width, 0)).toBeCloseTo(100, 1);
        expect(json.footer).toMatchObject({ role: "footer", x: 10, y: 630, width: 590, height: 142 });
        expect(json.footer.partitions).toContainEqual({ direction: "col", range: 76.27, lWidth: 1 });
        expect(json.sections[1]).toMatchObject({ name: "Tax mini box", x: 10, y: 630, width: 590, height: 20, applyBorder: true });
        [68.64, 75.42, 82.2, 88.98].forEach((range) => {
            expect(json.sections[1].partitions).toContainEqual({ direction: "col", range, lWidth: 1 });
        });
        // key feilds at exact legacy coordinates
        expect(json.feilds).toContainEqual(expect.objectContaining({ text: "Invoice No: ", fType: "billNo", x: 305, y: 37 }));
        expect(json.feilds).toContainEqual(expect.objectContaining({ fType: "net-CGST", x: 425, y: 635 }));
        expect(json.feilds).toContainEqual(expect.objectContaining({ fType: "net-SGST", x: 465, y: 635 }));
        expect(json.feilds).toContainEqual(expect.objectContaining({ text: "(Receiver's signature)", x: 460, y: 750 }));
    });

    test("default2 — scalar margin 10, factor grid, gst column, summary pairs", () => {
        const json = buildStarter("default2").toJSON();
        expect(json.applyMargin).toBe(true);
        expect(json.margin).toBe(10);
        expect(json.sections[0]).toMatchObject({ name: "Biller box", x: 10, y: 10, width: 575, height: 110, applyBorder: true });
        expect(json.sections[1]).toMatchObject({ name: "Meta box", x: 10, y: 120, width: 575, height: 60 });
        expect(json.sections[2]).toMatchObject({ name: "Customer box", x: 10, y: 180, width: 575, height: 88 });
        expect(json.body).toMatchObject({ role: "body", x: 10, y: 268, width: 575, height: 400 });
        [4.87, 50.02, 60.2, 70.38, 75.47, 85.65, 90.74].forEach((range) => {
            expect(json.body.partitions).toContainEqual({ direction: "col", range, lWidth: 1 });
        });
        expect(json.body.plan.cols.map((c) => c.var)).toEqual(
            ["slno", "name", "hsn", "qty", "unit", "rate", "gst", "netAmt"]
        );
        expect(json.body.plan.cols.find((c) => c.var === "gst").width).toBe(5.09);
        expect(json.body.plan.cols.reduce((a, c) => a + c.width, 0)).toBeCloseTo(100, 1);
        expect(json.sections[3]).toMatchObject({ name: "Signature box", x: 10, y: 790, width: 575, height: 40 });
        const fTypes = json.feilds.filter((f) => f.type === "variable").map((f) => f.fType);
        expect(fTypes).toContain("biller-bank");
        expect(fTypes).toContain("payment");
        expect(fTypes).toContain("place-of-jurisdiction");
        expect(json.feilds).toContainEqual(expect.objectContaining({ text: "GRAND TOTAL: ", fType: "grand-total", x: 361.17, y: 822, bold: true }));
        expect(json.feilds).toContainEqual(expect.objectContaining({ fType: "grand-total", x: 438.96, y: 822 }));
    });

    test("unknown starter name throws", () => {
        expect(() => buildStarter("nope")).toThrow(/Unknown starter/);
    });
});

describe("mainSectionBand — canonical main-section defaults", () => {
    test("returns the exact Three Sections starter bands on A4", () => {
        expect(mainSectionBand("head")).toEqual({ x: 8, y: 8, width: 579.28, height: 246 });
        expect(mainSectionBand("body")).toEqual({ x: 8, y: 262, width: 579.28, height: 330 });
        expect(mainSectionBand("footer")).toEqual({ x: 8, y: 600, width: 579.28, height: 234 });
    });

    test("scales proportionally to the host page size", () => {
        // A5 (half of A4): every coordinate halves.
        const half = mainSectionBand("head", 595.28 / 2, 841.89 / 2);
        expect(half).toEqual({ x: 4, y: 4, width: 289.64, height: 123 });
        expect(mainSectionBand("body", 595.28 / 2, 841.89 / 2).y).toBeCloseTo(131, 5);
    });

    test("unknown roles and the band map stay in lockstep", () => {
        expect(mainSectionBand("section")).toBeNull();
        expect(mainSectionBand("nope")).toBeNull();
        expect(Object.keys(MAIN_SECTION_BANDS).sort()).toEqual(["body", "footer", "head"]);
    });

    test("a Header instantiated with its band serializes as a full-width top band", () => {
        const head = new Header({ ...mainSectionBand("head"), applyBorder: true });
        expect(head.toJSON()).toMatchObject({
            role: "head",
            name: "head",
            x: 8,
            y: 8,
            width: 579.28,
            height: 246,
            applyBorder: true,
            border: 1,
            shape: "rectangle",
            cornerRadius: 8,
        });
        // The legacy section contract has no padding/margin keys.
        expect(head.toJSON().padding).toBeUndefined();
        expect(head.toJSON().margin).toBeUndefined();
    });
});
