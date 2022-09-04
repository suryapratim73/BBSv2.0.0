const {ipcRenderer} = require("electron");
const { toggleDevTool,validateInput,validateInput2,removeAllElem, roundOffTo2DecimalPlace, showToastNotification ,closeToast, drawSpinner, deleteRowCommon, applyTheme } = require("../js/common.js");
const uuid = require("uuid");


toggleDevTool(document);

let supplier = {},
    firstPage = document.getElementById("page1"),
    secondPage = document.getElementById("page3"),
    thirdPage = document.getElementById("page2"),
    fourthPage = document.getElementById("page4"),
    modal = document.getElementById("purchase-page-modal"),
    cover = document.querySelector(".cover"),
    bodyRow,timer,
    itemObj = {pInfo:{}},
    itemList = [],
    billMeta = {},
    currentPage = 1,
    payObj = {},
    deletedProperty = [];

function clickOrFocusinHandler(e){
    removeAllElem(".body-row-options")
    if(["P","INPUT"].includes(e.target.nodeName)){
        bodyRow = e.target.parentNode.parentNode;
        let bodyRowOpt = document.getElementById("item-options").content.cloneNode(true).querySelector("div");
        bodyRow.appendChild(bodyRowOpt);
    }
    else{
        if(e.target.dataset.cmd==="delete"){
            itemList = deleteRowCommon(bodyRow,itemList);
            return;
        }
        // else
        // if(e.target.dataset.cmd==="add-info"){
        //     modal.classList.remove("hide");
        //     modal.dataset.type = "page2";
        //     cover.classList.remove("hide");
        //     removeAllElem(".deletable");
        //     let pInfo =  bodyRow.dataset.pInfo ? JSON.parse(bodyRow.dataset.pInfo) : {};
        //     pInfo && !Object.keys(pInfo).some(key=>/type/i.test(key)) && setNewFeild("Type","");
        //     for(let label in pInfo)
        //         setNewFeild(label,pInfo[label]);
        // }
    }
    itemObj = itemList.find(obj=>bodyRow?.dataset?.uid==obj.uid) ?? {};
    let addRowBTN = document.querySelector(".body-row-options button:last-child");
    if(addRowBTN){
        if(itemObj.type==="service")
            addRowBTN.classList.add("hide");
        else
            addRowBTN.classList.remove("hide");
    }
}

document.querySelector("#tbody")?.addEventListener("focusin",clickOrFocusinHandler);

document.querySelector("#tbody")?.addEventListener("click",clickOrFocusinHandler);

document.querySelector("#tbody")?.addEventListener("input",function(e){
    const { value,dataset:{name} } = e.target;
    if(name==="igst")
        ["sgst","cgst"].forEach(key=>bodyRow.querySelector(`[data-name="${key}"]`).value = "");
    itemObj[name] = value ?? "";
    if("igst" in itemObj && itemObj.igst!=="")
        ["sgst","cgst"].forEach(key=>Reflect.deleteProperty(itemObj,key));
});

document.getElementById("billDate").valueAsDate = new Date();
document.getElementById("pay-date").valueAsDate = new Date();

function addSupplier(e){
    e.preventDefault();
    const { name,address,phones,email,gst } = e.target;
    firstPage.classList.add("hide");
    secondPage.classList.remove("hide");
    currentPage = 2;
    supplier.name = name.value;
    supplier.address = address.value;
    supplier.phones = supplier.phones ? [...supplier.phones,phones.value] : [phones.value];
    supplier.moreInfo = email.value ? {
        email: email.value
    } : {};
    supplier.gst = gst.value;
}

function addNewNumber(e){
    let input = e.target.previousSibling.previousSibling;
    supplier.phones = supplier.phones ? [...supplier.phones,input.value] : [input.value];
    input.value = "";
    input.focus();
}

function addRow(e){
    let slNo = ++[...document.querySelectorAll(".row.body")].length;
    let bodyRowTemplate = document.getElementById("body-row-template");
    let clonedBodyRow = bodyRowTemplate.content.cloneNode(true);
    clonedBodyRow.querySelector(".sm>p").textContent = slNo;
    let uid = uuid.v5(slNo.toString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    clonedBodyRow.querySelector("div").dataset.uid = uid;
    itemList.filter(obj=>obj!={});
    itemList = [...itemList,{...itemObj,pInfo:{...itemObj.pInfo},uid}];
    e.target.parentNode.before(clonedBodyRow);
    e.target.parentNode.previousSibling.previousSibling.querySelector("input").focus();
}

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

// function addFeild(e){
//     removeAllElem(".popup2");
//     modal.querySelector("form").classList.add("hide");
//     let popup2 = document.getElementById("new-feild-template").content.cloneNode(true).querySelector("form");
//     modal.appendChild(popup2);
//     [...document.querySelectorAll(".popup2 .feild>input")].forEach(input=>input.value="");
//     document.getElementById("value").dataset.type = "Number";
//     document.getElementById("value").dataset.subtype = "price";
// }

// function removeFeild(e){
//     let btn = e.target;
//     let {label} = btn.dataset;
//     if(billMeta.moreInfo)
//         billMeta.moreInfo = billMeta?.moreInfo.filter(obj=>obj.label!==label);
//     Reflect.deleteProperty(itemObj.pInfo,label);
//     deletedProperty.push(label);
//     if(bodyRow)
//         bodyRow.dataset.pInfo = JSON.stringify(itemObj.pInfo);
//     btn.parentNode.remove();
// }

// function setNewFeild(label,value,kind="info"){//remove "kind" dependency
//     document.querySelector(`[data-feild="${label}"]`)?.remove();
//     let newFeild = document.createElement("div");
//     newFeild.className = "feild deletable";
//     newFeild.dataset.feild = label;
//     newFeild.innerHTML = `
//         <label for="${label}">${label}</label>
//         <input type="text" data-catagory="pInfo" data-kind="${kind}" required id="${label}" name="${label}" value="${value}">
//         <button type="button" data-label="${label}" onclick="removeFeild(event)">x</button>
//     `;
//     let btnFeild = document.querySelector("#purchase-page-modal .feild:last-child");
//     btnFeild.before(newFeild);
//     btnFeild.scrollIntoView();
// }

// function setFeild(e){
//     e.preventDefault();
//     closeModal(undefined,"popup2");
//     let { label,value } = e.target;
//     label = label.value;
//     value = value.value;
//     setNewFeild(label,value);
// }

// function closeModal(e,popup){
//     let controller = popup ? popup : e.target.dataset.modal;
//     if(controller!="popup2"){
//         modal.classList.add("hide");
//         cover.classList.add("hide");
//     }
//     removeAllElem(".popup2");
//     modal.querySelector("form").classList.remove("hide");
// }

// function addItem(e){
//     e.preventDefault();
//     closeModal(undefined,"NA")
//     if(e.target.parentNode.dataset.type==="page2"){
//         [...modal.querySelectorAll(".feild input")].forEach(input=>{
//             itemObj.pInfo[input.name] = input.value;
//         });
//         bodyRow.dataset.pInfo = JSON.stringify(itemObj.pInfo);
//         thirdPage.classList.remove("blur-pointer");
//     }
//     else{
//         billMeta.moreInfo = [];
//         [...modal.querySelectorAll(".feild input")].forEach(input=>{
//             let obj = {label:input.name,kind:input.dataset.kind,value:input.value};
//             billMeta.moreInfo.push(obj);
//         });
//         billMeta.moreInfo = billMeta.moreInfo.filter((val,index,self)=>(
//             index===self.findIndex(obj=>(obj.label===val.label && obj.kind===val.kind && obj.value===val.value))
//         ));
//     }
// }

function proceedHandler(e){
    if(e.type==="submit"){// Page 2 submit event.
        e.preventDefault();
        currentPage = 3;
        thirdPage.classList.remove("hide");
        secondPage.classList.add("hide");
        billMeta.billNo = e.target.billNo.value;
        billMeta.billDate = (new Date(e.target.billDate.value)).toISOString().split("T")[0];
        billMeta.freightName = e.target.freightName.value;
        billMeta.freightCharge = Number(e.target.freightCharge.value);
        for(let key in billMeta)
            if(billMeta[key]===""){
                Reflect.deleteProperty(billMeta,key);
                deletedProperty.push(key);
                deletedProperty = Array.from(new Set(deletedProperty));
            }
    }
    else{
        const {cmd} = e.target.dataset;
        if(cmd==="next"){
            if(!("services" in billMeta))
                billMeta.services = [];
            billMeta.services = [...billMeta.services,...itemList.reduce((acc,itemObj,index)=>{
                if(itemObj.type!=="service") return acc;
                acc.push(itemObj);
                itemList.splice(index,1);
                return acc;
            },[])];
            if(itemList.length===0) return alert("Can't proceed with empty item list.");
            thirdPage.classList.add("hide");
            fourthPage.classList.remove("hide");
            currentPage = 4;
            initPage4();
        }
        else
        if(cmd==="back"){
            if(currentPage===2){
                secondPage.classList.add("hide");
                firstPage.classList.remove("hide");
                currentPage = 1;
            }
            else
            if(currentPage===3){
                thirdPage.classList.add("hide");
                secondPage.classList.remove("hide");
                currentPage = 2;
            }
            else{
                fourthPage.classList.add("hide");
                thirdPage.classList.remove("hide");
                currentPage = 3;
            }
        }
        else
        if(cmd==="cancel")
            ipcRenderer.send("close");
    }
}

function addFeild2SummaryDiv(label,value){
    let labelDiv = document.querySelector(`#summary-div div[data-label='${label}']`);
    if(labelDiv)
        labelDiv.remove(); 
    let div = document.createElement("div");
    div.dataset.label = label;
    div.innerHTML = `
        <p class="red">${label}</p>
        <p>${value}</p>
    `;
    document.getElementById("pay-amt-div").before(div);
}

function initPage4(){
    let total = 0;
    let { totalWithTax,totalWithoutTax } = itemList.reduce((acc,{rate,quantity,sgst=0,cgst=0,igst=0})=>{
        rate = Number(rate);
        quantity = Number(quantity);
        sgst = Number(sgst);
        cgst = Number(cgst);
        igst = Number(igst);
        acc.totalWithoutTax += rate * quantity;
        acc.totalWithTax += (igst===0? (1+(sgst+cgst)/100) : (1+igst/100)) * rate * quantity;
        return acc;
    },{
        totalWithoutTax:0,
        totalWithTax:0
    });
    total = totalWithTax;
    let freightCharge = "freightCharge" in billMeta ? Number(billMeta.freightCharge) : 0;
    total += freightCharge;
    if(freightCharge>0)
        addFeild2SummaryDiv("Freight Charge",freightCharge);
    if("services" in billMeta)
        total += billMeta.services.reduce((acc,obj)=>{
            addFeild2SummaryDiv(obj.name,obj.rate);
            let tax = ["sgst","cgst","igst"].reduce((acc,key)=>{
                if(key in obj)
                    return acc + Number(obj[key]);
                else
                    return acc;
            },0);
            return acc + Number(obj.rate)*Number(obj.quantity)*(1+(tax/100));
        },0);
    document.getElementById("bill-amt").textContent = totalWithoutTax;
    document.getElementById("tax-amt").textContent = totalWithTax - totalWithoutTax;
    document.getElementById("total-amt").textContent = total;
    billMeta.totalWithoutTax = totalWithoutTax;
    billMeta.totalTax = totalWithTax - totalWithoutTax;
    billMeta.total = total;
    showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"main");
    if(deletedProperty.length>0)
        deletedProperty.forEach(property=>{
            let propertyDiv = document.querySelector(`#summary-div div[data-label='${property}']`);
            if(propertyDiv){
                propertyDiv.remove();
                deletedProperty = deletedProperty.filter(prop=>prop!==property);
            }
        });
}

function updateSummaryDiv(e){
    let payment = Number(e.target.value);
    document.getElementById("summ-pay-amt").textContent = payment;
    payObj.payment = payment;
    let totalAmtP = document.getElementById("total-amt");
    let total = billMeta.total;
    totalAmtP.textContent = total - payment;
    document.getElementById("return-amt")?.remove();
    if(total-payment<0){
        totalAmtP.classList.add("red");
        let div = document.createElement("div");
        div.id = "return-amt";
        div.innerHTML = `
            <p class="red">Return amount</p>
            <p>${payment - total}</p>
        `;
        document.getElementById("pay-amt-div").after(div);
    }
    else{
        document.getElementById("return-amt")?.remove();
        totalAmtP.classList.remove("red");
        billMeta.paymentStatus = false;
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"main")
    }
    if(total-payment<=0){
        billMeta.paymentStatus = true;
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"main")
    }
}

function saveData(e){
    e.preventDefault();
    e.target.querySelectorAll("input").forEach(input=>input.setAttribute("disabled","disabled"));
    payObj.payMethod = e.target["pay-method"].value;
    payObj.detail = e.target["pay-desc"].value;
    payObj.payDate = (new Date(e.target["pay-date"].value)).toISOString().split("T")[0];
    payObj.amount = Number(e.target["pay-amt"].value);
    payObj.receiverName = e.target["pay-recpt"].value;
    payObj.balance = billMeta.total - payObj.amount>=0 ? billMeta.total - payObj.amount : 0;
    if(itemList.find((itemObj,_)=>("pInfo" in itemObj && Object.keys(itemObj.pInfo).some(key=>/type/i.test(key))))){
        let items = itemList.map((itemObj,_)=>(
            "pInfo" in itemObj && 
            Object.keys(itemObj.pInfo).some(key=>(/type/i.test(key) && !/type/.test(key))) &&
            itemObj
        )).filter(obj=>typeof obj!=="boolean");
        items.forEach(item=>{
            let typeAttr = Object.keys(item.pInfo).find(key=>/type/i.test(key));
            let typeVal = item.pInfo[typeAttr];
            Reflect.deleteProperty(item.pInfo,typeAttr);
            item.pInfo.type = typeVal;
        });
        itemList.forEach(item=>{
            if(item.type==="Undefined")
                item.type = item.pInfo.type;
        })
    }
    ipcRenderer.send("purchase-data",{supplier,billMeta,itemList,payObj});
}

function getOptions(e,id){
    let name = e.target.value;
    let form = e.target.parentNode.parentNode.parentNode;
    let selectedOption = document.querySelector(`${id} [value='${name}']`);
    return {name,form,selectedOption};
}

function getNewId(e){
    let name = e.target.value;
    let uuidV5 = uuid.v5(name+"_supplier","6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    supplier.id = uuidV5;
}

async function selectSupplier(e){
    let { form,selectedOption } = getOptions(e,"#suppliers-dl");
    if(!selectedOption)
        return getNewId(e);
    let { id } = selectedOption.dataset;
    supplier.id = id;
    let supplierMoreInfo = await ipcRenderer.invoke("get-more-info-supplier",id);
    let employeeNames = await ipcRenderer.invoke("get-employee-names",id);
    assignOpt_Dl(employeeNames,"employee-to-supp")
    for(let key in supplierMoreInfo){
        if(key==="name") continue;
        if(key==="phones")
            form.querySelector(`[name="${key}"]`).value = supplierMoreInfo[key][0];
        if(key==="moreInfo" && "email" in supplierMoreInfo.moreInfo)
            form.querySelector(`[name="email"]`).value = supplierMoreInfo.moreInfo.email;
        else{
            let feild = form.querySelector(`[name="${key}"]`);
            if(feild)
                feild.value = supplierMoreInfo[key];
        }
    }
}

function selectFreight(e){
    let { form,selectedOption } = getOptions(e,"#freightName-dl");
    if(selectedOption)
        form.querySelector(`[name="freightCharge"]`).value = selectedOption.dataset.charge;
}

async function selectStock(e){
    if(e.target.dataset.name!=="name") return;
    let { selectedOption } = getOptions(e,"#stock-dl");
    if(!selectedOption && bodyRow){
        itemObj.id = uuid.v4();
        return;
    }
    let { id } = selectedOption.dataset;
    itemObj.id = id;
    let _itemObj = await ipcRenderer.invoke("get-more-info-on-selected-stock",id);
    if(!_itemObj){
        _itemObj = {...selectedOption.dataset};
        _itemObj.pInfo = JSON.parse(_itemObj.pInfo);
    }
    for(let key in _itemObj){
        if(key==="pInfo"){
            itemObj.pInfo = {};
            Object.keys(_itemObj.pInfo).forEach(key=>{
                itemObj.pInfo[key] = _itemObj.pInfo[key];
            });
            bodyRow.dataset.pInfo = JSON.stringify(itemObj.pInfo);
            continue;
        }
        let feild = bodyRow.querySelector(`input[data-name="${key}"]`)
        if(feild && key!=="quantity"){
            itemObj[key] = (key==="unit" && _itemObj[key]===50)? 1 : _itemObj[key];
            feild.value = _itemObj[key];
        }
        if(key!=="quantity")
            itemObj[key] = _itemObj[key];
    }
    if(_itemObj.type==="service"){
        ["buyPrice","pHistory","quantity","cgst","sgst","igst"]
        .forEach(key=>{
            if(key in itemObj)
                Reflect.deleteProperty(itemObj,key);
        });
        itemObj._type = "service";
        itemObj.rate = itemObj.standardSellPrice;
    }
    bodyRow.querySelector(`input[data-name="quantity"]`)?.focus();
}

// Setting up datalists

function assignOpt_Dl(arr,dl){
    dl = document.getElementById(dl);
    // ipcRenderer.send("test");
    arr.forEach(obj=>{
        let option = document.createElement("option");
        for(let key in obj)
            if(key==="name")
                option.value = obj[key];
            else
                option.dataset[key] = typeof obj[key]!=="object" ? obj[key] : JSON.stringify(obj[key]);
        dl.appendChild(option);
    });
}

(async ()=>{
    let spinner = drawSpinner(document);
    let supplierNames = await ipcRenderer.invoke("get-supplier-names");
    assignOpt_Dl(supplierNames,"suppliers-dl");
    let freightList = await ipcRenderer.invoke("get-freights");
    assignOpt_Dl(freightList,"freightName-dl");
    let stockNames = await ipcRenderer.invoke("get-stock-names");
    assignOpt_Dl(stockNames,"stock-dl");
    let serviceNames = await ipcRenderer.invoke("get-services");
    assignOpt_Dl(serviceNames,"stock-dl");
    spinner.remove(window);
})();

document.addEventListener("keydown",e=>{
    if(currentPage===1 && e.ctrlKey && e.key==="+")
        document.getElementById("add-new-number").click();
    else
    if(e.key==="Enter"){
        if(!modal.classList.contains("hide"))
            modal.querySelector("form:last-child button[type='submit']").click();
        else
        if([...document.querySelectorAll(".page")].some(page=>(!page.classList.contains("hide")))){
            let page = [...document.querySelectorAll(".page")].find(page=>(!page.classList.contains("hide")));
            if(page.querySelector("form"))
                page.querySelector("form [type='submit']").click();
            else
                page.querySelector("[data-cmd='next']").click();
        }
    }
    else
    if(currentPage===3 && e.ctrlKey && e.key==="+")
        document.querySelector("#add-item>button").click();
    else
    if(currentPage===3 && e.ctrlKey && e.key==="Delete")
        itemList = deleteRowCommon(bodyRow,itemList);
});  

function setAmtFeilds(e){
    let bodyRow = e.target.parentNode.parentNode,
        qty = bodyRow.querySelector(`[data-name="quantity"]`).value,
        rate = bodyRow.querySelector(`[data-name="rate"]`).value,
        cgst = bodyRow.querySelector(`[data-name="cgst"]`).value,
        sgst = bodyRow.querySelector(`[data-name="sgst"]`).value,
        igst = bodyRow.querySelector(`[data-name="igst"]`).value;
    let tax = igst && Number(igst) ? Number(igst) : Number(cgst) + Number(sgst);
    if(rate && qty)
        bodyRow.querySelector(".amt-p").textContent = roundOffTo2DecimalPlace(Number(qty) * Number(rate));
    if(rate && qty && tax)
        bodyRow.querySelector(".net-amt-p").textContent = roundOffTo2DecimalPlace((Number(qty) * Number(rate))*(1+tax/100));

}