/**
 * execBlockTemplate.js — the single block-based invoice renderer (v2).
 *
 * ONE generator, MANY layouts: takes the entire billObj and draws whatever
 * the template's blocks reference. Replaces the per-template hardcoded
 * generators when the migration flips (user templates with version:2 route
 * here today; bundled defaults/v1 stay on the legacy path until verified).
 *
 * Requires NO pdfkit at the top level — the PDFDocument is injected, so the
 * engine is testable with a FakeDoc. Main-only helpers (emblemMaker, dialog)
 * are require()d lazily inside the branches that need them.
 *
 * Sections: Header/Body/Footer/Custom Section blocks are containers that
 * hold child blocks. Header and Footer repeat on every page (like the
 * legacy per-page header/footer); Body and custom sections flow and page-
 * break. A continuation carries a childStart PATH (one index per nesting
 * level) plus a table rowStart, so a table deep inside sections resumes at
 * exactly the right row after a page break.
 */
const fs = require("fs");
const path = require("path");
const {
    BillPage,
    resolveColumnVar,
    coerceOrderItems,
    getFont,
    formatScalar,
} = require("./billBlockModel");

const SECTION_TYPES = new Set(["header", "body", "footer", "section"]);

/**
 * Draw every caption copy of the bill.
 * @param {PDFDocument} doc        injected pdfkit document (piped to pdfPath by initBillPDF)
 * @param {string} pdfPath         output file path (returned to the caller)
 * @param {object} billObj         full bill object (billMeta/customer/orderItems/payment)
 * @param {object} template        plain v2 template JSON (version:2, blocks[])
 * @param {object} [saleConfig]    saleConfig.json content
 * @returns {Promise<string>} pdfPath
 */
async function main(doc, pdfPath, billObj, template, saleConfig = {}) {
    const page = template instanceof BillPage ? template : BillPage.fromJSON(template);
    const billMeta = billObj.billMeta ?? {};
    coerceOrderItems(billObj.orderItems ?? []);
    const captions =
        billMeta.printObj?.captions?.length
            ? billMeta.printObj.captions
            : ["Original Buyer's Copy"];

    for (let captionIndex = 0; captionIndex < captions.length; captionIndex++) {
        if (captionIndex > 0) doc.addPage();
        const ctx = {
            billObj,
            saleConfig,
            pageNo: 1,
            captionIndex,
        };
        await renderPage(doc, page, ctx, { blockStart: 0, rowStart: 0 });
    }
    doc.end();
    return pdfPath;
}

/**
 * Render the page's blocks downward with a y-cursor. Blocks whose content
 * resolves empty collapse entirely (no gap). On overflow a new page starts
 * and this function re-enters itself at the overflow point — blocks before
 * it (headers) and after it (footers) repeat on each page.
 *
 * @param {object} opts
 *   blockStart — top-level block index to start from (0 repeats headers)
 *   rowStart   — table row to resume (continuation of a broken table)
 *   childStart — section continuation PATH, e.g. [1, 2] = top-level block 1
 *                is a section, resume at its child 2 (may nest deeper)
 */
async function renderPage(
    doc,
    page,
    ctx,
    { blockStart = 0, rowStart = 0, childStart = [] } = {}
) {
    const { width, height } = doc.page;
    const left = page.margin.left;
    const right = page.margin.right;
    const top = page.margin.top;
    const bottom = page.margin.bottom;
    const contentWidth = width - left - right;
    const bottomY = height - bottom;

    // Page border
    if (page.applyBorder && page.border > 0) {
        const bw = page.border;
        doc.save();
        doc.lineWidth(bw);
        doc.rect(bw / 2, bw / 2, width - bw, height - bw);
        doc.stroke();
        doc.restore();
    }

    // Default document font (saleConfig, as the legacy generators used it)
    if (ctx.saleConfig?.defaultFontFamily)
        doc.font(ctx.saleConfig.defaultFontFamily);
    if (ctx.saleConfig?.defaultFontSize)
        doc.fontSize(ctx.saleConfig.defaultFontSize);

    // Top-level footer sections are bottom-anchored on EVERY page — including
    // pages where the body table breaks mid-way (legacy absolute-footer
    // parity). The main walk skips them; drawFooters stacks them at the
    // bottom, and onPageEnd hooks page breaks so the finished page gets its
    // footer before the cursor moves on.
    const footers = page.blocks.filter((b) => b.type === "footer");
    const footerReserve = footers.reduce((acc, f) => {
        return (
            acc +
            sectionBoxHeight(doc, f, ctx, contentWidth) +
            (f.margin?.top ?? 0) +
            (f.margin?.bottom ?? 0)
        );
    }, 0);
    const mainBottomY = bottomY - footerReserve;

    const drawFooters = async () => {
        let fy = bottomY; // bottom edge of the next footer box to place
        for (let i = footers.length - 1; i >= 0; i--) {
            const f = footers[i];
            const h = sectionBoxHeight(doc, f, ctx, contentWidth);
            const mt = f.margin?.top ?? 0;
            const mb = f.margin?.bottom ?? 0;
            const startY = fy - mt - h; // renderSection re-adds margin.top
            await renderSection(
                doc,
                f,
                ctx,
                {
                    y: startY,
                    left,
                    top,
                    contentWidth,
                    bottomY: Infinity,
                    rowStart: 0,
                },
                page,
                [],
                [page.blocks.indexOf(f)]
            );
            fy = startY - mb; // stack the next footer above this one
        }
    };

    // childStart is a continuation PATH — its first element is the top-level
    // block to resume. blockStart says where to begin iterating (0 = repeat
    // headers, the resume block renders fresh on the new page).
    await renderChildren(doc, page, page.blocks, ctx, {
        y: top,
        left,
        top,
        contentWidth,
        bottomY: mainBottomY,
        from: blockStart,
        contPath: childStart,
        rowStart,
        absPath: [],
        // top-level break: re-enter from block 0 so headers repeat, resume
        // the broken child via childStart
        breakPage: (childIdx, rs) => ({
            blockStart: 0,
            childStart: [childIdx],
            rowStart: rs,
        }),
        // every page gets its bottom-anchored footer before a break moves on
        onPageEnd: drawFooters,
        isRepeat: false,
    });
    // final page of this caption — footer drawn at the bottom
    await drawFooters();
}

/**
 * Render blocks[] downward with a y-cursor — the shared layout walk used by
 * both the page and sections. Returns { pageBroken, nextY }.
 *
 * layout fields:
 *   y/left/top/contentWidth/bottomY — cursor + geometry
 *   from     — first child index to render (page level: blockStart, so
 *              headers repeat; section level: contPath[0], so already-drawn
 *              children are skipped on continuation pages)
 *   contPath — continuation path relative to blocks[] (empty = fresh start)
 *   rowStart — pending table continuation row (consumed by the first table
 *              or continuation section that claims it)
 *   absPath  — this container's path inside the outermost section (breaks
 *              build childStart paths from it)
 *   breakPage(childIdx, rowStart) -> renderPage opts for a break at childIdx
 *   onPageEnd — awaited just before any page break (page-level footer hook)
 *   isRepeat — header/footer: never page-break, draw anyway
 */
async function renderChildren(doc, page, blocks, ctx, layout) {
    const {
        y: startY,
        left,
        top,
        contentWidth,
        bottomY,
        from = 0,
        contPath = [],
        rowStart = 0,
        absPath = [],
        breakPage = (childIdx, rs) => ({ blockStart: childIdx, rowStart: rs }),
        isRepeat = false,
    } = layout;
    let pendingRowStart = rowStart;
    let y = startY;

    for (let c = from; c < blocks.length; c++) {
        const block = blocks[c];

        // Top-level footer sections are bottom-anchored by renderPage —
        // they never participate in the flow walk. Nested footers flow.
        if (block.type === "footer" && absPath.length === 0) continue;

        // Sections: containers laid out by renderSection
        if (SECTION_TYPES.has(block.type)) {
            const isTarget = c === contPath[0];
            const rs = isTarget ? pendingRowStart : 0;
            if (isTarget) pendingRowStart = 0;
            const cont2 = isTarget ? contPath.slice(1) : [];
            const result = await renderSection(
                doc,
                block,
                ctx,
                { y, left, top, contentWidth, bottomY, rowStart: rs },
                page,
                cont2,
                [...absPath, c]
            );
            if (result.pageBroken) return result;
            y = result.nextY;
            continue;
        }

        // Tables are laid out inline by the engine (paging needs row state)
        if (block.type === "table") {
            const rs = pendingRowStart;
            pendingRowStart = 0;
            const result = await renderTable(
                doc,
                block,
                ctx,
                {
                    y,
                    left,
                    top,
                    contentWidth,
                    bottomY,
                    rowStart: rs,
                    breakPage: (row) => breakPage(c, row),
                    onPageEnd: layout.onPageEnd,
                },
                page,
                c
            );
            if (result.pageBroken) return result;
            y = result.nextY;
            continue;
        }

        // Images draw via the engine (emblem/seal gates + file resolution)
        if (block.type === "image") {
            if (!imageDrawable(block, ctx)) continue; // gate off → collapse
            y += block.margin.top;
            const blockHeight = block.measure(doc, contentWidth, ctx);
            const fitsOnFreshPage =
                top + blockHeight + block.margin.bottom <= bottomY;
            if (
                !isRepeat &&
                y + blockHeight + block.margin.bottom > bottomY &&
                fitsOnFreshPage
            ) {
                await layout.onPageEnd?.();
                doc.addPage();
                ctx.pageNo++;
                await renderPage(doc, page, ctx, breakPage(c, pendingRowStart));
                return { pageBroken: true, nextY: y };
            }
            await drawImage(doc, block, left, y, contentWidth, ctx);
            y += blockHeight + block.margin.bottom;
            continue;
        }

        // Text-like blocks: collapse when empty, measure, page-break, draw
        if (typeof block.isEmpty === "function" && block.isEmpty(ctx)) continue;
        const blockHeight = block.measure(doc, contentWidth, ctx);
        if (!(blockHeight > 0)) continue;
        y += block.margin.top;
        const frameHeight = blockHeight + 2 * (block.padding ?? 0);
        // A block taller than a full page is drawn anyway (no infinite re-page)
        const fitsOnFreshPage =
            top + frameHeight + block.margin.bottom <= bottomY;
        if (
            !isRepeat &&
            y + frameHeight + block.margin.bottom > bottomY &&
            fitsOnFreshPage
        ) {
            await layout.onPageEnd?.();
            doc.addPage();
            ctx.pageNo++;
            await renderPage(doc, page, ctx, breakPage(c, pendingRowStart));
            return { pageBroken: true, nextY: y };
        }
        await drawBlockFrame(doc, block, left, y, contentWidth, frameHeight);
        await block.renderPDF(
            doc,
            left + (block.padding ?? 0),
            y + (block.padding ?? 0),
            contentWidth - 2 * (block.padding ?? 0),
            ctx
        );
        y += frameHeight + block.margin.bottom;
    }
    return { pageBroken: false, nextY: y };
}

/**
 * Render a section container: margin → box (padding insets children) →
 * children via renderChildren → partitions → border/shape frame.
 * Header/footer sections never page-break (they repeat per page); body and
 * custom sections page-break, carrying contPath + rowStart forward.
 *
 * absPath is this section's path inside the page — element 0 is the section's
 * own top-level block index, so breaks can address it as blockStart.
 */
async function renderSection(doc, block, ctx, layout, page, contPath = [], absPath = []) {
    const { y: startY, left, top, contentWidth, bottomY, rowStart = 0 } = layout;
    const isRepeat = block.type === "header" || block.type === "footer";
    // Section padding is a single number (like every block's padding) — it
    // insets children on all four sides of the box.
    const pad = Number(block.padding ?? 0);
    const innerLeft = left + pad;
    const innerWidth = contentWidth - 2 * pad;
    const shape = block.shape ?? "rectangle";
    const fixed = Number(block.height) > 0;

    // Shape path helper — pdfkit shape methods build a path without painting,
    // so the same helper serves clip, background fill and border stroke.
    const shapePath = (x, y, w, h) => {
        if (shape === "circle")
            return doc.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2 + 1);
        if (shape === "ellipse")
            return doc.ellipse(x + w / 2, y + h / 2, w / 2 + 1, h / 2 + 1);
        if (shape === "rounded")
            return doc.roundedRect(x, y, w, h, block.cornerRadius ?? 10);
        return doc.rect(x, y, w, h);
    };

    const boxTop = startY + (block.margin?.top ?? 0);

    // Exact pre-measure so a background can be painted UNDER the children.
    // Table height is deterministic (fixed row heights), so this matches the
    // cursor math of the real render pass.
    let boxHeight = null;
    if (fixed) {
        boxHeight = Number(block.height);
    } else if (block.background) {
        boxHeight =
            measureChildren(doc, block, ctx, innerWidth, contPath, rowStart) +
            2 * pad;
    }

    if (block.background && boxHeight !== null) {
        doc.save();
        doc.fillColor(block.background);
        shapePath(left, boxTop, contentWidth, boxHeight);
        doc.fill();
        doc.restore();
    }

    // Children — clipped to the shape when a fixed height is set
    let y = boxTop + pad;
    const renderInner = () =>
        renderChildren(doc, page, block.blocks, ctx, {
            y,
            left: innerLeft,
            top,
            contentWidth: innerWidth,
            // header/footer never page-break — their content is drawn with
            // an effectively infinite page height
            bottomY: isRepeat ? Infinity : bottomY,
            // continuation pages skip children already drawn (no repeat of
            // body content — only the page-level header/footer repeats)
            from: contPath[0] ?? 0,
            contPath,
            rowStart,
            absPath,
            // thread the page-level footer hook through nesting levels, so a
            // break deep inside this section still finishes the page's footer
            onPageEnd: layout.onPageEnd,
            // Page walk restarts from block 0 so header-zone blocks repeat;
            // childStart (built from absPath) marks the exact resume point.
            breakPage: (childIdx, rs) => ({
                blockStart: 0,
                childStart: [...absPath, childIdx],
                rowStart: rs,
            }),
            isRepeat,
        });

    let result;
    if (fixed) {
        doc.save();
        shapePath(left, boxTop, contentWidth, boxHeight);
        doc.clip();
        result = await renderInner();
        if (result.pageBroken) {
            // The break added a new page; the matching restore must NOT be
            // emitted there. Leaving the save open on the finished page is
            // safe (an unmatched "q" at page end resets with the page), while
            // an unmatched "Q" on the new page would corrupt its content.
            return result;
        }
        drawPartitions(doc, block, left, boxTop, contentWidth, boxHeight);
        doc.restore();
    } else {
        result = await renderInner();
        y = result.nextY + pad;
    }
    if (result.pageBroken) return result;

    // Auto-height box: whatever the children actually consumed
    if (boxHeight === null) boxHeight = Math.max(y - boxTop, 1);
    if (!fixed)
        drawPartitions(doc, block, left, boxTop, contentWidth, boxHeight);

    // Border/shape frame on top of the content
    if (block.applyBorder && block.border > 0) {
        doc.save();
        doc.lineWidth(block.border);
        doc.strokeColor(block.font?.color || "#000000");
        shapePath(left, boxTop, contentWidth, boxHeight);
        doc.stroke();
        doc.restore();
    }

    return {
        pageBroken: false,
        nextY: boxTop + boxHeight + (block.margin?.bottom ?? 0),
    };
}

/**
 * Height of a section box — fixed height when set, otherwise the exact
 * measured height of its children plus padding. Deterministic, so it matches
 * the cursor math of the real render pass (used to reserve footer space and
 * to anchor footers at the page bottom).
 */
function sectionBoxHeight(doc, block, ctx, contentWidth) {
    if (Number(block.height) > 0) return Number(block.height);
    const pad = Number(block.padding ?? 0);
    return (
        measureChildren(doc, block, ctx, contentWidth - 2 * pad, [], 0) +
        2 * pad
    );
}

/** Divider lines inside a section (legacy partitionObj: direction/range). */
function drawPartitions(doc, block, x, y, w, h) {    if (!(block.partitions?.length > 0)) return;
    doc.save();
    doc.strokeColor("#000000");
    block.partitions.forEach((p) => {
        doc.lineWidth(p.lWidth ?? 1);
        if (p.direction === "col") {
            const px = x + ((p.range ?? 50) / 100) * w;
            doc.moveTo(px, y);
            doc.lineTo(px, y + h);
        } else {
            const py = y + ((p.range ?? 50) / 100) * h;
            doc.moveTo(x, py);
            doc.lineTo(x + w, py);
        }
        doc.stroke();
    });
    doc.restore();
}

/**
 * Exact height of a section's children (tables included) — used to size an
 * auto-height background box before the children are painted. Mirrors the
 * cursor math of renderChildren: margins + content (+ padding for frames).
 */
function measureChildren(doc, section, ctx, contentWidth, contPath, rowStart) {
    const childStart = contPath[0] ?? 0;
    let h = 0;
    for (let c = childStart; c < section.blocks.length; c++) {
        const child = section.blocks[c];
        if (child.type === "table") {
            const font = getFont(
                child.font.family,
                child.font.bold,
                child.font.italic
            );
            doc.font(font).fontSize(child.fSize ?? 12);
            const lineHeight =
                doc.currentLineHeight() || (child.fSize ?? 12) * 1.2;
            const rowHeight = lineHeight + 2 * (child.rSpacing ?? 0);
            const items = ctx.billObj.orderItems ?? [];
            const rs =
                c === childStart && contPath.length === 1 ? rowStart : 0;
            h +=
                (child.margin?.top ?? 0) +
                (child.thHeight ?? 0) +
                Math.max(items.length - rs, 0) * rowHeight +
                (child.margin?.bottom ?? 0);
            continue;
        }
        if (SECTION_TYPES.has(child.type)) {
            const cont2 = c === childStart ? contPath.slice(1) : [];
            const childPad = Number(child.padding ?? 0);
            const inner = measureChildren(
                doc,
                child,
                ctx,
                contentWidth - 2 * childPad,
                cont2,
                rowStart
            );
            h +=
                (child.margin?.top ?? 0) +
                childPad +
                inner +
                childPad +
                (child.margin?.bottom ?? 0);
            continue;
        }
        if (child.type === "image") {
            if (!imageDrawable(child, ctx)) continue;
            const ih = child.measure(doc, contentWidth, ctx) ?? 0;
            h += (child.margin?.top ?? 0) + ih + (child.margin?.bottom ?? 0);
            continue;
        }
        if (typeof child.isEmpty === "function" && child.isEmpty(ctx)) continue;
        const bh = child.measure(doc, contentWidth, ctx) ?? 0;
        if (!(bh > 0)) continue;
        h +=
            (child.margin?.top ?? 0) +
            bh +
            2 * (child.padding ?? 0) +
            (child.margin?.bottom ?? 0);
    }
    return h;
}

/** Border + background frame around a block's content area. */
async function drawBlockFrame(doc, block, x, y, contentWidth, frameHeight) {
    if (block.background) {
        doc.save();
        doc.fillColor(block.background);
        doc.rect(x, y, contentWidth, frameHeight);
        doc.fill();
        doc.restore();
    }
    if (block.applyBorder && block.border > 0) {
        doc.save();
        doc.lineWidth(block.border);
        doc.strokeColor(block.font?.color || "#000000");
        doc.rect(x, y, contentWidth, frameHeight);
        doc.stroke();
        doc.restore();
    }
}

/** Emblem/seal gate + main-process file resolution (legacy applyEmblem port). */
function imageDrawable(block, ctx) {
    const saleConfig = ctx.saleConfig ?? {};
    const gate =
        block.source === "emblem"
            ? "applyEmblem"
            : block.source === "seal"
            ? "applySeal"
            : null;
    if (!gate) return false;
    if (saleConfig.billTemplate?.[gate] !== true) return false;
    return Boolean(saleConfig.billTemplate?.[block.source]);
}

async function drawImage(doc, block, x, y, contentWidth, ctx) {
    const saleConfig = ctx.saleConfig ?? {};
    const file = saleConfig.billTemplate?.[block.source];
    if (!file) return;
    // Legacy parity: emblem/seal paths resolve relative to scripts/
    const filePath = path.resolve(__dirname, "../scripts", file);
    if (!fs.existsSync(filePath)) {
        const { dialog } = require("electron");
        if (dialog?.showErrorBox)
            dialog.showErrorBox(
                "File desn't exist",
                filePath +
                    " path doesn't exist. Try resetting " +
                    block.source +
                    "."
            );
        return;
    }
    const { emblemMaker } = require("./common");
    const imgDataURL = await emblemMaker(filePath, block.imgOpacity);
    const { width: imgWidth, height: imgHeight } = block.dimensions(contentWidth);
    let drawX = x;
    if (block.align === "center") drawX = x + (contentWidth - imgWidth) / 2;
    else if (block.align === "right") drawX = x + contentWidth - imgWidth;
    doc.image(imgDataURL, drawX, y, { width: imgWidth, height: imgHeight });
}

/**
 * Draw the table starting at rowStart; re-enter renderPage on page break.
 * layout.breakPage(row) builds the continuation opts (page-level breaks
 * restart from block 0 so headers repeat; section-level breaks carry a
 * childStart path to the table).
 * @returns {{pageBroken: boolean, nextY: number}}
 */
async function renderTable(doc, block, ctx, layout, page, blockIndex) {
    const { y: startY, left, contentWidth, bottomY, rowStart = 0 } = layout;
    const breakPage =
        layout.breakPage ??
        ((row) => ({ blockStart: 0, childStart: [0], rowStart: row }));
    let y = startY + block.margin.top;
    const { cols, thHeight, fSize, rSpacing, cellPadding, drawGrid } = block;
    const font = getFont(block.font.family, block.font.bold, block.font.italic);
    doc.font(font).fontSize(fSize);
    const lineHeight = doc.currentLineHeight() || fSize * 1.2;
    const rowHeight = lineHeight + 2 * rSpacing;
    const orderItems = ctx.billObj.orderItems ?? [];

    // Column geometry
    const totalPercent = cols.reduce((acc, col) => acc + (col.width || 0), 0) || 100;
    const colX = [];
    let cursor = left;
    cols.forEach((col) => {
        colX.push(cursor);
        cursor += ((col.width || 0) / totalPercent) * contentWidth;
    });
    const tableRight = left + contentWidth;
    const tableLeft = left;

    const drawRowGrid = (rowY, height) => {
        if (!drawGrid) return;
        doc.save();
        doc.strokeColor("#000000");
        doc.lineWidth(1);
        doc.rect(tableLeft, rowY, contentWidth, height);
        doc.stroke();
        doc.restore();
    };

    const drawHeader = () => {
        const headerY = y;
        cols.forEach((col, ci) => {
            const cellWidth = colX[ci + 1] !== undefined ? colX[ci + 1] - colX[ci] : tableRight - colX[ci];
            doc.fillColor(block.font.color);
            doc.text(col.label, colX[ci] + cellPadding, headerY + (thHeight - lineHeight) / 2, {
                width: cellWidth - 2 * cellPadding,
                align: block.align,
                ellipsis: true,
            });
        });
        drawRowGrid(headerY, thHeight);
        y += thHeight;
    };

    // Not enough room for the header + first row on this page?
    // (a header taller than a full page is drawn anyway — no infinite re-page)
    const headerFits =
        layout.top + block.margin.top + thHeight + rowHeight <= bottomY;
    if (y + thHeight + rowHeight > bottomY && headerFits) {
        await layout.onPageEnd?.(); // finished page gets its footer
        doc.addPage();
        ctx.pageNo++;
        // Blocks before the table (headers) and after it (footers) repeat on
        // the continuation page, matching the legacy per-page header/footer.
        await renderPage(doc, page, ctx, breakPage(rowStart));
        return { pageBroken: true, nextY: y };
    }

    drawHeader();

    for (let j = rowStart; j < orderItems.length; j++) {
        if (y + rowHeight > bottomY) {
            // A row taller than a full page is drawn anyway (clipped) so the
            // loop always makes progress.
            const rowFitsFresh =
                layout.top + block.margin.top + thHeight + rowHeight <= bottomY;
            if (rowFitsFresh) {
                await layout.onPageEnd?.(); // finished page gets its footer
                doc.addPage();
                ctx.pageNo++;
                await renderPage(doc, page, ctx, breakPage(j));
                return { pageBroken: true, nextY: y };
            }
        }
        const rowY = y;
        cols.forEach((col, ci) => {
            const value = formatScalar(
                resolveColumnVar(col.variable, orderItems[j], j, ctx.saleConfig)
            );
            const cellWidth = colX[ci + 1] !== undefined ? colX[ci + 1] - colX[ci] : tableRight - colX[ci];
            doc.fillColor(block.font.color);
            doc.text(value, colX[ci] + cellPadding, rowY + rSpacing, {
                width: cellWidth - 2 * cellPadding,
                align: block.align,
                ellipsis: true,
            });
        });
        drawRowGrid(rowY, rowHeight);
        y += rowHeight;
    }

    // Vertical column lines
    if (drawGrid) {
        doc.save();
        doc.strokeColor("#000000");
        doc.lineWidth(1);
        colX.slice(1).forEach((xPos) => {
            doc.moveTo(xPos, startY + block.margin.top);
            doc.lineTo(xPos, y);
        });
        doc.stroke();
        doc.restore();
    }

    return { pageBroken: false, nextY: y + block.margin.bottom };
}

module.exports = {
    main,
    renderPage,
    renderChildren,
    renderSection,
    renderTable,
    measureChildren,
    sectionBoxHeight,
    drawImage,
    imageDrawable,
};
