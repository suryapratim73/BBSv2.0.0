const { ipcRenderer } = require("electron");
const {toggleDevTool,appendToDL,validateInput,roundOffTo2DecimalPlace, showToastNotification, closeToast, retractHandler, deleteRowCommon} =  require("../js/common");
const uuid = require("uuid");
const { unitMap } = require("../../config/saleConfig.json");


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
    bodyRow,timer,
    coolieDatalist = document.createElement("datalist");

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";
coolieDatalist.id = "coolie-dl";

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
    appendToDL("get-coolies",coolieDatalist);
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
    setFooter();
    document.body.appendChild(unitDatalist);
}
init();// Datalist linking and selection handler work

function clickOrFocusinHandler(e){
    if(currentStep!==3) return;
    if(e.target.dataset.cmd==="delete-row" && e.type==="focusin")
        return deleteRow(e);
    bodyRow = e.target.parentNode.parentNode;
    if(orderItems.some(obj=>obj.sellId===bodyRow.dataset.sellId))
        selectedItem = orderItems.find(obj=>obj.sellId===bodyRow.dataset.sellId); 
    displaySection();
    [...document.querySelectorAll(".body-row-options")].forEach(div=>div.remove());
    if(bodyRow.className==="body row"){
        bodyRow.appendChild(document.getElementById("body-row-options-template").content.cloneNode(true));
        if(document.querySelector(".body-row-options"))
            document.querySelector(".body-row-options").dataset.sellId = bodyRow.dataset.sellId;    
        clearTimeout(timer);
        timer = setTimeout(()=>document.querySelector(".body-row-options")?.remove(),5000);
    }
}

function stepDetail(){
    if(currentStep===1) return `Add <span class="red">customer</span> detail`;
    if(currentStep===2) return `Add <span class="red">bill</span> detail`;
    if(currentStep===3) return `Add <span class="red">item</span> detail`;
    if(currentStep===4) return `Add <span class="red">payment</span> detail`;
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
        footer.querySelector(`[data-type="print"]`).classList.remove("hide");
        footer.querySelector(`[data-type="save"]`).classList.remove("hide");
        footer.querySelector(`[data-type="proceed"]`).classList.add("hide");
    }
    if(currentStep==1)
        footer.querySelector(`[data-type="back"]`).classList.add("hide");
    else
        footer.querySelector(`[data-type="back"]`).classList.remove("hide");
}

async function mainForm(){
    [...document.querySelectorAll(".page")].forEach(page=>{
        if(Number(page.dataset.pageno)===currentStep)
            page.classList.remove("hide");
        else
            page.classList.add("hide");
    });
    if(document.getElementById(`page-${currentStep}`).children.length===0){
        let pageDF = document.getElementById(`page-${currentStep}-template`).content.cloneNode(true);
        document.getElementById(`page-${currentStep}`).appendChild(pageDF);
    }
    if(currentStep===2 && !page2initialized){
        document.querySelector(`[data-name="billDate"]`).valueAsDate = new Date();
        document.querySelector(`[data-name="billNo"]`).value = await ipcRenderer.invoke("get-sale-bill-number");
        page2initialized = true;
    }
    setFooter();
    if(currentStep===3){
        document.querySelector("#tbody")?.addEventListener("focusin",clickOrFocusinHandler);
        document.querySelector("#tbody")?.addEventListener("click",clickOrFocusinHandler);
    }
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
    deliveryCharge += billMeta.coolieReq==="yes"?Number(billMeta.coolieCharge):0;
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
                    if(input.dataset.name==="delivery-mode")
                        formObjs.deliveryType = input.value;
                    else
                    if(input.dataset.name==="colley-required")
                        formObjs.coolieReq = input.value;
                    else
                        formObjs[input.dataset.name] = input.value;
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
                if(billMeta.coolieReq==="yes" && !("id" in billMeta))
                    billMeta.id = uuid.v5(billMeta.coolieName , "6ba7b814-9dad-11d1-80b4-00c04fd430c8")
                if(!("discVal" in billMeta))
                    billMeta.discVal = 0;
            }
        }
        else{
            orderItems.forEach(itemObj=>{
                ["sgst","cgst","igst"].forEach(key=>{
                    if(itemObj[key]===0)
                        Reflect.deleteProperty(itemObj,key);
                });
            });
            if(!["netQty","netAmt","netAmtTax"].every(key=>key in billMeta)){
                let reducedOrder = reduceOrder();
                billMeta.netQty = reducedOrder.netQty;
                billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
                billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
            }
        }
        currentStep++;
    }
    else
    if(e.type==="click" && e.target.dataset.type==="back")
        currentStep--;
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
    if(currentStep===4)
        page4Init();
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

function addRow(e){
    let clonedBodyRow = document.getElementById("body-row-template").content.cloneNode(true);
    document.getElementById("add-item").before(clonedBodyRow);
    [...document.querySelectorAll(".body.row>div:first-child>p")].forEach((p,index)=>{
        p.textContent = index+1;
    });
    e.target.scrollIntoView();
    e.target.parentNode.previousSibling.previousSibling.querySelector("input").focus();
    bodyRow = e.target.parentNode.previousSibling.previousSibling;
    selectedItem = {};
    bodyRow.dataset.sellId = uuid.v5(bodyRow.querySelector("p").textContent,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
}

function showPaymentMode(e){
    [...document.getElementsByClassName("payment-detail")].forEach(div=>{
        if(div.id===e.target.value+"-payment")
            div.classList.remove("hide");
        else
            div.classList.add("hide");
    })
}

function validateInput2(e){
    validateInput(e)
    if(e.defaultPrevented) return;
    if(e.target.dataset.subtype==="price" && !/\d/.test(e.key)) e.preventDefault();
}

function selectionHandler(e){// Work needed here
    let match = {...e.target.list?.querySelector(`[value='${e.target.value}']`)?.dataset};
    if(!match || Object.keys(match).length==0) return;
    if(e.target.dataset.name==="stock-name"){
        selectedItem = match;
        bodyRow = e.target.parentNode.parentNode;
        for(let key in match){
            let input = bodyRow.querySelector(`input[data-name="${key}"]`);
            if(input && key!=="unit")
                input.value = match[key];
            if(key==="unit" && selectedItem.type!=="service")
                input.value = "Kg";
            else
            if(key==="unit" && selectedItem.type==="service")
                input.value = selectedItem.unit;
            else
            if(key==="standardSellPrice")
                input.value = roundOffTo2DecimalPlace(selectedItem.standardSellPrice);
            bodyRow.dataset[key] = match[key];
        }
        bodyRow.querySelector(`[data-name="qty"]`).focus();
        match.sellId = bodyRow.dataset.sellId;
        orderItems = orderItems.filter(obj=>obj.sellId!==match.sellId);
        orderItems.push(match);
        if(selectedItem.id!==match.id)
            selectedItem = match;
        displaySection();
    }
    else
    if(e.target.dataset.name==="name"){// Done.
        let {address,phones,gst,moreInfo} = match;
        customer = {...match};
        document.querySelector("[data-name='address']").value = address;
        document.querySelector("[data-name='phones']").value = JSON.parse(phones)[0];
        document.querySelector("[data-name='gst']").value = gst;
        document.querySelector("[data-name='email']").value = JSON.parse(moreInfo).email;
    }
    else
    if(e.target.dataset.name==="transportName"){// Done
        let {address,phone,charge} = match;
        document.querySelector("[data-name='transportAddress']").value = address!==undefined?address:"";
        document.querySelector("[data-name='transportContact']").value = phone!==undefined?phone:"";
        document.querySelector("[data-name='transportCharge']").value = charge;
    }
    else
    if(e.target.dataset.name==="coolieName"){
        let { phones,moreInfo } = match;
        document.querySelector("[data-name='coolieContact']").value = phones!==undefined?phones:"";
        document.querySelector("[data-name='coolieCharge']").value = JSON.parse(moreInfo).charge;
    }
}

function calculateAmounts(e){
    if(Object.keys(selectedItem).length===0) return;
    let quantity = Number(bodyRow.querySelector('[data-name="qty"]').value);
    let rate = Number(bodyRow.querySelector('[data-name="standardSellPrice"]').value);
    let unit = bodyRow.querySelector(`[data-name="unit"]`).value;
    let res = unitMap.find(uObj=>unit in uObj);
    let multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
    if(selectedItem.type==="service" && unit===selectedItem.unit)
        multiplier = 1;
    bodyRow.querySelector(".amt").textContent = roundOffTo2DecimalPlace(quantity * rate * multiplier);
    let cgst = Number(bodyRow.querySelector('[data-name="cgst"]').value) ?? 0;
    let sgst = Number(bodyRow.querySelector('[data-name="sgst"]').value) ?? 0;
    let igst = Number(bodyRow.querySelector('[data-name="igst"]').value) ?? 0;
    if(igst>0){
        sgst = 0;
        cgst = 0;
        bodyRow.querySelector('[data-name="cgst"]').value = "";
        bodyRow.querySelector('[data-name="sgst"]').value = "";
    }
    selectedItem.sgst = sgst;
    selectedItem.cgst = cgst;
    selectedItem.igst = igst;
    selectedItem.rate = rate;
    selectedItem.sellUnit = bodyRow.querySelector('[data-name="unit"]').value;
    selectedItem.qty = quantity;
    bodyRow.querySelector(".amt-with-tax").textContent = roundOffTo2DecimalPlace(quantity * rate * multiplier * (1 + (cgst + sgst + igst)/100));
    displaySection();
}

function reduceOrder(){
    return orderItems.reduce((acc,obj)=>{
        let keys = ["qty","sellUnit","rate"];
        let obJKeys = Object.keys(obj);
        let tax = ["sgst","cgst","igst"].reduce((acc,key)=>{
            if(key in obj)
                return acc + obj[key]
            return acc
        },0);
        if(keys.every(val=>obJKeys.includes(val))){
            if(!("discVal" in billMeta))
                billMeta.discVal = 0;
            let res = unitMap.find(uObj=>obj.sellUnit in uObj);
            let multiplier;
            if(obj.type!=="service")
                multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
            else
            if(obj.type==="service" && obj.unit===Object.keys(res)[0])
                multiplier = 1;
            else
            if(obj.type==="service" && obj.unit!==Object.keys(res)[0])
                multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
            if(obj.type!=="service")
                acc.netQty += obj.qty * multiplier;
            acc.netAmt += roundOffTo2DecimalPlace(obj.rate * multiplier * obj.qty * (100-billMeta.discVal)/100) ?? 0;
            acc.netAmtTax += roundOffTo2DecimalPlace((obj.rate * multiplier * obj.qty * (100-billMeta.discVal)/100) * (1 + tax/100)) ?? 0;
        }
        return acc;
    },{
        netQty:0,
        netAmt:0,
        netAmtTax:0
    });
}

function displaySection(){
    let df = document.getElementById("summary-div-template").content.cloneNode(true);
    document.querySelector(".page #page3-summary-div")?.remove();
    document.querySelector("#page-3").appendChild(df);
    let summaryDiv = document.querySelector("#page3-summary-div");
    [...summaryDiv.querySelectorAll("#product-summary>.summary-col .blue")]
    .forEach(p=>{
        if(p.dataset.name==="specialPrice" && "specialPrice" in selectedItem){
            let sorted = JSON.parse(selectedItem.specialPrice)
                .filter(obj=>obj.customerId===customer.id)
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
    [...summaryDiv.querySelectorAll("#bill-summary .red")].forEach(p=>p.textContent=!isNaN(reducedOrder[p.dataset.name])?roundOffTo2DecimalPlace(reducedOrder[p.dataset.name]):p.textContent);
}

function deleteRow(){
    orderItems = deleteRowCommon(bodyRow,orderItems,"sellId");
    displaySection();
}

function updateBillValue(e){
    if(e.target.dataset.name!=="payment") return;
    //Update summary and billMeta
    let paymentModeDiv = e.target.parentNode.parentNode;
    let payObj = {
        payment:Number(e.target.value)
    };
    if(paymentModeDiv.id==="cash-payment"){
        payObj.type = "cash";
        let deliveryCharge = billMeta.deliveryType==="hand"?0:Number(billMeta.transportCharge);
        deliveryCharge += billMeta.coolieReq==="yes"?Number(billMeta.coolieCharge):0;
        if(Math.round(billMeta.netAmtTax + deliveryCharge)<=payObj.payment)
            billMeta.paymentStatus = true;
        else
            billMeta.paymentStatus = false;
    }
    else if(paymentModeDiv.id==="check-payment"){
        payObj.type = "check";
        payObj.bnk = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.branch = paymentModeDiv.querySelector("[data-name='bankBranch']").value;
        payObj.a_c_No = paymentModeDiv.querySelector("[data-name='bankACNo']").value;
        payObj.chkNo = paymentModeDiv.querySelector("[data-name='chkNo']").value;
        billMeta.paymentStatus = JSON.parse(paymentModeDiv.querySelector(`[data-name="paymentStatus"]`).value);
    }
    else{
        payObj.type = "online";
        payObj.bnk = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.ref = paymentModeDiv.querySelector("[data-name='bankTrnRef']").value;
        billMeta.paymentStatus = JSON.parse(paymentModeDiv.querySelector(`[data-name="paymentStatus"]`).value);
    }
    let updateFlag = false;
    if(payment.length>0)
        for(let i=0;i<payment.length;i++)
            if(payment[i].type===payObj.type){
                payment[i] = payObj;
                updateFlag = true;
                break;
            }
    if(!updateFlag)
        payment.push(payObj);
    billMeta.payment = payment;
    if(billMeta.paymentStatus)
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"page-4",32);
    else
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
    reassignSummaryDivFeilds();
}

function reassignSummaryDivFeilds(){
    let netPayment = "payment" in billMeta ? billMeta.payment.reduce((acc,payObj)=>acc + payObj.payment,0):0;
    let deliveryCharge = billMeta.deliveryType==="hand"?0:Number(billMeta.transportCharge);
    deliveryCharge += billMeta.coolieReq==="yes"?Number(billMeta.coolieCharge):0;
    document.querySelector("[data-name='paymentAmt']").textContent = netPayment;
    if(Math.sign(deliveryCharge + billMeta.netAmtTax - netPayment)<=0){
        document.querySelector("[data-name='dueAmt']").textContent = 0;
        billMeta.netDue = 0;
        document.querySelector("[data-name='return']").textContent = roundOffTo2DecimalPlace(netPayment - (Math.round(billMeta.netAmtTax) + deliveryCharge));
    }
    else{
        document.querySelector("[data-name='dueAmt']").textContent = roundOffTo2DecimalPlace(deliveryCharge + Math.round(billMeta.netAmtTax) - netPayment);
        billMeta.netDue = roundOffTo2DecimalPlace(deliveryCharge + Math.round(billMeta.netAmtTax) - netPayment);
        document.querySelector("[data-name='return']").textContent = 0;
    }
}

function deleteKey(arr,obj){
    arr.forEach(key=>{
        if(key in obj)
            Reflect.deleteProperty(obj,key);
    })
}

function assignDeliveryOptions(e){
    let transportDiv = document.getElementById("transport-div");
    let coolieDiv = document.getElementById("coolie-div");
    if(e.target.name==="delivery-mode"){
        if(e.target.value==="transport"){
            transportDiv.classList.remove("hide");
            let transportOptDF = document.getElementById("transport-retractable-div-template").content.cloneNode(true);
            transportDiv.appendChild(transportOptDF);
        }
        else{
            transportDiv.classList.add("hide");
            transportDiv.querySelector(".retractable-div").remove();
            deleteKey([
                "deliveryType",
                "transportName",
                "transportAddress",
                "transportContact",
                "transportCharge"
            ],billMeta);
        }
    }
    else{
        if(e.target.value==="yes"){
            coolieDiv.classList.remove("hide");
            let coolieOptDF = document.getElementById("coolie-retractable-div-template").content.cloneNode(true);
            coolieDiv.appendChild(coolieOptDF);
        }
        else{
            coolieDiv.classList.add("hide");
            coolieDiv.querySelector(".retractable-div").remove();
            deleteKey([
                "coolieReq",
                "coolieName",
                "coolieContact",
                "coolieCharge"
            ],billMeta);
        }
    }
}

function updatePayStatus(e){
    billMeta.paymentStatus = false;
    if(e)
        billMeta.paymentStatus = JSON.parse(e.target.value);
    if(billMeta.paymentStatus)
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"page-4",32);
    else
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
}

function execRetractHandler(e){
    if(e.target.nodeName!=="DIV"){
        let retractableDiv = e.target.parentNode.parentNode.querySelector(".retractable-div");
        [...e.target.parentNode.querySelectorAll("button")].forEach(btn=>btn.classList.toggle("hide"));
        retractHandler(retractableDiv);
    }
}

function showPrintDialog(){
    if(payment.length===0)
        payment.push({type:"due"})
    ipcRenderer.send("show-print-modal",{pageFit:"-o fit-to-page"});
}

ipcRenderer.on("printObj",(e,printObj)=>{
    billMeta.printObj = printObj;
    ipcRenderer.send("salepage-print-doc",{billMeta,customer,orderItems});
});

function saveExit(){
    ipcRenderer.send("save-exit-sale-bill",{billMeta,customer,orderItems});
}

function applyDiscount(e){
    let discVal = Number(e.target.value);
    document.getElementById("discount-feild")?.remove();
    billMeta.discVal = 0;
    let netAmt = reduceOrder().netAmt;
    billMeta.discVal = discVal;
    if(discVal>0){
        let div = document.createElement("div");
        div.innerHTML = `
            <p>Discount</p>
            <p data-name="discVal" class="highlight">${roundOffTo2DecimalPlace(netAmt - reduceOrder().netAmt)}</p>
        `;
        div.id = "discount-feild";
        document.getElementById("netAmtTaxDel-div").before(div);
    }
    let reducedOrder = reduceOrder();
    billMeta.netAmt = reducedOrder.netAmt;
    billMeta.netAmtTax = reducedOrder.netAmtTax;
    billMeta.netTax = billMeta.netAmtTax - billMeta.netAmt;
    page4Init();
}

document.addEventListener("keydown",e=>{
    if(e.ctrlKey && e.key==="Enter" && currentStep<4)
        document.querySelector("[data-type='proceed']").click();
    else
    if(e.ctrlKey && e.key==="Enter" && currentStep===4)
        document.querySelector('[data-type="save"]').click();
    if(e.ctrlKey && e.key==="ArrowLeft")
        document.querySelector('[data-type="back"]').click();
    if(e.ctrlKey && e.key==="+")
        document.querySelector("#add-item>button").click();
    if(e.shiftKey && e.key==="Delete")
        deleteRow();
});