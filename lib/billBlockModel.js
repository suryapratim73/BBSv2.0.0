/**
 * billBlockModel.js — shared bill-template model (v2 block architecture).
 *
 * Required by BOTH the designer page (renderer process:
 *   template/js/billBlockDesigner.js -> require("../../lib/billBlockModel"))
 * and the invoice generator (main process:
 *   lib/execBlockTemplate.js -> require("./billBlockModel")).
 *
 * MUST stay free of top-level `electron` / `pdfkit` / browser-only requires —
 * only `../template/js/common` (proven to load in both processes and under Jest).
 * DOM methods (renderDOM) touch `document` only when called, never at load.
 * Main-only helpers (getBillNo, emblemMaker) are require()d lazily INSIDE
 * resolver bodies, which only the main-process renderer ever calls.
 */
const {
    roundOffTo2DecimalPlace,
    capitalize,
    getAmtToWord,
    openFormatForDate,
} = require("../template/js/common");

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
// Variable registry — data-driven source of truth.
//
// The designer palette shows these groups/keys as labeled options PLUS a
// free-text picker (datalist) for anything else. The PDF generator resolves
// ANY key not listed here through the generic fallback: billMeta[key].
// That is the "new billMeta key becomes printable in every template with zero
// code changes" guarantee — registry entries only add labels/formatting.
//
// resolve(billObj, saleConfig, ctx) -> string | string[] | "" (missing).
// ctx = { pageNo, captionIndex } supplied by the renderer.
// ---------------------------------------------------------------------------
const VARIABLES = {
    // --- Bill ---
    billNo: { label: "Bill No", group: "Bill" },
    "bill-no-formatted": {
        label: "Bill No (formatted)",
        group: "Bill",
        resolve: (billObj) => {
            // main-only (reads process.presets) — lazy require
            const { getBillNo } = require("./common");
            return getBillNo(billObj.billMeta?.billNo);
        },
    },
    date: {
        label: "Date (yyyy-MM-dd)",
        group: "Bill",
        resolve: (billObj) => openFormatForDate(billObj.billMeta?.billDate),
    },
    "date-slash": {
        label: "Date (dd/mm/yyyy)",
        group: "Bill",
        resolve: (billObj) => {
            let d = billObj.billMeta?.billDate;
            if (!d) return "";
            if (!(d instanceof Date)) d = new Date(d);
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            return `${dd}/${mm}/${d.getFullYear()}`;
        },
    },
    billType: { label: "Bill Type", group: "Bill" },
    billStatus: { label: "Bill Status", group: "Bill" },
    orderRef: { label: "Order Ref", group: "Bill" },
    ewayBill: { label: "E-way Bill No", group: "Bill" },
    mode: { label: "Mode", group: "Bill" },
    target: { label: "Target", group: "Bill" },
    autoBill: { label: "Auto Bill", group: "Bill" },
    stateNcode: { label: "State Name & Code", group: "Bill" },
    placeOfSupply: { label: "Place of Supply", group: "Bill" },
    deliveryType: { label: "Delivery Type", group: "Bill" },
    shipTo: { label: "Ship To", group: "Bill" },
    shipAddr: { label: "Ship Address", group: "Bill" },
    shipPh: { label: "Ship Phone", group: "Bill" },
    shipGST: { label: "Ship GST", group: "Bill" },
    transportName: { label: "Transport Name", group: "Bill" },
    transportId: { label: "Transport Id", group: "Bill" },
    transportAddress: { label: "Transport Address", group: "Bill" },
    transportContact: { label: "Transport Contact", group: "Bill" },
    transportGST: { label: "Transport GST", group: "Bill" },
    netQty: { label: "Net Quantity", group: "Bill" },
    netAmt: { label: "Net Amount", group: "Bill" },
    netTax: { label: "Net Tax", group: "Bill" },
    netAmtTax: { label: "Net Amount + Tax", group: "Bill" },
    netDue: { label: "Net Due", group: "Bill" },
    netPayment: { label: "Net Payment", group: "Bill" },
    paymentStatus: { label: "Payment Status", group: "Bill" },
    discVal: { label: "Discount", group: "Bill" },
    delCharge: { label: "Delivery Charge", group: "Bill" },
    scrapTDSAmt: { label: "Scrap TDS Amount", group: "Bill" },
    ro: {
        label: "Rounded Off",
        group: "Bill",
        resolve: (billObj) =>
            roundOffTo2DecimalPlace(
                Math.round(billObj.billMeta?.netAmtTax) - billObj.billMeta?.netAmtTax
            ),
    },
    payment: {
        label: "Payment Details",
        group: "Bill",
        resolve: (billObj) => {
            const payments = billObj.billMeta?.payment ?? [];
            return payments.map(
                (p) => `${formatScalar(p.type)}: ${formatScalar(p.payment)}`
            );
        },
    },

    // --- Biller (from saleConfig) ---
    "biller-name": {
        label: "Biller Name",
        group: "Biller",
        resolve: (_b, saleConfig) => saleConfig.biller ?? "",
    },
    "biller-address": {
        label: "Biller Address",
        group: "Biller",
        resolve: (_b, saleConfig) => saleConfig.address ?? "",
    },
    "biller-gst": {
        label: "Biller GSTIN",
        group: "Biller",
        resolve: (_b, saleConfig) => saleConfig.gst ?? "",
    },
    "biller-phone": {
        label: "Biller Phone",
        group: "Biller",
        resolve: (_b, saleConfig) => (saleConfig.phones ?? []).join("/"),
    },
    "biller-email": {
        label: "Biller E-mail",
        group: "Biller",
        resolve: (_b, saleConfig) => saleConfig.email ?? "",
    },
    "biller-bank": {
        label: "Biller Bank Details (all)",
        group: "Biller",
        resolve: (_b, saleConfig) =>
            (saleConfig.bankDetails ?? []).map(
                (info) =>
                    `${info.bank} | ${info.branch} | A/c ${info.accNo} | IFSC ${info.ifsc}`
            ),
    },

    // --- Customer (from billObj.customer) ---
    "customer-name": {
        label: "Customer Name",
        group: "Customer",
        resolve: (billObj) => billObj.customer?.name ?? "",
    },
    "customer-address": {
        label: "Customer Address",
        group: "Customer",
        resolve: (billObj) => billObj.customer?.address ?? "",
    },
    "customer-gst": {
        label: "Customer GST",
        group: "Customer",
        resolve: (billObj) => billObj.customer?.gst ?? "",
    },
    "customer-phone": {
        label: "Customer Phone",
        group: "Customer",
        resolve: (billObj) => billObj.customer?.phones?.[1] ?? "",
    },

    // --- Payment (legacy execCustomTemplate semantics) ---
    "pay-mode": {
        label: "Pay Mode",
        group: "Payment",
        resolve: (billObj) =>
            "payment" in billObj ? billObj.payment?.type ?? "" : "",
    },
    "pay-date": {
        label: "Pay Date",
        group: "Payment",
        resolve: (billObj) =>
            "payment" in billObj
                ? openFormatForDate(billObj.billMeta?.billDate)
                : "",
    },
    "pay-status": {
        label: "Pay Status",
        group: "Payment",
        resolve: (billObj) =>
            billObj.billMeta?.paymentStatus ? "Paid" : "Unpaid",
    },

    // --- Taxes ---
    "net-CGST": {
        label: "Net CGST",
        group: "Taxes",
        resolve: (billObj) => reducedTaxes(billObj).netCGST,
    },
    "net-SGST": {
        label: "Net SGST",
        group: "Taxes",
        resolve: (billObj) => reducedTaxes(billObj).netSGST,
    },
    "net-IGST": {
        label: "Net IGST",
        group: "Taxes",
        resolve: (billObj) => reducedTaxes(billObj).netIGST,
    },

    // --- Print ---
    "bill-copy": {
        label: "Bill Copy (caption)",
        group: "Print",
        resolve: (billObj, _s, ctx) => {
            const captions = billObj.billMeta?.printObj?.captions ?? [];
            return captions[ctx.captionIndex] ?? "";
        },
    },
    "page-no": {
        label: "Page No",
        group: "Print",
        resolve: (_b, _s, ctx) => String(ctx.pageNo ?? 1),
    },
    "print-copies": {
        label: "Print Copies",
        group: "Print",
        resolve: (billObj) => billObj.billMeta?.printObj?.copies ?? "",
    },
    "print-printer": {
        label: "Print Printer",
        group: "Print",
        resolve: (billObj) => billObj.billMeta?.printObj?.printer ?? "",
    },
    "print-paper-size": {
        label: "Print Paper Size",
        group: "Print",
        resolve: (billObj) => billObj.billMeta?.printObj?.paperSize ?? "",
    },
    "print-orientation": {
        label: "Print Orientation",
        group: "Print",
        resolve: (billObj) => billObj.billMeta?.printObj?.printOrientation ?? "",
    },

    // --- Computed ---
    "gtotal-words": {
        label: "Grand Total in Words",
        group: "Computed",
        resolve: (billObj) =>
            capitalize(getAmtToWord(Math.round(billObj.billMeta?.netAmtTax)).trim()),
    },
    pan: {
        label: "Biller PAN (from GSTIN)",
        group: "Computed",
        resolve: (_b, saleConfig) => (saleConfig.gst ?? "").substring(2, 12),
    },
    "place-of-jurisdiction": {
        label: "Place of Jurisdiction",
        group: "Computed",
        resolve: () => {
            // main-only (process.presets) — designer never calls resolvers
            const place =
                typeof process !== "undefined" && process.presets
                    ? process.presets.placeOfJurisdiction
                    : "";
            if (!place) return "";
            return `Subject to ${place} Jurisdiction only.`;
        },
    },
    "sub-total": {
        label: "Sub Total (netAmt + discVal)",
        group: "Computed",
        resolve: (billObj) =>
            roundOffTo2DecimalPlace(
                (billObj.billMeta?.netAmt ?? 0) + (billObj.billMeta?.discVal ?? 0)
            ),
    },
    "total-before-tax": {
        label: "Total Before Tax",
        group: "Computed",
        resolve: (billObj) => {
            const { netAmt = 0, discVal = 0 } = billObj.billMeta ?? {};
            if (discVal >= 100) return "";
            return roundOffTo2DecimalPlace((netAmt * 100) / (100 - discVal));
        },
    },
    "total-discount": {
        label: "Total Discount",
        group: "Computed",
        resolve: (billObj) => {
            const { netAmt = 0, discVal = 0 } = billObj.billMeta ?? {};
            if (discVal >= 100) return "";
            return roundOffTo2DecimalPlace(netAmt * (100 / (100 - discVal) - 1));
        },
    },
    "scrap-tds": {
        label: "Scrap TDS (blank when 0)",
        group: "Computed",
        resolve: (billObj) => {
            const amt = billObj.billMeta?.scrapTDSAmt ?? 0;
            return amt > 0 ? roundOffTo2DecimalPlace(amt) : "";
        },
    },
    "grand-total": {
        label: "Grand Total (netAmtTax + scrapTDS)",
        group: "Computed",
        resolve: (billObj) =>
            roundOffTo2DecimalPlace(
                (billObj.billMeta?.netAmtTax ?? 0) +
                    (billObj.billMeta?.scrapTDSAmt ?? 0)
            ),
    },
};

// Palette groups derived from the registry (stable insertion order)
const VARIABLE_GROUPS = [];
const GROUP_INDEX = {};
Object.keys(VARIABLES).forEach((key) => {
    const { group } = VARIABLES[key];
    if (!(group in GROUP_INDEX)) {
        GROUP_INDEX[group] = VARIABLE_GROUPS.length;
        VARIABLE_GROUPS.push({ group, keys: [] });
    }
    VARIABLE_GROUPS[GROUP_INDEX[group]].keys.push(key);
});
const ALL_VARIABLE_KEYS = Object.keys(VARIABLES);

/** net-CGST / net-SGST / net-IGST reduced from orderItems (legacy port). */
function reducedTaxes(billObj) {
    const orderItems = billObj.orderItems ?? [];
    return orderItems.reduce(
        (acc, { rate, cgst, sgst, igst, qty, quantity = 0 }) => {
            if (!qty) qty = quantity;
            if (igst)
                acc.netIGST += roundOffTo2DecimalPlace(igst * qty * rate * 0.01);
            else {
                acc.netSGST += roundOffTo2DecimalPlace(sgst * qty * rate * 0.01);
                acc.netCGST += roundOffTo2DecimalPlace(cgst * qty * rate * 0.01);
            }
            return acc;
        },
        { netCGST: 0, netSGST: 0, netIGST: 0 }
    );
}

/** Format a resolved scalar the way it should appear on paper. */
function formatScalar(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return openFormatForDate(value);
    if (typeof value === "number") return String(roundOffTo2DecimalPlace(value));
    return String(value);
}

/**
 * Resolve a template variable key.
 * @returns {string|string[]} "" / empty array when the data is missing (never throws)
 */
function resolveVariable(key, billObj = {}, saleConfig = {}, ctx = {}) {
    const entry = VARIABLES[key];
    if (entry && typeof entry.resolve === "function") {
        const out = entry.resolve(billObj, saleConfig, ctx);
        if (Array.isArray(out)) return out;
        return formatScalar(out);
    }
    // Generic fallback: any billMeta key, even ones added after this file.
    const value = billObj.billMeta?.[key];
    if (Array.isArray(value))
        return value.map((v) => formatScalar(v)).filter((v) => v !== "");
    if (value && typeof value === "object" && !(value instanceof Date)) return "";
    return formatScalar(value);
}

/** Legacy orderItems numeric coercion (execCustomTemplate.js:13-20). */
function coerceOrderItems(orderItems) {
    orderItems.forEach((itemObj) => {
        Object.keys(itemObj).forEach((key) => {
            if (
                ["sgst", "cgst", "igst", "rate", "qty", "quantity"].includes(key) &&
                typeof itemObj[key] === "string"
            )
                itemObj[key] = Number(itemObj[key]);
        });
    });
}

/**
 * Resolve a table column variable for one item row (j is 0-based).
 * Legacy port (execCustomTemplate.js:316-341) + unit-price/amount/total.
 */
function resolveColumnVar(variable, itemObj, j, saleConfig = {}) {
    let { rate, cgst = 0, sgst = 0, igst = 0, qty } = itemObj;
    if (!qty) qty = itemObj.quantity;
    if (variable === "slno") return j + 1;
    if (variable === "unit") return itemObj.sellUnit;
    if (variable === "qty") return qty;
    if (variable === "rate") return rate;
    if (variable === "unit-price") {
        // rate × unitMap multiplier (buildPage.default.js:124-127 semantics)
        const unit = itemObj.sellUnit ?? itemObj.unit;
        const match = (saleConfig.unitMap ?? []).find((obj) => unit in obj);
        const multiplier = match ? Object.values(match)[0] : 1;
        return roundOffTo2DecimalPlace(rate * (multiplier || 1));
    }
    if (variable === "amt") return roundOffTo2DecimalPlace(rate * qty);
    if (variable === "amount") {
        const unit = itemObj.sellUnit ?? itemObj.unit;
        const match = (saleConfig.unitMap ?? []).find((obj) => unit in obj);
        const multiplier = match ? Object.values(match)[0] : 1;
        return roundOffTo2DecimalPlace(rate * (multiplier || 1) * qty);
    }
    if (variable === "netAmt")
        return roundOffTo2DecimalPlace((cgst + sgst + igst) * rate * qty * 0.01);
    if (variable === "total")
        return roundOffTo2DecimalPlace(rate * qty * (1 + (cgst + sgst + igst) / 100));
    if (["CGST", "SGST", "IGST"].includes(variable)) {
        const taxComp = itemObj[variable.toLowerCase()] ?? 0;
        return roundOffTo2DecimalPlace(taxComp * rate * qty * 0.01);
    }
    return itemObj[variable.toLowerCase()];
}

/** Ported from lib/execCustomTemplate.js:139-163 (incl. Arial->Times-Roman quirk). */
function getFont(fFamily, bold, italic) {
    if (!fFamily) fFamily = "Times-Roman";
    if (fFamily === "Arial") fFamily = "Times-Roman"; // Temporary fix
    if (fFamily === "Times-Roman") {
        if (bold && !italic) fFamily = "Times-Bold";
        else if (!bold && italic) fFamily = "Times-Italic";
        else if (bold && italic) fFamily = "Times-BoldItalic";
    } else {
        if (bold && !italic) fFamily += "-Bold";
        else if (!bold && italic) fFamily += "-Oblique";
        else if (bold && italic) fFamily += "-BoldOblique";
    }
    return fFamily;
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
    { key: "applyBorder", label: "Border", type: "checkbox", group: "Layout", default: false },
    { key: "border", label: "Border Width", type: "number", group: "Layout", default: 1, unit: "pt", min: 0, max: 10, step: 0.5 },
    { key: "background", label: "Background", type: "color", group: "Layout", default: "" },
];

const PAGE_PROPS_SCHEMA = [
    { key: "size", label: "Paper Size", type: "select", group: "Page", default: "a4", options: ["a4", "letter"] },
    { key: "margin.top", label: "Margin Top", type: "number", group: "Page", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.right", label: "Margin Right", type: "number", group: "Page", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.bottom", label: "Margin Bottom", type: "number", group: "Page", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
    { key: "margin.left", label: "Margin Left", type: "number", group: "Page", default: 0, unit: "pt", min: 0, max: 200, step: 1 },
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

    /** Designer preview element (renderer process only). */
    renderDOM(_contentWidth) {
        const el = document.createElement("div");
        el.className = "block";
        return el;
    }

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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block";
        el.textContent = this.content;
        applyDOMStyles(el, this, contentWidth);
        return el;
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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block variable-block";
        el.textContent = this.prefix + "[" + this.variable + "]" + this.suffix;
        el.dataset.placeholder = "true";
        applyDOMStyles(el, this, contentWidth);
        return el;
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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block image-block";
        el.textContent = `[${this.source} image]`;
        el.dataset.placeholder = "true";
        applyDOMStyles(el, this, contentWidth);
        return el;
    }
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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block table-block";
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        this.cols.forEach((col) => {
            const th = document.createElement("th");
            th.textContent = col.label;
            th.style.width = col.width + "%";
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        const row = document.createElement("tr");
        this.cols.forEach(() => {
            const td = document.createElement("td");
            td.textContent = "…";
            row.appendChild(td);
        });
        tbody.appendChild(row);
        table.appendChild(tbody);
        el.appendChild(table);
        applyDOMStyles(el, this, contentWidth);
        return el;
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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block totals-block";
        this.rows.forEach((row) => {
            const rowEl = document.createElement("div");
            rowEl.className = "totals-row";
            rowEl.style.textAlign = row.align;
            rowEl.textContent = row.label + ": [" + row.variable + "]";
            el.appendChild(rowEl);
        });
        applyDOMStyles(el, this, contentWidth);
        return el;
    }
}

// ---------------------------------------------------------------------------
// Sections — container blocks. Header/Body/Footer are the invoice's three
// classic sections; SectionBlock is a free custom section. All inherit
// BillSection: a block that holds child blocks plus partitions and a shape.
// ---------------------------------------------------------------------------
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
        if (data.padding === undefined) this.padding = 5;
        // Legacy parity: sections were bordered by default — a section the
        // user just added must be visible on the bill.
        if (data.applyBorder === undefined) this.applyBorder = true;
        this.name = data.name ?? "";
        this.shape = data.shape ?? "rectangle";
        this.cornerRadius = data.cornerRadius ?? 10;
        this.height = data.height ?? 0;
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

    renderDOM(contentWidth) {
        const el = document.createElement("div");
        el.className = "block section-block";
        el.dataset.blockId = this.id;
        el.dataset.shape = this.shape ?? "rectangle";
        const padding = this.padding ?? 0;
        const innerWidth = contentWidth - 2 * padding;
        el.style.padding = padding + "px";
        const chip = document.createElement("div");
        chip.className = "section-chip";
        chip.textContent = this.name || this.type;
        el.appendChild(chip);
        this.blocks.forEach((child) => {
            el.appendChild(child.renderDOM(innerWidth));
        });
        (this.partitions ?? []).forEach((p) => {
            const line = document.createElement("div");
            line.className = "partition-line";
            if (p.direction === "col") {
                line.style.left = p.range + "%";
                line.style.top = "0";
                line.style.bottom = "0";
                line.style.width = (p.lWidth || 1) + "px";
            } else {
                line.style.top = p.range + "%";
                line.style.left = "0";
                line.style.right = "0";
                line.style.height = (p.lWidth || 1) + "px";
            }
            el.appendChild(line);
        });
        applyDOMStyles(el, this, contentWidth);
        if (this.height > 0) {
            // border-box (applyDOMStyles): the outer box is this.height, and
            // the content area inside it is height - 2*padding — exactly like
            // the engine's fixed box (children at +pad, clipped at height).
            el.style.height = this.height + "px";
            el.style.overflow = "hidden";
        }
        if (this.shape === "circle" || this.shape === "ellipse") {
            el.style.borderRadius = "50%";
        } else if (this.shape === "rounded") {
            el.style.borderRadius = (this.cornerRadius ?? 10) + "px";
        }
        if (!this.applyBorder) el.dataset.plain = "true";
        return el;
    }
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

/** Shared inline-style application for the designer preview. */
function applyDOMStyles(el, block, contentWidth) {
    el.style.width = contentWidth + "px";
    el.style.boxSizing = "border-box";
    el.style.margin = `${block.margin.top}px ${block.margin.right}px ${block.margin.bottom}px ${block.margin.left}px`;
    el.style.padding = block.padding + "px";
    el.style.border = block.applyBorder
        ? `${block.border}px solid ${block.font.color || "#000"}`
        : "none";
    el.style.background = block.background || "transparent";
    el.style.textAlign = block.align;
    el.style.fontFamily = FONT_FAMILY_CSS[block.font.family] || "serif";
    el.style.fontSize = block.font.size + "px";
    el.style.fontWeight = block.font.bold ? "bold" : "normal";
    el.style.fontStyle = block.font.italic ? "italic" : "normal";
    el.style.textDecoration = block.font.underline ? "underline" : "none";
    el.style.color = block.font.color || "#000";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
class BillPage {
    constructor(data = {}) {
        this.version = 2;
        this.size = data.size ?? "a4";
        this.margin = { ...MARGIN_DEFAULTS, ...(data.margin ?? {}) };
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

    /** Factory via the type registry. */
    addBlock(type, index) {
        const Cls = BillBlock.TYPES[type];
        if (!Cls) throw new Error(`Unknown block type "${type}".`);
        const block = new Cls();
        block.font.family = this.fFamily;
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
        [this.blocks[index], this.blocks[target]] = [
            this.blocks[target],
            this.blocks[index],
        ];
    }

    removeBlock(id) {
        this.blocks = this.blocks.filter((block) => block.id !== id);
    }
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
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    resolveVariable,
    resolveColumnVar,
    getFont,
    coerceOrderItems,
    FONT_FAMILY_CSS,
    COMMON_PROPS_SCHEMA,
    PAGE_PROPS_SCHEMA,
    LEGACY_MSG,
    makeId,
    cloneObj,
    formatScalar,
    applyDOMStyles,
};
