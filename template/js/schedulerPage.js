// Scheduler — renderer logic for the Scheduler page. Loaded by mainPage.html
// next to mainPage.js; applyMode() calls schedulerPageInit() when the user
// opens the Scheduler menu. All store work happens in main via
// lib/scheduler.js (scheduler-get-state / scheduler-save-event / ...).
//
// NOTE: classic scripts share one global scope — mainPage.js (loaded first)
// already declares ipcRenderer, showToastNotification, appendToHost,
// removeAllElem and appendToDL, so this file must NOT redeclare them
// (const collision). Every top-level name here is prefixed with schp.

let schpState = null;      // {schedules, expiredSchedules, history, settings, printers}
let schpBills = null;      // {sales, purchases, orders} — lazy loaded for bill selects
let schpEditingId = null;  // event being edited; null while creating a new one
let schpEditorOpen = false;

// ---------------------------------------------------------------------------
// Init / state
// ---------------------------------------------------------------------------

async function schedulerPageInit(){
    let host = document.getElementById("scheduler-page-div");
    if(!host) return;
    schpState = await ipcRenderer.invoke("scheduler-get-state");
    schpEditorOpen = false;
    schpEditingId = null;
    schpRender(host);
}

async function schpRefresh(){
    schpState = await ipcRenderer.invoke("scheduler-get-state");
    let host = document.getElementById("scheduler-page-div");
    if(host) schpRender(host);
}

function schpToast(message, isError){
    showToastNotification(message,
        ["animation-common","move-left", isError ? "red-toast-box" : "blue-toast-box"],
        "main-div", 8, "9%");
}

function esc(str){
    return String(str == null ? "" : str)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// datetime-local input value from an ISO time (local timezone, no UTC shift)
function schpToLocalInput(date){
    let d = new Date(date);
    if(isNaN(d.getTime())) return "";
    let pad = n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function schpFormatTime(time){
    let d = new Date(time);
    if(isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN",{
        day:"2-digit", month:"short", year:"numeric",
        hour:"2-digit", minute:"2-digit"
    });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function schpRender(host){
    removeAllElem("#scheduler-page-div > *");
    let html = `
    <div class="schp-top">
        <h2><i class="fa-solid fa-clock"></i> Scheduler</h2>
        <button type="button" class="main-ui-btn" data-act="new-event" tabindex="0">
            <i class="fa-solid fa-plus"></i> New Event
        </button>
    </div>
    ${schpEditorHTML()}
    <section class="schp-section" id="schp-upcoming">
        <h3><i class="fa-solid fa-bell"></i> Upcoming (${schpState.schedules.length})</h3>
        ${schpSchedulesHTML()}
    </section>
    <section class="schp-section" id="schp-expired">
        <h3><i class="fa-solid fa-clock-rotate-left"></i> Expired (${schpState.expiredSchedules.length})</h3>
        ${schpExpiredHTML()}
    </section>
    <section class="schp-section" id="schp-history">
        <h3><i class="fa-solid fa-list-check"></i> History (${schpState.history.length})</h3>
        ${schpHistoryHTML()}
    </section>
    <section class="schp-section" id="schp-settings">
        <h3><i class="fa-solid fa-sliders"></i> Burst automation</h3>
        ${schpSettingsHTML()}
    </section>`;
    host.innerHTML = html;
    if(!host.dataset.bound){
        host.addEventListener("click", schpClick);
        host.addEventListener("change", schpChange);
        host.addEventListener("submit", schpSubmit);
        host.dataset.bound = "1";
    }
}

function schpEditorHTML(){
    if(!schpEditorOpen) return "";
    let ev = schpEditingId
        ? schpState.schedules.find(item=>item.id===schpEditingId)
        : null;
    let tag = ev ? ev.tag : "";
    let color = ev ? ev.color : "#4B0082";
    return `
    <section class="schp-editor">
        <h3>${ev ? "Edit event" : "New event"}</h3>
        <form id="schp-editor-form">
            <div class="schp-field">
                <label for="schp-type">Type</label>
                <select name="type" id="schp-type">
                    <option value="reminder" ${(!ev || ev.type==="reminder") ? "selected" : ""}>Reminder</option>
                    <option value="bill-payment" ${ev && ev.type==="bill-payment" ? "selected" : ""}>Bill Payment</option>
                    <option value="order-bill" ${ev && ev.type==="order-bill" ? "selected" : ""}>Billing</option>
                    <option value="print" ${ev && ev.type==="print" ? "selected" : ""}>Print</option>
                    <option value="mail" ${ev && ev.type==="mail" ? "selected" : ""}>Email</option>
                    <option value="task" ${ev && ev.type==="task" ? "selected" : ""}>Task</option>
                </select>
            </div>
            <div class="schp-field">
                <label for="schp-label">Label</label>
                <input type="text" name="label" id="schp-label" required
                    value="${esc(ev ? ev.label : "")}" placeholder="e.g. Pay electricity bill">
            </div>
            <div class="schp-field">
                <label for="schp-time">Date and time</label>
                <input type="datetime-local" name="time" id="schp-time" required
                    value="${esc(ev ? schpToLocalInput(ev.time) : schpToLocalInput(Date.now()))}">
            </div>
            <div class="schp-field schp-inline">
                <div>
                    <label for="schp-tag">Tag (optional)</label>
                    <input type="text" name="tag" id="schp-tag" value="${esc(tag)}">
                </div>
                <div class="schp-color">
                    <label for="schp-color">Colour</label>
                    <input type="color" name="color" id="schp-color" value="${esc(color)}">
                </div>
            </div>
            <div id="schp-type-fields">${schpTypeFieldsHTML(ev ? ev.type : "reminder", ev)}</div>
            <div class="schp-actions">
                <button type="submit" class="main-ui-btn" tabindex="0">
                    <i class="fa-solid fa-floppy-disk"></i> Save
                </button>
                <button type="button" class="main-ui-btn" data-act="cancel-edit" tabindex="0">Cancel</button>
            </div>
        </form>
    </section>`;
}

function schpTypeFieldsHTML(type, ev){
    ev = ev || {};
    let pr = ev.print || {};
    if(type==="reminder"){
        return `
        <div class="schp-field">
            <label for="schp-note">Note (optional)</label>
            <textarea name="note" id="schp-note" rows="2"
                placeholder="What this reminder is about">${esc(ev.note || "")}</textarea>
        </div>`;
    }
    if(type==="bill-payment" || type==="order-bill"){
        let billType = ev.billType || (type==="order-bill" ? "orders-select" : "sales-select");
        return `
        <div class="schp-field">
            <label for="schp-bill-type">Bill source</label>
            <select name="billType" id="schp-bill-type">
                <option value="sales-select" ${billType==="sales-select" ? "selected" : ""}>Sale</option>
                <option value="purchase-select" ${billType==="purchase-select" ? "selected" : ""}>Purchase</option>
                <option value="orders-select" ${billType==="orders-select" ? "selected" : ""}>Order</option>
            </select>
        </div>
        <div class="schp-field">
            <label for="schp-bill-no">Bill</label>
            <select name="billNo" id="schp-bill-no">${schpBillOptionsHTML(billType, ev)}</select>
        </div>`;
    }
    if(type==="print"){
        let printers = schpState.printers || [];
        return `
        <div class="schp-field">
            <label for="schp-bill-no">Bill to print</label>
            <select name="billNo" id="schp-bill-no">${schpBillOptionsHTML("sales-select", ev)}</select>
        </div>
        <div class="schp-field">
            <label for="schp-print-mode">Print mode</label>
            <select name="printMode" id="schp-print-mode">
                <option value="silent" ${pr.mode!=="manual" ? "selected" : ""}>Silent — send straight to printer</option>
                <option value="manual" ${pr.mode==="manual" ? "selected" : ""}>Manual — open PDF for me to print</option>
            </select>
        </div>
        <div class="schp-field">
            <label for="schp-printer">Printer</label>
            <select name="printer" id="schp-printer">
                <option value="">Default printer</option>
                ${printers.map(p=>`<option value="${esc(p.name)}" ${pr.printer===p.name ? "selected" : ""}>${esc(p.displayName || p.name)}${p.isDefault ? " (default)" : ""}</option>`).join("")}
            </select>
        </div>
        <div class="schp-field schp-inline">
            <div>
                <label for="schp-copies">Copies</label>
                <input type="number" name="copies" id="schp-copies" min="1" value="${esc(pr.copies || 1)}">
            </div>
            <div>
                <label for="schp-paper-size">Paper size</label>
                <select name="paperSize" id="schp-paper-size">
                    ${["A4","A5","Letter","Legal"].map(s=>`<option value="${s}" ${(pr.paperSize || "A4")===s ? "selected" : ""}>${s}</option>`).join("")}
                </select>
            </div>
        </div>`;
    }
    if(type==="mail"){
        let to = (ev.mail && ev.mail.to) || "";
        return `
        <div class="schp-field">
            <label for="schp-bill-no">Bill to email</label>
            <select name="billNo" id="schp-bill-no">${schpBillOptionsHTML("sales-select", ev)}</select>
        </div>
        <div class="schp-field">
            <label for="schp-mail-to">Recipient email</label>
            <input type="email" name="mailTo" id="schp-mail-to"
                value="${esc(to)}" placeholder="Leave blank to use the customer's email on record">
        </div>
        <p class="schp-hint"><i class="fa-solid fa-circle-info"></i> The bill PDF is emailed through the BBS Cloud API — sending needs a cloud signed-in account with a subscription (checked at send time).</p>`;
    }
    if(type==="task"){
        let task = ev.task || {};
        return `
        <div class="schp-field">
            <label for="schp-prompt">Task prompt</label>
            <input type="text" name="prompt" id="schp-prompt" required
                value="${esc(task.prompt || "")}" placeholder="e.g. Enter today's cash count">
        </div>
        <p class="schp-hint"><i class="fa-solid fa-circle-info"></i> When the task comes due you get a notification and fill the answer here yourself (worker hand-off needs multi-device sync, which is not wired yet).</p>`;
    }
    return "";
}

function schpBillOptionsHTML(billType, ev){
    let list = schpBills ? (
        billType==="purchase-select" ? schpBills.purchases :
        billType==="orders-select" ? schpBills.orders :
        schpBills.sales
    ) : [];
    let current = (ev.billObj && ev.billObj.billNo) ? String(ev.billObj.billNo) : "";
    if(!list.length)
        return `<option value="">${schpBills ? "No bills found" : "Loading bills…"}</option>`;
    return list.map(row=>{
        let billNo = String(row.billNo == null ? "" : row.billNo);
        let name = row.name || "";
        let date = row.billDate ? new Date(row.billDate).toLocaleDateString("en-IN") : "";
        return `<option value="${esc(billNo)}" ${billNo===current ? "selected" : ""}>${esc(name + " — Bill " + billNo + (date ? " (" + date + ")" : ""))}</option>`;
    }).join("");
}

function schpSchedulesHTML(){
    if(!schpState.schedules.length)
        return `<p class="schp-empty">Nothing scheduled. New events you create and automatic payment reminders for unpaid bills show up here.</p>`;
    return schpState.schedules
        .slice()
        .sort((a,b)=>new Date(a.time)-new Date(b.time))
        .map(ev=>`
        <div class="schp-card" data-id="${esc(ev.id)}" style="--color:${esc(ev.color || "#4B0082")}">
            <div class="schp-card-main">
                <p class="schp-label"><span class="schp-type-badge">${esc(schpTypeName(ev))}</span> ${esc(ev.label)}</p>
                <p class="schp-sub">${esc(schpEventSub(ev))}</p>
                ${ev.fired ? `<p class="schp-hint"><i class="fa-solid fa-bell"></i> Due-time notice already shown — awaiting your input.</p>` : ""}
            </div>
            <div class="schp-card-side">
                <p class="schp-time"><i class="fa-regular fa-clock"></i> ${esc(schpFormatTime(ev.time))}</p>
                ${ev.tag ? `<p class="schp-tag">${esc(ev.tag)}</p>` : ""}
                <div class="schp-actions">
                    ${ev.type==="task" ? `
                    <span class="schp-task-answer">
                        <input type="text" data-act-src="task-answer" placeholder="Your answer…" aria-label="Task answer">
                        <button type="button" class="main-ui-btn" data-act="complete-task" data-id="${esc(ev.id)}" tabindex="0">Complete</button>
                    </span>` : ""}
                    <button type="button" class="main-ui-btn" data-act="edit-event" data-id="${esc(ev.id)}" tabindex="0">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="main-ui-btn" data-act="remove-event" data-id="${esc(ev.id)}" tabindex="0">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        </div>`).join("");
}

function schpExpiredHTML(){
    if(!schpState.expiredSchedules.length)
        return `<p class="schp-empty">No expired events.</p>`;
    let clearBtn = `<div class="schp-actions"><button type="button" class="main-ui-btn" data-act="clear-expired" tabindex="0">Clear all</button></div>`;
    return clearBtn + schpState.expiredSchedules
        .slice()
        .sort((a,b)=>new Date(b.time)-new Date(a.time))
        .map(ev=>`
        <div class="schp-card schp-expired" data-id="${esc(ev.id)}" style="--color:${esc(ev.color || "#4B0082")}">
            <div class="schp-card-main">
                <p class="schp-label"><span class="schp-type-badge">${esc(schpTypeName(ev))}</span> ${esc(ev.label)}</p>
                <p class="schp-sub">${esc(schpEventSub(ev))}</p>
            </div>
            <div class="schp-card-side">
                <p class="schp-time"><i class="fa-regular fa-clock"></i> ${esc(schpFormatTime(ev.time))}</p>
                <div class="schp-actions">
                    <button type="button" class="main-ui-btn" data-act="dismiss-expired" data-id="${esc(ev.id)}" tabindex="0">Dismiss</button>
                </div>
            </div>
        </div>`).join("");
}

function schpHistoryHTML(){
    if(!schpState.history.length)
        return `<p class="schp-empty">No runs yet — history records every fired event and its result.</p>`;
    let clearBtn = `<div class="schp-actions"><button type="button" class="main-ui-btn" data-act="clear-history" tabindex="0">Clear history</button></div>`;
    return clearBtn + schpState.history
        .slice()
        .reverse()
        .map(h=>`
        <div class="schp-card schp-history-row">
            <p class="schp-label">${h.ok ? '<i class="fa-solid fa-circle-check schp-ok"></i>' : '<i class="fa-solid fa-circle-xmark schp-fail"></i>'} ${esc(h.label)}</p>
            <p class="schp-sub">${esc(schpFormatTime(h.time))} — ${esc(h.detail || "")}</p>
        </div>`).join("");
}

function schpSettingsHTML(){
    let s = schpState.settings || {};
    let printers = schpState.printers || [];
    return `
    <form id="schp-settings-form">
        <p class="schp-sub">The burst watcher counts how many bills you save inside 30 minutes. When the count reaches the threshold it offers to print them all in one go — accept and every bill is sent to the printer without opening each PDF.</p>
        <div class="schp-field schp-inline">
            <div>
                <label for="schp-burst-enabled">Burst automation</label>
                <select name="burstEnabled" id="schp-burst-enabled">
                    <option value="1" ${s.burstEnabled ? "selected" : ""}>On</option>
                    <option value="0" ${!s.burstEnabled ? "selected" : ""}>Off</option>
                </select>
            </div>
            <div>
                <label for="schp-burst-threshold">Bills per burst</label>
                <input type="number" name="burstThreshold" id="schp-burst-threshold" min="1" max="100"
                    value="${esc(s.burstThreshold || 5)}">
            </div>
            <div>
                <label for="schp-burst-print-mode">Burst print mode</label>
                <select name="burstPrintMode" id="schp-burst-print-mode">
                    <option value="silent" ${s.burstPrintMode!=="manual" ? "selected" : ""}>Silent</option>
                    <option value="manual" ${s.burstPrintMode==="manual" ? "selected" : ""}>Manual</option>
                </select>
            </div>
        </div>
        <div class="schp-field schp-inline">
            <div>
                <label for="schp-burst-printer">Burst printer</label>
                <select name="burstPrinter" id="schp-burst-printer">
                    <option value="">Default printer</option>
                    ${printers.map(p=>`<option value="${esc(p.name)}" ${s.burstPrinter===p.name ? "selected" : ""}>${esc(p.displayName || p.name)}${p.isDefault ? " (default)" : ""}</option>`).join("")}
                </select>
            </div>
            <div>
                <label for="schp-burst-copies">Copies</label>
                <input type="number" name="copies" id="schp-burst-copies" min="1" value="${esc(s.copies || 1)}">
            </div>
        </div>
        <div class="schp-actions">
            <button type="submit" class="main-ui-btn" tabindex="0"><i class="fa-solid fa-floppy-disk"></i> Save settings</button>
        </div>
    </form>`;
}

function schpTypeName(ev){
    return ({reminder:"Reminder", "bill-payment":"Bill payment", "order-bill":"Billing", print:"Print", mail:"Email", task:"Task"})[ev.type] || ev.type;
}

function schpEventSub(ev){
    let bill = ev.billObj || {};
    if((ev.type==="bill-payment" || ev.type==="order-bill") && bill.billNo)
        return `Bill ${esc(bill.name || "")} No ${esc(bill.billNo)}${ev.billType==="purchase-select" ? " — payment due" : " — collection due"}`;
    if(ev.type==="print" && bill.billNo){
        let pr = ev.print || {};
        return `Bill ${esc(bill.name || "")} No ${esc(bill.billNo)} — ${pr.mode==="manual" ? "open PDF" : "print"} (${esc(pr.copies || 1)}x, ${esc(pr.paperSize || "A4")})`;
    }
    if(ev.type==="mail" && bill.billNo)
        return `Bill ${esc(bill.name || "")} No ${esc(bill.billNo)} — email to ${esc((ev.mail && ev.mail.to) || "customer's email on record")}`;
    if(ev.type==="task" && ev.task && ev.task.prompt)
        return `Prompt: ${esc(ev.task.prompt)}`;
    return esc(ev.note || "");
}

// ---------------------------------------------------------------------------
// Burst offer (can arrive while the user is on any page)
// ---------------------------------------------------------------------------

ipcRenderer.on("scheduler-burst",(e,{count,bills})=>{
    let existing = document.getElementById("schp-burst-overlay");
    if(existing) existing.remove();
    let overlay = document.createElement("div");
    overlay.id = "schp-burst-overlay";
    overlay.innerHTML = `
    <div class="schp-burst-card">
        <h3><i class="fa-solid fa-print"></i> Print ${count} bills at once?</h3>
        <p>You just saved ${count} bills in a short burst: ${bills.map(b=>`<b>${esc(b)}</b>`).join(", ")}.</p>
        <p class="schp-sub">Accept and the scheduler prints each one straight to the configured printer — no opening PDFs one by one.</p>
        <div class="schp-actions">
            <button type="button" class="main-ui-btn" id="schp-burst-print" tabindex="0">Print all</button>
            <button type="button" class="main-ui-btn" id="schp-burst-notnow" tabindex="0">Not now</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#schp-burst-print").addEventListener("click", async ()=>{
        overlay.remove();
        schpToast(`Printing ${count} bills…`);
        let res = await ipcRenderer.invoke("scheduler-run-burst-print");
        let failed = (res && res.results || []).filter(r=>!r.ok).length;
        if(failed)
            schpToast(`${failed} bill(s) failed to print — see History.`, true);
        else
            schpToast("Burst print finished — see History.");
        schpRefresh();
    });
    overlay.querySelector("#schp-burst-notnow").addEventListener("click", ()=>{
        overlay.remove();
        ipcRenderer.invoke("scheduler-dismiss-burst");
    });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function schpClick(e){
    let btn = e.target.closest("[data-act]");
    if(!btn) return;
    let act = btn.dataset.act;
    if(act==="new-event"){
        schpEditingId = null;
        schpEditorOpen = true;
        schpRender(document.getElementById("scheduler-page-div"));
        schpLoadBills().then(()=>schpRefreshEditorFields());
    }
    else
    if(act==="cancel-edit"){
        schpEditorOpen = false;
        schpEditingId = null;
        schpRender(document.getElementById("scheduler-page-div"));
    }
    else
    if(act==="edit-event"){
        schpEditingId = btn.dataset.id;
        schpEditorOpen = true;
        schpLoadBills().then(()=>{
            schpRender(document.getElementById("scheduler-page-div"));
        });
        schpRender(document.getElementById("scheduler-page-div"));
    }
    else
    if(act==="remove-event"){
        ipcRenderer.invoke("scheduler-remove-event", btn.dataset.id).then(()=>{
            schpToast("Event removed.");
            schpRefresh();
        });
    }
    else
    if(act==="dismiss-expired"){
        ipcRenderer.invoke("scheduler-dismiss-expired", btn.dataset.id).then(()=>schpRefresh());
    }
    else
    if(act==="clear-expired"){
        ipcRenderer.invoke("scheduler-clear-expired").then(()=>{
            schpToast("Expired events cleared.");
            schpRefresh();
        });
    }
    else
    if(act==="clear-history"){
        ipcRenderer.invoke("scheduler-clear-history").then(()=>schpRefresh());
    }
    else
    if(act==="complete-task"){
        let card = btn.closest(".schp-card");
        let input = card && card.querySelector('[data-act-src="task-answer"]');
        let answer = input ? input.value.trim() : "";
        if(!answer){
            schpToast("Enter your answer before completing the task.", true);
            return;
        }
        ipcRenderer.invoke("scheduler-complete-task", {id: btn.dataset.id, answer}).then(res=>{
            if(res && res.ok){
                schpToast("Task completed — input accepted.");
                schpRefresh();
            }
            else
                schpToast((res && res.error) || "Task not found.", true);
        });
    }
}

function schpChange(e){
    if(e.target.id==="schp-type" || e.target.id==="schp-bill-type"){
        // re-render just the type-specific fields, keeping the user's pick
        let type = document.getElementById("schp-type").value;
        let billType = (document.getElementById("schp-bill-type") || {}).value;
        let fields = document.getElementById("schp-type-fields");
        if(fields){
            let ev = schpEditingId
                ? schpState.schedules.find(item=>item.id===schpEditingId)
                : null;
            fields.innerHTML = schpTypeFieldsHTML(type, ev);
            if(e.target.id==="schp-bill-type"){
                let bt = document.getElementById("schp-bill-type");
                if(bt && billType) bt.value = billType;
            }
            schpApplyTypeDefaults(type);
        }
    }
}

// sensible tag/colour defaults when creating a new event of a given type
function schpApplyTypeDefaults(type){
    if(schpEditingId) return;
    let tagInput = document.getElementById("schp-tag");
    if(!tagInput || tagInput.value) return;
    let defaults = {
        reminder: {tag:"Reminder", color:"#4B0082"},
        "bill-payment": {tag:"Payment collection", color:"#0000FF"},
        "order-bill": {tag:"Billing", color:"#0000FF"},
        print: {tag:"Print", color:"#4B0082"},
        mail: {tag:"Email", color:"#4B0082"},
        task: {tag:"Task", color:"#4B0082"}
    };
    let d = defaults[type];
    if(d){
        tagInput.value = d.tag;
        document.getElementById("schp-color").value = d.color;
    }
}

function schpSubmit(e){
    e.preventDefault();
    if(e.target.id==="schp-settings-form"){
        let data = Object.fromEntries(new FormData(e.target).entries());
        ipcRenderer.invoke("scheduler-set-settings", {
            burstEnabled: data.burstEnabled==="1",
            burstThreshold: Math.max(1, Number(data.burstThreshold) || 5),
            burstPrintMode: data.burstPrintMode,
            burstPrinter: data.burstPrinter || "",
            copies: Math.max(1, Number(data.copies) || 1)
        }).then(()=>{
            schpToast("Settings saved.");
            schpRefresh();
        });
        return;
    }
    if(e.target.id!=="schp-editor-form") return;
    let data = Object.fromEntries(new FormData(e.target).entries());
    let evObj = schpBuildEvent(data);
    let flag = schpEditingId ? "e" : "a";
    ipcRenderer.invoke("scheduler-save-event", evObj, flag).then(res=>{
        if(res && res.ok){
            schpToast(schpEditingId ? "Event updated." : "Event scheduled.");
            schpEditorOpen = false;
            schpEditingId = null;
            schpRefresh();
        }
        else
            schpToast((res && res.error) || "Could not save the event.", true);
    });
}

function schpBuildEvent(data){
    let type = data.type || "reminder";
    let action = type==="print" ? "print" : type==="task" ? "task" : type==="mail" ? "mail" : "notify";
    let billObj = {};
    let billType = data.billType || "";
    if(["bill-payment","order-bill","print","mail"].includes(type)){
        if(type==="mail") billType = "sales-select"; // the email service sends sale bills
        billType = type==="order-bill" ? (billType || "orders-select") : billType;
        billObj = schpFindBill(billType, data.billNo);
    }
    return {
        id: schpEditingId || "",
        label: data.label,
        type,
        action,
        time: new Date(data.time).toISOString(),
        tag: data.tag || "",
        color: data.color || "#4B0082",
        note: data.note || "",
        billType: ["bill-payment","order-bill"].includes(type) ? billType : "",
        billObj,
        task: type==="task" ? {prompt: data.prompt || ""} : {prompt:""},
        print: type==="print" ? {
            mode: data.printMode==="manual" ? "manual" : "silent",
            printer: data.printer || "",
            copies: Math.max(1, Number(data.copies) || 1),
            paperSize: data.paperSize || "A4"
        } : {mode:"silent", printer:"", copies:1, paperSize:"A4"},
        mail: type==="mail" ? {to: (data.mailTo || "").trim()} : {to:""}
    };
}

// embed the selected bill's row (with id = customer/supplier id for matching)
function schpFindBill(billType, billNo){
    if(!schpBills) return {};
    let list = billType==="purchase-select" ? schpBills.purchases :
               billType==="orders-select" ? schpBills.orders :
               schpBills.sales;
    let row = list.find(r=>String(r.billNo)===String(billNo));
    if(!row) return {};
    return {...row, id: row.customerId != null ? row.customerId : row.id};
}

async function schpLoadBills(){
    if(schpBills) return schpBills;
    let [sales,purchases,orders] = await Promise.all([
        ipcRenderer.invoke("get-sales"),
        ipcRenderer.invoke("get-purchases"),
        ipcRenderer.invoke("get-orders")
    ]);
    schpBills = {
        sales: Array.isArray(sales) ? sales : [],
        purchases: Array.isArray(purchases) ? purchases : [],
        orders: Array.isArray(orders) ? orders : []
    };
    return schpBills;
}

function schpRefreshEditorFields(){
    let fields = document.getElementById("schp-type-fields");
    if(!fields || !schpEditorOpen) return;
    let type = document.getElementById("schp-type").value;
    let ev = schpEditingId
        ? schpState.schedules.find(item=>item.id===schpEditingId)
        : null;
    fields.innerHTML = schpTypeFieldsHTML(type, ev);
}
