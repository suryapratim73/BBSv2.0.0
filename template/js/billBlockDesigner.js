/**
 * billBlockDesigner.js — the v2 Bill Layout Designer renderer.
 *
 * Three panes:
 *   1. Palette (left)  — add block types, quick-add variable blocks
 *   2. Workspace       — scaled page preview built from block.renderDOM()
 *   3. Properties      — generic panel driven by propsSchema
 *
 * The page model is lib/billBlockModel.js (shared with the PDF generator).
 * Saving sends page.toJSON() — pure data, no DOM — through the same IPC the
 * legacy designer used (save-bill-template / new-template-response / etc.).
 */
const { ipcRenderer } = require("electron");
const { applyTheme, toggleDevTool, showToastNotification } = require("../js/common");
const {
    BillPage,
    BillBlock,
    createInvoiceTemplate,
    STRUCTURAL_TYPES,
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    LEGACY_MSG,
} = require("../../lib/billBlockModel");
const SNAP = require("../../lib/designerSnap");

// 1 designer unit = 1 PDF pt; the preview renders pt-as-px, then scales.
const PAGE_SIZES = {
    a4: { w: 595.28, h: 841.89 },
    letter: { w: 612, h: 792 },
};
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
let snapEnabled = true;
let drag = null; // live drag session, or null
let suppressClickOnce = false; // swallow the mouseup→click pair after a drag

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
// Preview
// ---------------------------------------------------------------------------
function contentWidth() {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    return size.w - page.margin.left - page.margin.right;
}

function updateFrame() {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    pageFrame.style.width = size.w * zoom + "px";
    pageFrame.style.height = size.h * zoom + "px";
    pageEl.style.transform = `scale(${zoom})`;
    $("#zoom-label").textContent = Math.round(zoom * 100) + "%";
}

function renderAll() {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    const { margin } = page;
    const cw = size.w - margin.left - margin.right;
    pageEl.style.width = size.w + "px";
    pageEl.style.height = size.h + "px";
    pageEl.style.padding = `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`;
    pageEl.style.border = page.applyBorder
        ? `${page.border}px solid #000`
        : "none";
    pageEl.innerHTML = "";
    // Top-level footers are bottom-anchored in the PDF — draw them last in
    // the preview too, whatever their array position.
    const topBlocks = page.blocks.filter((b) => b.type !== "footer");
    const bottomBlocks = page.blocks.filter((b) => b.type === "footer");
    [...topBlocks, ...bottomBlocks].forEach((block) => {
        pageEl.appendChild(renderBlockEl(block, cw));
    });
    emptyHint.classList.toggle("hide", page.blocks.length > 0);
    ensureOverlays();
    attachResizeHandles();
    updateFrame();
}

/**
 * Build a block's preview element and wire it up recursively. Sections
 * contain children — clicks on a child select the child (stopPropagation),
 * clicks on the section's own padding/frame select the section.
 */
function renderBlockEl(block, cw) {
    const el = block.renderDOM(cw);
    el.dataset.blockId = block.id;
    const chip = el.querySelector(".section-chip");
    if (chip) chip.textContent = block.name || BLOCK_TITLES[block.type] || block.type;
    el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (suppressClickOnce) {
            // the mouseup of a drag — selecting again would just re-render
            suppressClickOnce = false;
            return;
        }
        selectBlock(block.id);
    });
    if (Array.isArray(block.blocks)) {
        const innerWidth = cw - 2 * (block.padding ?? 0);
        block.blocks.forEach((child) => {
            const childEl = el.querySelector(`:scope > [data-block-id="${child.id}"]`);
            if (childEl)
                childEl.replaceWith(renderBlockEl(child, innerWidth));
        });
    }
    if (block.id === selectedId) el.classList.add("selected");
    return el;
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
// Drag-resize (section heights, table columns) + alignment grids
// ---------------------------------------------------------------------------
// The snap decisions live in lib/designerSnap.js (pure, Jest-covered). Here
// we only translate pointer pixels to pt and drive the preview DOM. Pointer
// positions are measured on the transformed #page, so divide by zoom to get
// pt; everything inside #page is laid out in pt-as-px and scales together.

/** Grid visibility mirrors snapEnabled — the toggle button drives both. */
function syncGridUI() {
    pageEl.classList.toggle("show-grid", snapEnabled);
    const btn = $("#grid-toggle");
    if (btn) btn.classList.toggle("active", snapEnabled);
}

/** Guide lines + live size bubble are wiped by renderAll's innerHTML reset. */
function ensureOverlays() {
    if (!pageEl.querySelector("#guide-layer")) {
        const layer = document.createElement("div");
        layer.id = "guide-layer";
        pageEl.appendChild(layer);
    }
    if (!pageEl.querySelector("#live-bubble")) {
        const bubble = document.createElement("div");
        bubble.id = "live-bubble";
        bubble.hidden = true;
        pageEl.appendChild(bubble);
    }
}

/** Grip on every section's bottom edge; dividers on table column headers. */
function attachResizeHandles() {
    pageEl.querySelectorAll(".section-block").forEach((el) => {
        const block = findBlock(el.dataset.blockId);
        if (!block || !isSection(block)) return;
        const handle = document.createElement("div");
        handle.className = "resize-handle";
        handle.title = "Drag to resize the section height";
        handle.addEventListener("mousedown", (e) => startSectionResize(e, block, el));
        el.appendChild(handle);
    });
    pageEl.querySelectorAll(".table-block").forEach((el) => {
        const block = findBlock(el.dataset.blockId);
        if (!block || block.type !== "table") return;
        const ths = el.querySelectorAll("thead th");
        ths.forEach((th, i) => {
            if (i >= ths.length - 1) return; // last column: no divider after it
            const handle = document.createElement("div");
            handle.className = "col-handle";
            handle.title = "Drag to resize the column";
            handle.addEventListener("mousedown", (e) => startColResize(e, block, i, th));
            th.appendChild(handle);
        });
    });
}

/** Alignment lines: page edges, content box, centre, neighbouring sections. */
function snapTargets(excludeId) {
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    const pageRect = pageEl.getBoundingClientRect();
    const targets = [
        { y: 0, label: "page top" },
        { y: size.h, label: "page bottom" },
        { y: page.margin.top, label: "content top" },
        { y: size.h - page.margin.bottom, label: "content bottom" },
        { y: Math.round(size.h / 2), label: "page centre" },
    ];
    // snapshot at dragstart — live targets would shift with the dragged
    // section's own reflow and chase the pointer
    pageEl.querySelectorAll(".section-block").forEach((el) => {
        if (el.dataset.blockId === excludeId) return;
        const top = (el.getBoundingClientRect().top - pageRect.top) / zoom;
        targets.push({ y: Math.round(top), label: "section top" });
        targets.push({ y: Math.round(top + el.offsetHeight), label: "section bottom" });
    });
    return targets;
}

function startSectionResize(e, block, el) {
    e.preventDefault();
    e.stopPropagation();
    const pageRect = pageEl.getBoundingClientRect();
    const top = (el.getBoundingClientRect().top - pageRect.top) / zoom;
    const origH = block.height;
    // auto-height sections convert to fixed on first drag, starting at their
    // rendered height
    const startH = origH > 0 ? origH : Math.max(Math.round(el.offsetHeight), MIN_SECTION_HEIGHT);
    block.height = startH;
    drag = {
        kind: "section",
        block,
        el,
        origH,
        startY: e.clientY,
        startH,
        top,
        targets: snapTargets(block.id),
    };
    el.style.overflow = "hidden"; // live phase clips like the final fixed box
    beginDrag();
}

function startColResize(e, block, i, th) {
    e.preventDefault();
    e.stopPropagation();
    const table = th.closest("table");
    const tableRect = table.getBoundingClientRect();
    drag = {
        kind: "col",
        block,
        i,
        startX: e.clientX,
        tableW: Math.max(tableRect.width / zoom, 1),
        w0: block.cols[i].width,
        w1: block.cols[i + 1].width,
        ths: Array.from(table.querySelectorAll("thead th")),
    };
    beginDrag();
}

function beginDrag() {
    document.body.classList.add("dragging");
    document.body.style.cursor = drag.kind === "col" ? "col-resize" : "ns-resize";
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
    const bubble = pageEl.querySelector("#live-bubble");
    if (bubble) bubble.hidden = true;
    const layer = pageEl.querySelector("#guide-layer");
    if (layer) layer.innerHTML = "";
}

function onDragMove(e) {
    if (!drag) return;
    if (drag.kind === "section") {
        const delta = (e.clientY - drag.startY) / zoom;
        const raw = Math.round(drag.startH + delta);
        const clamped = Math.min(Math.max(raw, MIN_SECTION_HEIGHT), MAX_SECTION_HEIGHT);
        const snapped = SNAP.snapY(drag.top + clamped, drag.targets, {
            gridStep: GRID_STEP,
            snapGrid: snapEnabled,
        });
        const h = Math.min(
            Math.max(Math.round(snapped.value - drag.top), MIN_SECTION_HEIGHT),
            MAX_SECTION_HEIGHT
        );
        drag.block.height = h;
        drag.el.style.height = h + "px";
        drawGuides(snapped);
        showBubble(h + " pt", e);
    } else {
        const deltaPct = ((e.clientX - drag.startX) / drag.tableW) * 100;
        const [w0, w1] = SNAP.resizeColPair(drag.w0, drag.w1, deltaPct);
        drag.block.cols[drag.i].width = w0;
        drag.block.cols[drag.i + 1].width = w1;
        drag.ths[drag.i].style.width = w0 + "%";
        drag.ths[drag.i + 1].style.width = w1 + "%";
        showBubble(w0.toFixed(1) + "%  |  " + w1.toFixed(1) + "%", e);
    }
}

function onDragKey(e) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    const d = drag;
    if (d.kind === "section") d.block.height = d.origH;
    else {
        d.block.cols[d.i].width = d.w0;
        d.block.cols[d.i + 1].width = d.w1;
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
    suppressClickOnce = true;
    // the click event fires synchronously right after mouseup — clear the flag
    // afterwards so a click landing outside the dragged element isn't eaten
    setTimeout(() => {
        suppressClickOnce = false;
    }, 0);
    // rebuild from the model so props/partitions/chip all reflect the new size
    selectBlock(d.block.id);
}

function showBubble(text, e) {
    const bubble = pageEl.querySelector("#live-bubble");
    if (!bubble) return;
    const size = PAGE_SIZES[page.size] ?? PAGE_SIZES.a4;
    const pageRect = pageEl.getBoundingClientRect();
    bubble.textContent = text;
    bubble.style.left =
        Math.max(4, Math.min((e.clientX - pageRect.left) / zoom + 14, size.w - 80)) + "px";
    bubble.style.top = (e.clientY - pageRect.top) / zoom + 16 + "px";
    bubble.hidden = false;
}

function drawGuides(snapped) {
    const layer = pageEl.querySelector("#guide-layer");
    if (!layer) return;
    layer.innerHTML = "";
    if (snapped.guide == null) return;
    const line = document.createElement("div");
    line.className = "guide-line";
    line.style.top = snapped.guide + "px";
    layer.appendChild(line);
    const label = document.createElement("div");
    label.className = "guide-label";
    label.style.top = Math.max(2, snapped.guide - 14) + "px";
    label.textContent =
        Math.round(snapped.guide) + " pt" + (snapped.label ? " — " + snapped.label : "");
    layer.appendChild(label);
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
// File IPC (same contracts as the legacy designer)
// ---------------------------------------------------------------------------
function resetDoc() {
    page = createInvoiceTemplate();
    selectedId = null;
    renderAll();
    renderProps();
    updateContextHint();
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

    // workspace
    pageEl.addEventListener("click", (e) => {
        if (e.target === pageEl && selectedId) {
            selectedId = null;
            renderAll();
            renderProps();
        }
    });
    $("#zoom-out").addEventListener("click", () => {
        zoom = Math.max(0.4, Math.round((zoom - 0.1) * 100) / 100);
        updateFrame();
    });
    $("#zoom-in").addEventListener("click", () => {
        zoom = Math.min(1.2, Math.round((zoom + 0.1) * 100) / 100);
        updateFrame();
    });
    $("#grid-toggle").addEventListener("click", () => {
        snapEnabled = !snapEnabled;
        syncGridUI();
    });
    syncGridUI();

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

    // keyboard: reorder / delete when a block is selected
    document.addEventListener("keydown", (e) => {
        const tag = (e.target.nodeName ?? "").toLowerCase();
        if (["input", "select", "textarea"].includes(tag)) return;
        if (e.target.isContentEditable) return;
        if (!selectedId) return;
        const sel = findBlock(selectedId);
        const locked = sel && STRUCTURAL_TYPES.includes(sel.type);
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (locked)
                return toast(
                    "Header/Body/Footer stay in place — reorder their fields instead."
                );
            getParentOf(selectedId)?.container?.moveBlock(selectedId, -1);
            renderAll();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (locked)
                return toast(
                    "Header/Body/Footer stay in place — reorder their fields instead."
                );
            getParentOf(selectedId)?.container?.moveBlock(selectedId, 1);
            renderAll();
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

    // main-process events (menu driven — mirrors billLayout.js)
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
            selectedId = null;
            renderAll();
            renderProps();
            updateContextHint();
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
