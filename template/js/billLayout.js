/**
 * billLayout.js — the Bill Layout Designer renderer (the old designer's shell
 * rebuilt on the v2 block model).
 *
 * Three panes:
 *   1. Palette (left)  — add block types, quick-add variable blocks
 *   2. Workspace       — a CANVAS page preview laid out by lib/billCanvasPreview.js
 *   3. Properties      — generic panel driven by propsSchema
 *
 * The page model is lib/billBlockModel.js (shared with the PDF generator);
 * saving sends page.toJSON() — pure data, no DOM — through the same IPC the
 * original designer used (save-bill-template / new-template-response / etc.).
 *
 * The canvas preview mirrors the PDF engine's cursor math one-to-one (same box
 * widths, column cells, partition lines, fixed-height clipping and bottom-
 * anchored footers as lib/execBlockTemplate.js), so what you see prints exactly
 * in the same coordinates. Selection, resize grips/dots, column drags, guides,
 * the gap pill and the live bubble all work by hit-testing the layout records
 * the paint pass returns.
 *
 * Old-designer features kept on top of the v2 model: double-click drill-down,
 * corner dots on the selected section (top/left/right = margins, bottom =
 * height), gap + centre alignment guides, the old keyboard bindings (cleaned
 * of the Ctrl+Numpad double-fire), and the full v2 VARIABLES registry instead
 * of the legacy ~25 frozen fields.
 */
const { ipcRenderer } = require("electron");
const { applyTheme, toggleDevTool, showToastNotification } = require("../js/common");
const {
    BillPage,
    createInvoiceTemplate,
    STRUCTURAL_TYPES,
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    LEGACY_MSG,
} = require("../../lib/billBlockModel");
const SNAP = require("../../lib/designerSnap");
const { PAGE_SIZES, renderPreview, recordAt } = require("../../lib/billCanvasPreview");

const BLOCK_TITLES = {
    text: "Text Block",
    variable: "Variable Block",
    image: "Image Block",
    table: "Items Table",
    totals: "Totals Block",
    header: "Header Section",
    body: "Body Section",
    footer: "Footer Section",
    section: "Custom Section",
};

const $ = (sel) => document.querySelector(sel);
const pageEl = $("#page");
const pageFrame = $("#page-frame");
const emptyHint = $("#empty-hint");
const propsPanel = $("#props-panel");
const propsTitle = $("#props-title");
const blockActions = $("#block-actions");
const toastContainer = $("#toast-container");

// New templates start pre-built: Header/Body/Footer with the mandatory fields.
let page = createInvoiceTemplate();
let selectedId = null;
let zoom = 0.7;

// Drag-resize + alignment grid state
const GRID_STEP = 8; // 0.5rem grid — matches the section/page margin defaults
const MIN_SECTION_HEIGHT = 16;
const MAX_SECTION_HEIGHT = 800; // matches the schema cap
const MAX_MARGIN = 200; // pt — ceiling for the corner-dot margin drags
const GAP_PILL_RANGE = 10; // pt — show the gap readout to the nearest neighbour
let snapEnabled = true;
let drag = null; // live drag session, or null
let lastLayout = null; // layout records from the latest paint (hit-testing)
let hoveredId = null;
// transient drag readouts drawn on top of the page (cleared by renderAll)
let overlay = { guide: null, bubble: null, gapPill: null };

const ctx2d = pageEl.getContext("2d");

// ---------------------------------------------------------------------------
// Model helpers (BillPage has no getProp/setProp — handle dot paths here)
// ---------------------------------------------------------------------------
function getPath(obj, path) {
    return path
        .split(".")
        .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setPath(obj, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce(
        (acc, key) => (acc == null ? acc : acc[key]),
        obj
    );
    if (target && typeof target === "object") target[last] = value;
}

function toast(msg) {
    showToastNotification(msg, null, toastContainer);
}

// ---------------------------------------------------------------------------
// Preview — canvas paint (layout by lib/billCanvasPreview.js)
// ---------------------------------------------------------------------------
const pageSize = () => PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;

function accentColor() {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--bd-accent")
        .trim();
    return v || "#663399";
}

/** Paint the page onto the canvas. Canvas is in pt units, scaled by DPR × zoom. */
function paint() {
    const size = pageSize();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(size.w * zoom * dpr));
    const bh = Math.max(1, Math.round(size.h * zoom * dpr));
    if (pageEl.width !== bw) pageEl.width = bw;
    if (pageEl.height !== bh) pageEl.height = bh;
    pageEl.style.width = bw / dpr + "px";
    pageEl.style.height = bh / dpr + "px";
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastLayout = renderPreview(ctx2d, page, {
        grid: snapEnabled,
        selectedId,
        hoveredId,
        accent: accentColor(),
        guide: overlay.guide,
        bubble: overlay.bubble,
        gapPill: overlay.gapPill,
    });
}

/** Full repaint from the model; transient drag readouts are gone afterwards. */
function renderAll() {
    overlay = { guide: null, bubble: null, gapPill: null };
    const size = pageSize();
    pageFrame.style.width = size.w * zoom + "px";
    pageFrame.style.height = size.h * zoom + "px";
    $("#zoom-label").textContent = Math.round(zoom * 100) + "%";
    emptyHint.classList.toggle("hide", page.blocks.length > 0);
    paint();
}

// throttle preview rebuilds while dragging sliders / typing
let renderQueued = false;
function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        renderAll();
    });
}

// ---------------------------------------------------------------------------
// Drag-resize (section heights + edge dots, table columns) + alignment grids
// ---------------------------------------------------------------------------
// The snap decisions live in lib/designerSnap.js (pure, Jest-covered). Here
// we only translate pointer pixels to pt, mutate the model and repaint.
// Pointer positions are measured on the canvas, whose CSS size is size × zoom,
// so divide by zoom to get pt.

/** Pointer position in page pt. */
function ptFromEvent(e) {
    const rect = pageEl.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
    };
}

/** Grid visibility mirrors snapEnabled — the toggle button drives both. */
function syncGridUI() {
    const btn = $("#grid-toggle");
    if (btn) btn.classList.toggle("active", snapEnabled);
    renderAll(); // grid lines are painted by the canvas
}

/**
 * Which resize affordance sits under the pointer:
 * selection corner dots (selected section) → every section's bottom grip
 * (9pt strip) → table column dividers (±5pt in the header band) → null.
 */
function handleAt(pt) {
    const records = lastLayout?.records ?? [];
    if (selectedId) {
        const rec = records.find((r) => r.id === selectedId);
        if (rec && isSection(rec.block)) {
            const b = rec.box;
            const dots = [
                { tag: "top", x: b.x + b.w / 2, y: b.y + 5 },
                { tag: "bottom", x: b.x + b.w / 2, y: b.y + b.h - 5 },
                { tag: "left", x: b.x + 5, y: b.y + b.h / 2 },
                { tag: "right", x: b.x + b.w - 5, y: b.y + b.h / 2 },
            ];
            for (const d of dots) {
                if (Math.hypot(pt.x - d.x, pt.y - d.y) <= 7)
                    return { kind: "dot", tag: d.tag, block: rec.block, rec };
            }
        }
    }
    for (const r of records) {
        if (r.kind !== "section") continue;
        const b = r.box;
        if (
            pt.y >= b.y + b.h - 9 &&
            pt.y <= b.y + b.h &&
            pt.x >= b.x &&
            pt.x <= b.x + b.w
        ) {
            return { kind: "grip", block: r.block, rec: r };
        }
    }
    for (const r of records) {
        if (r.kind !== "table" || !r.colX) continue;
        for (let i = 1; i < r.colX.length - 1; i++) {
            if (
                Math.abs(pt.x - r.colX[i]) <= 5 &&
                pt.y >= r.headerY &&
                pt.y <= r.headerY + r.thHeight
            ) {
                return { kind: "col", block: r.block, rec: r, i: i - 1 };
            }
        }
    }
    return null;
}

function handleCursor(h) {
    if (!h) return "";
    if (h.kind === "grip") return "ns-resize";
    if (h.kind === "dot")
        return h.tag === "left" || h.tag === "right" ? "ew-resize" : "ns-resize";
    if (h.kind === "col") return "col-resize";
    return "";
}

/**
 * Alignment lines on both axes: page edges, content box, centre, and the
 * other sections' edges. Snapshot at dragstart — live targets would shift
 * with the dragged section's own reflow and chase the pointer. Targets use
 * {y, label} on both axes (snapY's math is axis-agnostic).
 */
function snapTargets(excludeId) {
    const size = pageSize();
    const y = [
        { y: 0, label: "page top" },
        { y: size.h, label: "page bottom" },
        { y: page.margin.top, label: "content top" },
        { y: size.h - page.margin.bottom, label: "content bottom" },
        { y: Math.round(size.h / 2), label: "page centre" },
    ];
    const x = [
        { y: 0, label: "page left" },
        { y: size.w, label: "page right" },
        { y: page.margin.left, label: "content left" },
        { y: size.w - page.margin.right, label: "content right" },
        { y: Math.round(size.w / 2), label: "page centre" },
    ];
    (lastLayout?.records ?? []).forEach((r) => {
        if (r.kind !== "section" || r.id === excludeId) return;
        const b = r.box;
        y.push({ y: Math.round(b.y), label: "section top" });
        y.push({ y: Math.round(b.y + b.h), label: "section bottom" });
        x.push({ y: Math.round(b.x), label: "section left" });
        x.push({ y: Math.round(b.x + b.w), label: "section right" });
    });
    return { x, y };
}

function startSectionResize(e, h) {
    e.preventDefault();
    e.stopPropagation();
    const b = h.rec.box;
    const origH = h.block.height;
    // auto-height sections convert to fixed on first drag, starting at their
    // rendered height (the fixed box clips its children from now on)
    const startH = origH > 0 ? origH : Math.max(Math.round(b.h), MIN_SECTION_HEIGHT);
    h.block.height = startH;
    drag = {
        kind: "section",
        block: h.block,
        origH,
        startY: e.clientY,
        startH,
        top: b.y,
        targets: snapTargets(h.block.id),
    };
    renderAll(); // fixed height now clips the children, like the PDF
    beginDrag();
}

function startDotResize(e, h) {
    e.preventDefault();
    e.stopPropagation();
    const b = h.rec.box;
    const orig = {
        marginTop: h.block.margin?.top ?? 0,
        marginLeft: h.block.margin?.left ?? 0,
        marginRight: h.block.margin?.right ?? 0,
        height: h.block.height,
    };
    drag = {
        kind: "dot",
        tag: h.tag,
        block: h.block,
        orig,
        // border-box edges at dragstart (pt): the visible box, not its margins
        top0: b.y,
        left0: b.x,
        width0: b.w,
        // dragging the top dot pins the bottom edge — an auto-height section
        // converts to fixed at its rendered height, like the bottom grip does
        baseH: orig.height > 0 ? orig.height : Math.max(Math.round(b.h), MIN_SECTION_HEIGHT),
        startX: e.clientX,
        startY: e.clientY,
        targets: snapTargets(h.block.id),
    };
    beginDrag();
}

function startColResize(e, h) {
    e.preventDefault();
    e.stopPropagation();
    // Work from the EFFECTIVE widths — a sumup column's stored width is 0 and
    // its rendered share is "whatever the fixed columns leave behind".
    const eff = SNAP.effectiveColWidths(h.block.cols);
    drag = {
        kind: "col",
        block: h.block,
        i: h.i,
        startX: e.clientX,
        tableW: Math.max(h.rec.box.w, 1),
        w0: eff[h.i],
        w1: eff[h.i + 1],
        // the stored state, so Esc can restore it exactly
        saved0: { width: h.block.cols[h.i].width, sumup: Boolean(h.block.cols[h.i].sumup) },
        saved1: { width: h.block.cols[h.i + 1].width, sumup: Boolean(h.block.cols[h.i + 1].sumup) },
        materialized: false, // sumup pair converted to fixed widths yet?
    };
    beginDrag();
}

function beginDrag() {
    document.body.classList.add("dragging");
    hoveredId = null;
    document.body.style.cursor =
        drag.kind === "dot"
            ? handleCursor(drag)
            : drag.kind === "col"
            ? "col-resize"
            : "ns-resize";
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("keydown", onDragKey);
}

function endDrag() {
    document.body.classList.remove("dragging");
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("keydown", onDragKey);
    overlay = { guide: null, bubble: null, gapPill: null };
}

function onDragMove(e) {
    if (!drag) return;
    if (drag.kind === "section") {
        const delta = (e.clientY - drag.startY) / zoom;
        const raw = Math.round(drag.startH + delta);
        const clamped = Math.min(Math.max(raw, MIN_SECTION_HEIGHT), MAX_SECTION_HEIGHT);
        const snapped = SNAP.snapY(drag.top + clamped, drag.targets.y, {
            gridStep: GRID_STEP,
            snapGrid: snapEnabled,
        });
        const h = Math.min(
            Math.max(Math.round(snapped.value - drag.top), MIN_SECTION_HEIGHT),
            MAX_SECTION_HEIGHT
        );
        drag.block.height = h;
        renderAll();
        drawGuides(snapped, "y");
        drawGapPill(drag.top + h, "below", drag.targets.y, e);
        showBubble(h + " pt", e);
        paint();
    } else if (drag.kind === "dot") {
        if (drag.tag === "top") {
            const delta = (e.clientY - drag.startY) / zoom;
            const snapped = SNAP.snapY(drag.top0 + delta, drag.targets.y, {
                gridStep: GRID_STEP,
                snapGrid: snapEnabled,
            });
            const d = Math.min(
                Math.max(snapped.value - drag.top0, -drag.orig.marginTop),
                MAX_MARGIN - drag.orig.marginTop
            );
            const marginTop = drag.orig.marginTop + d;
            const height = Math.min(
                Math.max(drag.baseH - d, MIN_SECTION_HEIGHT),
                MAX_SECTION_HEIGHT
            );
            drag.block.margin.top = marginTop;
            drag.block.height = height;
            renderAll();
            drawGuides(snapped, "y");
            drawGapPill(drag.top0 + d, "above", drag.targets.y, e);
            showBubble("gap ↑ " + Math.round(marginTop) + " pt  |  h " + height + " pt", e);
            paint();
        } else {
            const delta = (e.clientX - drag.startX) / zoom;
            const edge0 = drag.tag === "left" ? drag.left0 : drag.left0 + drag.width0;
            const snapped = SNAP.snapY(edge0 + delta, drag.targets.x, {
                gridStep: GRID_STEP,
                snapGrid: snapEnabled,
            });
            const origM = drag.tag === "left" ? drag.orig.marginLeft : drag.orig.marginRight;
            // left edge: the margin grows with the drag (box indents more);
            // right edge: the box widens to follow the pointer, so the margin
            // SHRINKS as the drag grows — both keep the edge under the pointer
            const d =
                drag.tag === "left"
                    ? Math.min(Math.max(snapped.value - edge0, -origM), MAX_MARGIN - origM)
                    : Math.min(Math.max(snapped.value - edge0, origM - MAX_MARGIN), origM);
            const m = drag.tag === "left" ? origM + d : origM - d;
            drag.block.margin[drag.tag] = m;
            renderAll();
            drawGuides(snapped, "x");
            drawGapPill(edge0 + d, drag.tag === "left" ? "left" : "right", drag.targets.x, e);
            showBubble("margin " + drag.tag + " " + Math.round(m) + " pt", e);
            paint();
        }
    } else {
        // first movement of a pair containing a sumup column: freeze the
        // "remaining space" into a real width so the drag has a fixed base
        if (!drag.materialized && (drag.saved0.sumup || drag.saved1.sumup)) {
            drag.block.cols[drag.i].sumup = false;
            drag.block.cols[drag.i + 1].sumup = false;
            drag.block.cols[drag.i].width = drag.w0;
            drag.block.cols[drag.i + 1].width = drag.w1;
            drag.materialized = true;
        }
        const deltaPct = ((e.clientX - drag.startX) / drag.tableW) * 100;
        const [w0, w1] = SNAP.resizeColPair(drag.w0, drag.w1, deltaPct);
        drag.block.cols[drag.i].width = w0;
        drag.block.cols[drag.i + 1].width = w1;
        renderAll();
        showBubble(w0.toFixed(1) + "%  |  " + w1.toFixed(1) + "%", e);
        paint();
    }
}

function onDragKey(e) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    const d = drag;
    if (d.kind === "section") {
        d.block.height = d.origH;
    } else if (d.kind === "col") {
        d.block.cols[d.i].width = d.saved0.width;
        d.block.cols[d.i].sumup = d.saved0.sumup;
        d.block.cols[d.i + 1].width = d.saved1.width;
        d.block.cols[d.i + 1].sumup = d.saved1.sumup;
    } else if (d.kind === "dot") {
        d.block.margin.top = d.orig.marginTop;
        d.block.margin.left = d.orig.marginLeft;
        d.block.margin.right = d.orig.marginRight;
        d.block.height = d.orig.height;
    }
    drag = null;
    endDrag();
    renderAll();
}

function onDragEnd() {
    const d = drag;
    if (!d) return;
    drag = null;
    endDrag();
    // rebuild from the model so props/partitions/chip all reflect the new size
    selectBlock(d.block.id);
}

function showBubble(text, e) {
    const size = pageSize();
    const pt = ptFromEvent(e);
    overlay.bubble = {
        text,
        x: Math.max(4, Math.min(pt.x + 14, size.w - 80)),
        y: pt.y + 16,
    };
}

function drawGuides(snapped, axis = "y") {
    overlay.guide = snapped.guide == null ? null : { snapped, axis };
}

/**
 * Gap readout: when a dragged edge lands within 10pt of the nearest neighbour
 * edge in the drag direction, a pill shows the distance between the two.
 * @param {number} pos dragged edge coordinate (pt)
 * @param {"above"|"below"|"left"|"right"} dir search direction
 * @param {{y: number, label?: string}[]} targets dragstart snapshot
 */
function drawGapPill(pos, dir, targets, e) {
    let bestDist = Infinity;
    for (const t of targets ?? []) {
        if (!(t.label ?? "").startsWith("section")) continue;
        const d = dir === "above" || dir === "left" ? pos - t.y : t.y - pos;
        if (d >= 0 && d <= GAP_PILL_RANGE && d < bestDist) bestDist = d;
    }
    overlay.gapPill = null;
    if (!isFinite(bestDist)) return;
    const size = pageSize();
    const pt = ptFromEvent(e);
    overlay.gapPill = {
        text: Math.round(bestDist) + " pt",
        x:
            dir === "above" || dir === "below"
                ? Math.max(4, Math.min(pt.x, size.w - 44))
                : pos + (dir === "right" ? bestDist / 2 : -bestDist / 2),
        y:
            dir === "above" || dir === "below"
                ? pos + (dir === "below" ? bestDist / 2 : -bestDist / 2)
                : Math.max(4, Math.min(pt.y, size.h - 20)),
    };
}

function selectBlock(id) {
    selectedId = id;
    renderAll();
    renderProps();
    updateContextHint();
}

// ---------------------------------------------------------------------------
// Block tree helpers (blocks live inside sections)
// ---------------------------------------------------------------------------
function isSection(block) {
    return Array.isArray(block.blocks);
}

/** Find a block anywhere in the page/section tree. */
function findBlock(id) {
    if (page.getBlock(id)) return page.getBlock(id);
    const search = (list) => {
        for (const b of list) {
            if (b.id === id) return b;
            if (Array.isArray(b.blocks)) {
                const found = search(b.blocks);
                if (found) return found;
            }
        }
        return null;
    };
    return search(page.blocks);
}

/** { container (page or section), index } for a block, so move/delete work on its parent. */
function getParentOf(id) {
    const idx = page.blocks.findIndex((b) => b.id === id);
    if (idx >= 0) return { container: page, index: idx };
    const search = (section) => {
        for (let i = 0; i < section.blocks.length; i++) {
            const b = section.blocks[i];
            if (b.id === id) return { container: section, index: i };
            if (Array.isArray(b.blocks)) {
                const found = search(b);
                if (found) return found;
            }
        }
        return null;
    };
    for (const b of page.blocks) {
        if (Array.isArray(b.blocks)) {
            const found = search(b);
            if (found) return found;
        }
    }
    return null;
}

/** Children of a section start from its font — they inherit the container. */
function inheritFromSection(block, section) {
    if (!section.font || !block.font) return;
    block.font.family = section.font.family;
    block.font.size = section.font.size;
    block.font.color = section.font.color;
}

/** Section font changed → push the change down to every child (recursive). */
function cascadeSectionFont(section) {
    (section.blocks ?? []).forEach((child) => {
        if (child.font) {
            child.font.family = section.font.family;
            child.font.size = section.font.size;
            child.font.color = section.font.color;
        }
        if (isSection(child)) cascadeSectionFont(child);
    });
}

function cascadeIfSectionFont(target, key) {
    if (key.startsWith("font.") && isSection(target))
        cascadeSectionFont(target);
}

function updateContextHint() {
    const hint = $("#context-hint");
    if (!hint) return;
    const sel = selectedId ? findBlock(selectedId) : null;
    if (sel && STRUCTURAL_TYPES.includes(sel.type)) {
        hint.textContent =
            (BLOCK_TITLES[sel.type] ?? sel.type) +
            " is a fixed section — edit or remove its fields, but the section itself stays in place.";
    } else if (sel && isSection(sel)) {
        hint.textContent =
            "Adding blocks now places them inside: " +
            (sel.name || BLOCK_TITLES[sel.type] || sel.type);
    } else if (sel) {
        const parent = getParentOf(selectedId)?.container;
        hint.textContent =
            parent && parent !== page && isSection(parent)
                ? "Adding blocks goes inside: " +
                  (parent.name || BLOCK_TITLES[parent.type] || parent.type)
                : "This block sits on the page.";
    } else {
        hint.textContent = "No block selected — new blocks go on the page.";
    }
}

// ---------------------------------------------------------------------------
// Properties panel (schema-driven)
// ---------------------------------------------------------------------------
function renderProps() {
    propsPanel.innerHTML = "";
    const block = selectedId ? findBlock(selectedId) : null;
    const target = block ?? page;
    const schema = block ? block.constructor.propsSchema : BillPage.propsSchema;
    propsTitle.textContent = block
        ? block.name || BLOCK_TITLES[block.type] || "Block"
        : "Page Settings";
    const locked = block && STRUCTURAL_TYPES.includes(block.type);
    blockActions.classList.toggle("hide", !block || locked);

    // group entries by their schema group
    const groups = {};
    schema.forEach((entry) => {
        (groups[entry.group] ??= []).push(entry);
    });
    Object.entries(groups).forEach(([group, entries]) => {
        const title = document.createElement("div");
        title.className = "props-group-title";
        title.textContent = group;
        propsPanel.appendChild(title);
        entries.forEach((entry) =>
            propsPanel.appendChild(renderEntry(entry, target))
        );
    });
}

function renderEntry(entry, target) {
    const row = document.createElement("div");
    row.className = "props-row";
    const label = document.createElement("label");
    label.textContent = entry.label;
    if (entry.unit) {
        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = "(" + entry.unit + ")";
        label.appendChild(unit);
    }
    row.appendChild(label);

    if (entry.type === "checkbox") {
        row.classList.add("row-inline");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(getPath(target, entry.key));
        input.addEventListener("change", () => {
            setPath(target, entry.key, input.checked);
            scheduleRender();
        });
        row.appendChild(input);
        return row;
    }

    if (entry.type === "color") {
        const wrap = document.createElement("div");
        wrap.className = "color-row";
        const input = document.createElement("input");
        input.type = "color";
        input.value = getPath(target, entry.key) || "#000000";
        input.addEventListener("input", () => {
            setPath(target, entry.key, input.value);
            cascadeIfSectionFont(target, entry.key);
            scheduleRender();
        });
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "color-clear";
        clear.title = "Clear (no fill)";
        clear.textContent = "✕";
        clear.addEventListener("click", () => {
            setPath(target, entry.key, "");
            scheduleRender();
            renderProps();
        });
        wrap.appendChild(input);
        wrap.appendChild(clear);
        row.appendChild(wrap);
        return row;
    }

    if (entry.type === "select") {
        const input = document.createElement("select");
        (entry.options ?? []).forEach((opt) => {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            input.appendChild(option);
        });
        input.value = getPath(target, entry.key);
        input.addEventListener("change", () => {
            setPath(target, entry.key, input.value);
            cascadeIfSectionFont(target, entry.key);
            scheduleRender();
        });
        row.appendChild(input);
        return row;
    }

    if (entry.type === "select-variable") {
        return renderVariablePicker(row, entry, target);
    }

    if (entry.type === "range" || entry.type === "number") {
        const input = document.createElement("input");
        if (entry.type === "range") {
            input.type = "range";
            const bubble = document.createElement("span");
            bubble.className = "range-value";
            const show = () =>
                (bubble.textContent = input.value + (entry.unit ? entry.unit : ""));
            show();
            input.addEventListener("input", () => {
                setPath(target, entry.key, Number(input.value));
                show();
                cascadeIfSectionFont(target, entry.key);
                scheduleRender();
            });
            row.appendChild(input);
            row.appendChild(bubble);
        } else {
            input.type = "number";
            input.addEventListener("input", () => {
                setPath(target, entry.key, Number(input.value) || 0);
                cascadeIfSectionFont(target, entry.key);
                scheduleRender();
            });
            row.appendChild(input);
        }
        if (entry.min !== undefined) input.min = entry.min;
        if (entry.max !== undefined) input.max = entry.max;
        if (entry.step !== undefined) input.step = entry.step;
        input.value = getPath(target, entry.key) ?? entry.default ?? 0;
        return row;
    }

    if (entry.type === "list") {
        row.appendChild(renderListEditor(entry, target));
        return row;
    }

    // default: text
    const input = document.createElement("input");
    input.type = "text";
    input.value = getPath(target, entry.key) ?? "";
    input.addEventListener("input", () => {
        setPath(target, entry.key, input.value);
        cascadeIfSectionFont(target, entry.key);
        scheduleRender();
    });
    row.appendChild(input);
    return row;
}

/** Select-variable: known keys grouped, plus a Custom… option (allowCustom). */
function renderVariablePicker(row, entry, target) {
    const value = getPath(target, entry.key);
    const known = ALL_VARIABLE_KEYS.includes(value);
    const wrap = document.createElement("div");
    const select = document.createElement("select");
    VARIABLE_GROUPS.forEach(({ group, keys }) => {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group;
        keys.forEach((key) => {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = VARIABLES[key]?.label ?? key;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
    if (entry.allowCustom) {
        const custom = document.createElement("option");
        custom.value = "__custom__";
        custom.textContent = "Custom…";
        select.appendChild(custom);
    }
    select.value = known ? value : "__custom__";
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.value = known || !entry.allowCustom ? "" : value;
    customInput.placeholder = "any billMeta key";
    customInput.hidden = known || !entry.allowCustom;
    select.addEventListener("change", () => {
        if (select.value === "__custom__") {
            customInput.hidden = false;
            customInput.focus();
            setPath(target, entry.key, customInput.value || "");
        } else {
            customInput.hidden = true;
            setPath(target, entry.key, select.value);
        }
        scheduleRender();
    });
    customInput.addEventListener("input", () => {
        setPath(target, entry.key, customInput.value);
        scheduleRender();
    });
    wrap.appendChild(select);
    wrap.appendChild(customInput);
    row.appendChild(wrap);
    return row;
}

/** List editor (table cols / totals rows) with add/remove per listSchema. */
function renderListEditor(entry, target) {
    const { fields, canAdd, canRemove } = entry.listSchema ?? {};
    const items = getPath(target, entry.key) ?? [];
    const wrap = document.createElement("div");
    wrap.className = "props-list";

    items.forEach((item, i) => {
        const itemEl = document.createElement("div");
        itemEl.className = "props-list-item";
        const head = document.createElement("div");
        head.className = "list-item-head";
        head.textContent = "#" + (i + 1);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "✕";
        removeBtn.title = "Remove";
        removeBtn.hidden = !canRemove;
        removeBtn.addEventListener("click", () => {
            const list = getPath(target, entry.key) ?? [];
            list.splice(i, 1);
            scheduleRender();
            renderProps();
        });
        head.appendChild(removeBtn);
        itemEl.appendChild(head);
        (fields ?? []).forEach((field) => {
            const fRow = document.createElement("div");
            fRow.className = "props-row";
            const fLabel = document.createElement("label");
            fLabel.textContent = field.label;
            fRow.appendChild(fLabel);
            if (field.type === "checkbox") {
                fRow.classList.add("row-inline");
                const check = document.createElement("input");
                check.type = "checkbox";
                check.title = field.label;
                check.checked = Boolean(item[field.key] ?? field.default ?? false);
                check.addEventListener("change", () => {
                    item[field.key] = check.checked;
                    if (field.key === "sumup" && check.checked) {
                        // one "fill the remaining space" column at a time
                        items.forEach((other, j) => {
                            if (j !== i) other.sumup = false;
                        });
                        renderProps();
                    }
                    scheduleRender();
                });
                fRow.appendChild(check);
                itemEl.appendChild(fRow);
                return;
            }
            const fWrap = document.createElement("div");
            const input = document.createElement("input");
            input.type =
                field.type === "range"
                    ? "range"
                    : field.type === "select-variable" || field.type === "select"
                    ? "hidden" // replaced below
                    : "text";
            input.min = field.min ?? 0;
            input.max = field.max ?? 100;
            input.value = item[field.key] ?? field.default ?? "";
            input.addEventListener("input", () => {
                if (input.type === "range")
                    item[field.key] = Number(input.value);
                else item[field.key] = input.value;
                scheduleRender();
            });
            fWrap.appendChild(input);
            if (field.type === "range") {
                const bubble = document.createElement("span");
                bubble.className = "range-value";
                const show = () => (bubble.textContent = input.value + (field.unit ?? "%"));
                show();
                input.addEventListener("input", show);
            }
            if (field.type === "select-variable" || field.type === "select") {
                const select = document.createElement("select");
                (field.type === "select" ? field.options ?? [] : []).forEach(
                    (opt) => {
                        const option = document.createElement("option");
                        option.value = opt;
                        option.textContent = opt;
                        select.appendChild(option);
                    }
                );
                if (field.type === "select-variable") {
                    VARIABLE_GROUPS.forEach(({ group, keys }) => {
                        const optgroup = document.createElement("optgroup");
                        optgroup.label = group;
                        keys.forEach((key) => {
                            const option = document.createElement("option");
                            option.value = key;
                            option.textContent = VARIABLES[key]?.label ?? key;
                            optgroup.appendChild(option);
                        });
                        select.appendChild(optgroup);
                    });
                }
                select.value = item[field.key] ?? field.default ?? "";
                select.addEventListener("change", () => {
                    item[field.key] = select.value;
                    scheduleRender();
                });
                fWrap.replaceChild(select, input);
            }
            fRow.appendChild(fWrap);
            itemEl.appendChild(fRow);
        });
        wrap.appendChild(itemEl);
    });

    if (canAdd) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "palette-btn props-list-add";
        addBtn.textContent = "+ Add";
        addBtn.addEventListener("click", () => {
            const list = getPath(target, entry.key) ?? [];
            const newItem = {};
            (fields ?? []).forEach((f) => (newItem[f.key] = f.default));
            list.push(newItem);
            scheduleRender();
            renderProps();
        });
        wrap.appendChild(addBtn);
    }
    return wrap;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
function fillVariablePicker() {
    const picker = $("#variable-picker");
    const datalist = $("#variable-datalist");
    VARIABLE_GROUPS.forEach(({ group, keys }) => {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group;
        keys.forEach((key) => {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = VARIABLES[key]?.label ?? key;
            optgroup.appendChild(option);
        });
        picker.appendChild(optgroup);
    });
    ALL_VARIABLE_KEYS.forEach((key) => {
        const option = document.createElement("option");
        option.value = key;
        option.label = VARIABLES[key]?.label ?? key;
        datalist.appendChild(option);
    });
}

/**
 * Add a block. Structural sections (header/body/footer) always join the page
 * at their pinned slot — one each, in order. Everything else: if a section is
 * selected the block goes inside it; if a block inside a section is selected
 * the block joins that same section. Otherwise it goes on the page. Children
 * inherit their section's font.
 */
function addBlock(type) {
    if (STRUCTURAL_TYPES.includes(type)) {
        try {
            const block = page.addBlock(type);
            selectBlock(block.id);
        } catch (err) {
            toast(err.message || "This section already exists.");
        }
        return;
    }
    const sel = selectedId ? findBlock(selectedId) : null;
    let parent = page;
    if (sel) {
        if (isSection(sel)) parent = sel;
        else parent = getParentOf(selectedId)?.container ?? page;
    }
    const block = parent.addBlock(type);
    if (parent !== page) inheritFromSection(block, parent);
    selectBlock(block.id);
}

function addVariableBlock(key) {
    key = String(key || "").trim();
    if (!key) return;
    const sel = selectedId ? findBlock(selectedId) : null;
    let parent = page;
    if (sel) {
        if (isSection(sel)) parent = sel;
        else parent = getParentOf(selectedId)?.container ?? page;
    }
    const block = parent.addBlock("variable");
    block.variable = key;
    if (parent !== page) inheritFromSection(block, parent);
    selectBlock(block.id);
}

// ---------------------------------------------------------------------------
// File IPC (same contracts as the original designer)
// ---------------------------------------------------------------------------
// Which starter template the workspace currently holds: "blank" | "sections"
// | "default1" | "default2", or null for a file opened from disk.
let currentTemplate = "sections";

function syncTemplatePicker() {
    $("#template-picker").value = currentTemplate ?? "";
}

async function loadStarterTemplate(name) {
    // The picker replaces the whole design — ask before discarding.
    try {
        const sig = await ipcRenderer.invoke("confirm-replace-template", name);
        if (!sig || sig.response !== 0) return syncTemplatePicker();
    } catch (err) {
        console.error(err);
        return syncTemplatePicker();
    }
    try {
        if (name === "blank") page = new BillPage();
        else if (name === "sections") page = createInvoiceTemplate();
        else {
            // Bundled v2 copies of the legacy Default1/Default2 layouts.
            const data = await ipcRenderer.invoke("read-bill-template", name);
            if (!data || data.error)
                throw new Error(data?.error || "Could not load template.");
            page = BillPage.fromJSON(data);
        }
        currentTemplate = name;
        selectedId = null;
        renderAll();
        renderProps();
        updateContextHint();
    } catch (err) {
        toast(err.message || "Could not load template.");
    }
    syncTemplatePicker();
}

function resetDoc() {
    page = createInvoiceTemplate();
    currentTemplate = "sections";
    selectedId = null;
    renderAll();
    renderProps();
    updateContextHint();
    syncTemplatePicker();
}

function saveAndExit() {
    ipcRenderer.send("set-app-status", "normal");
    ipcRenderer.send("save-bill-template", page.toJSON());
    // let the save dialog settle before the page unloads
    setTimeout(() => ipcRenderer.send("load-main-page"), 800);
}

function exitDesigner() {
    ipcRenderer.send("set-app-status", "normal");
    ipcRenderer.send("load-main-page");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function init() {
    // block menu shortcuts while the designer is open (legacy parity)
    ipcRenderer.send("set-app-status", "block-non-sp-key");
    toggleDevTool(document);
    ipcRenderer.invoke("init-theme").catch(() => {});
    fillVariablePicker();
    renderAll();
    renderProps();

    // palette
    document.querySelectorAll("[data-add-block]").forEach((btn) => {
        btn.addEventListener("click", () => addBlock(btn.dataset.addBlock));
    });
    $("#variable-picker").addEventListener("change", (e) => {
        if (e.target.value) addVariableBlock(e.target.value);
        e.target.value = "";
    });
    $("#add-custom-variable").addEventListener("click", () => {
        addVariableBlock($("#custom-variable").value);
        $("#custom-variable").value = "";
    });
    $("#custom-variable").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            addVariableBlock(e.target.value);
            e.target.value = "";
        }
    });

    // workspace — mousedown hit-tests the painted layout: selection chrome
    // first (dots/grip/column dividers), then the deepest block, then empty
    // paper (deselect). There is no click handler — selection happens on
    // mousedown, so drags never trigger it.
    pageEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const pt = ptFromEvent(e);
        const h = handleAt(pt);
        if (h?.kind === "grip") return startSectionResize(e, h);
        if (h?.kind === "dot") return startDotResize(e, h);
        if (h?.kind === "col") return startColResize(e, h);
        const rec = lastLayout ? recordAt(lastLayout, pt.x, pt.y) : null;
        if (rec) {
            selectBlock(rec.id);
        } else if (selectedId) {
            selectedId = null;
            renderAll();
            renderProps();
            updateContextHint();
        }
    });
    pageEl.addEventListener("mousemove", (e) => {
        if (drag) return; // drag sessions repaint themselves
        const pt = ptFromEvent(e);
        const h = handleAt(pt);
        const cursor = handleCursor(h);
        pageEl.style.cursor = cursor;
        const next = cursor
            ? null
            : (lastLayout ? recordAt(lastLayout, pt.x, pt.y) : null)?.id ?? null;
        if (next !== hoveredId) {
            hoveredId = next;
            paint(); // hover outline only — no model change
        }
    });
    pageEl.addEventListener("mouseleave", () => {
        if (hoveredId !== null) {
            hoveredId = null;
            paint();
        }
    });
    $("#zoom-out").addEventListener("click", () => {
        zoom = Math.max(0.4, Math.round((zoom - 0.1) * 100) / 100);
        renderAll();
    });
    $("#zoom-in").addEventListener("click", () => {
        zoom = Math.min(1.2, Math.round((zoom + 0.1) * 100) / 100);
        renderAll();
    });
    $("#grid-toggle").addEventListener("click", () => {
        snapEnabled = !snapEnabled;
        syncGridUI();
    });
    syncGridUI();
    $("#template-picker").addEventListener("change", (e) => {
        if (e.target.value) loadStarterTemplate(e.target.value);
    });
    syncTemplatePicker();

    // block actions — operate on the selected block's parent container
    $("#move-up").addEventListener("click", () => {
        getParentOf(selectedId)?.container?.moveBlock(selectedId, -1);
        renderAll();
    });
    $("#move-down").addEventListener("click", () => {
        getParentOf(selectedId)?.container?.moveBlock(selectedId, 1);
        renderAll();
    });
    $("#delete-block").addEventListener("click", () => {
        getParentOf(selectedId)?.container?.removeBlock(selectedId);
        selectedId = null;
        renderAll();
        renderProps();
        updateContextHint();
    });

    // file actions
    $("#save-btn").addEventListener("click", saveAndExit);
    $("#exit-btn").addEventListener("click", exitDesigner);

    // keyboard — the old designer's bindings on the v2 model, minus the
    // Ctrl+Numpad double-fire quirk: Ctrl+Shift+= / Ctrl+Shift+- zooms,
    // Ctrl+N adds a section, Ctrl+NumpadAdd/Subtract nudges the selected
    // section's height by 1pt, ArrowUp/Down nudges the top gap (flow layout
    // has no free x/y — closer to the previous element = a smaller gap),
    // Delete removes, Escape deselects.
    document.addEventListener("keydown", (e) => {
        const tag = (e.target.nodeName ?? "").toLowerCase();
        if (["input", "select", "textarea"].includes(tag)) return;
        if (e.target.isContentEditable) return;
        if (drag) return; // mid-drag keys are handled by the drag session

        if (e.ctrlKey && e.shiftKey && e.code === "Equal") {
            e.preventDefault();
            zoom = Math.min(1.2, Math.round((zoom + 0.1) * 100) / 100);
            renderAll();
            return;
        }
        if (e.ctrlKey && e.shiftKey && e.code === "Minus") {
            e.preventDefault();
            zoom = Math.max(0.4, Math.round((zoom - 0.1) * 100) / 100);
            renderAll();
            return;
        }
        if (e.ctrlKey && !e.shiftKey && e.code === "KeyN") {
            e.preventDefault();
            addBlock("section");
            return;
        }
        if (
            e.ctrlKey &&
            !e.shiftKey &&
            (e.code === "NumpadAdd" || e.code === "NumpadSubtract")
        ) {
            e.preventDefault();
            const sel = selectedId ? findBlock(selectedId) : null;
            if (!sel || !isSection(sel)) return;
            // rendered box height from the last layout (auto sections convert
            // to fixed at their drawn height, like the bottom grip does)
            const rec = lastLayout?.records.find((r) => r.id === sel.id);
            const base =
                sel.height > 0
                    ? sel.height
                    : Math.max(Math.round(rec?.box.h ?? 0), MIN_SECTION_HEIGHT);
            sel.height = Math.min(
                Math.max(base + (e.code === "NumpadAdd" ? 1 : -1), MIN_SECTION_HEIGHT),
                MAX_SECTION_HEIGHT
            );
            renderAll();
            renderProps();
            return;
        }
        if (!selectedId) return;
        const sel = findBlock(selectedId);
        const locked = sel && STRUCTURAL_TYPES.includes(sel.type);
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            if (sel?.margin) {
                sel.margin.top = Math.min(
                    Math.max((sel.margin.top ?? 0) + (e.key === "ArrowUp" ? -1 : 1), 0),
                    MAX_MARGIN
                );
            }
            renderAll();
            renderProps();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            if (locked)
                return toast(
                    "Header/Body/Footer cannot be deleted — remove their fields instead."
                );
            getParentOf(selectedId)?.container?.removeBlock(selectedId);
            selectedId = null;
            renderAll();
            renderProps();
            updateContextHint();
        } else if (e.key === "Escape") {
            selectedId = null;
            renderAll();
            renderProps();
            updateContextHint();
        }
    });

    // main-process events (menu driven — mirrors the original designer)
    ipcRenderer.on("new-template", async () => {
        try {
            const sig = await ipcRenderer.invoke("new-template-response", page.toJSON());
            if (!sig || !("response" in sig)) return console.error(sig);
            if (sig.response === 0)
                ipcRenderer.send("save-bill-template", page.toJSON());
        } catch (err) {
            console.error(err);
        }
        resetDoc();
    });

    ipcRenderer.on("set-opened-file", (_e, data, filePath) => {
        try {
            page = BillPage.fromJSON(data);
            page.newDoc = false;
            page.filePath = filePath;
            currentTemplate = null;
            selectedId = null;
            renderAll();
            renderProps();
            updateContextHint();
            syncTemplatePicker();
        } catch (err) {
            toast(err.message || LEGACY_MSG);
        }
    });

    ipcRenderer.on("save-as", () => {
        ipcRenderer.send("save-bill-template", page.toJSON(), true);
    });

    ipcRenderer.on("save-as-exit", saveAndExit);
}

ipcRenderer.on("apply-theme", (e, theme) => applyTheme.call(document, e, theme));
init();
