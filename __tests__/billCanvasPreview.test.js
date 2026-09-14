/**
 * billCanvasPreview.test.js — the designer's canvas renderer against a
 * recording FakeCtx. The module mirrors the PDF engine's cursor math, so the
 * assertions here pin the SAME coordinates the engine's tests pin: box
 * math, column cells, partition lines (including the Default1 centre line at
 * x = 297.64), fixed-height clipping, and bottom-anchored footers.
 */
const {
    BillPage,
    TextBlock,
    VariableBlock,
    ImageBlock,
    TableBlock,
    TotalsBlock,
    SectionBlock,
} = require("../lib/billBlockModel");
const {
    PAGE_SIZES,
    layoutPage,
    renderPreview,
    recordAt,
} = require("../lib/billCanvasPreview");
const default1 = require("../template/billTemplates/default1.json");
const default2 = require("../template/billTemplates/default2.json");

/** Recording canvas 2D stand-in (same spirit as the engine's FakeDoc). */
class FakeCtx {
    constructor() {
        this.texts = [];
        this.rects = []; // rect() path ops
        this.fillRects = [];
        this.strokeRects = [];
        this.arcs = [];
        this.ellipses = [];
        this.roundRects = [];
        this.lines = []; // {from: {x, y}, to: {x, y}}
        this.clips = []; // path snapshots at clip() time
        this.saves = 0;
        this.restores = 0;
        this.strokes = 0;
        this.fills = 0;
        this.dashSets = [];
        this._pendingMove = null;
        this._lastPath = null;
        this.font = "12px serif";
        this.fillStyle = "#000000";
        this.strokeStyle = "#000000";
        this.lineWidth = 1;
        this.textBaseline = "alphabetic";
        this.textAlign = "left";
    }
    beginPath() {
        this._pendingMove = null;
        this._lastPath = null;
    }
    moveTo(x, y) {
        this._pendingMove = { x, y };
    }
    lineTo(x, y) {
        if (this._pendingMove) {
            this.lines.push({ from: this._pendingMove, to: { x, y } });
            this._pendingMove = null;
        }
    }
    rect(x, y, w, h) {
        this.rects.push({ x, y, w, h });
        this._lastPath = { kind: "rect", x, y, w, h };
    }
    roundRect(x, y, w, h, r) {
        this.roundRects.push({ x, y, w, h, r });
        this._lastPath = { kind: "roundRect", x, y, w, h, r };
    }
    arc(x, y, radius) {
        this.arcs.push({ x, y, radius });
        this._lastPath = { kind: "arc", x, y, radius };
    }
    ellipse(x, y, r1, r2) {
        this.ellipses.push({ x, y, r1, r2 });
        this._lastPath = { kind: "ellipse", x, y, r1, r2 };
    }
    fillRect(x, y, w, h) {
        this.fillRects.push({ x, y, w, h });
    }
    strokeRect(x, y, w, h) {
        this.strokeRects.push({ x, y, w, h });
    }
    fill() {
        this.fills++;
    }
    stroke() {
        this.strokes++;
    }
    clip() {
        if (this._lastPath) this.clips.push(this._lastPath);
    }
    save() {
        this.saves++;
    }
    restore() {
        this.restores++;
    }
    setLineDash(dash) {
        this.dashSets.push(dash.slice());
    }
    measureText(text) {
        const size = parseFloat(this.font) || 12;
        return { width: String(text).length * size * 0.5 };
    }
    fillText(text, x, y, maxWidth) {
        this.texts.push({
            text: String(text),
            x,
            y,
            maxWidth: maxWidth ?? null,
            font: this.font,
            align: this.textAlign,
        });
    }
}

const A4 = PAGE_SIZES.a4;

function pageWith(blocks) {
    const page = new BillPage();
    page.blocks = blocks;
    return page;
}

function rec(layout, id) {
    return layout.records.find((r) => r.id === id);
}

describe("canvas preview layout (engine coordinate parity)", () => {
    test("boxes a text block inside its margins and padding", () => {
        const block = new TextBlock({ content: "Hello" });
        block.margin = { top: 5, right: 15, bottom: 3, left: 10 };
        block.padding = 4;
        block.applyBorder = true;
        block.border = 1;
        const page = pageWith([block]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const b = rec(layout, block.id).box;
        expect(b.x).toBeCloseTo(8 + 10, 5);
        expect(b.w).toBeCloseTo(A4.w - 8 - 8 - 10 - 15, 5);
        expect(b.y).toBeCloseTo(8 + 5, 5);
        // 1 wrapped line × 12pt × 1.2 + 2 × 4pt padding
        expect(b.h).toBeCloseTo(12 * 1.2 + 8, 5);
    });

    test("wraps long text like pdfkit (extra lines add height)", () => {
        const block = new TextBlock({
            content: "aaaa bbbb cccc dddd eeee",
            padding: 0,
        });
        const page = pageWith([block]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        // 25 chars × 6pt = 150pt of text in a ~563pt box → one line
        expect(rec(layout, block.id).box.h).toBeCloseTo(12 * 1.2, 5);

        block.content = "aaaa bbbb cccc dddd eeee ffff gggg hhhh";
        const narrow = pageWith([block]);
        narrow.margin = { top: 8, right: 250, bottom: 8, left: 250 };
        const layout2 = layoutPage(new FakeCtx(), narrow);
        // ~95pt box → several lines
        expect(rec(layout2, block.id).box.h).toBeGreaterThan(2 * 12 * 1.2);
    });

    test("a columned section hands each child a cell, never the full box", () => {
        const section = new SectionBlock();
        section.columns = 2;
        section.padding = 8;
        section.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        const c1 = new VariableBlock({ variable: "billNo" });
        const c2 = new VariableBlock({ variable: "billNo" });
        section.blocks = [c1, c2];
        const page = pageWith([section]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const sb = rec(layout, section.id).box;
        const b1 = rec(layout, c1.id).box;
        const b2 = rec(layout, c2.id).box;
        const cell = b1.w;
        expect(b2.w).toBeCloseTo(cell, 5);
        expect(b2.x - b1.x).toBeCloseTo(cell, 5);
        // both cells stay inside the section's padded interior (engine:
        // innerLeft = boxLeft + padding)
        expect(b1.x).toBeCloseTo(sb.x + 8, 5);
        expect(b2.x + b2.w).toBeLessThanOrEqual(sb.x + sb.w - 8 + 1e-6);
    });

    test("a fixed-height section clips its children to the box", () => {
        const section = new SectionBlock({ height: 50 });
        section.padding = 0;
        section.applyBorder = false;
        const child = new TextBlock({ content: "taller than the box" });
        section.blocks = [child];
        const page = pageWith([section]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const ctx = new FakeCtx();
        const layout = layoutPage(ctx, page);
        const sb = rec(layout, section.id).box;
        expect(ctx.clips).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "rect",
                    x: sb.x,
                    y: sb.y,
                    w: sb.w,
                    h: 50,
                }),
            ])
        );
        // overflow still paints (the preview shows it, the PDF would clip)
        expect(rec(layout, child.id).box.y).toBeCloseTo(sb.y, 5);
    });

    test("footers are bottom-anchored, stacked from the content bottom", () => {
        const page = new BillPage();
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        const h = page.addBlock("header");
        h.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        h.blocks = [new TextBlock({ content: "top" })];
        const f = page.addBlock("footer");
        f.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        f.blocks = [new TextBlock({ content: "bottom" })];

        const layout = layoutPage(new FakeCtx(), page);
        const fb = rec(layout, f.id).box;
        expect(fb.y + fb.h).toBeCloseTo(A4.h - 8, 5); // page margin.bottom
        const hb = rec(layout, h.id).box;
        expect(hb.y).toBeCloseTo(8, 5);
        expect(fb.y).toBeGreaterThan(hb.y + hb.h);
    });

    test("degenerate section (margins wider than the content) still advances the flow", () => {
        const bad = new SectionBlock();
        bad.margin = { top: 0, right: 0, bottom: 0, left: 600 };
        const after = new TextBlock({ content: "after" });
        const page = pageWith([bad, after]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const bb = rec(layout, bad.id).box;
        expect(bb.w).toBeLessThanOrEqual(0);
        // the following block still lands below the page top margin
        expect(rec(layout, after.id).box.y).toBeGreaterThanOrEqual(8);
    });

    test("sumup column absorbs the remaining table width", () => {
        const table = new TableBlock();
        table.cols = [
            { label: "A", variable: "slno", width: 10, sumup: false },
            { label: "B", variable: "name", width: 0, sumup: true },
        ];
        const page = pageWith([table]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const r = rec(layout, table.id);
        expect(r.colX).toHaveLength(3);
        const total = r.colX[2] - r.colX[0];
        expect(r.colX[1] - r.colX[0]).toBeCloseTo(0.1 * total, 5);
        expect(r.colX[2] - r.colX[1]).toBeCloseTo(0.9 * total, 5);
        // header labels sit at colX + cellPadding
        expect(r.block.cols[0].label).toBe("A");
        const ctx = new FakeCtx();
        layoutPage(ctx, page);
        const headerTexts = ctx.texts.filter((t) => t.text !== "…");
        expect(headerTexts[0].x).toBeCloseTo(r.colX[0] + (table.cellPadding ?? 0), 5);
    });

    test("totals rows stack with the engine's 0.3 line-height gap", () => {
        const totals = new TotalsBlock();
        totals.rows = [
            { label: "Total", variable: "netAmt", align: "right" },
            { label: "Grand", variable: "netAmtTax", align: "right" },
        ];
        totals.padding = 0;
        const page = pageWith([totals]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const lh = 12 * 1.2;
        expect(rec(layout, totals.id).box.h).toBeCloseTo(2 * lh + 0.3 * lh, 5);
    });

    test("image blocks box at their percentage dimensions", () => {
        const image = new ImageBlock();
        image.imgWidth = 20;
        image.imgHeight = 10;
        const page = pageWith([image]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const b = rec(layout, image.id).box;
        expect(b.w).toBeCloseTo(A4.w - 16, 5);
        expect(b.h).toBeCloseTo(0.1 * b.w, 5);
    });

    test("field width shrinks a block inside its cell and align offsets it", () => {
        const block = new TextBlock({ content: "Hello" });
        block.width = 50;
        const page = pageWith([block]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        const cw = A4.w - 16;

        const layout = layoutPage(new FakeCtx(), page);
        const b = rec(layout, block.id).box;
        expect(b.w).toBeCloseTo(cw / 2, 5);
        expect(b.x).toBeCloseTo(8, 5);
        // the record carries its own cell for the width drag handle
        expect(rec(layout, block.id).avail).toEqual({ x: 8, w: cw });

        block.align = "right";
        const r = layoutPage(new FakeCtx(), page);
        expect(rec(r, block.id).box.x).toBeCloseTo(8 + cw / 2, 5);

        block.align = "center";
        const c = layoutPage(new FakeCtx(), page);
        expect(rec(c, block.id).box.x).toBeCloseTo(8 + cw / 4, 5);
    });

    test("field width is a % of the column cell inside a columned section", () => {
        const section = new SectionBlock();
        section.columns = 2;
        section.padding = 0;
        section.applyBorder = false;
        section.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        const c1 = new VariableBlock({ variable: "billNo", width: 50 });
        const c2 = new VariableBlock({ variable: "billNo" });
        section.blocks = [c1, c2];
        const page = pageWith([section]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const sb = rec(layout, section.id).box;
        const cell = sb.w / 2;
        const b1 = rec(layout, c1.id).box;
        const b2 = rec(layout, c2.id).box;
        expect(b1.w).toBeCloseTo(cell / 2, 5);
        expect(b2.w).toBeCloseTo(cell, 5);
        // avail is the CELL (width % is relative to it), not the shrunk box
        expect(rec(layout, c1.id).avail.w).toBeCloseTo(cell, 5);
    });

    test("a 50% footer bottom-anchors as a half-width band", () => {
        const page = new BillPage();
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        const f = page.addBlock("footer");
        f.margin = { top: 0, right: 0, bottom: 0, left: 0 };
        f.padding = 0;
        f.applyBorder = false;
        f.width = 50;
        f.align = "right";
        f.blocks = [new TextBlock({ content: "bottom" })];

        const layout = layoutPage(new FakeCtx(), page);
        const fb = rec(layout, f.id).box;
        const cw = A4.w - 16;
        expect(fb.w).toBeCloseTo(cw / 2, 5);
        expect(fb.x).toBeCloseTo(8 + cw / 2, 5);
        expect(fb.y + fb.h).toBeCloseTo(A4.h - 8, 5); // still bottom-anchored
    });
});

describe("canvas preview hit-testing and overlays", () => {
    test("recordAt returns the deepest block at a point", () => {
        const outer = new SectionBlock({ padding: 8 });
        const inner = new SectionBlock({
            height: 40,
            padding: 0,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            applyBorder: false,
        });
        outer.blocks = [inner];
        const page = pageWith([outer]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const layout = layoutPage(new FakeCtx(), page);
        const ib = rec(layout, inner.id).box;
        const hit = recordAt(layout, ib.x + ib.w / 2, ib.y + ib.h / 2);
        expect(hit.id).toBe(inner.id);
        expect(hit.depth).toBeGreaterThan(rec(layout, outer.id).depth);
        // empty paper returns null
        expect(recordAt(layout, A4.w - 2, A4.h - 2)).toBeNull();
    });

    test("selection chrome: outline, grip pill, four corner dots", () => {
        const section = new SectionBlock({ height: 60 });
        const page = pageWith([section]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const ctx = new FakeCtx();
        const layout = renderPreview(ctx, page, {
            selectedId: section.id,
            hoveredId: null,
            accent: "#663399",
        });
        const b = rec(layout, section.id).box;
        // 2pt solid outline
        expect(ctx.strokeRects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ x: b.x, y: b.y, w: b.w, h: b.h }),
            ])
        );
        // grip pill at the bottom edge
        expect(ctx.fillRects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    x: b.x + b.w / 2 - 14,
                    y: b.y + b.h - 4,
                    w: 28,
                    h: 3,
                }),
            ])
        );
        // 4 dots (edge midpoints inside the box)
        expect(ctx.arcs).toHaveLength(4);
    });

    test("selected non-section block draws the right-edge width handle", () => {
        const block = new TextBlock({ content: "Hello", width: 50 });
        const page = pageWith([block]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        const ctx = new FakeCtx();
        const layout = renderPreview(ctx, page, { selectedId: block.id, accent: "#663399" });
        const b = rec(layout, block.id).box;
        expect(ctx.fillRects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    x: b.x + b.w - 4,
                    y: b.y + b.h / 2 - 8,
                    w: 3,
                    h: 16,
                }),
            ])
        );
    });

    test("recordAt respects the shrunk box (empty cell area stays paper)", () => {
        const block = new TextBlock({ content: "Hello", width: 50, align: "right" });
        const page = pageWith([block]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        const layout = layoutPage(new FakeCtx(), page);
        const b = rec(layout, block.id).box;
        expect(recordAt(layout, b.x + b.w / 2, b.y + b.h / 2).id).toBe(block.id);
        expect(recordAt(layout, b.x - 20, b.y + b.h / 2)).toBeNull();
    });

    test("hover outline is dashed; a snapped guide draws a dashed line + label", () => {
        const section = new SectionBlock({ height: 60 });
        const page = pageWith([section]);
        page.margin = { top: 8, right: 8, bottom: 8, left: 8 };

        const ctx = new FakeCtx();
        renderPreview(ctx, page, {
            hoveredId: section.id,
            guide: { snapped: { guide: 300, label: "page centre" }, axis: "y" },
            accent: "#663399",
        });
        expect(ctx.dashSets).toEqual(
            expect.arrayContaining([[4, 3]])
        );
        // centre snap shows the full-page crosshair: a horizontal + vertical line
        const horizontal = ctx.lines.filter(
            (l) => l.from.y === l.to.y && l.from.x !== l.to.x
        );
        const vertical = ctx.lines.filter(
            (l) => l.from.x === l.to.x && l.from.y !== l.to.y
        );
        expect(horizontal.length).toBeGreaterThanOrEqual(1);
        expect(vertical.length).toBeGreaterThanOrEqual(1);
    });

    test("renderPreview paints the page border when applyBorder", () => {
        const page = pageWith([new TextBlock({ content: "x" })]);
        page.applyBorder = true;
        page.border = 1;
        const ctx = new FakeCtx();
        renderPreview(ctx, page, {});
        expect(ctx.strokeRects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    x: 0.5,
                    y: 0.5,
                    w: A4.w - 1,
                    h: A4.h - 1,
                }),
            ])
        );
    });
});

describe("bundled default templates on canvas", () => {
    test("default1 draws the centre partition at x = 297.64", () => {
        const page = BillPage.fromJSON(default1);
        const ctx = new FakeCtx();
        layoutPage(ctx, page);
        const vertical = ctx.lines.filter((l) => l.from.x === l.to.x);
        expect(
            vertical.some((l) => Math.abs(l.from.x - 297.64) < 0.5)
        ).toBe(true);
    });

    test("default2 lays out without errors and keeps its top-level sections", () => {
        const page = BillPage.fromJSON(default2);
        const layout = layoutPage(new FakeCtx(), page);
        const sectionIds = layout.records
            .filter((r) => r.kind === "section" && r.depth === 0)
            .map((r) => r.id);
        expect(sectionIds).toEqual(
            expect.arrayContaining(
                page.blocks.filter((b) => b.type !== "footer").map((b) => b.id)
            )
        );
    });
});
