const { toggleDevTool, noDataPlaceholder, closeModal, createModal, applyTheme, showToastNotification } = require("../js/common");
const { ipcRenderer } = require("electron");

toggleDevTool(document);

// ==================== State ====================
let logEntries = [];
let filteredEntries = [];
let selectedLevel = "all";
let searchQuery = "";
let autoScroll = true;
let wrapText = false;
let detailPanelOpen = false;

// ==================== DOM References ====================
const tbody = document.querySelector("#log-table .tbody");
const logCountEl = document.getElementById("log-count");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const autoScrollToggle = document.getElementById("auto-scroll-toggle");
const wrapTextToggle = document.getElementById("wrap-text-toggle");
const detailPanel = document.getElementById("log-detail-panel");
const logTable = document.getElementById("log-table");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

// ==================== Initialization ====================
async function init() {
    ipcRenderer.send("get-logs");
    ipcRenderer.on("log-entries", (e, logs, isTampered) => { hydrateTable(logs, isTampered); });
    updateChipCounts();
    updateLogCount();
    updateConnectionStatus(true);
}
init();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document, null));
ipcRenderer.on("apply-theme", applyTheme.bind(document));

// ==================== Level Detection ====================
function detectLevel(entry) {
    const title = (entry.title || "").toLowerCase();
    if (/error|fail|critical/i.test(title)) return "error";
    if (/warn|warning/i.test(title))          return "warn";
    return "info";
}

// ==================== Log Entry Hydration ====================

function hydrateTable(entries, isTampered) {
    tbody.innerHTML = "";

    if (isTampered) {
        const warningRow = document.createElement("div");
        warningRow.classList.add("body", "row");
        warningRow.style.cssText = "border-left: 3px solid #F44336; background: rgba(244,67,54,0.08);";
        warningRow.innerHTML = `<p class="col eq-space" style="color:#C62828; font-weight:600; text-align:center;">
            ⚠ Log integrity check failed — tampering detected. Logs may be compromised.
        </p>`;
        tbody.appendChild(warningRow);
    }

    logEntries = entries.filter(e => e && (e.ts || e.title || e.message)); // drop empty rows
    applyFilters();
}

function createLogRow(entry, index) {
    const template = document.getElementById("log-body-row-template");
    const clone = template.content.firstElementChild.cloneNode(true);
    const level = detectLevel(entry);

    clone.setAttribute("data-level", level);
    clone.setAttribute("data-index", index);
    clone.addEventListener("click", () => openDetailPanel(entry));

    clone.querySelector('[data-colname="index"]').textContent   = index + 1;
    clone.querySelector('[data-colname="level"]').textContent    = level;
    clone.querySelector('[data-colname="timestamp"]').textContent = entry.ts || "";
    clone.querySelector('[data-colname="source"]').textContent   = entry.user || "App";
    clone.querySelector('[data-colname="message"]').textContent  = entry.message || entry.title || "";

    return clone;
}

function clearTable() {
    tbody.innerHTML = "";
}

// ==================== Filtering ====================

function filterHandler(e) {
    const chip = e.currentTarget;
    selectedLevel = chip.dataset.level;

    document.querySelectorAll("#level-filters .level-chip").forEach(c => {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
    });
    chip.classList.add("selected");
    chip.setAttribute("aria-pressed", "true");

    applyFilters();
}

function searchHandler(e) {
    searchQuery = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = searchQuery ? "inline-block" : "none";
    applyFilters();
}

function applyFilters() {
    clearTable();

    filteredEntries = logEntries.filter(entry => {
        const level = detectLevel(entry);
        if (selectedLevel !== "all" && level !== selectedLevel) return false;
        if (searchQuery) {
            const haystack = [entry.ts, entry.title, entry.message, entry.user, entry.func]
                .filter(Boolean).join(" ").toLowerCase();
            if (!haystack.includes(searchQuery)) return false;
        }
        return true;
    });

    if (filteredEntries.length === 0) {
        noDataPlaceholder(tbody);
    } else {
        filteredEntries.forEach((entry, i) => {
            tbody.appendChild(createLogRow(entry, i));
        });
    }

    updateChipCounts();
    updateLogCount();
    if (autoScroll) scrollToBottom();
}

// ==================== Row Interaction ====================

function openDetailPanel(entry) {
    const level = detectLevel(entry);
    detailPanel.querySelector('[data-field="timestamp"]').textContent = entry.ts || "";
    detailPanel.querySelector('[data-field="level"]').textContent     = level;
    detailPanel.querySelector('[data-field="source"]').textContent    = entry.user || "App";
    detailPanel.querySelector('[data-field="message"]').textContent   = entry.message || entry.title || "";

    const stackField = document.getElementById("detail-stack-field");
    const stackPre   = stackField.querySelector('[data-field="stack"]');
    if (entry.stack) {
        stackPre.textContent = entry.stack;
        stackField.style.display = "block";
    } else {
        stackField.style.display = "none";
    }

    detailPanel.classList.remove("hide");
    detailPanelOpen = true;
}

function closeDetailPanel() {
    detailPanel.classList.add("hide");
    detailPanelOpen = false;
}

// ==================== Action Handlers ====================

function actionHandler(e) {
    const cmd = e.currentTarget.dataset.cmd;
    switch (cmd) {
        case "refresh-logs":    refreshLogs();    break;
        case "export-logs":     exportLogs();     break;
        case "open-log-folder": openLogFolder();  break;
        case "download-logs":   downloadLogs();   break;
        case "clear-search":    searchInput.value = ""; searchQuery = ""; clearSearchBtn.style.display = "none"; applyFilters(); break;
    }
}

function refreshLogs() {
    clearTable();
    logEntries = [];
    filteredEntries = [];
    ipcRenderer.send("get-logs");
}

async function exportLogs() {
    const lines = filteredEntries.reduce((acc,obj)=>{
        acc+=JSON.stringify(obj)+"\n";
        return acc;
    },"");
    const result = await ipcRenderer.invoke("save-dialog", {
        defaultPath: `logs_export_${new Date().toISOString().slice(0,10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }, { name: "Text", extensions: ["txt"] }]
    });
    if (result) {
        let resp = ipcRenderer.invoke("write-file", { path: result, data: lines });
        if(resp)
            showToastNotification("Log saved to file "+result,["animation-common","move-left","blue-toast-box"])
    }
}

function openLogFolder() {
    ipcRenderer.send("open-log-folder");
}

async function downloadLogs(){
    const result = await ipcRenderer.invoke("download-missing-enc");
    if (result && result.downloaded > 0) {
        refreshLogs();  // reload the table with newly downloaded files
    }
}

// ==================== Toggle Handlers ====================

function toggleHandler(e) {
    const toggled = e.target;
    if (toggled === autoScrollToggle) {
        autoScroll = toggled.checked;
    } else if (toggled === wrapTextToggle) {
        wrapText = toggled.checked;
        logTable.classList.toggle("wrap-text", wrapText);
    }
}

// ==================== Utility Functions ====================

function updateChipCounts() {
    const counts = { all: logEntries.length, info: 0, warn: 0, error: 0 };
    logEntries.forEach(e => { counts[detectLevel(e)]++; });

    document.querySelectorAll(".chip-count").forEach(span => {
        span.textContent = counts[span.dataset.level] || 0;
    });
}

function updateLogCount() {
    const showing = filteredEntries.length;
    const total   = logEntries.length;
    logCountEl.textContent = `Showing ${showing} of ${total} log entries`;
}

function updateConnectionStatus(connected) {
    statusDot.classList.toggle("connected", connected);
    statusDot.classList.toggle("disconnected", !connected);
    statusText.textContent = connected ? "Connected" : "Disconnected";
}

function scrollToBottom() {
    if (autoScroll) {
        tbody.scrollTop = tbody.scrollHeight;
    }
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ==================== Expose to inline HTML handlers ====================
window.filterHandler      = filterHandler;
window.searchHandler      = searchHandler;
window.actionHandler      = actionHandler;
window.toggleHandler      = toggleHandler;
window.closeDetailPanel   = closeDetailPanel;
window.closeModal         = closeModal;