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
 * Render the page's blocks from blockStart downward with a y-cursor.
 * Blocks whose content resolves empty collapse entirely (no gap).
 * On overflow, a new page starts and this function re-enters itself with
 * the overflow point — headers/footers (earlier blocks) repeat on each page.
 */
async function renderPage(
    doc,
    page,
    ctx,
    { blockStart = 0, rowStart = 0 } = {}
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

    let y = top;
    for (let i = blockStart; i < page.blocks.length; i++) {
        const block = page.blocks[i];

        // Tables are laid out inline by the engine (paging needs row state)
        if (block.type === "table") {
            const result = await renderTable(
                doc,
                block,
                ctx,
                { y, left, top, contentWidth, bottomY, rowStart },
                page,
                i
            );
            if (result.pageBroken) return; // recursion handled the new page
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
                y + blockHeight + block.margin.bottom > bottomY &&
                fitsOnFreshPage
            ) {
                doc.addPage();
                ctx.pageNo++;
                await renderPage(doc, page, ctx, { blockStart: i, rowStart });
                return;
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
        const fitsOnFreshPage = top + frameHeight + block.margin.bottom <= bottomY;
        if (
            y + frameHeight + block.margin.bottom > bottomY &&
            fitsOnFreshPage
        ) {
            doc.addPage();
            ctx.pageNo++;
            await renderPage(doc, page, ctx, { blockStart: i, rowStart });
            return;
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
 * @returns {{pageBroken: boolean, nextY: number}}
 */
async function renderTable(doc, block, ctx, layout, page, blockIndex) {
    const { y: startY, left, contentWidth, bottomY, rowStart = 0 } = layout;
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
        doc.addPage();
        ctx.pageNo++;
        // Blocks before the table (headers) and after it (footers) repeat on
        // the continuation page, matching the legacy per-page header/footer.
        await renderPage(doc, page, ctx, { blockStart: 0, rowStart });
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
                doc.addPage();
                ctx.pageNo++;
                await renderPage(doc, page, ctx, { blockStart: 0, rowStart: j });
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

module.exports = { main, renderPage, renderTable, drawImage, imageDrawable };
