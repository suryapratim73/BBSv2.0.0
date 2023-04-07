const { ipcRenderer } = require("electron");
const { toggleDevTool, showToastNotification, updateBillValue, showPaymentMode, execRetractHandler, deleteKey, assignDeliveryOptions, validateInput, retractHandler, validateInput2, selectionHandler, deleteRowCommon, clickOrFocusinHandler, calculateAmounts, roundOffTo2DecimalPlace, getsaleConfigPolicyPath, drawSpinner, noDataPlaceholder, bodyRow:bodyRowGen, removeAllElem, addRow, appendToDL, applyTheme, bodyRowInpFillup, applySpinner, reduceOrder, tableFillupHelper, appendToHost } = require("../js/common");
const fs = require("fs");

toggleDevTool(document);

let preset = false,currentStep = 1,
    billMeta,bodyRow,selectedItem,
    nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    transporterDatalist = document.createElement("datalist"),
    unitDatalist = document.createElement("datalist"),
    orderItems = [],timer,payment = [],customer;

const { unitMap = [] } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";

async function init(){
    let spinner = drawSpinner(document);
    if([...nameDatalist.querySelectorAll("option")].length===0){
        appendToDL("get-stocks",nameDatalist);
        appendToDL("get-services",nameDatalist);
        appendToDL("get-customers",customerNameDatalist);
        appendToDL("get-transporter",transporterDatalist);
        unitMap.forEach(obj=>{
            let key = Object.keys(obj)[0];
            let option = document.createElement("option");
            option.value = key;
            option.textContent = key==="Bag"?"Bag (=50 Kg)":key;
            unitDatalist.appendChild(option);
        });
        document.body.appendChild(unitDatalist);
    }
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
    if(preset) return (()=>spinner.remove(window) && proceedHandler())();
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    let orders = await ipcRenderer.invoke("get-orders");
    let orderTbody = document.querySelector("#page-1 .tbody");
    if(!("fileList" in orders) || orders.fileList.length===0) 
        return spinner.remove(window) && noDataPlaceholder(orderTbody);
    tableFillupHelper(orders.fileList,"#page-1 .row.head .col>p","#page-1 .tbody",bodyRowGen);
    spinner.remove(window);
};
init();

function proceedHandler(){
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    if(currentStep===2){
        [...document.querySelectorAll("#meta>div>p:last-child")]
        .forEach(p=>p.textContent=billMeta[p.dataset.col]);
        tableFillupHelper(billMeta.orderItems,"#item-table .row.head p","#item-table .tbody",bodyRowGen);
        let payHistDiv = document.querySelector("#payment-history>div");
        billMeta.payment.forEach(payObj=>{
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
        orderItems = JSON.parse(JSON.stringify(billMeta.orderItems));
    }
    else
    if(currentStep===4){
        tableFillupHelper(orderItems,"#item-table .row.head p","#item-table .tbody",bodyRowGen);
        let reviewMetaDiv = document.querySelector("#review-meta");
        let reducedObj = reduceOrder();
        reducedObj.netTax = roundOffTo2DecimalPlace(reducedObj.netAmtTax-reducedObj.netAmt);
        let reviewMetaEntryDiv = document.getElementById("review-meta-template").content.cloneNode(true).querySelector("div");
        reviewMetaDiv.appendChild(reviewMetaEntryDiv);
        Object.keys(reducedObj)
        .forEach(key=>{
            let col = reviewMetaEntryDiv.querySelector(`[data-col="${key}"]`);
            if(col)
                col.textContent = reducedObj[key];
        });
    }
    else
    if(currentStep===5){
        billMeta.orderItems = orderItems;
        checkBillComplaince();
    }
}

async function checkBillComplaince(){
    removeAllElem("#host *");
    let host = document.getElementById("host");
    if(!("name" in billMeta)){
        appendToHost("#customer-info-template",host);
        currentStep = 1;
    }
    else
    if(!("billNo" in billMeta)){
        let billMetaForm = appendToHost("#bill-meta-template",host);
        let billNo = await ipcRenderer.invoke("get-sale-bill-number");
        billMetaForm.querySelector("[name='billDate']").valueAsDate = new Date();
        billMetaForm.querySelector("[name='billNo']").value = billNo;
    }
    else
    if(billMeta.paymentStatus===false && billMeta.netPayment<billMeta.netAmtTax){
        payment = billMeta.payment;
        appendToHost("#payment-div-template",host);
    }
    else
    if(billMeta.paymentStatus)
        submitHandler({target:{dataset:{id:"payment-div"}}});
}

function submitHandler(e){
    let data = {};
    if(e && "preventDefault" in e){
        e.preventDefault();
        data = Object.fromEntries(new FormData(e.target).entries());
    }
    if("phones" in data)
        data.phones = [data.phones];
    let { id } = e.target.dataset;
    if(id==="cust-form"){
        data.id = customer.id;
        billMeta = { ...billMeta,...data,customer:data };
    }
    if(id==="bill-meta"){
        billMeta = { ...billMeta,billMeta:data,...data };
        billMeta.billMeta.autoBill = e.target["auto-bill"].checked;
    }
    if(id==="payment-div"){
        billMeta.payment = [ ...billMeta.payment,...payment ];
        [...document.querySelectorAll("button[disabled]")]
        .forEach(btn=>btn.removeAttribute("disabled"));
        removeAllElem("#host *");
        appendToHost("#ready-for-billing-template",document.getElementById("host"),"div");
        // CSS work left
        // Backend work left
        return;
    }
    checkBillComplaince();
}

async function clickHandler(e){
    let cmd;
    if("cmd" in e.target.dataset)
        cmd = e.target.dataset.cmd;
    else
    if(currentStep===1)
        cmd = e.path.find(elem=>elem.classList.contains("tbody")).dataset.cmd;
    if(cmd==="open-order"){
        let bodyRowGen = e.path.find(elem=>elem.classList.contains("body") && elem.classList.contains("row"));
        let orderObj = JSON.parse(bodyRowGen.dataset.obj);
        let { orderId } = orderObj;
        billMeta = await ipcRenderer.invoke("get-order",orderId);
        billMeta.orderId = orderId;
        currentStep = 2;
        applySpinner(proceedHandler);
    }
    else
    if(cmd==="edit"){
        currentStep = 3;
        removeAllElem(".page");
        applySpinner(()=>{
            let editPage = document.getElementById("edit-order-template").content.cloneNode(true).querySelector("div");
            document.body.appendChild(editPage);
            orderItems = JSON.parse(JSON.stringify(billMeta.orderItems));
            orderItems.forEach(itemObj=>bodyRowInpFillup(itemObj));
            document.querySelector("#tbody").addEventListener("focusin",clickOrFocusinHandler);
            document.querySelector("#tbody").addEventListener("click",clickOrFocusinHandler);
        });
    }
    else
    if(cmd==="proceed"){
        currentStep = 4;
        applySpinner(proceedHandler);
    }
    else
    if(cmd==="cancel"){
        currentStep = 2;
        applySpinner(proceedHandler);
    }
    else
    if(cmd==="save"){
        billMeta.orderItems = orderItems;
        let resp = await ipcRenderer.invoke("manage-order",billMeta);
        if(resp===false || !resp) return;
        currentStep = 1;
        init();
    }
    else
    if(cmd==="create-bill"){
        currentStep = 5;
        applySpinner(proceedHandler);
    }
    else
    if(cmd==="back-page1"){
        currentStep = 1;
        preset = false;
        init();
    }
    else
    if(cmd==="save-bill" || cmd==="print"){
        if(!("customer" in billMeta)){
            customer = {...customerNameDatalist.querySelector(`option[data-name="${billMeta.name}"]`).dataset};
            billMeta.customer = {
                id:customer?.id,
                name:billMeta.name,
                email:billMeta.email,
                gst:billMeta.gst,
                address:billMeta.address,
                phones:[billMeta.phones]
            };
        }
        billMeta.billMeta = {
            ...(billMeta?.billMeta ?? {}),
            netDue:Number(billMeta.netDue),
            netTax:Number(billMeta.netTax),
            netAmt:Number(billMeta.netAmt),
            paymentStatus:billMeta.paymentStatus,
            billType:billMeta.billType,
            autoBill:billMeta?.autoBill ?? false,
            orderRef:billMeta.orderRef,
            netAmtTax:Number(billMeta.netAmtTax),
            payment:billMeta.payment,
            discVal:(billMeta?.discVal ?? 0),
            ...[
                "transportName",
                "transportId",
                "transportAddress",
                "transportContact"
            ].map(key=>{
                if(key in billMeta)
                    return { [key]:billMeta[key] };
                else
                    return;
            }).filter(obj=>!(typeof obj === "undefined"))
        };
        if(cmd==="print"){
            ipcRenderer.send("set-listener-order-manager");
            ipcRenderer.send("show-print-modal",{pageFit:"-o fit-to-page"});
        }
        else
            ipcRenderer.send("save-exit-sale-bill",billMeta,"order-billed");
    }
}

function deleteRow(){
    orderItems = deleteRowCommon(bodyRow,orderItems,"sellId");
}

function showPrintDialog(){
    // if(payment.length===0)
    //     payment.push({type:"due"})
    ipcRenderer.send("show-print-modal",{pageFit:"-o fit-to-page"});
}

ipcRenderer.on("billing-complete",()=>{
    clickHandler({target:{dataset:{cmd:"back-page1"}}})
});

async function contextCommon(e,obj,pageNo){
    preset = true;
    let { orderId } = obj;
    billMeta = await ipcRenderer.invoke("get-order",orderId);
    billMeta.orderId = orderId;
    currentStep = pageNo;
    applySpinner(proceedHandler);
}

ipcRenderer.on("generate-bill",contextCommon);

ipcRenderer.on("view-order",contextCommon);

ipcRenderer.on("printObj",(e,printObj)=>{
    billMeta.billMeta.printObj = printObj;
    ipcRenderer.send("salepage-print-doc",billMeta,"order-billed");
});

document.addEventListener("keydown",e=>{
    // if(e.ctrlKey && e.key==="Enter" && !e.shiftKey)
    //     document.querySelector("[data-type='proceed']").click();
    // else
    // if(e.ctrlKey && e.key==="ArrowLeft" && currentStep>1)
    //     document.querySelector('[data-mode="back"]')?.click();
    if(e.ctrlKey && e.key==="+")
        document.querySelector("#add-item>button").click();
    if(e.shiftKey && e.key==="Delete")
        deleteRow();
    if(e.ctrlKey && e.shiftKey && e.key==="Enter" && currentStep===3)
        document.querySelector(`[data-mode="proforma"]`).click();
});