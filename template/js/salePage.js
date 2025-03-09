const { ipcRenderer } = require("electron");
const {toggleDevTool,reduceOrder,clickOrFocusinHandler,applyDiscount,reassignSummaryDivFeilds,showPaymentMode,updateBillValue,addRow,calculateAmounts,getsaleConfigPolicyPath,appendToDL,validateInput,roundOffTo2DecimalPlace, showToastNotification, closeToast, retractHandler, deleteRowCommon, applyTheme, removeAllElem,selectionHandler, assignDeliveryOptions, execRetractHandler, deleteKey, validateInput2, upperCaseInput, appendToHost, createModal, closeModal, capitalize, textRollAnnimation, traverseParent } =  require("../js/common");

const uuid = require("uuid");
let fs = require("fs");

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
    bodyRow,timer,currentBillNo,
    probableGrps = [],
    availableBillNoDL = document.createElement("datalist"),igstFlag,preset;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";
availableBillNoDL.id = "available-bill-no-div";

const { unitMap = [],availableBillNo = [],gst:_gst } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

async function init(){
    appendToDL("get-stocks",nameDatalist);
    appendToDL("get-services",nameDatalist);
    appendToDL("get-customers",customerNameDatalist);
    appendToDL("get-transporter",transporterDatalist);
    let billNos = Array.from(new Set(availableBillNo)) ;
    billNos = billNos.map(no=>{
        return {
            name:no
        }
    });
    appendToDL(null,availableBillNoDL,true,null,[],billNos);
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key==="Bag"?"Bag (=50 Kg)":key;
        unitDatalist.appendChild(option);
    });
    preset = await ipcRenderer.invoke("get-presets");
    if(preset && preset?.target==="salePage"){
        customer = preset.customer;
        if("billMeta" in preset){
            billMeta = {...preset.billMeta};
            if(typeof billMeta.delivery==="object")
                ["deliveryType","transportName","transportAddress","transportContact","transportGST"]
                .forEach(key=>{
                    billMeta[key] = billMeta.delivery?.[key];
                });
        }
        if("itemList" in preset)
            orderItems = preset.itemList.map(itemObj=>{
                return {
                    ...itemObj,
                    qty:itemObj.quantity,
                    sellUnit:itemObj.unit
                }
            });
    }
    else
        preset = undefined;
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
    if(typeof preset!=="undefined" && preset?.target==="salePage")
        while(preset.currentStep>currentStep)
            document.querySelector(`[data-type="proceed"]`).click();
    document.body.appendChild(unitDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
}
init().catch((err)=>{
    console.log(err)
});// Datalist linking and selection handler work

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function stepDetail(){
    if(currentStep===1) return `Add <span class="highlight">customer</span> detail`;
    if(currentStep===2) return `Add <span class="highlight">bill</span> detail`;
    if(currentStep===3) return `Add <span class="highlight">item</span> detail`;
    if(currentStep===4) return `Add <span class="highlight">payment</span> detail`;
}

function setFooter(){
    if(!document.getElementById("btn-container")){
        let footerDF = document.getElementById("footer-template").content.cloneNode(true).querySelector("DIV");
        footer.appendChild(footerDF);
    }
    [...footer.querySelectorAll("button")]
    .forEach(btn=>btn.classList.add("hide"));
    footer.querySelector(`[data-type="cancel"]`).classList.remove("hide");
    if(currentStep<4)
        footer.querySelector(`[data-type="proceed"]`).classList.remove("hide");
    else{
        if(billMeta.billType==="regular")
            footer.querySelector(`[data-type="print"]`).classList.remove("hide");
        footer.querySelector(`[data-type="save"]`).classList.remove("hide");
    }
    if(currentStep!==1)
        footer.querySelector(`[data-type="back"]`).classList.remove("hide");
}

function helperFunc1(itemObj){
    let main = document.querySelector("main");
    main.querySelector("#add-item > button").click();
    bodyRow = main.querySelector("#tbody .body.row:nth-last-child(2)");
    selectedItem = itemObj;
    let sellId = bodyRow.dataset.sellId;
    if(!("sellId" in itemObj))
        itemObj.sellId = sellId;
    [...bodyRow.querySelectorAll("input")]
    .forEach(input=>{
        let key = input.dataset.name;
        if(key!=="unit"){
            if("rate" in itemObj && itemObj.rate>0 && key==="standardSellPrice")
                input.value = itemObj.rate;
            else
                input.value = itemObj?.[key] ?? "";
        }
        else{console.log({unit:itemObj.sellUnit})
            input.value = itemObj.sellUnit;}
    });
    calculateAmounts();
}

async function reInitFormData(){
    let main = document.querySelector("main");
    [ customer, billMeta, orderItems ]
    .forEach(obj=>{
        if(currentStep===3 && obj instanceof Array){//Step 3
            orderItems.forEach(obj=>{
                if(obj.type==="grp")
                    obj.items.forEach(obj=>helperFunc1(obj));
                else
                    helperFunc1(obj);
            });
        }
        else
        if(currentStep!=3 && !(obj instanceof Array)){// Step 1,2,4
            let inputs = [...main.querySelectorAll(`input,select`)];
            let keys = inputs.map(inp=>inp.dataset.name);
            if(!keys.some(key=>key in obj)) return;
            //Step 1,2
            for(let _index=0;_index<inputs.length;_index++){
                let input = inputs[_index];
                let key = input.dataset.name;
                if(["text","email"].includes(input.type) && obj[key]){
                    input.value = (key!="phones" || obj instanceof Array) ? obj[key] : JSON.parse(obj[key]);
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
                    if(obj.billStatus==="close")
                        main.querySelector("#bill-status-close").setAttribute("checked",true);
                    else
                        main.querySelector("#bill-status-open").setAttribute("checked",true);
                }
                if(key==="billDate")
                    input.valueAsDate = typeof obj.billDate==="string" ? new Date(obj.billDate) : obj.billDate;
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
            if(!("payment" in billMeta) || ("paymentStatus" in billMeta && billMeta.paymentStatus==false)) return;
            billMeta.payment?.forEach?.((payObj,i)=>{
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
    if(currentStep===2){
        billMeta.billDate = (typeof preset!="undefined" && preset.currentStep>2) ? billMeta.billDate : await ipcRenderer.invoke("get-date");
        document.querySelector(`[data-name="billDate"]`).valueAsDate = typeof billMeta.billDate==="string" ? new Date(billMeta.billDate) : billMeta.billDate;
        if(!page2initialized){
            currentBillNo = (typeof preset != "undefined" && preset.currentStep>2) ? billMeta.billNo : (await ipcRenderer.invoke("get-sale-bill-number"));
            billMeta.billNo = currentBillNo;
            billMeta.billType = "regular";
            page2initialized = true;
        }
        else
            currentBillNo = billMeta.billNo;
        if(availableBillNo.length>0){
            let input = document.getElementById("bill-number-regular");
            input?.setAttribute("list","available-bill-no-div");
        }
        document.querySelector(`[data-name="billNo"]`).value = billMeta.billNo;
        document.querySelector('[data-name="shipTo"]').value = customer.name;
        document.querySelector('[data-name="shipAddr"]').value = customer.address;
        document.querySelector('[data-name="shipPh"]').value = customer.phones?.[0];
        document.querySelector('[data-name="shipGST"]').value = customer.gst;
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

function advanceSet(target,newValue){
    if(typeof target==="string")
        target = JSON.parse(target);
    target.push(newValue);
    return Array.from(new Set(target))
}

function page4Init(){
    let netAmtTax = Math.round(billMeta.netAmtTax);
    document.querySelector("#summary-div .highlight").textContent = Math.round(netAmtTax);
    document.querySelector("[data-name='netAmtTaxDel']").textContent = netAmtTax;
    let netPayment = "payment" in billMeta ? billMeta.payment.reduce?.((acc,obj)=>acc+obj.payment,0):0;
    if(netAmtTax-netPayment>0){
        document.querySelector(`[data-name="dueAmt"]`).textContent = netAmtTax-netPayment;
        document.querySelector(`[data-name="return"]`).textContent = 0;
    }
    else{
        document.querySelector(`[data-name="dueAmt"]`).textContent = 0;
        document.querySelector(`[data-name="return"]`).textContent = netPayment - netAmtTax;
    }
    if(probableGrps.length>0)
        document.querySelector('button[data-cmd="grp-item"]').removeAttribute("disabled");
    else
        document.querySelector('button[data-cmd="grp-item"]').setAttribute("disabled",true);
    updatePayStatus();
}

function proceedOrFinishHandler(e){
    e && e.preventDefault();
    if(e.type==="submit"){
        if(currentStep!==3){ 
            let formObjs = Object.fromEntries(new FormData(e.target).entries());
            if(currentStep===1){
                let gst = formObjs.gst;
                if(gst!==""){
                    let flag = gstChecksum(gst);
                    ipcRenderer.send("log",{
                        title:"GST CHecksum",
                        message:{flag,gst},
                        func:"proceedOrFinishHandler function"
                    });
                    if(!flag)
                        showToastNotification("GST number may be not valid. You may consider a recheck.",["animation-common","move-left","red-toast-box"],document.body);
                }// GST Validation
                igstFlag = gst!="" && Number(gst.match(/\d\d/)?.[0])!=Number(_gst.match(/\d\d/)?.[0]);
                customer = {...customer,...formObjs,phones:customer.phones};
                if(!("id" in customer))
                    customer.id = uuid.v5(customer.name+"_customer","6ba7b814-9dad-11d1-80b4-00c04fd430c8");
                customer.phones = advanceSet(customer.phones,formObjs.phones);
            }
            else{
                if("autoBill" in formObjs)
                    formObjs.autoBill = true;
                if(billMeta.deliveryType==="transport" && !("transportId" in billMeta))
                    billMeta.transportId = uuid.v5(billMeta.transportName,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
                if(!("discVal" in billMeta))
                    billMeta.discVal = 0;
                billMeta = {...billMeta,...formObjs}
                if(billMeta.billType==="monthly" && billMeta.billNo==="reserve")
                    billMeta.billNo = currentBillNo;
            }
        }// Step 1,2 & 4
        else{
            probableGrps = [];
            orderItems.forEach(async itemObj=>{
                // ["sgst","cgst","igst"].forEach(key=>{
                //     if(itemObj[key]===0)
                //         Reflect.deleteProperty(itemObj,key);
                // });
                let grpObj = probableGrps.find(obj=>obj.rate===itemObj.rate);
                if(itemObj.type!=="grp"){
                    if(!grpObj)
                        probableGrps.push({
                            rate:itemObj.rate,
                            items:[itemObj]
                        })
                    else
                        grpObj.items.push(itemObj);
                    // console.log(probableGrps)
                }
                if(!("id" in itemObj)){
                    [...document.querySelectorAll(".body.row")]
                    .forEach(row=>{
                        if(row.dataset.sellId===itemObj.sellId){
                            itemObj.name = row.querySelector('[data-name="name"]').value;
                            itemObj.hsn = row.querySelector('[data-name="hsn"]').value;
                        }
                    });
                    let obj = await ipcRenderer.invoke("create-stock",itemObj);
                    itemObj.id = obj.id
                }
            });
            if(!["netQty","netAmt","netAmtTax"].every(key=>key in billMeta)){
                let reducedOrder = reduceOrder();
                billMeta.netQty = reducedOrder.netQty;
                billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
                billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
            }
            probableGrps = probableGrps.filter(obj=>obj.items.length!==1)
        }// Step 3
        currentStep++;
    }
    else
    if(e.type==="click" && e.target.dataset.type==="back"){
        currentStep--;
        if(currentStep===2){
            orderItems.filter(obj=>!("name" in obj))
            .forEach(obj=>{
                let { sellId } = obj;
                let bodyRow = document.querySelector(`.body.row[data-sell-id="${sellId}"]`);
                obj.name = bodyRow.querySelector("input[data-name='name']").value;
                obj.hsn = bodyRow.querySelector("input[data-name='hsn']").value;
            });

        }
    }
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
}

function showItemMergeOpts(){
    removeAllElem("main *");
    appendToHost("#item-group-option-template","main","div");
    [...document.querySelectorAll("#btn-container button")]
    .forEach(btn=>{
        btn.classList.add("hide");
        if(btn.dataset.type==="grp-pg-btn")
            btn.classList.remove("hide");
    });
}

function revealMoreGrpOpts(e,mode){
    let page = traverseParent(e.target,"page");
    if(mode===1){
        ["#price-selector-div","#old-grp","#create-grp-btn"]
        .forEach(id=>page.querySelector(id).classList.remove("hide"));
        let select = page.querySelector("#price-selector-div select");
        probableGrps.forEach(obj=>{
            let option = document.createElement("option");
            select.appendChild(option);
            option.value = obj.rate;
            option.textContent = obj.rate;
        });
    }
    else
    if(mode===2){
        removeAllElem(".item");
        let selectedRate = Number(e.target.value);
        let itemsForPrice = (probableGrps.find(obj=>obj.rate===selectedRate))?.items;
        let itemHost = page.querySelector("#old-item-host");
        itemsForPrice.forEach(itemObj=>{
            let child = appendToHost("#grp-item-template",itemHost,"div");
            child.dataset.obj = JSON.stringify(itemObj);
            [...child.querySelectorAll("p")]
            .forEach(p=>{
                p.textContent = itemObj[p.dataset.name];
            });
        });
    }
}

// function swapItems(e){
//     e.stopPropagation();
//     let page = traverseParent(e.target,"page");
//     let newGrpHost = page.querySelector("#new-item-host");
//     let prevGrpHost = page.querySelector("#old-item-host");
//     [...page.querySelectorAll(".item")]
//     .map(elem=>{
//         let chkBox = elem.querySelector("input[type='checkbox']");
//         if(chkBox.checked)
//             return elem;
//     })
//     .filter(elem=>elem!==undefined)
//     .forEach(elem=>{
//         elem.querySelector("input[type='checkbox']").checked = false;
//         if(elem.parentNode===prevGrpHost)
//             newGrpHost.appendChild(elem);
//         else
//             prevGrpHost.appendChild(elem);
//     });

//     if([...newGrpHost.querySelectorAll(".item")].length>0)
//         document.getElementById("create-grp-btn").removeAttribute("disabled");
//     else
//         document.getElementById("create-grp-btn").setAttribute("disabled",true);
// }

function createNewGrp(e){
    e.stopPropagation();
    let page = traverseParent(e.target,"page");
    let selectedRate = Number(page.querySelector("select").value);
    let newGrpItems = [...document.querySelectorAll("#old-item-host .item>input")]
                        .filter(item=>item.checked===true)
                        .map(checkbox=>JSON.parse(checkbox.parentNode.dataset.obj));
    let qty = 0;
    newGrpItems.forEach(obj=>{
        let  grpObj = probableGrps.find(obj=>obj.rate===selectedRate);
        grpObj.items.splice(grpObj.items.find(_obj=>_obj.id===obj.id),1);
        orderItems = orderItems.filter(_obj=>_obj.id!=obj.id);
        qty+=roundOffTo2DecimalPlace(obj.qty);
    });
    let newId = uuid.v4();
    let desc = newGrpItems.reduce((acc,obj,i,self)=>{
        acc += obj.name + "-" + obj.qty + obj.sellUnit;
        if(i<self.length-1)
            acc += ", ";
        return acc;
    },"");
    // Proceed by adding label for new group and aggregate qty for new group.
    let modal = createModal("new-grp-label");
    let child = appendToHost("#new-grp-label-form-template",modal,"FORM");
    child.dataset.obj = JSON.stringify({newGrpItems,selectedRate,newId,qty,desc});
    child.dataset.id = newId;
    modal.querySelector("input").focus();
    document.querySelector(".cover").addEventListener("click",closeModal)
}

function showPage4(e,cmd){
    if(cmd==="cancel-grp")
        orderItems = orderItems.reduce((acc,obj)=>{
            if(obj.type!=="grp")
                acc.push(obj);
            else
                obj.items.forEach(obj=>acc.push(obj));
            return acc;
        },[]);
    else
        orderItems.forEach(obj=>{
            if(obj.type==="grp")
                obj.desc = obj.items.reduce((acc,obj,i,self)=>{
                    acc += obj.name + ": " + obj.qty + capitalize(obj.sellUnit);
                    if(i<self.length-1)
                        acc += ", ";
                    return acc;
                },"")
        });
    currentStep = 4;
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
}

function addDescToItem(e){
    e.preventDefault();
    let cmd = e.target.dataset.cmd;
    let descDiv = bodyRow.querySelector(".desc-div");
    if(cmd==="rej"){
        descDiv.querySelector("input").value = "";
        if("desc" in selectedItem)
            selectedItem.desc = "";
    }
    else
        selectedItem.desc = descDiv.querySelector("input").value;
    descDiv.classList.add("hide");
}

function addLabelToGrp(e){
    e.preventDefault();
    let label = e.target.label.value;
    let newId = e.target.dataset.id;
    let {desc,newGrpItems,qty,selectedRate} = JSON.parse(e.target.dataset.obj);
    orderItems.push({
        items:newGrpItems,
        rate:selectedRate,
        id:newId,
        qty,
        label,
        type:"grp",
        ...["hsn","sellUnit","sgst","cgst","igst"].reduce((acc,key)=>{
            if(key in newGrpItems[0] && newGrpItems[0][key])
                acc[key] = newGrpItems[0][key];
            return acc;
        },{}),
        desc
    });
    [...document.querySelectorAll("#old-grp .item")]
    .forEach(itemDiv=>{
        if(itemDiv.querySelector("input").checked)
            itemDiv.remove();
    });
    closeModal();
}

function cancelAction(){
    ipcRenderer.send('cancel-sale-bill',currentStep)
}

ipcRenderer.on("get-current-step",cancelAction);

function addPhone(e){
    let customerPhoneInput = document.getElementById("phones");
    customer.phones = advanceSet((customer?.phones ?? []),customerPhoneInput.value);
    customerPhoneInput.value = "";
    customerPhoneInput.focus();
    customerPhoneInput.setAttribute("placeholder","Add new phone number");
}

function displaySection(){
    if(currentStep!==3) return;
    removeAllElem(".page #page3-summary-div");
    appendToHost("#summary-div-template",document.querySelector("#page-3"),"DIV")
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
            sorted = sorted.filter(obj=>(obj.customerId==customer.id))
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
        if(p.dataset.name==="standardSellPrice"){
            let rate = Number(selectedItem.standardSellPrice);
            if(rate===NaN)
                rate = 0;
            else
                rate = Math.round(rate);
            p.textContent = roundOffTo2DecimalPlace(rate);
        }
        else
            p.textContent = selectedItem[p.dataset.name] ?? ""; 
    });
    let reducedOrder = reduceOrder();
    // console.log(reducedOrder)
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
    console.log({
        message:"Response from print-modal",
        printObj,
        cond1: typeof preset!=="undefined" && preset?.target==="salePage",
        cond1a:typeof preset!=="undefined",
        cond1b: preset?.target==="salePage"
    });
    if(typeof preset!=="undefined" && preset?.target==="salePage" && preset.flag!=="new-bill"){
        ipcRenderer.send('cancel-sale-bill',currentStep);
        printObj.customer = customer;
        return ipcRenderer.send("add-item-to-bill",preset?.itemList,orderItems,billMeta,customer,printObj);
    }
    ipcRenderer.send("salepage-print-doc",{billMeta,customer,orderItems});
});

async function saveExit(){
    let dbInitialized = await ipcRenderer.invoke("db-init-status");
    if(typeof preset!=="undefined" && preset.target==="salePage" && preset.flag!=="new-bill"){
        ipcRenderer.send('cancel-sale-bill',currentStep)
        return ipcRenderer.send("add-item-to-bill",preset.itemList,orderItems,billMeta,customer);
    }
    if(dbInitialized)
        ipcRenderer.send("save-exit-sale-bill",{billMeta,customer,orderItems});
    else
        showToastNotification("Please wait, databse initialization is in progress.",["animation-common","move-left","red-toast-box"],"page-4",32);
}

function gstChecksum(gst){
    let regTest = /\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}/.test(gst)
     if(regTest){
        let a=65,b=55,c=36;
        return Array.from(gst).reduce((i,j,k,g)=>{
            p=(p=(j.charCodeAt(0)<a?parseInt(j):j.charCodeAt(0)-b)*(k%2+1))>c?1+(p-c):p;
            return k<14?i+p:j==((c=(c-(i%c)))<10?c:String.fromCharCode(c+b));
        },0); 
    }
    return regTest
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
    if(e.shiftKey && e.key==="ArrowDown")
        bodyRow.querySelector(".desc-div").classList.remove("hide");
    if(e.shiftKey && e.key==="Enter")
        bodyRow.querySelector(".desc-cnf-btn").click();
    if(e.shiftKey && e.key==="ArrowUp")
        bodyRow.querySelector(".desc-rej-btn").click();
    // if(e.ctrlKey && e.key==="g")
    //     document.querySelector("#grp-btn-div button").click();
});