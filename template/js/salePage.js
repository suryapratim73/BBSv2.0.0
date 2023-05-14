const { ipcRenderer } = require("electron");
const {toggleDevTool,reduceOrder,clickOrFocusinHandler,applyDiscount,reassignSummaryDivFeilds,showPaymentMode,updateBillValue,addRow,calculateAmounts,getsaleConfigPolicyPath,appendToDL,validateInput,roundOffTo2DecimalPlace, showToastNotification, closeToast, retractHandler, deleteRowCommon, applyTheme, removeAllElem,selectionHandler, assignDeliveryOptions, execRetractHandler, deleteKey, validateInput2, upperCaseInput } =  require("../js/common");
const uuid = require("uuid");
let fs = require("fs");

const { unitMap = [] } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

toggleDevTool(document);

let nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    customer = {},
    currentStep = 1, 
    selectedItem = {}, 
    orderItems = [], 
    billMeta = {},
    payment = [],
    transporterDatalist = document.createElement("datalist"),
    unitDatalist = document.createElement("datalist"),
    page2initialized = false,
    footer = document.querySelector("footer"),
    bodyRow,timer,currentBillNo;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";

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
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
    setFooter();
    document.body.appendChild(unitDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
}
init();// Datalist linking and selection handler work

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function stepDetail(){
    if(currentStep===1) return `Add <span class="highlight">customer</span> detail`;
    if(currentStep===2) return `Add <span class="highlight">bill</span> detail`;
    if(currentStep===3) return `Add <span class="highlight">item</span> detail`;
    if(currentStep===4) return `Add <span class="highlight">payment</span> detail`;
}

function setFooter(){
    let footerDF = document.getElementById("footer-template").content.cloneNode(true);
    [...footer.children].forEach(elem=>elem.remove());
    footer.appendChild(footerDF);
    if(currentStep<4){
        footer.querySelector(`[data-type="print"]`).classList.add("hide");
        footer.querySelector(`[data-type="save"]`).classList.add("hide");
        footer.querySelector(`[data-type="proceed"]`).classList.remove("hide");
    }
    else{
        if(billMeta.billType==="regular")
            footer.querySelector(`[data-type="print"]`).classList.remove("hide");
        else
            footer.querySelector(`[data-type="print"]`).classList.add("hide");
        footer.querySelector(`[data-type="save"]`).classList.remove("hide");
        footer.querySelector(`[data-type="proceed"]`).classList.add("hide");
    }
    if(currentStep==1)
        footer.querySelector(`[data-type="back"]`).classList.add("hide");
    else
        footer.querySelector(`[data-type="back"]`).classList.remove("hide");
}

function reInitFormData(){
    let main = document.querySelector("main");
    [ customer, billMeta, orderItems ]
    .forEach(obj=>{
        if(currentStep===3 && obj instanceof Array){//Step 3
            orderItems.forEach(itemObj=>{
                main.querySelector("#add-item > button").click();
                bodyRow = main.querySelector("#tbody .body.row:nth-last-child(2)");
                selectedItem = itemObj;
                [...bodyRow.querySelectorAll("input")]
                .forEach(input=>{
                    let key = input.dataset.name;
                    if(key!=="unit"){
                        if("rate" in itemObj && itemObj.rate>0 && key==="standardSellPrice")
                            input.value = itemObj.rate;
                        else
                            input.value = itemObj?.[key] ?? "";
                    }
                    else
                        input.value = itemObj.sellUnit;
                });
                calculateAmounts();
            });
        }
        else{// Step 1,2,4
            let inputs = [...main.querySelectorAll(`input,select`)];
            if(inputs.length===0) return;
            //Step 1,2
            for(let _index=0;_index<inputs.length;_index++){
                let input = inputs[_index];
                let key = input.dataset.name;
                if(!(key in obj)) break;
                if(["text","email"].includes(input.type)){
                    input.value = obj[key];
                    inputs.splice(_index,1);
                    _index--;
                }
                if(key==="billType" && obj[key]==="monthly"){
                    inputs.splice(_index,1);
                    _index--;
                    inputs.splice(inputs.findIndex(input=>input.dataset.name==="billType"),1);
                    main.querySelector("#bill-type-monthly").setAttribute("checked",true);
                    main.querySelector(".bill-number.regular").classList.add("hide");
                    main.querySelector(".bill-number.regular input").setAttribute("disabled",true);
                    main.querySelector(".bill-number.monthly").classList.remove("hide");
                    if("autoBill" in obj && obj.autoBill)
                        main.querySelector(".bill-number.monthly input[data-name='autoBill']").setAttribute("checked",true);
                    main.querySelector(`#bill-number-${obj.billNo}`).setAttribute("checked",true);
                    [...main.querySelectorAll(".bill-number.monthly input[data-name='billNo']")]
                    .forEach(input=>{
                        input.removeAttribute("disabled");
                    });
                    main.querySelector("#bill-status-open").setAttribute("checked",true);
                    main.querySelector("#bill-status-open").setAttribute("disabled",true);
                    main.querySelector("#bill-status-close").setAttribute("disabled",true);
                }
                if(key==="billDate")
                    input.valueAsDate = new Date(obj.billDate);
            }
            if(main.querySelector("#bill-number-regular") && obj.billType==="regular")
                main.querySelector("#bill-number-regular").value = billMeta.billNo;
            if("deliveryType" in obj && obj.deliveryType==="transport" && currentStep===2){
                main.querySelector("#delivery-mode option[value='transport']").setAttribute("selected",true);
                assignDeliveryOptions({value:"transport"});
                main.querySelector("input[data-name='transportName']").value = obj.transportName;
                main.querySelector("input[data-name='transportAddress']").value = obj.transportAddress ?? "";
                main.querySelector("input[data-name='transportContact']").value = obj.transportContact ?? "";
            }
            //Step 4
            if(!("payment" in billMeta)) return;
            billMeta.payment.forEach((payObj,i)=>{
                if(i===0)
                    showPaymentMode({value:payObj.type});
                Object.keys(payObj)
                .forEach(key=>{
                    let input = main.querySelector(`#${payObj.type}-payment input[data-name="${key}"]`);
                    if(input)
                        input.value = payObj[key];
                    if(billMeta.paymentStatus && payObj.type!=="cash")
                        main.querySelector(`#${payObj.type}-payment select[data-name="paymentStatus"] option[value="${billMeta.paymentStatus}"]`).setAttribute("selected",true);
                });
            });
            if("discVal" in billMeta)
                main.querySelector("#discount-div>input").value = billMeta.discVal;
            reassignSummaryDivFeilds();
        }
    });
}

async function mainForm(){
    removeAllElem("main *");
    let page = document.getElementById(`page-${currentStep}-template`).content.cloneNode(true).querySelector("div");
    document.querySelector("main").appendChild(page);
    if(currentStep===2 && !page2initialized){
        document.querySelector(`[data-name="billDate"]`).valueAsDate = new Date();
        billMeta.billDate = document.querySelector(`[data-name="billDate"]`).value;
        currentBillNo = await ipcRenderer.invoke("get-sale-bill-number");
        billMeta.billNo = currentBillNo;
        billMeta.billType = "regular";
        document.querySelector(`[data-name="billNo"]`).value = billMeta.billNo;
        page2initialized = true;
    }
    setFooter();
    if(currentStep===3){
        document.querySelector("#tbody")?.addEventListener("focusin",clickOrFocusinHandler);
        document.querySelector("#tbody")?.addEventListener("click",clickOrFocusinHandler);
    }
    if(currentStep===4)
        page4Init();
    reInitFormData();
}

function phoneRegExpInp(text){
    let numHead = "(\\+\\d+ )*";
    text = text.replace(/(\+\d+ )*/,"");
    text = numHead + text.substring(0,text.length/2)+ " *" + text.substring(text.length/2,text.length).trim();
    return text;
}

function advanceSet(target=[],newValue){
    if(typeof target==="string")
        target = JSON.parse(target);
    target.push(newValue);
    return target
            .filter((val,index,self)=>index===self.findIndex(_val=>new RegExp(phoneRegExpInp(val)).test(_val)))
            .map(val=>val.replace("\\",""));
}

function page4Init(){
    let netAmtTax = Math.round(billMeta.netAmtTax);
    document.querySelector("#summary-div .highlight").textContent = Math.round(netAmtTax);
    let deliveryCharge = billMeta.deliveryType==="hand"?0:Number(billMeta.transportCharge);
    document.querySelector("[data-name='delCharge']").textContent = deliveryCharge;
    document.querySelector("[data-name='netAmtTaxDel']").textContent = netAmtTax+deliveryCharge;
    let netPayment = "payment" in billMeta ? billMeta.payment.reduce((acc,obj)=>acc+obj.payment,0):0;
    if(netAmtTax+deliveryCharge-netPayment>0){
        document.querySelector(`[data-name="dueAmt"]`).textContent = netAmtTax+deliveryCharge-netPayment;
        document.querySelector(`[data-name="return"]`).textContent = 0;
    }
    else{
        document.querySelector(`[data-name="dueAmt"]`).textContent = 0;
        document.querySelector(`[data-name="return"]`).textContent = netPayment - (netAmtTax+deliveryCharge);
    }
    updatePayStatus();
}

function proceedOrFinishHandler(e){
    e && e.preventDefault();
    if(e.type==="submit"){
        if(currentStep!==3){ 
            let formObjs = {};
            let allInputs = [...e.target.querySelectorAll(`#page-${currentStep} input`)];
            allInputs = [...allInputs,...e.target.querySelectorAll(`#page-${currentStep} select`)];
            allInputs.forEach(input=>{
                if(input.type!=="radio"){
                    if(input.dataset.name==="phones")
                        formObjs[input.dataset.name] = advanceSet(customer.phones,input.value);
                    else
                    if(input.type!=="checkbox")
                        formObjs[input.dataset.name] = input.value;
                    else
                    if(input.type==="checkbox")
                        formObjs[input.dataset.name] = input.checked;
                }
                else
                if(input.type==="radio" && input.checked)
                    formObjs[input.dataset.name] = input.value;
            });
            if(currentStep===1){
                customer = {...customer,...formObjs};
                if(!("id" in customer))
                    customer.id = uuid.v5(customer.name+"_customer","6ba7b814-9dad-11d1-80b4-00c04fd430c8");
            }
            else{
                billMeta = {...billMeta,...formObjs};
                if(billMeta.deliveryType==="transport" && !("transportId" in billMeta))
                    billMeta.transportId = uuid.v5(billMeta.transportName,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
                if(!("discVal" in billMeta))
                    billMeta.discVal = 0;
            }
            if(billMeta.billType==="monthly" && billMeta.billNo==="reserve")
                billMeta.billNo = currentBillNo;
        }// Step 1,2 & 4
        else{
            orderItems.forEach(async itemObj=>{
                ["sgst","cgst","igst"].forEach(key=>{
                    if(itemObj[key]===0)
                        Reflect.deleteProperty(itemObj,key);
                });
                if(!("id" in itemObj)){
                    [...document.querySelectorAll(".body.row")]
                    .forEach(row=>{
                        if(row.dataset.sellId===itemObj.sellId){
                            itemObj.name = row.querySelector('[data-name="name"]').value;
                            itemObj.hsn = row.querySelector('[data-name="hsn"]').value;
                        }
                    });
                    let obj = await ipcRenderer.invoke("create-stock",itemObj);
                    Object.keys(obj)
                    .forEach(key=>{
                        itemObj[key] = obj[key];
                    });
                }
            });
            if(!["netQty","netAmt","netAmtTax"].every(key=>key in billMeta)){
                let reducedOrder = reduceOrder();
                billMeta.netQty = reducedOrder.netQty;
                billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
                billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
            }
        }// Step 3
        currentStep++;
    }
    else
    if(e.type==="click" && e.target.dataset.type==="back")
        currentStep--;
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
}

function cancelAction(){
    ipcRenderer.send('cancel-sale-bill',currentStep)
}

ipcRenderer.on("get-current-step",cancelAction);

function addPhone(e){
    let customerPhoneInput = document.getElementById("customer-phone");
    customer.phones = advanceSet(customer?.phones,customerPhoneInput.value);
    customerPhoneInput.value = "";
    customerPhoneInput.focus();
    customerPhoneInput.setAttribute("placeholder","Add new phone number");
}

function displaySection(){
    if(currentStep!==3) return;
    let df = document.getElementById("summary-div-template").content.cloneNode(true);
    document.querySelector(".page #page3-summary-div")?.remove();
    document.querySelector("#page-3").appendChild(df);
    let summaryDiv = document.querySelector("#page3-summary-div");
    [...summaryDiv.querySelectorAll("#product-summary>.summary-col .blue")]
    .forEach(p=>{
        if(p.dataset.name==="specialPrice" && "specialPrice" in selectedItem){
            let sorted;
            try{
                sorted = JSON.parse(selectedItem.specialPrice ?? {});
            }
            catch(err){
                sorted = [];
            }
            sorted.filter(obj=>obj.customerId===customer.id)
            .sort((obj1,obj2)=>{
                if(new Date(obj1.billDate)<new Date(obj2.billDate))
                    return 1;
                else
                if(new Date(obj1.billDate)==new Date(obj2.billDate))
                    return 0;
                else
                    return -1
            });
            p.textContent = sorted?.[0]?.rate ?? 0;
        }
        else
        if(p.dataset.name==="quantity" && selectedItem.type!=="service"){
            let quantity = selectedItem.quantity ?? 0;
            let totalQty = orderItems.reduce((acc,obj)=>{
                if(obj.id===selectedItem.id && "qty" in obj && "id" in selectedItem && "id" in obj){
                    let res = unitMap.find(uObj=>obj?.sellUnit in uObj);
                    let multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
                    return acc+obj.qty*multiplier;
                }
                else
                    return acc;
            },0);
            p.textContent = quantity - totalQty;
            if(Math.sign(quantity - totalQty)<0)
                p.classList.add("red");
            else
                p.classList.remove("red");
        }
        else
        if(p.dataset.name==="standardSellPrice")
            p.textContent = roundOffTo2DecimalPlace(selectedItem.standardSellPrice);
        else
            p.textContent = selectedItem[p.dataset.name] ?? ""; 
    });
    let reducedOrder = reduceOrder();
    billMeta.netQty = reducedOrder.netQty;
    billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
    billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
    billMeta.netTax = roundOffTo2DecimalPlace(billMeta.netAmtTax - billMeta.netAmt);
    [...summaryDiv.querySelectorAll("#bill-summary .highlight")].forEach(p=>p.textContent=!isNaN(reducedOrder[p.dataset.name])?roundOffTo2DecimalPlace(reducedOrder[p.dataset.name]):p.textContent);
}

function deleteRow(){
    orderItems = deleteRowCommon(bodyRow,orderItems,"sellId");
    displaySection();
}

function updatePayStatus(e){
    if(billMeta.billType!=="regular"){
        billMeta.paymentStatus = false;
        return showToastNotification("Monthly bills are marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
    }
    billMeta.paymentStatus = "paymentStatus" in billMeta? billMeta.paymentStatus : false;
    if(e)
        billMeta.paymentStatus = e.target.value==="true";
    if(billMeta.paymentStatus)
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"page-4",32);
    else
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
}

function showPrintDialog(){
    if(payment.length===0)
        payment.push({type:"due"})
    ipcRenderer.send("show-print-modal",{pageFit:"-o fit-to-page"});
}

ipcRenderer.on("print-obj",(e,printObj)=>{
    billMeta.printObj = printObj;
    ipcRenderer.send("salepage-print-doc",{billMeta,customer,orderItems});
});

async function saveExit(){
    let dbInitialized = await ipcRenderer.invoke("db-init-status");
    if(dbInitialized)
        ipcRenderer.send("save-exit-sale-bill",{billMeta,customer,orderItems});
    else
        showToastNotification("Please wait, databse initialization is in progress.",["animation-common","move-left","red-toast-box"],"page-4",32);
}

document.addEventListener("keydown",e=>{
    if(e.ctrlKey && e.key==="Enter" && currentStep<4)
        document.querySelector("[data-type='proceed']").click();
    else
    if(e.ctrlKey && e.key==="Enter" && currentStep===4)
        document.querySelector('[data-type="save"]').click();
    if(e.ctrlKey && e.key==="ArrowLeft")
        document.querySelector('[data-type="back"]' && currentStep>1).click();
    if(e.ctrlKey && e.key==="+")
        document.querySelector("#add-item>button").click();
    if(e.shiftKey && e.key==="Delete")
        deleteRow();
    if(e.ctrlKey && e.key==="p" && currentStep===4 && billMeta.billType==="regular")
        document.querySelector(`[data-type="print"]`).click();
});