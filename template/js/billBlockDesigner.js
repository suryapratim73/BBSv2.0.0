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
    VARIABLES,
    VARIABLE_GROUPS,
    ALL_VARIABLE_KEYS,
    LEGACY_MSG,
} = require("../../lib/billBlockModel");

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
};

const $ = (sel) => document.querySelector(sel);
const pageEl = $("#page");
const pageFrame = $("#page-frame");
const emptyHint = $("#empty-hint");
const propsPanel = $("#props-panel");
const propsTitle = $("#props-title");
const blockActions = $("#block-actions");
const toastContainer = $("#toast-container");

let page = new BillPage();
let selectedId = null;
let zoom = 0.7;

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
    page.blocks.forEach((block) => {
        const el = block.renderDOM(cw);
        el.dataset.blockId = block.id;
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            selectBlock(block.id);
        });
        if (block.id === selectedId) el.classList.add("selected");
        pageEl.appendChild(el);
    });
    emptyHint.classList.toggle("hide", page.blocks.length > 0);
    updateFrame();
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

function selectBlock(id) {
    selectedId = id;
    renderAll();
    renderProps();
}

// ---------------------------------------------------------------------------
// Properties panel (schema-driven)
// ---------------------------------------------------------------------------
function renderProps() {
    propsPanel.innerHTML = "";
    const block = selectedId ? page.getBlock(selectedId) : null;
    const target = block ?? page;
    const schema = block ? block.constructor.propsSchema : BillPage.propsSchema;
    propsTitle.textContent = block ? BLOCK_TITLES[block.type] ?? "Block" : "Page Settings";
    blockActions.classList.toggle("hide", !block);

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
                scheduleRender();
            });
            row.appendChild(input);
            row.appendChild(bubble);
        } else {
            input.type = "number";
            input.addEventListener("input", () => {
                setPath(target, entry.key, Number(input.value) || 0);
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

function addBlock(type) {
    const block = page.addBlock(type);
    selectBlock(block.id);
}

function addVariableBlock(key) {
    key = String(key || "").trim();
    if (!key) return;
    const block = page.addBlock("variable");
    block.variable = key;
    selectBlock(block.id);
}

// ---------------------------------------------------------------------------
// File IPC (same contracts as the legacy designer)
// ---------------------------------------------------------------------------
function resetDoc() {
    page = new BillPage();
    selectedId = null;
    renderAll();
    renderProps();
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

    // block actions
    $("#move-up").addEventListener("click", () => {
        page.moveBlock(selectedId, -1);
        renderAll();
    });
    $("#move-down").addEventListener("click", () => {
        page.moveBlock(selectedId, 1);
        renderAll();
    });
    $("#delete-block").addEventListener("click", () => {
        page.removeBlock(selectedId);
        selectedId = null;
        renderAll();
        renderProps();
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
        if (e.key === "ArrowUp") {
            e.preventDefault();
            page.moveBlock(selectedId, -1);
            renderAll();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            page.moveBlock(selectedId, 1);
            renderAll();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            page.removeBlock(selectedId);
            selectedId = null;
            renderAll();
            renderProps();
        } else if (e.key === "Escape") {
            selectedId = null;
            renderAll();
            renderProps();
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
