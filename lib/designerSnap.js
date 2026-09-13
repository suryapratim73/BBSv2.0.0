/**
 * designerSnap.js — pure geometry helpers for the designer's drag-resize
 * interactions (renderer only).
 *
 * No DOM, no electron, no pdfkit: the snap rules live here so Jest can pin
 * them without a browser. The designer (template/js/billLayout.js) translates
 * pointer pixels to pt and drives the DOM; all the decisions below are plain
 * numbers.
 */

// 1 designer unit = 1 PDF pt.
const ALIGN_THRESHOLD = 5; // pt — alignment lines win within this
const GRID_THRESHOLD = 3; // pt — otherwise the grid snaps within this

/**
 * Snap a proposed coordinate (pt) to an alignment line first, then to the
 * grid. Alignment beats the grid when both are in range. The math is
 * axis-agnostic: the designer feeds x-axis targets through this too.
 *
 * @param {number} y proposed coordinate in pt
 * @param {{y: number, label?: string}[]} targets alignment lines to prefer
 * @param {{gridStep?: number, snapGrid?: boolean}} [opts]
 * @returns {{value: number, guide: ?number, label: string, type: ?("align"|"grid")}}
 *          value = snapped (or original) y; guide = where to draw the guide
 *          line (null = nothing snapped, no guide).
 */
function snapY(y, targets, { gridStep = 8, snapGrid = true } = {}) {
    let best = null;
    let bestDist = Infinity;
    for (const t of targets ?? []) {
        const d = Math.abs(t.y - y);
        if (d <= ALIGN_THRESHOLD && d < bestDist) {
            best = t;
            bestDist = d;
        }
    }
    if (best)
        return { value: best.y, guide: best.y, label: best.label ?? "", type: "align" };
    if (snapGrid && gridStep > 0) {
        const g = Math.round(y / gridStep) * gridStep;
        if (Math.abs(g - y) <= GRID_THRESHOLD)
            return { value: g, guide: g, label: "", type: "grid" };
    }
    return { value: y, guide: null, label: "", type: null };
}

/**
 * Shift width between two adjacent table columns without changing their
 * combined share (their sum is what the PDF engine normalizes against).
 * Returns the new pair [a, b] — callers assign. A degenerate pair (no room
 * to redistribute) comes back unchanged.
 *
 * @param {number} a0 left column's current width
 * @param {number} b0 right column's current width
 * @param {number} deltaPct how much to move from b0 to a0
 * @param {number} [min] floor per column
 * @returns {[number, number]}
 */
function resizeColPair(a0, b0, deltaPct, min = 2) {
    const sum = a0 + b0;
    if (sum < 2 * min) return [a0, b0];
    let a = a0 + deltaPct;
    let b = b0 - deltaPct;
    if (a < min) {
        a = min;
        b = sum - min;
    } else if (b < min) {
        b = min;
        a = sum - min;
    }
    return [a, b];
}

/**
 * Effective rendered widths (%) of a table's columns — the "sumup" column
 * (if any) absorbs whatever the fixed columns leave behind. Mirrors the
 * engine's width math (lib/execBlockTemplate.js) so the designer's
 * drag-resize starts from what is actually shown on the bill.
 *
 * @param {{width: number, sumup?: boolean}[]} cols
 * @returns {number[]} effective width per column (not re-normalized)
 */
function effectiveColWidths(cols) {
    const fixedTotal = (cols ?? []).reduce(
        (sum, c) => sum + (c.sumup ? 0 : Number(c.width) || 0),
        0
    );
    const remainder = Math.max(1, 100 - fixedTotal);
    return (cols ?? []).map((c) =>
        c.sumup ? remainder : Number(c.width) || 0
    );
}

module.exports = {
    snapY,
    resizeColPair,
    effectiveColWidths,
    ALIGN_THRESHOLD,
    GRID_THRESHOLD,
};
