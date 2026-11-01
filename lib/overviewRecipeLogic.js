/**
 * overviewRecipeLogic.js — pure logic for the Overview page recipe.
 *
 * The Overview dashboard is a grid of row bands × 2 columns. A JSON recipe
 * (config/overviewRecipe.json) says which widget sits in which cell:
 *   - a cell may span the whole row ("full") or sit left/right
 *   - card widgets (monthly-sale, yearly-sale, net-turnover, net-purchase)
 *     may stack several deep inside one cell
 *   - big widgets (tables, graphs, scheduler, cloud, file-monitor) must be
 *     the only widget in their cell
 *   - any number of bands may exist but at least MIN_ROWS (1) must remain;
 *     rows are sorted and renumbered 1..N so a removed middle band leaves
 *     no gap
 *
 * No widget is resizable — the recipe only controls placement. This module
 * has no Electron/fs dependencies so it runs under jest as-is.
 */

const CARD_WIDGETS = ["monthly-sale", "yearly-sale", "net-turnover", "net-purchase"];

/** Widget registry: id → { type: "card" | "big" }. The renderer owns the
 *  same ids in its widget registry — keep the two lists in sync. */
const WIDGETS = {
    "cloud-usage": { type: "big" },
    "sale-purchase-graph": { type: "big" },
    "sale-chart": { type: "big" },
    "purchase-chart": { type: "big" },
    "order-table": { type: "big" },
    "expired-bills": { type: "big" },
    "stock-low": { type: "big" },
    "scheduler": { type: "big" },
    "file-monitor": { type: "big" },
    "sale-table": { type: "big" },
    "today-purchases": { type: "big" },
    "monthly-sale": { type: "card" },
    "yearly-sale": { type: "card" },
    "net-turnover": { type: "card" },
    "net-purchase": { type: "card" }
};

const COLS = ["full", "left", "right"];
const MIN_ROWS = 1; // at least one row band must remain

/** Default layout — the layout the user specified for the merged page. */
const DEFAULT_RECIPE = {
    version: 1,
    rows: [
        { row: 1, cells: [{ col: "full", widgets: ["cloud-usage"] }] },
        {
            row: 2,
            cells: [
                { col: "left", widgets: ["net-turnover", "net-purchase"] },
                { col: "right", widgets: ["sale-purchase-graph"] }
            ]
        },
        {
            row: 3,
            cells: [
                { col: "left", widgets: ["order-table"] },
                { col: "right", widgets: ["scheduler"] }
            ]
        }
    ]
};

/** Normalize one recipe object. Returns { ok, recipe, warnings }.
 *  Invalid structure → { ok:false }; recoverable mistakes (unknown widget
 *  ids, big widgets stacked with cards, duplicate rows) are repaired and
 *  reported in warnings instead of discarding the user's layout. */
function normalizeRecipe(recipe) {
    if (!recipe || typeof recipe !== "object" || Array.isArray(recipe))
        return { ok: false, error: "Recipe must be a JSON object." };
    if (!Array.isArray(recipe.rows))
        return { ok: false, error: "Recipe must have a rows array." };

    const warnings = [];
    const seenRows = new Set();
    const seenWidgets = new Set(); // one instance per widget id — DOM ids stay unique
    const rowsOut = [];

    recipe.rows.forEach(rawRow => {
        if (!rawRow || typeof rawRow !== "object" || !Number.isInteger(rawRow.row)) {
            warnings.push("Skipped a malformed row entry.");
            return;
        }
        if (rawRow.row < 1) {
            warnings.push(`Row ${rawRow.row} is out of range (rows start at 1) — skipped.`);
            return;
        }
        if (seenRows.has(rawRow.row)) {
            warnings.push(`Duplicate row ${rawRow.row} — keeping the first one.`);
            return;
        }
        seenRows.add(rawRow.row);

        const cells = Array.isArray(rawRow.cells) ? rawRow.cells : [];
        const normalizedCells = [];
        const fullCell = cells.find(c => c && COLS.includes(c.col) && c.col === "full");
        if (fullCell) {
            const cell = normalizeCell(fullCell, warnings, rawRow.row, seenWidgets);
            if (cell) normalizedCells.push(cell);
        } else {
            COLS.filter(col => col !== "full").forEach(col => {
                const cell = cells.find(c => c && c.col === col);
                if (!cell) return;
                const normalized = normalizeCell(cell, warnings, rawRow.row, seenWidgets);
                if (normalized) normalizedCells.push(normalized);
            });
        }
        rowsOut.push({ row: rawRow.row, cells: normalizedCells });
    });

    if (rowsOut.length === 0)
        return { ok: false, error: "Recipe must keep at least one row band." };

    // Sort then renumber 1..N so a removed middle band leaves no gap.
    rowsOut.sort((a, b) => a.row - b.row);
    rowsOut.forEach((row, i) => { row.row = i + 1; });

    const chart = sanitizeChartFill(recipe.chart);
    return { ok: true, recipe: { version: 1, rows: rowsOut, ...(chart ? { chart } : {}) }, warnings };
}

/** Optional chart gradient fill colors (customize section). Kept only when
 *  both are valid 6-digit hex colors; otherwise omitted so the renderer
 *  falls back to the defaults (series fillColor → --theme-secondary). */
function sanitizeChartFill(chart) {
    if (!chart || typeof chart !== "object") return null;
    const okHex = v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
    if (!okHex(chart.fillStart) || !okHex(chart.fillStop)) return null;
    return { fillStart: chart.fillStart, fillStop: chart.fillStop };
}

function normalizeCell(cell, warnings, rowNum, seenWidgets) {
    const rawWidgets = Array.isArray(cell.widgets) ? cell.widgets : [];
    const widgets = [];
    for (const id of rawWidgets) {
        if (typeof id !== "string") continue;
        if (!WIDGETS[id]) {
            warnings.push(`Row ${rowNum}: unknown widget "${id}" — dropped.`);
            continue;
        }
        if (widgets.includes(id)) continue; // duplicate id in the same cell
        if (seenWidgets.has(id)) {
            warnings.push(`Row ${rowNum}: widget "${id}" appears twice in the recipe — second instance dropped.`);
            continue;
        }
        const existing = widgets[0] && WIDGETS[widgets[0]];
        if (existing && (existing.type === "big" || WIDGETS[id].type === "big")) {
            warnings.push(`Row ${rowNum}: "${id}" can't share a cell with "${widgets[0]}" — dropped.`);
            continue;
        }
        widgets.push(id);
        seenWidgets.add(id);
    }
    if (widgets.length === 0) return null;
    return { col: cell.col, widgets };
}

module.exports = { WIDGETS, CARD_WIDGETS, COLS, MIN_ROWS, DEFAULT_RECIPE, normalizeRecipe };
