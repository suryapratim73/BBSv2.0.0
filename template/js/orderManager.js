const { ipcRenderer } = require("electron");
const { toggleDevTool, showToastNotification, execRetractHandler, retractHandler, roundOffTo2DecimalPlace, drawSpinner, noDataPlaceholder, bodyRow:bodyRowGen, removeAllElem, appendToDL, applyTheme, bodyRowInpFillup, applySpinner, tableFillupHelper, appendToHost, openFormatForDate, reInitFuzzyIndexWithOrderID, fuzzySearchHandler, traverseParent, getOrderIds } = require("../js/common");
const fs = require("fs");

toggleDevTool(document);

let presetFlag = false,currentStep = 1,
    billMeta = {},
    bodyRow,
    customerNameDatalist = document.createElement("datalist"),
    orderItems = [],
    customer = {},
    preset,
    currentTab = "orders",
    orders = [],
    proformas = [];

customerNameDatalist.id = "customer-names";

async function init(){
    let spinner = drawSpinner(document);
    await appendToDL.call({tableName:"customer"},"get-customers",customerNameDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
    if(presetFlag) return (()=>spinner.remove(window) && proceedHandler())();
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    preset = await ipcRenderer.invoke("get-presets");
    [orders, proformas] = await Promise.all([
        ipcRenderer.invoke("get-orders"),
        ipcRenderer.invoke("get-proformas"),
    ]);
    reInitFuzzyIndexWithOrderID([
        ...(Array.isArray(orders) ? orders.map(obj=>({orderId:obj.orderId,name:obj.name})) : []),
        ...(Array.isArray(proformas) ? proformas.map(obj=>({orderId:obj.proformaId,name:obj.name})) : []),
    ],customerNameDatalist);
    wirePage1();
    renderTable();
    spinner.remove(window);
};
init();

function wirePage1(){
    [...document.querySelectorAll(".tab-btn")]
    .forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));
    document.getElementById("new-entry-btn").addEventListener("click",()=>{
        // Proforma tab "+" opens the sale page in proforma mode; orders are
        // created from the sale page's "Save as Order" button, so the orders
        // tab "+" opens a regular new sale.
        ipcRenderer.send("new-sale-purchase", currentTab === "proformas" ? 3 : 1);
    });
}

function switchTab(tab){
    currentTab = tab;
    syncTabUI();
    renderTable();
}

function syncTabUI(){
    [...document.querySelectorAll(".tab-btn")]
    .forEach(btn=>{
        btn.classList.toggle("active", btn.dataset.tab === currentTab);
        btn.setAttribute("aria-selected", String(btn.dataset.tab === currentTab));
    });
    document.getElementById("list-title").textContent =
        currentTab === "proformas" ? "Proforma bills" : "Unbilled orders";
    document.getElementById("new-entry-btn").dataset.msg =
        currentTab === "proformas" ? "Create new proforma bill" : "Create new order";
    document.getElementById("search-input").placeholder =
        currentTab === "proformas"
            ? "Search proforma bills by customer name..."
            : "Search orders by customer name...";
}

function proformaRow({obj, index}){
    let div = document.createElement("div");
    div.dataset.obj = JSON.stringify(obj);
    div.dataset.identifier = "proforma";
    div.className = "body row";
    ["slNo","billDate","name","netAmtTax","status"].forEach(col=>{
        let p = document.createElement("p");
        p.className = "col eq-space";
        if(col==="slNo") p.textContent = index + 1;
        else if(col==="netAmtTax") p.textContent = Math.round(obj.netAmtTax || 0);
        else p.textContent = obj[col] != null ? String(obj[col]) : "";
        div.appendChild(p);
    });
    let actions = document.createElement("div");
    actions.className = "col eq-space proforma-actions";
    let convertBtn = document.createElement("button");
    convertBtn.textContent = "Convert";
    convertBtn.dataset.cmd = "convert";
    convertBtn.dataset.proformaId = obj.proformaId;
    convertBtn.dataset.msg = "Convert this proforma bill to a real invoice";
    convertBtn.className = "hover bottom";
    let delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.dataset.cmd = "delete-proforma";
    delBtn.dataset.proformaId = obj.proformaId;
    delBtn.dataset.msg = "Delete this proforma bill permanently";
    delBtn.className = "hover bottom";
    actions.appendChild(convertBtn);
    actions.appendChild(delBtn);
    div.appendChild(actions);
    return div;
}

function renderTable(){
    syncTabUI();
    let ordersTbody = document.querySelector("#orders-table .tbody");
    let proformasTbody = document.querySelector("#proformas-table .tbody");
    document.getElementById("orders-table").classList.toggle("hide", currentTab !== "orders");
    document.getElementById("proformas-table").classList.toggle("hide", currentTab !== "proformas");
    ordersTbody.replaceChildren();
    proformasTbody.replaceChildren();
    if(currentTab === "orders"){
        if(!Array.isArray(orders) || orders.length===0)
            return noDataPlaceholder(ordersTbody);
        tableFillupHelper(orders,"#orders-table .row.head .col>p","#orders-table .tbody",bodyRowGen);
    } else {
        if(!Array.isArray(proformas) || proformas.length===0)
            return noDataPlaceholder(proformasTbody);
        proformas.forEach((obj,index)=>proformasTbody.appendChild(proformaRow({obj,index})));
    }
}

function proceedHandler(){
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    let isProforma = billMeta.billType === "proforma";
    document.getElementById("details-title").textContent =
        isProforma ? "Proforma Details" : "Order Details";
    // Proformas are quotes — no payments, no order-editing
    document.getElementById("payment-history").classList.toggle("hide", isProforma);
    document.querySelector('.btn-container [data-cmd="edit"]').classList.toggle("hide", isProforma);
    document.querySelector('.btn-container [data-cmd="convert"]').classList.toggle("hide", !isProforma);
    [...document.querySelectorAll("#meta>div>p:last-child")]
    .forEach(p=>{
        let col = p.dataset.col;
        if(col === "netPayment" && billMeta?.payment)
            p.textContent = billMeta.netPayment ?? billMeta.payment.reduce((a, obj) => a + (obj.payment || 0), 0);
        else{
            let val = billMeta?.[col] || customer?.[col];
            if(col === "paymentStatus")
                p.textContent = val ? "Paid" : "Unpaid";
            else
                p.textContent = col==="billDate" ? openFormatForDate(`${val}`) : val;
        }
    });
    tableFillupHelper((orderItems ?? []),"#item-table .row.head p","#item-table .tbody",bodyRowGen);
    let payHistDiv = document.querySelector("#payment-history>div");
    billMeta?.payment?.forEach(payObj=>{
        let payObjDiv = document.getElementById("pay-object-template").content.cloneNode(true).querySelector("div");
        payHistDiv.appendChild(payObjDiv);
        [...payObjDiv.querySelectorAll("[data-col]")]
        .forEach(p=>{
            if(p.dataset.col==="date" && "date" in payObj)
                p.textContent = payObj.date;
            else
            if(p.dataset.col==="date" && !("date" in payObj))
                p.textContent = billMeta.billDate;
            else
                p.textContent = payObj[p.dataset.col];
        });
    });
}

async function clickHandler(e){
    let cmd;
    if("cmd" in e.target.dataset)
        cmd = e.target.dataset.cmd;
    else
    if(currentStep===1)
        cmd = e.target.closest(".tbody").dataset.cmd;
    if(cmd==="open-order"){
        let bodyRow = e.target?.closest?.(".body.row");
        let orderId = JSON.parse((bodyRow?.dataset?.obj || "{}"))?.orderId  || e?.target?.dataset?.orderId;
        let orderObj = await ipcRenderer.invoke("get-order",orderId);
        billMeta = orderObj.billMeta;
        billMeta.orderId = orderId;
        customer = orderObj.customer;
        orderItems = orderObj.orderItems;
        currentStep = 2;
        applySpinner(proceedHandler);
    }
    if(cmd==="open-proforma"){
        let bodyRow = e.target?.closest?.(".body.row");
        let proformaId = JSON.parse((bodyRow?.dataset?.obj || "{}"))?.proformaId || e?.target?.dataset?.proformaId;
        let proformaObj = await ipcRenderer.invoke("get-proforma",proformaId);
        if(!proformaObj) return;
        billMeta = proformaObj.billMeta;
        billMeta.proformaId = proformaId;
        customer = proformaObj.customer;
        orderItems = proformaObj.orderItems;
        currentStep = 2;
        applySpinner(proceedHandler);
    }
    if(cmd==="edit"){
        currentStep = 2;
        ipcRenderer.send("open-sale-in-order-mode",{billMeta,orderItems,customer});
    }
    else
    if(cmd==="convert"){
        // Row-level Convert carries the full record in the row's dataset;
        // the details-page Convert falls back to the loaded state.
        let row = e.target?.closest?.(".body.row");
        let obj = row?.dataset?.obj ? JSON.parse(row.dataset.obj) : {billMeta,orderItems,customer};
        ipcRenderer.send("open-sale-from-proforma",{
            billMeta:obj.billMeta,
            orderItems:obj.orderItems,
            customer:obj.customer,
            proformaId:obj.proformaId || billMeta.proformaId,
        });
    }
    else
    if(cmd==="delete-order"){
        if(billMeta.billType==="proforma"){
            if(confirm("Delete this proforma bill? This action cannot be undone.")){
                ipcRenderer.invoke("manage-proforma", {proformaId:billMeta.proformaId}, "proforma-deleted");
                currentStep = 1;
                presetFlag = false;
                applySpinner(init);
            }
        }
        else
        if(confirm("Delete this order? This action cannot be undone.")){
            ipcRenderer.invoke("manage-order", billMeta, "order-deleted");
            currentStep = 1;
            presetFlag = false;
            applySpinner(init);
        }
    }
    else
    if(cmd==="delete-proforma"){
        let proformaId = e.target.dataset.proformaId;
        if(confirm("Delete this proforma bill? This action cannot be undone.")){
            ipcRenderer.invoke("manage-proforma", {proformaId}, "proforma-deleted");
            currentStep = 1;
            presetFlag = false;
            applySpinner(init);
        }
    }
    else
    if(cmd==="back-page1"){
        currentStep = 1;
        presetFlag = false;
        init();
    }
}

ipcRenderer.on("billing-complete",()=>{
    clickHandler({target:{dataset:{cmd:"back-page1"}}})
});

ipcRenderer.on("view-order",async (e,orderId)=>{
    presetFlag = true;
    currentStep = 2;
    applySpinner(()=>clickHandler({target:{dataset:{cmd:"open-order",orderId}}}));
});

ipcRenderer.on("view-proforma",async (e,proformaId)=>{
    presetFlag = true;
    currentStep = 2;
    applySpinner(()=>clickHandler({target:{dataset:{cmd:"open-proforma",proformaId}}}));
});

ipcRenderer.on("refresh-orders",()=>{
    if(currentStep === 1) init();
});

// Right-click context menu on rows (page 1) — orders and proformas have
// their own menu sets (orderManagerObj / proformaObj) in the main process.
document.addEventListener("contextmenu", e => {
    if(currentStep !== 1) return;
    let row = traverseParent(e.target, "body");
    if(!row || !row.dataset.obj) return;
    e.preventDefault();
    let obj = JSON.parse(row.dataset.obj);
    if(currentTab === "proformas")
        ipcRenderer.send("show-context-menu", { mode: "proformaObj", obj, targetWin:"manage-order" });
    else
        ipcRenderer.send("show-context-menu", { mode: "orderManagerObj", obj, targetWin:"manage-order" });
});

// document.addEventListener("keydown",e=>{
// });

function selectionHandler2(e){
    let input = e.target;
    let value = input.value;
    let orderIds = getOrderIds(value) || [];
    [...document.querySelectorAll(".body.row")]
    .forEach(row=>{
        let obj = JSON.parse(row.dataset.obj);
        let id = obj.orderId || obj.proformaId;
        if(orderIds.includes(id))
            row.classList.remove("hide");
        else
            row.classList.add("hide");
    })
}