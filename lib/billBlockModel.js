/**
 * billBlockModel.js — shared bill-template model (v2 block architecture).
 *
 * Required by BOTH the designer page (renderer process:
 *   template/js/billLayout.js -> require("../../lib/billBlockModel"))
 * and the invoice generator (main process:
 *   lib/execBlockTemplate.js -> require("./billBlockModel")).
 *
 * MUST stay free of top-level `electron` / `pdfkit` / browser-only requires —
 * only `../template/js/common` (proven to load in both processes and under Jest).
 * The designer preview is painted on canvas by lib/billCanvasPreview.js (the
 * model itself has no DOM code). Main-only helpers (getBillNo, emblemMaker)
 * are require()d lazily INSIDE resolver bodies, which only the main-process
 * renderer ever calls.
 */
// Variable registry extracted to lib/billVariableRegistry.js — the legacy
// engine (lib/execCustomTemplate.js) and the designer resolve field values
// from there now. Re-exported so existing importers keep working until the
// v2 stack is removed.
const {
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    formatScalar,
    resolveVariable,
    coerceOrderItems,
    resolveColumnVar,
    getFont,
} = require("./billVariableRegistry");

const LEGACY_MSG =
    "This template uses the old (v1) layout format. " +
    "Recreate it in the new Bill Layout Designer.";

// pdfkit built-in family -> CSS stack for the designer preview
const FONT_FAMILY_CSS = {
    "Times-Roman": '"Times New Roman", Times, serif',
    Helvetica: "Helvetica, Arial, sans-serif",
    Courier: '"Courier New", Courier, monospace',
};

const MARGIN_DEFAULTS = { top: 0, right: 0, bottom: 0, left: 0 };
const FONT_DEFAULTS = {
    family: "Times-Roman",
    size: 12,
    bold: false,
    italic: false,
    underline: false,
    color: "#000000",
};

function makeId() {
    return (
        "b" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8)
    );
}

/** Clone a plain object (block props are plain data — safe with spread). */
function cloneObj(obj) {
    if (Array.isArray(obj)) return obj.map(cloneObj);
    if (obj && typeof obj === "object")
        return Object.keys(obj).reduce(
            (acc, key) => ((acc[key] = cloneObj(obj[key])), acc),
            {}
        );
    return obj;
}


// ---------------------------------------------------------------------------
// Property schemas — the generic property panel renders these.
// ---------------------------------------------------------------------------
const COMMON_PROPS_SCHEMA = [
    { key: "margin.top", label: "Margin Top", type: "number", group: "Spacing", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.right", label: "Margin Right", type: "number", group: "Spacing", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.bottom", label: "Margin Bottom", type: "number", group: "Spacing", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.left", label: "Margin Left", type: "number", group: "Spacing", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "padding", label: "Padding", type: "number", group: "Spacing", default: 0, unit: "pt", min: 0, max: 100, step: 1 },
    { key: "font.family", label: "Font", type: "select", group: "Font", default: "Times-Roman", options: ["Times-Roman", "Courier", "Helvetica"] },
    { key: "font.size", label: "Font Size", type: "number", group: "Font", default: 12, unit: "pt", min: 6, max: 72, step: 1 },
    { key: "font.bold", label: "Bold", type: "checkbox", group: "Font", default: false },
    { key: "font.italic", label: "Italic", type: "checkbox", group: "Font", default: false },
    { key: "font.underline", label: "Underline", type: "checkbox", group: "Font", default: false },
    { key: "font.color", label: "Color", type: "color", group: "Font", default: "#000000" },
    { key: "align", label: "Align", type: "select", group: "Layout", default: "left", options: ["left", "center", "right"] },
    { key: "width", label: "Width %", type: "range", group: "Layout", default: 100, unit: "%", min: 1, max: 100, step: 1 },
    { key: "applyBorder", label: "Border", type: "checkbox", group: "Layout", default: false },
    { key: "border", label: "Border Width", type: "number", group: "Layout", default: 1, unit: "pt", min: 0, max: 10, step: 0.5 },
    { key: "background", label: "Background", type: "color", group: "Layout", default: "" },
];

const PAGE_PROPS_SCHEMA = [
    { key: "size", label: "Paper Size", type: "select", group: "Page", default: "a4", options: ["a4", "letter"] },
    { key: "margin.top", label: "Margin Top", type: "number", group: "Page", default: 8, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.right", label: "Margin Right", type: "number", group: "Page", default: 8, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.bottom", label: "Margin Bottom", type: "number", group: "Page", default: 8, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.left", label: "Margin Left", type: "number", group: "Page", default: 8, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "applyBorder", label: "Page Border", type: "checkbox", group: "Page", default: false },
    { key: "border", label: "Border Width", type: "number", group: "Page", default: 1, unit: "pt", min: 0, max: 10, step: 0.5 },
    { key: "fFamily", label: "Default Font", type: "select", group: "Page", default: "Times-Roman", options: ["Times-Roman", "Courier", "Helvetica"] },
];

// ---------------------------------------------------------------------------
// Block classes — super class holds the common properties; UI classes inherit
// and add their unique properties.
// ---------------------------------------------------------------------------
class BillBlock {
    constructor(data = {}) {
        this.id = data.id || makeId();
        this.margin = { ...MARGIN_DEFAULTS, ...(data.margin ?? {}) };
        this.padding = data.padding ?? 0;
        this.font = { ...FONT_DEFAULTS, ...(data.font ?? {}) };
        this.applyBorder = data.applyBorder ?? false;
        this.border = data.border ?? 1;
        this.background = data.background ?? "";
        this.align = data.align ?? "left";
        // Field width: % of the available cell width (100 = full width).
        this.width = data.width ?? 100;
        this.applyTypeProps(data);
    }

    static get type() {
        return "text";
    }

    /** Instance alias so engine/designer/tests can read `block.type` uniformly. */
    get type() {
        return this.constructor.type;
    }

    static get propsSchema() {
        return COMMON_PROPS_SCHEMA;
    }

    /** Subclasses override to absorb their unique props from data. */
    applyTypeProps(_data) {}

    toJSON() {
        return {
            id: this.id,
            type: this.constructor.type,
            margin: { ...this.margin },
            padding: this.padding,
            font: { ...this.font },
            applyBorder: this.applyBorder,
            border: this.border,
            background: this.background,
            align: this.align,
            width: this.width,
            ...this.typePropsJSON(),
        };
    }

    /** Subclasses override: unique props to serialize. */
    typePropsJSON() {
        return {};
    }

    static fromJSON(obj) {
        if (!obj || typeof obj !== "object")
            throw new Error("Invalid block data.");
        if (!("type" in obj) || !(obj.type in BillBlock.TYPES)) {
            if (
                "x" in obj ||
                "feilds" in obj ||
                "plan" in obj ||
                "sections" in obj ||
                "head" in obj
            )
                throw new Error(LEGACY_MSG);
            throw new Error(`Unknown block type "${obj.type}".`);
        }
        return new BillBlock.TYPES[obj.type](obj);
    }

    /**
     * True when the block has nothing to draw for this bill — the renderer
     * collapses it entirely (no margin, no border, no gap).
     */
    isEmpty(_ctx) {
        return false;
    }

    /**
     * Content height in pt at the given content width (margins/padding not
     * included). Table blocks return null — the renderer lays tables inline.
     */
    measure(_doc, _contentWidth, _ctx) {
        return 0;
    }

    /** Draw content only (frame/padding/margins handled by the layout engine). */
    renderPDF(_doc, _x, _y, _contentWidth, _ctx) {}

    /** Dot-path property used by the generic property panel. */
    getProp(path) {
        return path
            .split(".")
            .reduce((acc, key) => (acc == null ? acc : acc[key]), this);
    }

    setProp(path, value) {
        const keys = path.split(".");
        const last = keys.pop();
        const target = keys.reduce(
            (acc, key) => (acc == null ? acc : acc[key]),
            this
        );
        if (target && typeof target === "object") target[last] = value;
    }

    /** Shared underline helper (ported setUnderline). */
    setUnderline(doc, x, y, text) {
        doc.underline(x, y, doc.widthOfString(text), doc.currentLineHeight());
    }
}

class TextBlock extends BillBlock {
    static get type() {
        return "text";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            { key: "content", label: "Text", type: "text", group: "Content", default: "" },
        ];
    }

    applyTypeProps(data) {
        this.content = data.content ?? "";
    }

    typePropsJSON() {
        return { content: this.content };
    }

    isEmpty() {
        return !String(this.content).trim();
    }

    measure(doc, contentWidth) {
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size);
        return doc.heightOfString(this.content, { width: contentWidth });
    }

    renderPDF(doc, x, y, contentWidth) {
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size).fillColor(this.font.color);
        doc.text(this.content, x, y, { width: contentWidth, align: this.align });
        if (this.font.underline) this.setUnderline(doc, x, y, this.content);
    }
}

class VariableBlock extends BillBlock {
    static get type() {
        return "variable";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            { key: "variable", label: "Variable", type: "select-variable", group: "Content", default: "billNo", allowCustom: true },
            { key: "prefix", label: "Prefix", type: "text", group: "Content", default: "" },
            { key: "suffix", label: "Suffix", type: "text", group: "Content", default: "" },
        ];
    }

    applyTypeProps(data) {
        this.variable = data.variable ?? "billNo";
        this.prefix = data.prefix ?? "";
        this.suffix = data.suffix ?? "";
    }

    typePropsJSON() {
        return { variable: this.variable, prefix: this.prefix, suffix: this.suffix };
    }

    /** Resolved lines (multi-line variables -> stacked lines). */
    resolveLines(ctx = {}) {
        const value = resolveVariable(
            this.variable,
            ctx.billObj,
            ctx.saleConfig,
            ctx
        );
        if (Array.isArray(value))
            return value.map((v) => this.prefix + v + this.suffix);
        const text = this.prefix + value + this.suffix;
        return text === this.prefix + this.suffix ? [] : [text];
    }

    isEmpty(ctx) {
        return this.resolveLines(ctx).every((line) => !String(line).trim());
    }

    measure(doc, contentWidth, ctx = {}) {
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size);
        return this.resolveLines(ctx).reduce(
            (acc, line) => acc + doc.heightOfString(line, { width: contentWidth }),
            0
        );
    }

    renderPDF(doc, x, y, contentWidth, ctx = {}) {
        const lines = this.resolveLines(ctx).filter((line) => String(line).trim());
        if (!lines.length) return;
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size).fillColor(this.font.color);
        let lineY = y;
        lines.forEach((line) => {
            doc.text(line, x, lineY, { width: contentWidth, align: this.align });
            if (this.font.underline) this.setUnderline(doc, x, lineY, line);
            lineY += doc.currentLineHeight();
        });
    }
}

class ImageBlock extends BillBlock {
    static get type() {
        return "image";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            { key: "source", label: "Image Source", type: "select", group: "Content", default: "emblem", options: ["emblem", "seal"] },
            { key: "imgWidth", label: "Width %", type: "range", group: "Content", default: 10, unit: "%", min: 1, max: 100, step: 1 },
            { key: "imgHeight", label: "Height %", type: "range", group: "Content", default: 10, unit: "%", min: 1, max: 100, step: 1 },
            { key: "imgOpacity", label: "Opacity %", type: "range", group: "Content", default: 100, unit: "%", min: 0, max: 100, step: 1 },
            { key: "applyAspectRatio", label: "Lock Aspect Ratio", type: "checkbox", group: "Content", default: false },
            { key: "aspectRatio", label: "Aspect Ratio", type: "select", group: "Content", default: "1:1", options: ["1:1", "3:2", "4:3", "16:9"] },
            { key: "imgTag", label: "Image Tag", type: "text", group: "Content", default: "" },
        ];
    }

    applyTypeProps(data) {
        this.source = data.source ?? "emblem";
        this.imgWidth = data.imgWidth ?? 10;
        this.imgHeight = data.imgHeight ?? 10;
        this.imgOpacity = data.imgOpacity ?? 100;
        this.applyAspectRatio = data.applyAspectRatio ?? false;
        this.aspectRatio = data.aspectRatio ?? "1:1";
        this.imgTag = data.imgTag ?? "";
    }

    typePropsJSON() {
        return {
            source: this.source,
            imgWidth: this.imgWidth,
            imgHeight: this.imgHeight,
            imgOpacity: this.imgOpacity,
            applyAspectRatio: this.applyAspectRatio,
            aspectRatio: this.aspectRatio,
            imgTag: this.imgTag,
        };
    }

    /** Resolved draw dimensions (pt) for a given content width. */
    dimensions(contentWidth) {
        let { imgWidth, imgHeight } = this;
        const [wRatio, hRatio] = String(this.aspectRatio)
            .split(":")
            .map(Number);
        if (this.applyAspectRatio && wRatio && hRatio) {
            if (this.imgWidth !== undefined && !imgHeight)
                imgHeight = (imgWidth * hRatio) / wRatio;
            else if (this.imgHeight !== undefined && !imgWidth)
                imgWidth = (imgHeight * wRatio) / hRatio;
        }
        return {
            width: (imgWidth * contentWidth) / 100,
            height: (imgHeight * contentWidth) / 100,
        };
    }

    measure(_doc, contentWidth) {
        return this.dimensions(contentWidth).height;
    }

    // renderPDF is implemented by the layout engine (lib/execBlockTemplate.js):
    // the file path (saleConfig.billTemplate.emblem|seal) resolves in the MAIN
    // process relative to the app's scripts/ dir, exactly like the legacy
    // applyEmblem helper, and the emblem/seal gates live there too.
}

class TableBlock extends BillBlock {
    static get type() {
        return "table";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            { key: "thHeight", label: "Header Height", type: "number", group: "Table", default: 32, unit: "pt", min: 8, max: 100, step: 1 },
            { key: "fSize", label: "Cell Font Size", type: "number", group: "Table", default: 16, unit: "pt", min: 6, max: 72, step: 1 },
            { key: "rSpacing", label: "Row Spacing", type: "number", group: "Table", default: 8, unit: "pt", min: 0, max: 50, step: 1 },
            { key: "cellPadding", label: "Cell Padding", type: "number", group: "Table", default: 10, unit: "pt", min: 0, max: 50, step: 1 },
            { key: "drawGrid", label: "Draw Grid", type: "checkbox", group: "Table", default: true },
            {
                key: "cols", label: "Columns", type: "list", group: "Table",
                listSchema: {
                    fields: [
                        { key: "label", label: "Label", type: "text", default: "" },
                        { key: "variable", label: "Variable", type: "select-variable", default: "name", allowCustom: true },
                        { key: "width", label: "Width %", type: "range", min: 1, max: 100, unit: "%", default: 10 },
                        { key: "sumup", label: "Use remaining space", type: "checkbox", default: false },
                    ],
                    canAdd: true,
                    canRemove: true,
                },
            },
        ];
    }

    applyTypeProps(data) {
        this.cols = (data.cols ?? [{ label: "Sl No", variable: "slno", width: 10 }]).map((col) => ({
            label: col.label ?? "",
            variable: col.variable ?? "name",
            width: col.width ?? 10,
            sumup: col.sumup ?? false,
        }));
        this.thHeight = data.thHeight ?? 32;
        this.fSize = data.fSize ?? 16;
        this.rSpacing = data.rSpacing ?? 8;
        this.cellPadding = data.cellPadding ?? 10;
        this.drawGrid = data.drawGrid ?? true;
    }

    typePropsJSON() {
        return {
            cols: this.cols.map((c) => ({ ...c })),
            thHeight: this.thHeight,
            fSize: this.fSize,
            rSpacing: this.rSpacing,
            cellPadding: this.cellPadding,
            drawGrid: this.drawGrid,
        };
    }

    measure() {
        return null; // renderer lays the table out inline (needs row data + paging)
    }

    renderPDF(_doc, _x, _y, _cw, _ctx) {
        // handled by the layout engine (lib/execBlockTemplate.js)
    }
}

class TotalsBlock extends BillBlock {
    static get type() {
        return "totals";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            {
                key: "rows", label: "Totals Rows", type: "list", group: "Totals",
                listSchema: {
                    fields: [
                        { key: "label", label: "Label", type: "text", default: "" },
                        { key: "variable", label: "Variable", type: "select-variable", default: "netAmtTax", allowCustom: true },
                        { key: "align", label: "Align", type: "select", options: ["left", "right"], default: "right" },
                    ],
                    canAdd: true,
                    canRemove: true,
                },
            },
        ];
    }

    applyTypeProps(data) {
        this.rows = (data.rows ?? [{ label: "Grand Total", variable: "netAmtTax", align: "right" }]).map((row) => ({
            label: row.label ?? "",
            variable: row.variable ?? "netAmtTax",
            align: row.align ?? "right",
        }));
    }

    typePropsJSON() {
        return { rows: this.rows.map((r) => ({ ...r })) };
    }

    rowLines(row, ctx = {}) {
        const value = resolveVariable(row.variable, ctx.billObj, ctx.saleConfig, ctx);
        const label = row.label ? row.label + ": " : "";
        if (Array.isArray(value)) {
            if (!value.length) return [];
            return value.map((v, i) => (i === 0 ? label : "    ") + v);
        }
        if (!String(value).trim()) return [];
        return [label + value];
    }

    isEmpty(ctx) {
        return this.rows.every((row) => !this.rowLines(row, ctx).length);
    }

    measure(doc, contentWidth, ctx = {}) {
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size);
        let total = 0;
        let first = true;
        this.rows.forEach((row) => {
            const lines = this.rowLines(row, ctx);
            if (!lines.length) return;
            if (!first) total += doc.currentLineHeight() * 0.3;
            first = false;
            total += lines.reduce(
                (acc, line) => acc + doc.heightOfString(line, { width: contentWidth }),
                0
            );
        });
        return total;
    }

    renderPDF(doc, x, y, contentWidth, ctx = {}) {
        const font = getFont(this.font.family, this.font.bold, this.font.italic);
        doc.font(font).fontSize(this.font.size).fillColor(this.font.color);
        let rowY = y;
        this.rows.forEach((row) => {
            const lines = this.rowLines(row, ctx);
            if (!lines.length) return;
            lines.forEach((line) => {
                if (row.align === "right") {
                    const textWidth = doc.widthOfString(line);
                    doc.text(line, x + contentWidth - textWidth, rowY, {
                        width: textWidth,
                    });
                } else {
                    doc.text(line, x, rowY, { width: contentWidth, align: "left" });
                }
                rowY += doc.currentLineHeight();
            });
            rowY += doc.currentLineHeight() * 0.3;
        });
    }
}

// ---------------------------------------------------------------------------
// Sections — container blocks. Header/Body/Footer are the invoice's three
// classic sections; SectionBlock is a free custom section. All inherit
// BillSection: a block that holds child blocks plus partitions and a shape.
// ---------------------------------------------------------------------------
/** Section layout columns — clamped to a sane 1..6; 1 = vertical stacking. */
function clampColumns(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 1;
}

/**
 * Width a section's children flow in: the passed content width shrunk by the
 * section's horizontal margins and its own frame (padding + border) — the same
 * box math as the engine's renderSection.
 */
function innerWidthOf(block, contentWidth) {
    return (
        contentWidth -
        (block.margin?.left ?? 0) -
        (block.margin?.right ?? 0) -
        2 * (block.padding ?? 0) -
        2 * (block.applyBorder ? (block.border ?? 0) : 0)
    );
}

/**
 * Width each child gets inside a section with `columns`: rows of N equal
 * cells (the engine lays out the same rows). 1 column = the full inner width.
 */
function cellWidthOf(block, innerWidth) {
    const cols = clampColumns(block.columns);
    return cols > 1 ? innerWidth / cols : innerWidth;
}

/**
 * Effective box width (pt) of a block: `width` is a percentage of the
 * available cell width (100 = full width, the default). Clamped 1..100 so
 * garbage/0 mean full width. Shared by the engine, the canvas preview and
 * the designer so the three can't drift.
 */
function effectiveWidthOf(block, availableWidth) {
    const pct = Number(block?.width);
    const p = Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 100;
    return (availableWidth * p) / 100;
}

/**
 * Left edge of a block's box within its cell, per its align (left/center/
 * right). With width 100 the box fills the cell and this is a no-op.
 */
function alignedLeftOf(block, cellLeft, availableWidth) {
    const w = effectiveWidthOf(block, availableWidth);
    if (block?.align === "center") return cellLeft + (availableWidth - w) / 2;
    if (block?.align === "right") return cellLeft + availableWidth - w;
    return cellLeft;
}

class BillSection extends BillBlock {
    static get type() {
        return "section";
    }

    static get propsSchema() {
        return [
            ...COMMON_PROPS_SCHEMA,
            { key: "name", label: "Section Name", type: "text", group: "Section", default: "" },
            { key: "shape", label: "Shape", type: "select", group: "Section", default: "rectangle", options: ["rectangle", "rounded", "circle", "ellipse"] },
            { key: "cornerRadius", label: "Corner Radius", type: "number", group: "Section", default: 10, unit: "pt", min: 0, max: 100, step: 1 },
            { key: "height", label: "Fixed Height", type: "number", group: "Section", default: 0, unit: "pt", min: 0, max: 800, step: 1, hint: "0 = grow with content (required for circle/ellipse clipping)" },
            { key: "columns", label: "Columns", type: "number", group: "Section", default: 1, min: 1, max: 6, step: 1, hint: "1 = fields stack; 2+ = fields flow in rows of N" },
            {
                key: "partitions", label: "Partitions", type: "list", group: "Section",
                listSchema: {
                    fields: [
                        { key: "direction", label: "Direction", type: "select", options: ["col", "row"], default: "col" },
                        { key: "range", label: "Position %", type: "range", min: 0, max: 100, default: 50 },
                        { key: "lWidth", label: "Line Width", type: "number", min: 1, max: 10, default: 1 },
                    ],
                    canAdd: true,
                    canRemove: true,
                },
            },
        ];
    }

    applyTypeProps(data) {
        // Non-zero defaults (0.5rem = 8pt): a section is a visible box —
        // padding insets its children, margin separates it from its neighbours.
        if (data.padding === undefined) this.padding = 8;
        if (data.margin === undefined)
            this.margin = { top: 8, right: 8, bottom: 8, left: 8 };
        // Legacy parity: sections were bordered by default — a section the
        // user just added must be visible on the bill.
        if (data.applyBorder === undefined) this.applyBorder = true;
        this.name = data.name ?? "";
        this.shape = data.shape ?? "rectangle";
        this.cornerRadius = data.cornerRadius ?? 10;
        this.height = data.height ?? 0;
        this.columns = clampColumns(data.columns);
        this.partitions = (data.partitions ?? []).map((p) => ({
            direction: p.direction ?? "col",
            range: p.range ?? 50,
            lWidth: p.lWidth ?? 1,
        }));
        this.blocks = (data.blocks ?? []).map((blockObj) =>
            BillBlock.fromJSON(blockObj)
        );
    }

    typePropsJSON() {
        return {
            name: this.name,
            shape: this.shape,
            cornerRadius: this.cornerRadius,
            height: this.height,
            columns: this.columns,
            partitions: this.partitions.map((p) => ({ ...p })),
            blocks: this.blocks.map((block) => block.toJSON()),
        };
    }

    /** Sections are laid out inline by the engine (children + paging state). */
    measure() {
        return null;
    }

    /** Sections are structural boxes — they render even with no children. */
    isEmpty() {
        return false;
    }

    // renderPDF is handled by the layout engine (lib/execBlockTemplate.js).
}

class HeaderBlock extends BillSection {
    static get type() {
        return "header";
    }
}

class BodyBlock extends BillSection {
    static get type() {
        return "body";
    }

    applyTypeProps(data) {
        super.applyTypeProps(data);
        // a fresh Body comes pre-loaded with the items table
        if (data.blocks === undefined && this.blocks.length === 0) {
            this.blocks = [new TableBlock()];
        }
    }
}

class FooterBlock extends BillSection {
    static get type() {
        return "footer";
    }
}

class SectionBlock extends BillSection {
    static get type() {
        return "section";
    }
}

/** Shared child-block list operations for BillPage and BillSection. */
function applyBlockContainerMixin(Cls) {
    Cls.prototype.addBlock = function (type, index) {
        const BlockCls = BillBlock.TYPES[type];
        if (!BlockCls) throw new Error(`Unknown block type "${type}".`);
        const block = new BlockCls();
        block.font.family =
            this.fFamily ?? this.font?.family ?? "Times-Roman";
        if (index === undefined || index < 0) this.blocks.push(block);
        else this.blocks.splice(index, 0, block);
        return block;
    };
    Cls.prototype.getBlock = function (id) {
        return this.blocks.find((block) => block.id === id);
    };
    Cls.prototype.moveBlock = function (id, dir) {
        const index = this.blocks.findIndex((block) => block.id === id);
        if (index < 0) return;
        const target = index + dir;
        if (target < 0 || target >= this.blocks.length) return;
        [this.blocks[index], this.blocks[target]] = [
            this.blocks[target],
            this.blocks[index],
        ];
    };
    Cls.prototype.removeBlock = function (id) {
        this.blocks = this.blocks.filter((block) => block.id !== id);
    };
    return Cls;
}

applyBlockContainerMixin(BillSection);

BillBlock.TYPES = {
    text: TextBlock,
    variable: VariableBlock,
    image: ImageBlock,
    table: TableBlock,
    totals: TotalsBlock,
    header: HeaderBlock,
    body: BodyBlock,
    footer: FooterBlock,
    section: SectionBlock,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Header/Body/Footer are the invoice's structural sections: unique, pinned in
 * this order (Header top, Body middle, Footer bottom) and permanent. Their
 * FIELDS are freely editable/removable — only the sections themselves are not.
 */
const STRUCTURAL_TYPES = ["header", "body", "footer"];

class BillPage {
    constructor(data = {}) {
        this.version = 2;
        this.size = data.size ?? "a4";
        // Page margins default to 0.5rem (8pt) — a bill with no margin looks
        // broken. Blocks keep MARGIN_DEFAULTS (0); sections bring their own.
        this.margin = { top: 8, right: 8, bottom: 8, left: 8, ...(data.margin ?? {}) };
        this.applyBorder = data.applyBorder ?? false;
        this.border = data.border ?? 1;
        this.fFamily = data.fFamily ?? "Times-Roman";
        this.blocks = (data.blocks ?? []).map((blockObj) => BillBlock.fromJSON(blockObj));
        this.newDoc = data.newDoc ?? true;
        this.filePath = data.filePath ?? "";
    }

    static get propsSchema() {
        return PAGE_PROPS_SCHEMA;
    }

    static fromJSON(obj) {
        if (!obj || typeof obj !== "object")
            throw new Error("Invalid bill template file.");
        if (obj.version !== undefined && obj.version !== 2) {
            if (obj.version === 1) throw new Error(LEGACY_MSG);
            throw new Error(`Unsupported template version ${obj.version}.`);
        }
        if (Array.isArray(obj.blocks)) return new BillPage(obj);
        if (
            "feilds" in obj ||
            "head" in obj ||
            "sections" in obj ||
            "plan" in obj
        )
            throw new Error(LEGACY_MSG);
        throw new Error("Unsupported bill template file.");
    }

    toJSON() {
        return {
            version: this.version,
            size: this.size,
            margin: { ...this.margin },
            applyBorder: this.applyBorder,
            border: this.border,
            fFamily: this.fFamily,
            blocks: this.blocks.map((block) => block.toJSON()),
            newDoc: this.newDoc,
            filePath: this.filePath,
        };
    }

    /** Factory via the type registry. Structural sections are unique and are
     *  inserted at their canonical slot: header first, body right after it,
     *  footer last. */
    addBlock(type, index) {
        const Cls = BillBlock.TYPES[type];
        if (!Cls) throw new Error(`Unknown block type "${type}".`);
        const block = new Cls();
        block.font.family = this.fFamily;
        if (STRUCTURAL_TYPES.includes(type)) {
            if (this.blocks.some((b) => b.type === type))
                throw new Error(
                    `A ${type[0].toUpperCase() + type.slice(1)} section already exists.`
                );
            const headerIdx = this.blocks.findIndex((b) => b.type === "header");
            const pos =
                type === "header"
                    ? 0
                    : type === "body"
                    ? headerIdx >= 0
                        ? headerIdx + 1
                        : 0
                    : this.blocks.length; // footer always last
            this.blocks.splice(pos, 0, block);
            return block;
        }
        if (index === undefined || index < 0) this.blocks.push(block);
        else this.blocks.splice(index, 0, block);
        return block;
    }

    getBlock(id) {
        return this.blocks.find((block) => block.id === id);
    }

    moveBlock(id, dir) {
        const index = this.blocks.findIndex((block) => block.id === id);
        if (index < 0) return;
        const target = index + dir;
        if (target < 0 || target >= this.blocks.length) return;
        // Structural sections are pinned: they never move, and nothing may
        // swap with them (Header stays on top, Footer at the bottom).
        if (
            STRUCTURAL_TYPES.includes(this.blocks[index].type) ||
            STRUCTURAL_TYPES.includes(this.blocks[target].type)
        )
            return;
        [this.blocks[index], this.blocks[target]] = [
            this.blocks[target],
            this.blocks[index],
        ];
    }

    removeBlock(id) {
        const block = this.blocks.find((b) => b.id === id);
        // Structural sections are permanent — remove their fields instead.
        if (!block || STRUCTURAL_TYPES.includes(block.type)) return;
        this.blocks = this.blocks.filter((b) => b.id !== id);
    }
}

/**
 * The default new-template layout: an invoice's three mandatory sections with
 * the non-questionable fields pre-built.
 *
 * Header takes 30% of the page, Body 40%, Footer 30% — heights are fixed pt
 * computed once at creation (adjustable in the designer); 0.5rem (8pt) margins
 * separate the boxes and pad their content. Users can remove or restyle the
 * FIELDS, but the three structural sections stay in this order.
 */
function createInvoiceTemplate() {
    const page = new BillPage();
    const pageH = 841.89; // a4 — the default size
    const usableH = pageH - page.margin.top - page.margin.bottom;
    const zone = (frac) => Math.round(frac * usableH - 16); // 8pt margins above + below the box
    const m = (top, bottom) => ({ top, right: 0, bottom, left: 0 }); // flow spacing
    const patch = (block, props) => {
        Object.entries(props).forEach(([key, value]) => {
            if (key === "font") Object.assign(block.font, value);
            else block[key] = value;
        });
        return block;
    };

    // --- Header: seller + buyer mandatory fields ---
    const header = page.addBlock("header");
    header.name = "Header";
    header.height = zone(0.3);
    patch(header.addBlock("text"), {
        content: "TAX INVOICE",
        align: "center",
        font: { size: 18, bold: true },
        margin: m(0, 6),
    });
    patch(header.addBlock("variable"), { variable: "biller-name", font: { size: 14, bold: true } });
    patch(header.addBlock("variable"), { variable: "biller-address", font: { size: 11 }, margin: m(0, 2) });
    patch(header.addBlock("variable"), { variable: "biller-gst", prefix: "GSTIN: ", font: { size: 11 } });
    patch(header.addBlock("variable"), { variable: "biller-phone", prefix: "Phone: ", font: { size: 11 } });
    patch(header.addBlock("variable"), { variable: "bill-no-formatted", prefix: "Bill No: ", margin: m(6, 0) });
    patch(header.addBlock("variable"), { variable: "date-slash", prefix: "Date: " });
    patch(header.addBlock("text"), { content: "Bill To", font: { bold: true }, margin: m(6, 0) });
    patch(header.addBlock("variable"), { variable: "customer-name", font: { bold: true } });
    patch(header.addBlock("variable"), { variable: "customer-address", font: { size: 11 }, margin: m(0, 2) });
    patch(header.addBlock("variable"), { variable: "customer-gst", prefix: "GSTIN: ", font: { size: 11 } });

    // --- Body: the items table (pre-loaded), configured with standard columns ---
    const body = page.addBlock("body");
    body.name = "Body";
    body.height = zone(0.4);
    const table = body.blocks[0];
    table.thHeight = 18;
    table.fSize = 11;
    table.rSpacing = 2;
    table.cellPadding = 2;
    table.cols = [
        { label: "Sl No", variable: "slno", width: 8 },
        { label: "Item", variable: "name", width: 44 },
        { label: "Qty", variable: "qty", width: 12 },
        { label: "Rate", variable: "rate", width: 16 },
        { label: "Amount", variable: "total", width: 20 },
    ];

    // --- Footer: totals + thanks + signatory ---
    const footer = page.addBlock("footer");
    footer.name = "Footer";
    footer.height = zone(0.3);
    const totals = footer.addBlock("totals");
    totals.rows = [
        { label: "Total Amount", variable: "netAmtTax", align: "right" },
        { label: "Grand Total", variable: "grand-total", align: "right" },
        { label: "Net Due", variable: "netDue", align: "right" },
    ];
    patch(footer.addBlock("text"), { content: "Thank You!", align: "center", margin: m(12, 0) });
    patch(footer.addBlock("variable"), {
        variable: "biller-name",
        prefix: "For ",
        font: { bold: true },
        margin: m(12, 0),
    });
    patch(footer.addBlock("text"), { content: "Authorised Signatory", font: { size: 10 } });

    return page;
}

module.exports = {
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
    BillPage,
    createInvoiceTemplate,
    STRUCTURAL_TYPES,
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    resolveVariable,
    resolveColumnVar,
    getFont,
    coerceOrderItems,
    clampColumns,
    innerWidthOf,
    cellWidthOf,
    effectiveWidthOf,
    alignedLeftOf,
    FONT_FAMILY_CSS,
    COMMON_PROPS_SCHEMA,
    PAGE_PROPS_SCHEMA,
    LEGACY_MSG,
    makeId,
    cloneObj,
    formatScalar,
};
