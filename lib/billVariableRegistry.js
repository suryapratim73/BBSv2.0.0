/**
 * billVariableRegistry.js — data-driven registry of template variable keys.
 *
 * Shared by the bill layout designer (renderer process:
 *   template/js/billLayout.js -> require("../../lib/billVariableRegistry"))
 * and the legacy invoice generator (main process:
 *   lib/execCustomTemplate.js -> require("./billVariableRegistry")).
 *
 * MUST stay free of top-level `electron` / `pdfkit` / browser-only requires.
 * Main-only helpers (getBillNo) are require()d lazily INSIDE resolver bodies,
 * which only the main-process renderer ever calls.
 *
 * The designer palette shows these groups/keys as labeled options PLUS a
 * free-text picker for anything else. The PDF generator resolves ANY key not
 * listed here through the generic fallback: billMeta[key]. That is the
 * "new billMeta key becomes printable in every template with zero code
 * changes" guarantee — registry entries only add labels/formatting.
 *
 * resolve(billObj, saleConfig, ctx) -> string | string[] | "" (missing).
 * ctx = { pageNo, captionIndex } supplied by the renderer.
 */
const {
    roundOffTo2DecimalPlace,
    capitalize,
    getAmtToWord,
    openFormatForDate,
} = require("../template/js/common");

// ---------------------------------------------------------------------------
// Variable registry
// ---------------------------------------------------------------------------
const VARIABLES = {
    // --- Bill ---
    // billNo / netAmt / netAmtTax use legacyScalar (Math.round for numbers)
    // so templates saved with the old designer print byte-identically
    // (execCustomTemplate.js default case rounded every number).
    billNo: {
        label: "Bill No",
        group: "Bill",
        resolve: (billObj) => legacyScalar(billObj.billMeta?.billNo),
    },
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
    netAmt: {
        label: "Net Amount",
        group: "Bill",
        resolve: (billObj) => legacyScalar(billObj.billMeta?.netAmt),
    },
    netTax: { label: "Net Tax", group: "Bill" },
    netAmtTax: {
        label: "Net Amount + Tax",
        group: "Bill",
        resolve: (billObj) => legacyScalar(billObj.billMeta?.netAmtTax),
    },
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
        // Legacy reduce (execCustomTemplate.js): "n1/n2/…" with a plain
        // string fallback for non-array phones.
        resolve: (_b, saleConfig) => {
            const phones = saleConfig.phones;
            if (typeof phones === "string") return phones;
            return (phones ?? []).reduce((acc, num, i, self) => {
                if (i < self.length - 1) acc += num + "/";
                else acc += num;
                return acc;
            }, "");
        },
    },
    "biller-email": {
        label: "Biller E-mail",
        group: "Biller",
        resolve: (_b, saleConfig) => saleConfig.email ?? "",
    },
    "biller-bank": {
        label: "Biller Bank Details (all)",
        group: "Biller",
        // Legacy line set ("Bank Details: …", "Account No: …", "IFSC …")
        // in legacy order (bankDetails reversed), without mutating the config.
        resolve: (_b, saleConfig) =>
            (saleConfig.bankDetails ?? [])
                .slice()
                .reverse()
                .flatMap((info) => [
                    `Bank Details: ${info.bank}`,
                    `Bank Details: ${info.branch}`,
                    `Account No: ${info.accNo}`,
                    `IFSC ${info.ifsc}`,
                ]),
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
 * Legacy default-case scalar (execCustomTemplate.js): numbers print as
 * Math.round — used for billNo / netAmt / netAmtTax so old templates print
 * byte-identically.
 */
function legacyScalar(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(Math.round(value));
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

module.exports = {
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    reducedTaxes,
    formatScalar,
    legacyScalar,
    resolveVariable,
    coerceOrderItems,
    resolveColumnVar,
    getFont,
};
