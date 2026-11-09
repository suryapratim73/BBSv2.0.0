/**
 * overviewPage.js — recipe-driven renderer for the merged Overview dashboard.
 *
 * The page is a grid of row bands × 2 columns (at least 1 band — the
 * customize editor lets the user add or remove bands). config/overviewRecipe.json
 * (served by get-overview-recipe / saved by save-overview-recipe) says which
 * widget sits in which cell; this file builds the DOM from the recipe and
 * wires every widget's data. Widgets are NOT resizable — the recipe only
 * controls placement.
 *
 * Widgets reuse the shared helpers of common.js (bodyRow, noDataPlaceholder,
 * drawLineGraph) and the styles of common.css + the ov-* classes added to
 * mainPage.css.
 */

// NOTE: classic scripts share one global scope — mainPage.js (loaded first)
// already declares ipcRenderer, showToastNotification, hslComponents and
// lightenHSL, so this file must NOT redeclare them (const collision).
const { bodyRow, noDataPlaceholder, drawLineGraph, attachChartTooltip, smoothMoveUpDownAnimation } = require("../js/common");

const PAGE_SIZE = 5; // order table entries per page

let widgetData = null;   // get-overview-widget-data payload (cards + chart series)
let ordersCache = [];    // get-orders payload
let orderPageIndex = 1;  // 1-based page of the order table
let expiredBillPageIndex = 1;  // 1-based page of the order table
let chartSeq = 0;        // unique canvas ids per chart instance
let chartFill = { start: "", stop: "" }; // chart gradient fill colors from the customize section ("" → defaults)
const mountedCharts = [];// { selector, draw } — redrawn on window resize
let fileMonitorOn = false;

// ---------------------------------------------------------------------------
// small helpers

function fmtMoney(n) {
    return "Rs. " + (Number(n) || 0).toLocaleString("en-IN");
}

function ageText(minutes) {
    if (minutes < 60) return minutes + " min ago";
    const h = Math.floor(minutes / 60);
    if (h < 24) return h + " h ago";
    return Math.floor(h / 24) + " d ago";
}

function toast(msg, error = false) {
    showToastNotification(msg, ["animation-common", "move-left", error ? "red-toast-box" : "blue-toast-box"], "main");
}

/** removeAllElem from common.js is document-scoped — this one is host-scoped
 *  so multiple widgets never clear each other's rows. */
function clearHost(host, selector) {
    if(host)
        host.querySelectorAll(selector).forEach(node => node.remove());
}

/** host-scoped copy of common.js tableFillupHelper (which is document-scoped) */
function tableFillup(host, arr, key) {
    if(!host) return;
    const cols = [...host.querySelectorAll(".row.head .col>p")].map(p => p.dataset.col);
    const tbody = host.querySelector(".tbody");
    if(tbody)
        arr.forEach((obj, index) => tbody.appendChild(bodyRow({ key, obj, cols, index })));
}

function fillTableOrPlaceholder(host, arr, key) {
    const tbody = host.querySelector(".tbody");
    clearHost(tbody, ".no-data");
    clearHost(tbody, "div.body.row");
    if (arr.length > 0)
        tableFillup(host, arr, key);
    else
        noDataPlaceholder(tbody);
}

// ---------------------------------------------------------------------------
// chart widgets

function chartBox(title) {
    const div = document.createElement("div");
    div.className = "ov-chart";
    div.innerHTML = `
        <div>
            <h3>${title}</h3>
            <canvas></canvas>
        </div>
        <div>
            <label>Change chart period</label>
            <select tabindex="0">
                <option value="year" data-mode="3">Year</option>
                <option value="month" data-mode="2" selected>Month</option>
            </select>
        </div>`;
    return div;
}

// attachChartTooltip moved to common.js — shared with salePage's 6-month rate graph.

/** Factory for sale/purchase line charts. getSeries(mode) returns the
 *  multi-series array drawLineGraph expects. */
function makeChartWidget(title, getSeries) {
    return {
        type: "big",
        label: title,
        build(host) {
            const box = chartBox(title);
            host.appendChild(box);
            const canvas = box.querySelector("canvas");
            const seq = ++chartSeq;
            canvas.id = `ov-chart-${seq}`;
            const selector = `#ov-chart-${seq}`;
            let mode = 2; // default period: monthly (no daily option on the overview charts)
            const draw = () => {
                const series = getSeries(mode);
                // real grand total of the plotted period (percentage-scaling denominator, kept for later)
                const total = series.reduce((s, sr) => s + (sr.data || []).reduce((a, o) => a + (o.amt || 0), 0), 0);
                const res = drawLineGraph(total, series, selector, "green", "red", {
                    mode, useGradient: true,
                    gradientStart: chartFill.start, // "" → series fillColor
                    gradientStop: chartFill.stop,   // "" → --theme-secondary
                });
                attachChartTooltip(res, canvas);
                if (canvas.width !== Math.round(0.95 * canvas.parentNode.clientWidth))
                    setTimeout(draw, 0);
            };
            box.querySelector("select").addEventListener("change", e => {
                mode = Number(e.target.querySelector(`[value="${e.target.value}"]`).dataset.mode);
                draw();
            });
            this._draw = draw;
            mountedCharts.push({ selector, draw });
        },
        init() { if (this._draw) this._draw(); }
    };
}

function saleSeries() {
    return [{ data: widgetData ? widgetData.saleObjs : [], lineColor: "green", fillColor: "green", label: "Sale" }];
}
function purchaseSeries() {
    return [{ data: widgetData ? widgetData.purchaseObjs : [], lineColor: "red", fillColor: "red", label: "Purchase" }];
}
function combinedSeries() {
    return [
        { data: widgetData ? widgetData.saleObjs : [], lineColor: "green", fillColor: "green", label: "Sale" },
        { data: widgetData ? widgetData.purchaseObjs : [], lineColor: "red", fillColor: "red", label: "Purchase" }
    ];
}

// ---------------------------------------------------------------------------
// card widgets

function makeCardWidget(label, valueKey, subLabel) {
    return {
        type: "card",
        label,
        build(host) {
            host.innerHTML = `
                <h4>${label}</h4>
                <p class="ov-card-value">—</p>
                <p class="ov-card-sub">${subLabel}</p>`;
        },
        init(host) {
            const value = widgetData ? widgetData[valueKey] : null;
            let _card = host.querySelector(".ov-card-value");
            if(_card)
                _card.textContent = fmtMoney(value);
        }
    };
}

// ---------------------------------------------------------------------------
// table widgets (order table, expired bills, stock low, sale table, purchases)

function tableShell(headCols) {
    const div = document.createElement("div");
    div.className = "table ov-table";
    div.innerHTML = `
        <div class="row head">
            ${headCols.map(c => `<div class="col eq-space"><p data-col="${c.id}">${c.label}</p></div>`).join("")}
        </div>
        <div class="tbody hide-scrollbar"></div>`;
    return div;
}

function renderOrdersPage(tableEl) {// issue
    if(!tableEl) return;
    const host = tableEl.closest(".ov-widget");
    const tbody = tableEl.querySelector(".tbody");
    clearHost(tbody, ".no-data");
    clearHost(tbody, "div.body.row");
    const total = ordersCache.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    orderPageIndex = Math.min(orderPageIndex, pages);
    const slice = ordersCache.slice((orderPageIndex - 1) * PAGE_SIZE, orderPageIndex * PAGE_SIZE);
    if (slice.length === 0)
        noDataPlaceholder(tbody);
    else
        tableFillup(tableEl, slice, "orderObj");
    const info = host.querySelector(".ov-page-info");
    if (info) info.textContent = total === 0 ? "No orders" : `Page ${orderPageIndex} of ${pages} · ${total} order${total === 1 ? "" : "s"}`;
    const prevBtn = host.querySelector("[data-cmd='prev']");
    const nextBtn = host.querySelector("[data-cmd='next']");
    if (prevBtn) prevBtn.disabled = orderPageIndex <= 1;
    if (nextBtn) nextBtn.disabled = orderPageIndex >= pages;
}

const widgets = {
    // ---- big widgets ----

    "cloud-usage": {
        type: "big",
        label: "BBS Cloud usage",
        build(host) {
            host.innerHTML = `
                <div class="ov-cloud">
                    <div class="ov-cloud-stat">
                        <h4>Available credit balance</h4>
                        <p class="ov-card-value" data-field="credit">—</p>
                    </div>
                    <div class="ov-cloud-stat">
                        <h4>Credit validity</h4>
                        <p class="ov-card-value" data-field="credit">—</p>
                    </div>
                    <div class="ov-cloud-stat">
                        <h4>Emails sent</h4>
                        <p class="ov-card-value" data-field="emails">—</p>
                    </div>
                    <div class="ov-cloud-stat">
                        <h4>Active subscription</h4>
                        <p class="ov-card-value" data-field="subscription">—</p>
                    </div>
                    <div class="ov-cloud-stat">
                        <h4>Subscription validity</h4>
                        <p class="ov-card-value" data-field="subscriptionExpiry">—</p>
                    </div>
                    <div class="ov-cloud-side">
                        <button class="main-ui-btn hover" data-cmd="cloud-refresh" data-msg="Refresh cloud usage" tabindex="0"><i class="fa-solid fa-rotate"></i></button>
                        <button class="main-ui-btn hover" data-cmd="open-cloud" data-msg="Open BBS Cloud" tabindex="0">BBS Cloud</button>
                        <p class="ov-cloud-note"></p>
                    </div>
                </div>`;
            host.querySelector("[data-cmd='cloud-refresh']").addEventListener("click", () => loadCloudUsage(host));
            host.querySelector("[data-cmd='open-cloud']").addEventListener("click", () => {
                document.querySelector('#nav-div [data-cmd="cloud"]').click();
            });
        },
        init(host) { return loadCloudUsage(host); }
    },

    "sale-purchase-graph": makeChartWidget("Sale & Purchase chart", combinedSeries),
    "sale-chart": makeChartWidget("Sale chart", saleSeries),
    "purchase-chart": makeChartWidget("Purchase chart", purchaseSeries),

    "order-table": {
        type: "big",
        label: "Unbilled orders",
        build(host) {
            host.innerHTML = `<h3>Unbilled orders</h3>`;
            host.appendChild(tableShell([
                { id: "slNo", label: "Sl No" },
                { id: "billDate", label: "Date" },
                { id: "name", label: "Customer Name" },
                { id: "netAmtTax", label: "Amount" },
                { id: "paymentStatus", label: "Payment Status" },
                { id: "status", label: "Order Status" }
            ]));
            const pager = document.createElement("div");
            pager.className = "ov-pager";
            pager.innerHTML = `
                <div>
                    <button class="main-ui-btn hover" data-cmd="prev" data-msg="Previous page" tabindex="0"><i class="fa-solid fa-arrow-left"></i> Prev</button>
                    <span class="ov-page-info"></span>
                    <button class="main-ui-btn hover" data-cmd="next" data-msg="Next page" tabindex="0">Next <i class="fa-solid fa-arrow-right"></i></button>
                </div>`;
            host.appendChild(pager);
            const tableEl = host.querySelector(".table");
            pager.querySelector("[data-cmd='prev']").addEventListener("click", () => {
                orderPageIndex = Math.max(1, orderPageIndex - 1);
                renderOrdersPage(tableEl);
            });
            pager.querySelector("[data-cmd='next']").addEventListener("click", () => {
                orderPageIndex++;
                renderOrdersPage(tableEl);
            });
        },
        init(host) {
            return ipcRenderer.invoke("get-orders").then(orders => {
                ordersCache = Array.isArray(orders) ? orders : [];
                orderPageIndex = 1;
                renderOrdersPage(host.querySelector(".table"));
            });
        }
    },

    "expired-bills": {
        type: "big",
        label: "Expired bills",
        build(host) {
            host.innerHTML = `
                <div class="ov-widget-head">
                    <h3>Expired Bills</h3>
                    <select name="finYear" id="fin-year" tabindex="0">
                        <option value="0" selected>Current Financial Year</option>
                        <option value="1">Last Financial Year</option>
                        <option value="2">All Financial Year</option>
                    </select>
                </div>`;
            host.appendChild(tableShell([
                { id: "billNo", label: "Bill Number" },
                { id: "billDate", label: "Bill Date" },
                { id: "name", label: "Customer Name" },
                { id: "billAmt", label: "Bill Amount" }
            ]));
            const pager = document.createElement("div");
            pager.className = "ov-pager";
            pager.innerHTML = `
                <div>
                    <button class="main-ui-btn hover" data-cmd="prev" data-msg="Previous page" tabindex="0"><i class="fa-solid fa-arrow-left"></i> Prev</button>
                    <span class="ov-page-info"></span>
                    <button class="main-ui-btn hover" data-cmd="next" data-msg="Next page" tabindex="0">Next <i class="fa-solid fa-arrow-right"></i></button>
                </div>`;
            host.appendChild(pager);
            pager.querySelector("[data-cmd='prev']").addEventListener("click", () => {
                expiredBillPageIndex = Math.max(1, expiredBillPageIndex - 1);
                loadExpiredBills(host,expiredBillPageIndex);
            });
            pager.querySelector("[data-cmd='next']").addEventListener("click", () => {
                expiredBillPageIndex++;
                loadExpiredBills(host,expiredBillPageIndex);
            });
            host.querySelector("#fin-year").addEventListener("change", () => loadExpiredBills(host,1));
        },
        init(host) { return loadExpiredBills(host,1); }
    },

    "stock-low": {
        type: "big",
        label: "Stocks running low",
        build(host) {
            host.innerHTML = `<h3>Stocks running low</h3>`;
            host.appendChild(tableShell([
                { id: "name", label: "Name" },
                { id: "quantity", label: "Quantity" }
            ]));
        },
        init(host) {
            return ipcRenderer.invoke("get-overview-content", 0).then(({ stocks = [] } = {}) => {
                fillTableOrPlaceholder(host, stocks, "stock");
            });
        }
    },

    "scheduler": {
        type: "big",
        label: "Scheduler",
        build(host) {
            const tpl = document.getElementById("scheduler-widget-template");
            if (!tpl) return;
            const div = tpl.content.cloneNode(true).querySelector("div");
            host.appendChild(div);
        },
        init(host) { return initSchedulerWidget(host); }
    },

    "file-monitor": {
        type: "big",
        label: "Unprinted invoices",
        build(host) {
            host.innerHTML = `
                <div class="ov-widget-head">
                    <h3>Unprinted invoices <span class="ov-count-badge"></span></h3>
                    <div class="ov-fm-actions">
                        <button class="main-ui-btn hover" data-cmd="fm-print-all" data-msg="Print all invoices" tabindex="0" title="Print all"><i class="fa-solid fa-print"></i></button>
                        <button class="main-ui-btn hover" data-cmd="fm-remove-all" data-msg="Remove all from queue" tabindex="0" title="Remove all"><i class="fa-solid fa-trash-can"></i></button>
                        <button class="main-ui-btn hover" data-cmd="fm-refresh" data-msg="Refresh queue" tabindex="0" title="Sync"><i class="fa-solid fa-rotate"></i></button>
                    </div>
                </div>
                <p class="ov-fm-note"></p>
                <div class="ov-fm-list hide-scrollbar" data-ui="fm-list"></div>`;
            host.querySelector("[data-cmd='fm-refresh']").addEventListener("click", () => loadFileMonitorQueue(host));
            host.querySelector("[data-cmd='fm-print-all']").addEventListener("click", () => printAllInvoices(host));
            host.querySelector("[data-cmd='fm-remove-all']").addEventListener("click", () => removeAllInvoices(host));
            const list = host.querySelector(".ov-fm-list");
            list.addEventListener("click", e => {
                const btn = e.target.closest("button");
                if (!btn) return;
                const row = btn.closest(".ov-fm-row");
                if (!row) return;
                if (btn.dataset.cmd === "fm-print") printInvoice(row.dataset.path, host);
                else if (btn.dataset.cmd === "fm-remove") removeInvoice(row.dataset.path, host);
            });
        },
        init(host) {
            return ipcRenderer.invoke("get-file-monitor-status").then(status => {
                fileMonitorOn = Boolean(status);
                renderFileMonitorNote(host);
                return loadFileMonitorQueue(host);
            });
        }
    },

    "sale-table": {
        type: "big",
        label: "Monthly sale table",
        build(host) {
            host.innerHTML = `<h3>Monthly sale table</h3>`;
            host.appendChild(tableShell([
                { id: "billDate", label: "Date" },
                { id: "name", label: "Name" },
                { id: "netAmt", label: "Bill Amount" },
                { id: "paymentStatus", label: "Paid / Unpaid" }
            ]));
        },
        init(host) {
            return ipcRenderer.invoke("get-sale-content").then(({ bills = [] } = {}) => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const filtered = bills.filter(obj => {
                    const d = obj.billDate instanceof Date ? obj.billDate : new Date(obj.billDate);
                    return d >= start;
                });
                fillTableOrPlaceholder(host, filtered, "billObj");
            });
        }
    },

    "today-purchases": {
        type: "big",
        label: "Today's purchases",
        build(host) {
            host.innerHTML = `<h3>Today's purchases</h3>`;
            host.appendChild(tableShell([
                { id: "billNo", label: "Bill Number" },
                { id: "billDate", label: "Bill Date" },
                { id: "supplierName", label: "Supplier Name" },
                { id: "billAmt", label: "Bill Amount" }
            ]));
        },
        init(host) {
            return ipcRenderer.invoke("get-purchase-content").then(purchases => {
                purchases = Array.isArray(purchases) ? purchases : [];
                const today = new Date().toDateString();
                const todays = purchases.filter(obj => new Date(obj.billDate).toDateString() === today);
                const tbody = host.querySelector(".tbody");
                clearHost(tbody, ".no-data");
                clearHost(tbody, "div.body.row");
                todays.forEach(({ billNo, billDate, supplierName, billAmt }) => {
                    const div = document.createElement("div");
                    div.className = "body row";
                    div.innerHTML = `
                        <p class="col eq-space">${billNo}</p>
                        <p class="col eq-space">${new Date(billDate).toLocaleDateString("en-GB")}</p>
                        <p class="col eq-space">${supplierName}</p>
                        <p class="col eq-space">${billAmt}</p>`;
                    tbody.appendChild(div);
                });
                if (tbody.children.length === 0) noDataPlaceholder(tbody);
            });
        }
    },

    // ---- cards (stackable) ----

    "monthly-sale": makeCardWidget("Monthly sale card", "monthSale", "This month"),
    "yearly-sale": makeCardWidget("Yearly sale card", "yearSale", "This financial year"),
    "net-turnover": makeCardWidget("Net turnover card", "netTurnover", "This FY · sales − purchases"),
    "net-purchase": makeCardWidget("Net purchase card", "netPurchase", "This financial year")
};

// ---------------------------------------------------------------------------
// per-widget loaders

async function loadCloudUsage(host) {
    const res = await ipcRenderer.invoke("get-cloud-usage");
    const creditEl = host.querySelector("[data-field='credit']");
    const emailsEl = host.querySelector("[data-field='emails']");
    const note = host.querySelector(".ov-cloud-note");
    // guard like renderFileMonitorNote: a re-render can replace the widget
    // while this async call was in flight, leaving a stale host
    if (!creditEl || !emailsEl || !note) return;
    if (res && res.ok && res.data) {
        creditEl.textContent = res.data.creditBalance === null || res.data.creditBalance === undefined
            ? "—" : "Rs. " + res.data.creditBalance.toLocaleString("en-IN");
        emailsEl.textContent = res.data.emailsSent === null || res.data.emailsSent === undefined
            ? "—" : String(res.data.emailsSent);
        note.textContent = "Synced just now";
    } else {
        creditEl.textContent = "—";
        emailsEl.textContent = "—";
        note.textContent = res && res.error ? res.error : "Cloud unreachable";
    }
}

async function loadExpiredBills(host,pageNo=1) {
    if(!host) return;
    const year = Number(host.querySelector("#fin-year")?.value || 0);
    pageNo--;
    let startNo = pageNo*10;
    let endNo = startNo+9;
    const { unPaidBills = [],len } = await ipcRenderer.invoke("get-overview-content", year, true,startNo,endNo);
    if(startNo>len) return;
    host.querySelector(".ov-page-info").textContent = `Page ${pageNo+1} of ${Math.round(len/10)} expired bills pages`;
    fillTableOrPlaceholder(host, unPaidBills, "billObj");
}

// ---- scheduler widget (carousel with its own timer so hover can pause it) ----

let schedulerCarouselTimer = null;

function schedulerEventPage(evObj) {
    const tpl = document.getElementById("schedules-page-template");
    if (!tpl) return null;
    const page = tpl.content.cloneNode(true).querySelector("div");
    const pHost = page.querySelector("#event-host");
    const p = document.createElement("p");
    p.style.setProperty("--color", evObj.color);
    const [h, s, l] = hslComponents(evObj.color);
    p.style.setProperty("--lighter-shade", lightenHSL(h, s, l, 0.3));
    p.dataset.obj = JSON.stringify(evObj);
    const span = document.createElement("span");
    span.textContent = evObj.label;
    p.appendChild(span);
    const span2 = document.createElement("span");
    span2.textContent = new Date(evObj.time).toLocaleDateString("en-IN", {
        day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    p.appendChild(span2);
    pHost.appendChild(p);
    return page;
}

function startSchedulerCarousel(host) {
    clearInterval(schedulerCarouselTimer);
    const pages = [...host.querySelectorAll(".event-page")];
    if (pages.length === 0) return;
    let i = 0;
    pages.forEach((pg, idx) => {
        pg.classList.remove("card-in", "card-out");
        if (idx === 0) pg.classList.add("card-in");
    });
    schedulerCarouselTimer = setInterval(() => {
        pages[i].classList.remove("card-in");
        pages[i].classList.add("card-out");
        i = (i + 1) % pages.length;
        pages[i].classList.remove("card-out");
        pages[i].classList.add("card-in");
    }, 10000);
}

async function initSchedulerWidget(host) {
    const schedulerDiv = host.querySelector("#scheduler-div");
    if (!schedulerDiv) return;
    const schedules = ((await ipcRenderer.invoke("scheduler-get-state")) || {}).schedules || [];
    schedulerDiv.querySelectorAll(".event-page.removable").forEach(node => node.remove());
    const firstPage = schedulerDiv.querySelector(".event-page.first-page");
    if (firstPage) {
        const [dt, mnth, yr] = new Date().toLocaleDateString("en-GB", { dateStyle: "long" }).split(" ");
        const dtDiv = firstPage.querySelector("#dt-div");
        if (dtDiv) {
            dtDiv.querySelector("h1").textContent = dt;
            dtDiv.querySelector("p").textContent = `${mnth}, ${yr}`;
        }
        firstPage.classList.remove("card-in");
    }
    if (schedules.length > 0) {
        schedules.forEach(evObj => {
            const page = schedulerEventPage(evObj);
            if (page) schedulerDiv.appendChild(page);
        });
    }
    if (firstPage) firstPage.classList.add("card-in");
    startSchedulerCarousel(schedulerDiv);
    schedulerDiv.addEventListener("mouseenter", () => clearInterval(schedulerCarouselTimer));
    schedulerDiv.addEventListener("mouseleave", () => startSchedulerCarousel(schedulerDiv));
}

// ---- file monitor widget ----

function renderFileMonitorQueue(host, queue) {
    const list = host.querySelector(".ov-fm-list");
    const badge = host.querySelector(".ov-count-badge");
    if (!list) return;
    clearHost(list, "*");
    if (badge) badge.textContent = queue && queue.length ? `(${queue.length})` : "";
    if (!queue || queue.length === 0) {
        const p = document.createElement("p");
        p.className = "ov-fm-empty";
        p.textContent = "No unprinted invoices";
        list.appendChild(p);
        return;
    }
    queue.forEach(item => {
        const row = document.createElement("div");
        row.className = "ov-fm-row";
        row.dataset.path = item.path;
        row.innerHTML = `
            <i class="fa-solid fa-file-pdf"></i>
            <span class="ov-fm-name" title="${item.name}">${item.name}</span>
            <span class="ov-fm-age">${ageText(item.age)}</span>
            <button class="main-ui-btn hover" data-cmd="fm-print" data-msg="Print this invoice" tabindex="0" title="Print"><i class="fa-solid fa-print"></i></button>
            <button class="main-ui-btn hover" data-cmd="fm-remove" data-msg="Remove from queue" tabindex="0" title="Remove from queue"><i class="fa-solid fa-trash"></i></button>`;
        list.appendChild(row);
    });
}

function renderFileMonitorNote(host, txt = "") {
    const note = host.querySelector(".ov-fm-note");
    if (!note) return;
    if (!fileMonitorOn) {
        note.textContent = "File Monitor is off — click the status bar toggle to turn it on.";
        note.className = "ov-fm-note fm-off";
    } else {
        note.textContent = txt ? txt.trim().replace(/^-\s*/, "") : "Watching for new invoices…";
        note.className = "ov-fm-note";
    }
}

async function loadFileMonitorQueue(host) {
    const queue = await ipcRenderer.invoke("get-file-monitor-queue");
    renderFileMonitorQueue(host, queue);
}

async function printInvoice(filePath, host) {
    const res = await ipcRenderer.invoke("file-monitor-print-invoice", filePath);
    if (res && res.ok)
        toast(res.viaDialog ? "Pick a printer to print this invoice." : "Invoice sent to the default printer.");
    else
        toast(res && res.error ? res.error : "Print failed.", true);
}

async function removeInvoice(filePath, host) {
    const res = await ipcRenderer.invoke("file-monitor-remove-invoice", filePath);
    if (res && res.ok)
        toast("Invoice removed from the queue.");
    else
        toast(res && res.error ? res.error : "Could not remove the invoice.", true);
}

async function printAllInvoices(host) {
    const res = await ipcRenderer.invoke("file-monitor-print-all");
    if (res && res.ok) {
        const done = Number(res.printed) || 0, failed = Number(res.failed) || 0;
        if (done)
            toast(`Printed ${done} invoice${done === 1 ? "" : "s"}${failed ? ` — ${failed} failed` : ""}.`);
        else if (failed)
            toast(`${failed} invoice${failed === 1 ? "" : "s"} could not be printed.`, true);
        else
            toast("Queue is empty.");
        await loadFileMonitorQueue(host);
    } else {
        toast(res && res.error ? res.error : "Print failed.", true);
    }
}

async function removeAllInvoices(host) {
    const res = await ipcRenderer.invoke("file-monitor-remove-all");
    if (res && res.ok) {
        const removed = Number(res.removed) || 0;
        toast(removed ? `Removed ${removed} invoice${removed === 1 ? "" : "s"} from the queue.` : "Queue is already empty.");
        await loadFileMonitorQueue(host);
    } else {
        toast(res && res.error ? res.error : "Could not remove the invoices.", true);
    }
}

// ---------------------------------------------------------------------------
// renderer

/** Fetch shared payloads once, only for the widgets that need them. */
async function collectWidgetData(recipe) {
    const ids = recipe.rows.flatMap(r => r.cells.flatMap(c => c.widgets));
    if (ids.some(id => ["monthly-sale", "yearly-sale", "net-turnover", "net-purchase",
        "sale-purchase-graph", "sale-chart", "purchase-chart"].includes(id)))
        widgetData = await ipcRenderer.invoke("get-overview-widget-data");
    else
        widgetData = null;
}

async function renderOverview(seq) {
    const host = document.getElementById("overview-div");
    if (!host) return;
    const { recipe } = await ipcRenderer.invoke("get-overview-recipe");
    // Superseded by a newer render while awaiting IPC — leave the DOM alone,
    // the newer render will clear and rebuild it.
    if (seq && seq !== overviewRenderSeq) return;
    // chart gradient fill colors from the customize section ("" → defaults)
    chartFill = (recipe.chart && recipe.chart.fillStart && recipe.chart.fillStop)
        ? { start: recipe.chart.fillStart, stop: recipe.chart.fillStop }
        : { start: "", stop: "" };
    clearHost(host, "*");
    chartSeq = 0;
    mountedCharts.length = 0;
    clearInterval(schedulerCarouselTimer);

    const built = []; // { box, w } in DOM order — used to init after data loads
    recipe.rows.forEach(rowDef => {
        const band = document.createElement("div");
        band.className = "ov-band";
        band.dataset.row = rowDef.row;
        const grid = document.createElement("div");
        grid.className = "ov-grid";
        rowDef.cells.forEach(cell => {
            const cellDiv = document.createElement("div");
            cellDiv.className = `ov-cell ov-${cell.col}`;
            cellDiv.dataset.col = cell.col;
            cell.widgets.forEach(wid => {
                const w = widgets[wid];
                if (!w) return;
                const box = document.createElement("div");
                box.className = w.type === "card" ? "ov-widget ov-card" : "ov-widget";
                box.dataset.widget = wid;
                w.build(box);
                cellDiv.appendChild(box);
                built.push({ box, w });
            });
            grid.appendChild(cellDiv);
        });
        band.appendChild(grid);
        host.appendChild(band);
    });

    await collectWidgetData(recipe);
    if (seq && seq !== overviewRenderSeq) return;
    for (const { box, w } of built) {
        if (w.init) await w.init(box);
    }
    for (const { box, w } of built) {
        if (w.draw) w.draw(box);
    }
}

// charts follow the window size (the old correctChart contract)
window.addEventListener("resize", () => mountedCharts.forEach(c => c.draw()));

// ---------------------------------------------------------------------------
// customize mode

const PALETTE = Object.keys(widgets);
const MIN_ROWS = 1; // at least one row band must remain (mirrors overviewRecipeLogic)

function slotSelect(selected) {
    const sel = document.createElement("select");
    sel.className = "ov-widget-select";
    sel.innerHTML = `<option value="">— Empty —</option>` +
        PALETTE.map(id => `<option value="${id}" ${id === selected ? "selected" : ""}>${widgets[id].label || id}</option>`).join("");
    sel.addEventListener("change", () => rebuildSlot(sel.closest(".ov-slot")));
    return sel;
}

const undoMemory = new Map();

/** Keep a slot consistent: a big pick collapses the slot to itself; card
 *  picks allow stacking more cards. */
function rebuildSlot(slot) {
    if (!slot) return;
    const selects = [...slot.querySelectorAll("select")];
    const bigSel = selects.find(s => s.value && widgets[s.value] && widgets[s.value].type === "big");
    const addBtn = slot.querySelector(".ov-add-btn");
    let actBtnContainer = slot.querySelector(".ov-act-btn-div")
    const remWidget = slot.querySelector(".ov-remove-widget");
    const undoWidget = slot.querySelector(".ov-undo-remove");
    if (bigSel) {
        // only the big widget may stay — it can't share a cell
        selects.forEach(s => { if (s !== bigSel) s.remove(); });
        if (actBtnContainer) actBtnContainer.remove();
        return;
    }
    // all cards (or empty) — allow stacking of maximum 3 cards.
    if(!actBtnContainer){
        actBtnContainer = document.createElement("div");
        actBtnContainer.className = "ov-act-btn-div";
        slot.appendChild(actBtnContainer);
    }
    if (!addBtn) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "main-ui-btn hover ov-add-btn";
        add.textContent = "+ Add card";
        add.dataset.msg = "Add more card upto maximum of 3 cards per slot"
        add.addEventListener("click", () => {
            let selects = add.closest(".ov-slot").querySelectorAll("select");
            if(selects.length<3)
                slot.insertBefore(slotSelect(""), actBtnContainer);
            else
                toast("Cannot add more than 3 cards",true);
            selects = add.closest(".ov-slot").querySelectorAll("select");
            undoMemory.set(slot,selects);
        });
        actBtnContainer.appendChild(add);
    }
    // Remove widget button
    if (!remWidget) {
        const rem = document.createElement("button");
        rem.type = "button";
        rem.className = "main-ui-btn hover ov-remove-widget";
        rem.textContent = "Remove cards";
        rem.dataset.msg = "Remove cards from this slot"
        rem.addEventListener("click", () => {
            let ovSlot = rem.closest(".ov-slot");
            let selects = rem.closest(".ov-slot").querySelectorAll("select");
            clearHost(ovSlot,"select");
            slot.insertBefore(slotSelect(""), actBtnContainer);
            undoMemory.set(slot,selects);
        });
        actBtnContainer.appendChild(rem);
    }
    // Undo remove widget
    if (!undoWidget) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "main-ui-btn hover ov-undo-remove";
        undo.textContent = "Undo";
        undo.dataset.msg = "Undo widget removal";
        undo.addEventListener("click", () => {
            let selects = undoMemory.get(slot);
            clearHost(slot,"select");
            selects.forEach(select=>slot.insertBefore(select,actBtnContainer));
        });
        actBtnContainer.appendChild(undo);
    }

}

/** Build one band editor (row label + remove button + slot editors). The
 *  row number is display-only — syncRowBands() renumbers everything in DOM
 *  order, so a removed middle band leaves no gap. */
function makeBandEditor(host, rowNum, { isFull = false, fullWidgets = [], leftWidgets = [], rightWidgets = [] } = {}) {
    const band = document.createElement("div");
    band.className = "ov-band ov-band-editor";
    band.dataset.row = rowNum;
    band.innerHTML = `
        <div class="ov-band-editor-head">
            <p>Row ${rowNum}</p>
            <div>
                <button type="button" class="main-ui-btn hover ban-btn ov-row-up" data-msg="Move band up" tabindex="0" title="Remove this row band">
                    <i class="fa-solid fa-arrow-up ov-row-up"></i>
                </button>
                <button type="button" class="main-ui-btn hover ban-btn ov-row-down" data-msg="Move band down" tabindex="0" title="Remove this row band">
                    <i class="fa-solid fa-arrow-down ov-row-down"></i>
                </button>
                <button type="button" class="main-ui-btn hover ban-btn ov-row-remove" data-msg="Remove this row band" tabindex="0" title="Remove this row band">
                    <i class="fa-solid fa-trash"></i> Remove
                </button>
            </div>
        </div>
        <div class="ov-cell-editor">
            <label class="ov-full-toggle"><input type="checkbox" ${isFull ? "checked" : ""}> Full width</label>
            <div class="ov-slot ov-slot-full" data-slot="full"><label>Widget</label></div>
            <div class="ov-slot-row">
                <div class="ov-slot" data-slot="left"><label>Left</label></div>
                <div class="ov-slot" data-slot="right"><label>Right</label></div>
            </div>
        </div>`;

    const toggle = band.querySelector(".ov-full-toggle input");
    const fullSlot = band.querySelector('[data-slot="full"]');
    const leftSlot = band.querySelector('[data-slot="left"]');
    const rightSlot = band.querySelector('[data-slot="right"]');
    fullSlot.appendChild(slotSelect(isFull ? fullWidgets[0] || "" : ""));
    leftSlot.appendChild(slotSelect(isFull ? "" : leftWidgets[0] || ""));
    rightSlot.appendChild(slotSelect(isFull ? "" : rightWidgets[0] || ""));
    // restore stacked cards
    (isFull ? fullWidgets.slice(1) : leftWidgets.slice(1)).forEach(id => {
        if (!id) return;
        const target = isFull ? fullSlot : leftSlot;
        target.insertBefore(slotSelect(id), target.querySelector(".ov-add-btn") || null);
    });
    rightWidgets.slice(1).forEach(id => {
        if (!id) return;
        rightSlot.insertBefore(slotSelect(id), rightSlot.querySelector(".ov-add-btn") || null);
    });
    rebuildSlot(fullSlot);
    rebuildSlot(leftSlot);
    rebuildSlot(rightSlot);
    const applyToggle = () => {
        fullSlot.classList.toggle("hide", !toggle.checked);
        band.querySelector(".ov-slot-row").classList.toggle("hide", toggle.checked);
    };
    toggle.addEventListener("change", applyToggle);
    applyToggle();

    band.querySelector(".ov-row-remove").addEventListener("click", () => {
        band.remove();
        syncRowBands(host);
    });    

    band.querySelector(".ov-row-up").addEventListener("click",bandMoveHelper);
    band.querySelector(".ov-row-down").addEventListener("click",bandMoveHelper);
    return band;
}

function bandMoveHelper(e){
    let host = document.getElementById("overview-div");
    let band = e.target.closest(".ov-band");
    let moveUp = e.target.classList.contains("ov-row-up") ? true : false;
    let bands = [...document.querySelectorAll(".ov-band")];
    const firstPositions = new Map(
        bands.map(el => [el, el.getBoundingClientRect()])
    );
    let currentBandIndex = bands.indexOf(band);
    if((moveUp && currentBandIndex==0) || (!moveUp && currentBandIndex==bands.length-1)) return; // Can't move
    let adjIndex = moveUp ? currentBandIndex - 1 : currentBandIndex + 1;
    let adjBand = bands[adjIndex];
    if(moveUp)
        adjBand.before(band);
    else
        adjBand.after(band);
    smoothMoveUpDownAnimation(bands,firstPositions);
    syncRowBands(host);
}

/** Renumber the band labels/ids in DOM order and enforce the 1-band minimum
 *  by disabling the remove button on the last remaining band. */
function syncRowBands(host) {
    const bands = [...host.querySelectorAll(".ov-band-editor")];
    bands.forEach((band, i) => {
        band.dataset.row = i + 1;
        const head = band.querySelector(".ov-band-editor-head p");
        if (head) head.textContent = `Row ${i + 1}`;
        const remove = band.querySelector(".ov-row-remove");
        if (remove) remove.disabled = bands.length <= MIN_ROWS;
    });
}

function renderCustomize(recipe) {
    const host = document.getElementById("overview-div");
    clearHost(host, "*");
    mountedCharts.length = 0;
    clearInterval(schedulerCarouselTimer);

    const toolbar = document.createElement("div");
    toolbar.className = "ov-customize-bar";
    const fill = (recipe.chart && recipe.chart.fillStart && recipe.chart.fillStop) ? recipe.chart : null;
    toolbar.innerHTML = `
        <p>Customize overview — pick the widget for each slot, add or remove row bands. Widgets are not resizable.</p>
        <div>
            <button class="main-ui-btn hover" data-cmd="ov-add-row" data-msg="Add a row band" tabindex="0"><i class="fa-solid fa-plus"></i> Add row</button>
            <button class="main-ui-btn hover" data-cmd="ov-customize-save" data-msg="Save layout" tabindex="0">Save</button>
            <button class="main-ui-btn hover" data-cmd="ov-load-default" data-msg="Revert back o default design" tabindex="0">Reset to default</button>
            <button class="main-ui-btn hover" data-cmd="ov-customize-cancel" data-msg="Discard changes" tabindex="0">Cancel</button>
        </div>
        <div class="ov-chart-fill">
            <label><input type="checkbox" data-ov-fill-use ${fill ? "checked" : ""}> Use custom chart fill colors</label>
            <label>Start <input type="color" data-ov-fill="start" value="${fill ? fill.fillStart : "#2e7d32"}"></label>
            <label>Stop <input type="color" data-ov-fill="stop" value="${fill ? fill.fillStop : "#fafafa"}"></label>
        </div>`;
    host.appendChild(toolbar);

    recipe.rows.forEach(rowDef => {
        const isFull = rowDef.cells.some(c => c.col === "full");
        const fullWidgets = rowDef.cells.find(c => c.col === "full")?.widgets || [];
        const leftWidgets = rowDef.cells.find(c => c.col === "left")?.widgets || [];
        const rightWidgets = rowDef.cells.find(c => c.col === "right")?.widgets || [];
        host.appendChild(makeBandEditor(host, rowDef.row, { isFull, fullWidgets, leftWidgets, rightWidgets }));
    });
    syncRowBands(host);

    host.querySelector("[data-cmd='ov-add-row']").addEventListener("click", () => {
        const next = host.querySelectorAll(".ov-band-editor").length + 1;
        host.appendChild(makeBandEditor(host, next));
        syncRowBands(host);
    });

    host.querySelector("[data-cmd='ov-customize-save']").addEventListener("click", async () => {
        const rows = [];
        host.querySelectorAll(".ov-band-editor").forEach((bandEditor, index) => {
            const full = bandEditor.querySelector(".ov-full-toggle input").checked;
            const read = slot => [...slot.querySelectorAll("select")].map(s => s.value).filter(Boolean);
            const cells = [];
            if (full) {
                const widgets = read(bandEditor.querySelector('[data-slot="full"]'));
                if (widgets.length) cells.push({ col: "full", widgets });
            } else {
                const left = read(bandEditor.querySelector('[data-slot="left"]'));
                const right = read(bandEditor.querySelector('[data-slot="right"]'));
                if (left.length) cells.push({ col: "left", widgets: left });
                if (right.length) cells.push({ col: "right", widgets: right });
            }
            rows.push({ row: index + 1, cells });
        });
        // chart gradient fill colors — only persisted while the "use custom" box is ticked
        const useFill = toolbar.querySelector("[data-ov-fill-use]").checked;
        const chart = useFill
            ? {
                fillStart: toolbar.querySelector("[data-ov-fill='start']").value,
                fillStop: toolbar.querySelector("[data-ov-fill='stop']").value,
              }
            : null;
        const res = await ipcRenderer.invoke("save-overview-recipe", { rows, chart });
        if (res && res.ok) {
            toast("Overview layout saved.");
            renderOverviewPage();
        } else {
            toast(res && res.error ? res.error : "Could not save the layout.", true);
        }
    });

    host.querySelector("[data-cmd='ov-load-default']").addEventListener("click", async ()=>{
        await ipcRenderer.invoke("revert-to-default-layout");
        renderOverviewPage();
    });

    host.querySelector("[data-cmd='ov-customize-cancel']").addEventListener("click", () =>{
        renderOverviewPage()
    });
}

// ---------------------------------------------------------------------------
// toolbar (normal mode) + entry point

/** Monotonic render token — rapid refreshes (e.g. "update-content" broadcasts
 *  while the previous render is still awaiting IPC) used to interleave and
 *  stack a second toolbar/Customize button. Only the latest render may mount
 *  the toolbar. */
let overviewRenderSeq = 0;

function mountToolbar() {
    const host = document.getElementById("overview-div");
    clearHost(host, ".ov-toolbar"); // never stack toolbars on re-render
    const toolbar = document.createElement("div");
    toolbar.className = "ov-toolbar";
    toolbar.innerHTML = `<button class="main-ui-btn hover" data-cmd="ov-customize" data-msg="Customize this page" tabindex="0"><i class="fa-solid fa-pen-to-square"></i> Customize</button>`;
    host.appendChild(toolbar);
    toolbar.querySelector("[data-cmd='ov-customize']").addEventListener("click", async () => {
        const { recipe } = await ipcRenderer.invoke("get-overview-recipe");
        renderCustomize(recipe);
    });
}

/** Entry point — called by applyMode() in mainPage.js for the overview mode. */
async function renderOverviewPage() {
    ensureFileMonitorListeners();
    const seq = ++overviewRenderSeq;
    await renderOverview(seq);
    if (seq !== overviewRenderSeq) return; // superseded — a newer render mounts the toolbar
    mountToolbar();
}

// ---- file-monitor listeners (shared channel with the status bar in
// mainPage.js — never removeAllListeners here). Bound lazily on first render:
// this script loads BEFORE mainPage.js, so ipcRenderer isn't declared yet at
// load time. ----
let fmListenersBound = false;
function ensureFileMonitorListeners() {
    if (fmListenersBound) return;
    fmListenersBound = true;
    ipcRenderer.on("file-monitor-queue-update", (e, queue) => {
        const host = document.querySelector('#overview-div .ov-widget[data-widget="file-monitor"]');
        if (host) renderFileMonitorQueue(host, queue);
    });
    ipcRenderer.on("get-file-monitor-update", (e, status, txt) => {
        fileMonitorOn = Boolean(status);
        const host = document.querySelector('#overview-div .ov-widget[data-widget="file-monitor"]');
        if (host) renderFileMonitorNote(host, txt || "");
    });
}

/** Called by mainPage.js when notifications refresh — re-init the scheduler
 *  widget if it is mounted on the Overview page. */
async function refreshSchedulerWidget() {
    const widget = document.querySelector('#overview-div .ov-widget[data-widget="scheduler"]');
    if (widget) await initSchedulerWidget(widget);
}

window.renderOverviewPage = renderOverviewPage;
window.renderOverview = renderOverview;
window.refreshSchedulerWidget = refreshSchedulerWidget;
