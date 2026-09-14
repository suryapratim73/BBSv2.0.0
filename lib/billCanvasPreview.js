/**
 * billCanvasPreview.js — canvas renderer for the Bill Layout Designer preview.
 *
 * Pure layout + painting on an injected Canvas 2D context (no DOM access, so
 * Jest runs it against a FakeCtx). The layout pass mirrors the PDF engine's
 * cursor math (lib/execBlockTemplate.js renderSection/renderChildren) one to
 * one — same box math, same column cells, same partition lines, same
 * fixed-height clipping, same footer bottom-anchoring — so the canvas shows
 * exactly what pdfkit will print, in the same coordinates. Variables, totals
 * and images draw as [key] placeholder tokens (the designer has no bill data).
 */
"use strict";

const {
    FONT_FAMILY_CSS,
    effectiveWidthOf,
    alignedLeftOf,
} = require("./billBlockModel");

const PAGE_SIZES = {
    a4: { w: 595.28, h: 841.89 },
    letter: { w: 612, h: 792 },
};

const LINE_HEIGHT = 1.2; // pdfkit currentLineHeight = fontSize × 1.2
const SAMPLE_ROWS = 1; // one "…" placeholder row under the table header

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampColumns(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 1;
}

function isSection(block) {
    return Array.isArray(block.blocks);
}

function fontString(font) {
    const family = FONT_FAMILY_CSS[font.family] || "serif";
    return (
        (font.italic ? "italic " : "") +
        (font.bold ? "bold " : "") +
        font.size +
        "px " +
        family
    );
}

function textWidth(ctx, text) {
    return ctx.measureText(String(text)).width;
}

/** Word-wrap to a width — the preview's stand-in for pdfkit's wrapping. */
function wrapLines(ctx, text, width) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const candidate = line ? line + " " + word : word;
        if (line && textWidth(ctx, candidate) > width) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
}

/** Display lines per block type ({lines, align} groups — totals has one per row). */
function previewLines(ctx, block, innerWidth) {
    if (block.type === "text") {
        // an empty text block collapses to its frame (the PDF collapses it too)
        if (!String(block.content ?? "").trim()) return [];
        return [{ lines: wrapLines(ctx, block.content, innerWidth), align: block.align }];
    }
    if (block.type === "variable") {
        const text = block.prefix + "[" + block.variable + "]" + block.suffix;
        return [{ lines: wrapLines(ctx, text, innerWidth), align: block.align }];
    }
    if (block.type === "totals") {
        return block.rows.map((row) => ({
            lines: wrapLines(
                ctx,
                (row.label ? row.label + ": " : "") + "[" + row.variable + "]",
                innerWidth
            ),
            align: row.align,
        }));
    }
    return [];
}

/** Wrapped content height of a text-like block (totals: engine's 0.3×lh row gap). */
function textLikeHeight(ctx, block, innerWidth) {
    ctx.save();
    ctx.font = fontString(block.font); // wrapping measures in the block's own font
    const groups = previewLines(ctx, block, innerWidth);
    const lh = block.font.size * LINE_HEIGHT;
    let h = 0;
    let first = true;
    for (const g of groups) {
        if (block.type === "totals" && !first) h += lh * 0.3;
        first = false;
        h += g.lines.length * lh;
    }
    ctx.restore();
    return h;
}

function tableRowHeight(block) {
    return (block.fSize ?? 16) * LINE_HEIGHT + 2 * (block.rSpacing ?? 0);
}

function tableHeight(block) {
    return (block.thHeight ?? 32) + SAMPLE_ROWS * tableRowHeight(block);
}

// ---------------------------------------------------------------------------
// Measurement (mirrors execBlockTemplate.measureChildren / sectionBoxHeight)
// ---------------------------------------------------------------------------

function measureChildren(ctx, section, innerWidth) {
    const cols = clampColumns(section.columns);
    const cellWidth = cols > 1 ? innerWidth / cols : innerWidth;
    let h = 0;
    let rowH = 0;
    for (let c = 0; c < section.blocks.length; c++) {
        const child = section.blocks[c];
        const colIdx = c % cols;
        // Field width: block.width is a % of the cell (engine parity)
        const childW = effectiveWidthOf(child, cellWidth);
        let ch;
        if (isSection(child)) {
            ch =
                (child.margin?.top ?? 0) +
                measureSection(ctx, child, childW) +
                (child.margin?.bottom ?? 0);
        } else if (child.type === "table") {
            ch =
                (child.margin?.top ?? 0) +
                tableHeight(child) +
                (child.margin?.bottom ?? 0);
        } else if (child.type === "image") {
            ch =
                (child.margin?.top ?? 0) +
                child.dimensions(
                    childW - (child.margin?.left ?? 0) - (child.margin?.right ?? 0)
                ).height +
                (child.margin?.bottom ?? 0);
        } else {
            const bw = childW - (child.margin?.left ?? 0) - (child.margin?.right ?? 0);
            const bh = textLikeHeight(ctx, child, bw - 2 * (child.padding ?? 0));
            ch = bh > 0
                ? (child.margin?.top ?? 0) + bh + 2 * (child.padding ?? 0) + (child.margin?.bottom ?? 0)
                : 0;
        }
        if (cols > 1) {
            rowH = Math.max(rowH, ch);
            if (colIdx === cols - 1 || c === section.blocks.length - 1) {
                h += rowH;
                rowH = 0;
            }
        } else {
            h += ch;
        }
    }
    return h;
}

/** Section box height — fixed height when set, else children + 2×padding. */
function measureSection(ctx, block, contentWidth) {
    if (Number(block.height) > 0) return Number(block.height);
    const pad = Number(block.padding ?? 0);
    const border = block.applyBorder ? Number(block.border ?? 0) : 0;
    const innerWidth =
        contentWidth -
        (block.margin?.left ?? 0) -
        (block.margin?.right ?? 0) -
        2 * pad -
        2 * border;
    return measureChildren(ctx, block, innerWidth) + 2 * pad;
}

// ---------------------------------------------------------------------------
// Drawing (the same order and coordinates as the engine)
// ---------------------------------------------------------------------------

function shapePath(ctx, block, x, y, w, h) {
    const shape = block.shape ?? "rectangle";
    ctx.beginPath();
    if (shape === "circle") {
        // +1 matches the engine's circle/ellipse radius (legacy parity)
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 + 1, 0, Math.PI * 2);
    } else if (shape === "ellipse") {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2 + 1, h / 2 + 1, 0, 0, Math.PI * 2);
    } else if (shape === "rounded" && ctx.roundRect) {
        ctx.roundRect(x, y, w, h, block.cornerRadius ?? 10);
    } else {
        ctx.rect(x, y, w, h);
    }
}

function strokeFrame(ctx, block, x, y, w, h) {
    if (block.applyBorder && block.border > 0) {
        ctx.save();
        ctx.lineWidth = block.border;
        ctx.strokeStyle = block.font?.color || "#000000";
        shapePath(ctx, block, x, y, w, h);
        ctx.stroke();
        ctx.restore();
    }
}

function drawPartitions(ctx, block, x, y, w, h) {
    if (!(block.partitions?.length > 0)) return;
    ctx.save();
    ctx.strokeStyle = "#000000";
    block.partitions.forEach((p) => {
        ctx.lineWidth = p.lWidth ?? 1;
        ctx.beginPath();
        if (p.direction === "col") {
            const px = x + ((p.range ?? 50) / 100) * w;
            ctx.moveTo(px, y);
            ctx.lineTo(px, y + h);
        } else {
            const py = y + ((p.range ?? 50) / 100) * h;
            ctx.moveTo(x, py);
            ctx.lineTo(x + w, py);
        }
        ctx.stroke();
    });
    ctx.restore();
}

/** Small name tag in the section's top-left corner (the old .section-chip). */
function drawChip(ctx, block, x, y, w) {
    if (w < 40) return;
    const label = block.name || block.type;
    ctx.save();
    ctx.font = "9px sans-serif";
    const tw = textWidth(ctx, label);
    ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
    ctx.fillRect(x + 2, y + 2, tw + 8, 12);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 6, y + 3);
    ctx.restore();
}

function drawTextLike(ctx, block, cellLeft, cellWidth, y, records, depth, cell) {
    y += block.margin.top;
    const bx = cellLeft + block.margin.left;
    const bw = cellWidth - block.margin.left - block.margin.right;
    const pad = block.padding ?? 0;
    const innerW = bw - 2 * pad;
    const contentH = textLikeHeight(ctx, block, innerW);
    const frameHeight = contentH + 2 * pad;
    records.push({
        id: block.id,
        kind: block.type,
        depth,
        box: { x: bx, y, w: bw, h: frameHeight },
        block,
        avail: cell, // the parent cell the width % is relative to
    });

    if (bw > 0) {
        if (block.background) {
            ctx.fillStyle = block.background;
            ctx.fillRect(bx, y, bw, frameHeight);
        }
        if (block.applyBorder && block.border > 0) {
            ctx.strokeStyle = block.font.color || "#000";
            ctx.lineWidth = block.border;
            ctx.strokeRect(bx, y, bw, frameHeight);
        }
    }
    if (bw > 0 && contentH > 0) {
        ctx.save();
        ctx.font = fontString(block.font);
        ctx.fillStyle = block.font.color || "#000";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const lh = block.font.size * LINE_HEIGHT;
        const groups = previewLines(ctx, block, innerW);
        let lineY = y + pad;
        let firstRow = true;
        for (const g of groups) {
            if (block.type === "totals" && !firstRow) lineY += lh * 0.3;
            firstRow = false;
            for (const line of g.lines) {
                const w = textWidth(ctx, line);
                const lx =
                    g.align === "center"
                        ? bx + pad + (innerW - w) / 2
                        : g.align === "right"
                        ? bx + pad + innerW - w
                        : bx + pad;
                ctx.fillText(line, lx, lineY);
                if (block.font.underline) {
                    ctx.strokeStyle = block.font.color || "#000";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(lx, lineY + lh - 1);
                    ctx.lineTo(lx + w, lineY + lh - 1);
                    ctx.stroke();
                }
                lineY += lh;
            }
        }
        ctx.restore();
    }
    return y + frameHeight + block.margin.bottom;
}

function drawImage(ctx, block, cellLeft, cellWidth, y, records, depth, cell) {
    y += block.margin.top;
    const bx = cellLeft + block.margin.left;
    const bw = cellWidth - block.margin.left - block.margin.right;
    const { width: iw, height: ih } = block.dimensions(bw);
    let drawX = bx;
    if (block.align === "center") drawX = bx + (bw - iw) / 2;
    else if (block.align === "right") drawX = bx + bw - iw;
    records.push({
        id: block.id,
        kind: "image",
        depth,
        box: { x: bx, y, w: bw, h: ih },
        block,
        avail: cell,
    });

    if (bw > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(drawX, y, iw, ih);
        ctx.setLineDash([]);
        const label = "[" + block.source + " image]";
        ctx.font = fontString(block.font);
        ctx.fillStyle = block.font.color || "#000";
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.fillText(label, drawX + iw / 2, y + ih / 2 - (block.font.size * LINE_HEIGHT) / 2);
        ctx.restore();
    }
    return y + ih + block.margin.bottom;
}

function drawTable(ctx, block, left, contentWidth, y, records, depth, cell) {
    y += block.margin.top;
    const tableLeft = left + block.margin.left;
    const tableRight = left + contentWidth - block.margin.right;
    const tableWidth = tableRight - tableLeft;
    const thHeight = block.thHeight ?? 32;
    const rowHeight = tableRowHeight(block);
    const totalH = thHeight + SAMPLE_ROWS * rowHeight;

    // Effective column geometry — a "sumup" column absorbs the remainder
    // (the engine's local math; the stored widths are untouched).
    const fixedTotal = block.cols.reduce(
        (acc, col) => acc + (col.sumup ? 0 : col.width || 0),
        0
    );
    const remainder = Math.max(1, 100 - fixedTotal);
    const widths = block.cols.map((col) => (col.sumup ? remainder : col.width || 0));
    const totalPercent = widths.reduce((acc, w) => acc + w, 0) || 100;
    const colX = [];
    let cursor = tableLeft;
    widths.forEach((w) => {
        colX.push(cursor);
        cursor += (w / totalPercent) * tableWidth;
    });
    colX.push(tableRight);

    records.push({
        id: block.id,
        kind: "table",
        depth,
        box: { x: tableLeft, y, w: tableWidth, h: totalH },
        block,
        colX,
        headerY: y,
        thHeight,
        rowHeight,
        avail: cell,
    });

    if (tableWidth <= 0) return y + block.margin.bottom;

    ctx.save();
    ctx.font = fontString({ ...block.font, size: block.fSize ?? 16 });
    ctx.fillStyle = block.font.color || "#000";
    ctx.textBaseline = "top";
    ctx.textAlign = block.align === "center" || block.align === "right" ? block.align : "left";
    const cellPadding = block.cellPadding ?? 0;
    const lh = (block.fSize ?? 16) * LINE_HEIGHT;

    if (block.drawGrid) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(tableLeft, y, tableWidth, thHeight);
        ctx.strokeRect(tableLeft, y + thHeight, tableWidth, rowHeight);
        colX.slice(1, -1).forEach((xPos) => {
            ctx.beginPath();
            ctx.moveTo(xPos, y);
            ctx.lineTo(xPos, y + totalH);
            ctx.stroke();
        });
    }
    block.cols.forEach((col, ci) => {
        const cellW = colX[ci + 1] - colX[ci];
        ctx.fillText(col.label, colX[ci] + cellPadding, y + (thHeight - lh) / 2, cellW - 2 * cellPadding);
        ctx.fillText("…", colX[ci] + cellPadding, y + thHeight + (rowHeight - lh) / 2, cellW - 2 * cellPadding);
    });
    ctx.restore();
    return y + totalH + block.margin.bottom;
}

/**
 * Render a section container: margin → box (padding insets children) →
 * children → partitions → frame. Fixed-height boxes draw their frame first
 * and clip their children, exactly like the engine's renderSection.
 */
function drawSection(ctx, block, left, top, contentWidth, bottomY, records, startY, depth, cell) {
    const pad = Number(block.padding ?? 0);
    const border = block.applyBorder ? Number(block.border ?? 0) : 0;
    const boxLeft = left + (block.margin?.left ?? 0);
    const boxWidth = contentWidth - (block.margin?.left ?? 0) - (block.margin?.right ?? 0);
    const innerLeft = boxLeft + pad;
    const innerWidth = boxWidth - 2 * pad - 2 * border;
    const boxTop = startY + (block.margin?.top ?? 0);
    const fixed = Number(block.height) > 0;

    // Degenerate box (margins wider than the content area): nothing drawable,
    // but the flow still advances (engine parity).
    if (boxWidth <= 0) {
        const h = fixed ? Number(block.height) : 0;
        records.push({
            id: block.id,
            kind: "section",
            depth,
            box: { x: boxLeft, y: boxTop, w: boxWidth, h },
            block,
            avail: cell,
        });
        return boxTop + h + (block.margin?.bottom ?? 0);
    }

    // A background needs the box height BEFORE children are painted (engine order).
    let boxHeight = null;
    if (fixed) boxHeight = Number(block.height);
    else if (block.background) boxHeight = measureChildren(ctx, block, innerWidth) + 2 * pad;

    const record = {
        id: block.id,
        kind: "section",
        depth,
        box: { x: boxLeft, y: boxTop, w: boxWidth, h: boxHeight ?? 0 },
        block,
        avail: cell,
    };
    records.push(record);

    if (block.background && boxHeight !== null) {
        ctx.save();
        ctx.fillStyle = block.background;
        shapePath(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
        ctx.fill();
        ctx.restore();
    }

    // Fixed box: frame first, then clip the children to the shape.
    if (fixed) {
        strokeFrame(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
        ctx.save();
        shapePath(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
        ctx.clip();
    }

    const innerY = flowChildren(
        ctx,
        block,
        innerLeft,
        top,
        innerWidth,
        fixed ? boxTop + boxHeight - pad : bottomY,
        records,
        boxTop + pad,
        depth + 1
    );

    if (fixed) {
        drawPartitions(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
        ctx.restore();
    } else {
        boxHeight = Math.max(innerY + pad - boxTop, 1);
        record.box.h = boxHeight;
        drawPartitions(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
        strokeFrame(ctx, block, boxLeft, boxTop, boxWidth, boxHeight);
    }
    return boxTop + boxHeight + (block.margin?.bottom ?? 0);
}

/** Children flow in rows of N equal cells; a row advances by its tallest cell. */
function flowChildren(ctx, section, left, top, contentWidth, bottomY, records, startY, depth) {
    const cols = clampColumns(section.columns);
    const cellWidth = cols > 1 ? contentWidth / cols : contentWidth;
    let y = startY;
    let rowTop = y;
    let rowH = 0;
    for (let c = 0; c < section.blocks.length; c++) {
        const block = section.blocks[c];
        const colIdx = c % cols;
        if (colIdx === 0) {
            rowTop = y;
            rowH = 0;
        } else {
            y = rowTop; // each cell renders from its row's top edge
        }
        const cellLeft = left + colIdx * cellWidth;
        // Field width: width % of the cell, positioned by align (engine parity)
        const childW = effectiveWidthOf(block, cellWidth);
        const childLeft = alignedLeftOf(block, cellLeft, cellWidth);
        const cell = { x: cellLeft, w: cellWidth };
        if (isSection(block)) {
            y = drawSection(ctx, block, childLeft, top, childW, bottomY, records, y, depth, cell);
        } else if (block.type === "table") {
            y = drawTable(ctx, block, childLeft, childW, y, records, depth, cell);
        } else if (block.type === "image") {
            y = drawImage(ctx, block, childLeft, childW, y, records, depth, cell);
        } else {
            y = drawTextLike(ctx, block, childLeft, childW, y, records, depth, cell);
        }
        rowH = Math.max(rowH, y - rowTop);
        if (colIdx === cols - 1 || c === section.blocks.length - 1) {
            y = rowTop + rowH;
        }
    }
    return y;
}

/**
 * Lay the whole page out and paint every block into ctx. Returns the layout
 * (size, margins, content box, per-block records) for hit-testing and
 * handles. Top-level footers are bottom-anchored, engine style: stacked from
 * the content bottom upward, in reverse order.
 */
function layoutPage(ctx, page) {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    const m = page.margin ?? { top: 8, right: 8, bottom: 8, left: 8 };
    const left = m.left;
    const top = m.top;
    const contentWidth = size.w - m.left - m.right;
    const bottomY = size.h - m.bottom;
    const records = [];

    let y = top;
    const cell = { x: left, w: contentWidth }; // every top-level block's cell
    for (const block of page.blocks) {
        if (block.type === "footer") continue; // bottom-anchored, drawn last
        // Field width: width % of the content box, positioned by align
        const childW = effectiveWidthOf(block, contentWidth);
        const childLeft = alignedLeftOf(block, left, contentWidth);
        if (isSection(block)) {
            y = drawSection(ctx, block, childLeft, top, childW, bottomY, records, y, 0, cell);
        } else if (block.type === "table") {
            y = drawTable(ctx, block, childLeft, childW, y, records, 0, cell);
        } else if (block.type === "image") {
            y = drawImage(ctx, block, childLeft, childW, y, records, 0, cell);
        } else {
            y = drawTextLike(ctx, block, childLeft, childW, y, records, 0, cell);
        }
    }

    const footers = page.blocks.filter((b) => b.type === "footer");
    let fy = bottomY; // bottom edge of the next footer box to place
    for (let i = footers.length - 1; i >= 0; i--) {
        const f = footers[i];
        const fw = effectiveWidthOf(f, contentWidth);
        const fl = alignedLeftOf(f, left, contentWidth);
        const h = measureSection(ctx, f, fw);
        const startY = fy - (f.margin?.top ?? 0) - h; // renderSection re-adds margin.top
        drawSection(ctx, f, fl, top, fw, bottomY, records, startY, 0, cell);
        fy = startY - (f.margin?.bottom ?? 0);
    }

    return {
        size,
        margin: m,
        contentBox: { x: left, y: top, w: contentWidth, h: bottomY - top },
        records,
    };
}

// ---------------------------------------------------------------------------
// Overlays (selection, handles, guides, readouts)
// ---------------------------------------------------------------------------

/** Deepest block whose box contains the point (children over parents). */
function recordAt(layout, x, y) {
    let best = null;
    for (const r of layout.records) {
        const b = r.box;
        if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
        if (
            !best ||
            r.depth > best.depth ||
            (r.depth === best.depth && r.box.w * r.box.h < best.box.w * best.box.h)
        ) {
            best = r;
        }
    }
    return best;
}

function drawGrid(ctx, size) {
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.04)";
    ctx.lineWidth = 1;
    for (let x = 8; x < size.w; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size.h);
        ctx.stroke();
    }
    for (let y = 8; y < size.h; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size.w, y);
        ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    for (let x = 40; x < size.w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size.h);
        ctx.stroke();
    }
    for (let y = 40; y < size.h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size.w, y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawPill(ctx, text, x, y, size) {
    ctx.save();
    ctx.font = (size === 9 ? "9px" : "11px") + " sans-serif";
    const tw = textWidth(ctx, text);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(x, y, tw + 14, size === 9 ? 15 : 20);
    ctx.fillStyle = "#f9fafb";
    ctx.textBaseline = "top";
    ctx.fillText(text, x + 7, y + (size === 9 ? 2 : 4));
    ctx.restore();
}

/** Accent-bg white-text label pill (the old .guide-label look). */
function drawLabelPill(ctx, text, x, y, accent) {
    ctx.save();
    ctx.font = "9px sans-serif";
    const tw = textWidth(ctx, text);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, tw + 10, 15);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(text, x + 5, y + 2);
    ctx.restore();
}

/** Alignment guide + label — mirrors the old drawGuides DOM overlay. */
function drawGuide(ctx, size, snapped, axis, accent) {
    if (!snapped || snapped.guide == null) return;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (snapped.label === "page centre") {
        // snapping to the centre shows the full-page crosshair
        ctx.moveTo(0, Math.round(size.h / 2));
        ctx.lineTo(size.w, Math.round(size.h / 2));
        ctx.moveTo(Math.round(size.w / 2), 0);
        ctx.lineTo(Math.round(size.w / 2), size.h);
    } else if (axis === "x") {
        ctx.moveTo(snapped.guide, 0);
        ctx.lineTo(snapped.guide, size.h);
    } else {
        ctx.moveTo(0, snapped.guide);
        ctx.lineTo(size.w, snapped.guide);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const label =
        Math.round(snapped.guide) + " pt" + (snapped.label ? " — " + snapped.label : "");
    ctx.font = "9px sans-serif";
    const tw = textWidth(ctx, label);
    if (axis === "x") {
        drawLabelPill(ctx, label, Math.max(2, snapped.guide + 6), 4, accent);
    } else {
        drawLabelPill(ctx, label, Math.max(2, size.w - tw - 18), Math.max(2, snapped.guide - 14), accent);
    }
    ctx.restore();
}

/** Selection outline + resize affordances over the selected section. */
function drawSelection(ctx, layout, selectedId, hoveredId, accent) {
    const dotColor = "#e11d48";
    const records = layout.records;
    const sel = selectedId ? records.find((r) => r.id === selectedId) : null;
    const hov = hoveredId && hoveredId !== selectedId
        ? records.find((r) => r.id === hoveredId)
        : null;

    if (hov && hov.block) {
        const b = hov.box;
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
    }

    if (!sel || !sel.block) return;
    const b = sel.box;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();

    if (isSection(sel.block)) {
        // bottom-edge grip pill (the whole 9pt strip is the drag target)
        ctx.save();
        ctx.fillStyle = accent;
        ctx.fillRect(b.x + b.w / 2 - 14, b.y + b.h - 4, 28, 3);
        // corner dots on the edge midpoints, just inside the box (the old
        // designer's adj-points — top/bottom = height, left/right = margins)
        const dots = [
            { x: b.x + b.w / 2, y: b.y + 5 },
            { x: b.x + b.w / 2, y: b.y + b.h - 5 },
            { x: b.x + 5, y: b.y + b.h / 2 },
            { x: b.x + b.w - 5, y: b.y + b.h / 2 },
        ];
        dots.forEach((d) => {
            ctx.beginPath();
            ctx.arc(d.x, d.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
        });
        ctx.restore();
    } else {
        // right-edge width handle on the vertical centreline of the box
        ctx.save();
        ctx.fillStyle = accent;
        ctx.fillRect(b.x + b.w - 4, b.y + b.h / 2 - 8, 3, 16);
        ctx.restore();
    }
}

/** Paint the page: background, grid, blocks (via layoutPage), overlays. */
function renderPreview(ctx, page, opts = {}) {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.w, size.h);
    if (page.applyBorder) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = page.border ?? 1;
        ctx.strokeRect((page.border ?? 1) / 2, (page.border ?? 1) / 2, size.w - (page.border ?? 1), size.h - (page.border ?? 1));
    }
    if (opts.grid) drawGrid(ctx, size);
    const layout = layoutPage(ctx, page);
    // section chips last (over the content, under the selection chrome)
    layout.records.forEach((r) => {
        if (r.kind === "section" && r.block) drawChip(ctx, r.block, r.box.x, r.box.y, r.box.w);
    });
    drawSelection(ctx, layout, opts.selectedId, opts.hoveredId, opts.accent || "#2563eb");
    if (opts.guide) drawGuide(ctx, size, opts.guide.snapped, opts.guide.axis, opts.accent || "#2563eb");
    if (opts.bubble) drawPill(ctx, opts.bubble.text, opts.bubble.x, opts.bubble.y, 11);
    if (opts.gapPill) drawPill(ctx, opts.gapPill.text, opts.gapPill.x, opts.gapPill.y, 9);
    ctx.restore();
    return layout;
}

module.exports = {
    PAGE_SIZES,
    layoutPage,
    renderPreview,
    recordAt,
};
