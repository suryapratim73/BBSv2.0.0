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
    preset;

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
    let orders = await ipcRenderer.invoke("get-orders");
    reInitFuzzyIndexWithOrderID(orders.map(obj=>({orderId:obj.orderId,name:obj.name})),customerNameDatalist);
    let orderTbody = document.querySelector("#page-1 .tbody");
    if(!Array.isArray(orders) || orders.length===0)
        return spinner.remove(window) && noDataPlaceholder(orderTbody);
    tableFillupHelper(orders,"#page-1 .row.head .col>p","#page-1 .tbody",bodyRowGen);
    spinner.remove(window);
};
init();

function proceedHandler(){
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    [...document.querySelectorAll("#meta>div>p:last-child")]
    .forEach(p=>{
        let col = p.dataset.col;
        if(col === "netPayment" && billMeta?.payment)
            p.textContent = billMeta.netPayment ?? billMeta.payment.reduce((a, obj) => a + (obj.payment || 0), 0);
        else{
            let val = billMeta?.[col] || customer?.[col];
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
        let bodyRowGen = e.target?.closest?.(".body.row");
        let orderId = JSON.parse((bodyRowGen?.dataset?.obj || "{}"))?.orderId  || e?.target?.dataset?.orderId;
        let orderObj = await ipcRenderer.invoke("get-order",orderId);
        billMeta = orderObj.billMeta;
        billMeta.orderId = orderId;
        customer = orderObj.customer;
        orderItems = orderObj.orderItems;
        currentStep = 2;
        applySpinner(proceedHandler);
    }
    if(cmd==="edit"){
        currentStep = 2;
        ipcRenderer.send("open-sale-in-order-mode",{billMeta,orderItems,customer});
    }
    else
    if(cmd==="delete-order"){
        if(confirm("Delete this order? This action cannot be undone.")){
            ipcRenderer.invoke("manage-order", billMeta, "order-deleted");
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

ipcRenderer.on("refresh-orders",()=>{
    if(currentStep === 1) init();
});

// Right-click context menu on order rows (page 1)
document.addEventListener("contextmenu", e => {
    if(currentStep !== 1) return;
    let row = traverseParent(e.target, "body");
    if(!row || !row.dataset.obj) return;
    e.preventDefault();
    let obj = JSON.parse(row.dataset.obj);
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
        if(orderIds.includes(obj.orderId))
            row.classList.remove("hide");
        else
            row.classList.add("hide");
    })
}