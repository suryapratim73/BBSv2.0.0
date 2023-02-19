const { toggleDevTool,reduceOrder,clickOrFocusinHandler,deleteRowCommon,applyDiscount,closeToast,reassignSummaryDivFeilds,showPaymentMode,updateBillValue,showToastNotification,roundOffTo2DecimalPlace,validateInput2,validateInput,calculateAmounts,addRow,appendToDL,getsaleConfigPolicyPath,applyTheme,selectionHandler, removeAllElem } = require("../js/common");
const fs = require("fs");
const { ipcRenderer } = require("electron");


const { unitMap = [] } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

toggleDevTool(document);

let choice,
    nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    transporterDatalist = document.createElement("datalist"),
    unitDatalist = document.createElement("datalist"),
    currentStep,orderItems = [],billMeta = {
        paymentStatus:false,
        netDue:0,
        deliveryType:"hand",
        discVal:0,
        transportCharge:0
    }, payment = [], mode, selectedItem, timer;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";

let host = document.getElementById("mode-host");

async function init(){
    appendToDL("get-stocks",nameDatalist);
    appendToDL("get-services",nameDatalist);
    appendToDL("get-customers",customerNameDatalist);
    appendToDL("get-transporter",transporterDatalist)
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key==="Bag"?"Bag (=50 Kg)":key;
        unitDatalist.appendChild(option);
    });
    document.body.appendChild(unitDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
}
init();// Datalist linking and selection handler work

function deleteRow(){
    orderItems = deleteRowCommon(bodyRow,orderItems,"sellId");
}

function firstChoice(e){
    choice = Number(e.target.dataset.choice);
    if(!choice) return;
    document.getElementById("first-display").classList.add("hide");
    document.querySelector("main").classList.remove("hide");
    let formId;
    if(choice===1){//Detail
        currentStep = 1;
        formId = `step-${currentStep}-template`;
        mode = "detail";
    }
    else{//quick
        currentStep = 2;
        formId = `step-${currentStep}-quick-template`;
        mode = "quick";
    }
    let progressMap = document.getElementById(`progress-map-${mode=='quick'?mode+"-":""}template`).content.cloneNode(true);
    document.getElementById("progress-map").appendChild(progressMap);
    billMeta.orderMode = mode;
    let form = document.getElementById(formId)?.content.cloneNode(true).querySelector("form");
    host.appendChild(form);
    if(mode==="quick"){
        document.querySelector("#tbody").addEventListener("focusin",clickOrFocusinHandler);
        document.querySelector("#tbody").addEventListener("click",clickOrFocusinHandler);
    }
}

function progressBarControl(reverse=false){
    let index1,index2;
    if(reverse===true){
        if(mode==="detail"){
            index1 = currentStep + 1;
            index2 = currentStep;
        }
        else{
            index1 = 4;
            index2 = 2;
        }
        document.querySelector(`.step[data-step="${index1}"]`).className = "step fas fa-check-circle done";
        document.querySelector(`.step[data-step="${index2}"]`).className = "step far fa-circle progress";
    }
    else{
        if(mode==="detail"){
            index1 = currentStep;
            index2 = currentStep + 1;
        }
        else{
            index1 = 2;
            index2 = 4;
        }
        document.querySelector(`.step[data-step="${index1}"]`).className = "step fas fa-check-circle done";
        document.querySelector(`.step[data-step="${index2}"]`).className = "step far fa-circle progress";
    }
}

function proceedOrFinishHandler(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    if(currentStep===4)
        return ipcRenderer.send("manage-order",{billMeta,mode:e.submitter.dataset.mode});
    progressBarControl();
    if(currentStep===1 && mode==="detail")
        billMeta = { ...billMeta,...data };
    if(currentStep<4 && mode==="detail"){
        removeAllElem("#mode-host *");
        currentStep++;
        let form = document.getElementById(`step-${currentStep}-template`)?.content.cloneNode(true).querySelector("form");
        host.appendChild(form);
        if(currentStep===2)
            document.querySelector("#tbody")?.addEventListener("focusin",clickOrFocusinHandler);
            document.querySelector("#tbody")?.addEventListener("click",clickOrFocusinHandler);
    }
    else
    if(currentStep===2 && mode==="quick"){
        document.querySelector("#mode-host *").classList.add("hide");
        currentStep = 4;
        if(!document.getElementById("step-4-form")){
            let form = document.getElementById(`step-${currentStep}-template`)?.content.cloneNode(true).querySelector("form");
            host.appendChild(form);
        }
        else
            document.getElementById("step-4-form").classList.remove("hide");
        let { netAmtTax,netAmt,netTax } = reduceOrder();
        data.transportCharge = Number(data.transportCharge);
        billMeta = {
            ...billMeta,
            ...data,
            deliveryType:data.transportCharge>0?"transport":"hand",
            billType:"order",
            netAmt,
            netAmtTax,
            netTax
        }
    }
    if(currentStep===3 && mode==="detail"){
        billMeta.transportCharge = Number(data.transportCharge);
        if(billMeta.transportCharge>0)
            billMeta.deliveryType = "transport";
        billMeta.billType = "order";
        let { netAmtTax,netAmt,netTax } = reduceOrder();
        billMeta.netAmtTax = netAmtTax;
        billMeta.netAmt = netAmt;
        billMeta.netTax = netTax;
        document.querySelector(`#summary-div [data-name="netAmtTax"]`).textContent = Math.round(netAmtTax);
        document.querySelector(`#summary-div [data-name="netAmtTaxDel"]`).textContent = Math.round(netAmtTax + billMeta.transportCharge);
        document.querySelector(`#summary-div [data-name="transportCharge"]`).textContent = Math.round(billMeta.transportCharge);
        document.querySelector(`#summary-div [data-name="dueAmt"]`).textContent = Math.round(netAmtTax + billMeta.transportCharge);
    }
    else
    if(currentStep===4){
        let orderHost = document.querySelector("#order-host .tbody");
        let itemDivTemplate = document.getElementById("item-div-template");
        billMeta.payment = payment;
        billMeta.orderItems = orderItems;
        billMeta.netPayment = payment.reduce((acc,{payment})=>acc+payment,0);
        orderItems.forEach(({name,qty})=>{
            let itemDiv = itemDivTemplate.content.cloneNode(true).querySelector("div");
            itemDiv.querySelector(`[data-col="name"]`).textContent = name;
            itemDiv.querySelector(`[data-col="qty"]`).textContent = qty;
            orderHost.appendChild(itemDiv);
        });
        [...document.querySelectorAll("#order-meta>div>p:last-child")]
        .forEach(p=>{
            if(p.dataset.col!=="payment")
                p.textContent = typeof billMeta[p.dataset.col]!="boolean" ? billMeta[p.dataset.col] : (billMeta[p.dataset.col]==true?"Paid":"Unpaid");
            else
                p.textContent = billMeta.payment.reduce((acc,{payment})=>acc+payment,0);
        });
    }
}

function clickHandler(e){
    let { mode,step } = e.target.dataset;
    if(mode==="cancel")
        window.close();
    if(e.target.type==="submit" || mode!=="back") return mode!==undefined && console.log(mode);
    // mode===back
    let form;
    if(billMeta.orderMode==="detail"){
        removeAllElem("#mode-host *");
        currentStep = Number(step);
        form = document.getElementById(`step-${currentStep}-template`)?.content.cloneNode(true).querySelector("form");
        host.appendChild(form);
    }
    else
        currentStep = 2;
    progressBarControl(true);
    if(step=="1" && billMeta.orderMode==="detail")
        [...form.querySelectorAll("input")]
        .forEach(input=>{
            input.value = billMeta[input.name];
        });
    else
    if(step=="2" && billMeta.orderMode==="detail"){// ordered items
        orderItems.forEach(itemObj=>{
            document.querySelector("#add-item>button").click();
            selectedItem = itemObj;
            [...document.querySelectorAll(`.body.row:nth-last-child(2) input`)]
            .forEach(input=>{
                if(input.dataset.name!=="unit")
                    input.value = itemObj[input.dataset.name];
                else
                    [...input.list.querySelectorAll("option")]
                    .forEach(opt=>{
                        if(opt.value===itemObj.sellUnit){
                            opt.setAttribute("selected",true);
                            input.value = itemObj.sellUnit;
                        }
                        else
                            opt.removeAttribute("selected");
                    });
            });
            calculateAmounts();
        });
        if(billMeta.deliveryType!=="hand")
            form.transportCharge.value = billMeta.transportCharge;
    }
    else
    if(step=="3" && billMeta.orderMode==="detail"){
        payment.forEach((payObj,i)=>{
            if(i===0)
                [...form.querySelectorAll("#payment-mode select>option")]
                .forEach(option=>{
                    if(option.value===payObj.type)
                        option.setAttribute("selected",true);
                })
            let payDiv = form.querySelector(`#${payObj.type}-payment`);
            if(i==0)
                payDiv.classList.remove("hide");
            [...payDiv.querySelectorAll("input,select")]
            .forEach(input=>{
                if(input.dataset.name!=="paymentStatus")
                    input.value = payObj[input.dataset.name];
                else
                    input.querySelector(`option[value="${billMeta.paymentStatus}"]`).setAttribute("selected",true);
            });
        });
        if(billMeta.discVal>0){
            document.querySelector("#discount-div input").value = billMeta.discVal;
            applyDiscount({target:{value:billMeta.discVal}});
        }
        document.querySelector("#summary-div p[data-name='netAmtTax']").textContent = Math.round(billMeta.netAmtTax);
        document.querySelector("#summary-div p[data-name='transportCharge']").textContent = billMeta.transportCharge;
        document.querySelector("#summary-div p[data-name='netAmtTaxDel']").textContent = Math.round(billMeta.netAmt);
        document.querySelector("#summary-div p[data-name='paymentAmt']").textContent = billMeta.netPayment;
        document.querySelector("#summary-div p[data-name='dueAmt']").textContent = Math.round(billMeta.netAmtTax - billMeta.payment + billMeta.transportCharge)>=0?Math.round(billMeta.netAmtTax - billMeta.payment + billMeta.transportCharge):0;
        document.querySelector("#summary-div p[data-name='return']").textContent = Math.abs(Math.round(billMeta.netAmtTax - billMeta.netPayment));
    }
    else
    if(step=="3" && billMeta.orderMode==="quick"){
        document.getElementById("step-4-form").classList.add("hide");
        document.getElementById("step-2-form").classList.remove("hide");
    }
}

function updatePayStatus(e){
    billMeta.paymentStatus = "paymentStatus" in billMeta? billMeta.paymentStatus : false;
    if(e)
        billMeta.paymentStatus = e.target.value==="true";
    if(billMeta.paymentStatus)
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"page-4",32);
    else
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
}

document.addEventListener("keydown",e=>{
    if(e.ctrlKey && e.key==="Enter")
        document.querySelector("[data-type='proceed']").click();
    else
    if(e.ctrlKey && e.key==="ArrowLeft" && currentStep>1)
        document.querySelector('[data-mode="back"]')?.click();
    if(e.ctrlKey && e.key==="+")
        document.querySelector("#add-item>button").click();
    if(e.shiftKey && e.key==="Delete")
        deleteRow();
    if(e.ctrlKey && e.key==="p" && currentStep===4 && billMeta.billType==="regular")
        document.querySelector(`[data-mode="proforma"]`).click();
});