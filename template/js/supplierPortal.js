const { ipcRenderer } = require("electron");
const UUID = require("uuid");
const { drawSpinner, closeModal, createModal, toggleDevTool, scrollSymSet, removeAllElem, drawLineGraph, validateInput, printModal, dataModal, applyTheme } = require("../js/common");

toggleDevTool(document);
let suppliersTbody = document.querySelector("#all-suppliers .tbody"),
    supplierLedger = document.querySelector("#supplier-ledger"),
    currentPage = 1,
    supplierBills = document.getElementById("supplier-bills"),
    timer,
    suppId;

async function init(reload=false){
    let spinner = drawSpinner(document);
    removeAllElem("#all-suppliers .body.row");
    (await ipcRenderer.invoke("get-suppliers",reload))
    .sort((a,b)=>{
        if(a.netDebt>b.netDebt) return -1;
        else
        if(a.netDebt===b.netDebt) return 0;
        else return 1;
    })
    .forEach((suppObj,index)=>{
        let bodyRow = document.createElement("div");
        bodyRow.className = "body row";
        const { id,name } = suppObj;
        bodyRow.dataset.id = id;
        bodyRow.dataset.name = name;
        for(let key in suppObj){
            let p = document.createElement("p");
            p.className = "col eq-space";
            if(key==="id")
                p.textContent = index + 1;
            else    
                p.textContent = suppObj[key];
            bodyRow.appendChild(p);
        }
        suppliersTbody.appendChild(bodyRow);
    });
    removeAllElem("#all-suppliers .scroll-sym-common");
    if(suppliersTbody.scrollHeight>suppliersTbody.clientHeight)
        scrollSymSet(suppliersTbody);
    spinner.remove(window);
    if(reload===false){
        currentPage = 1;
        showPage(false);
        showOrHideNavBTN();
    }
}
init();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

async function page2Init(e){
    let bodyRow;
    if(e)
        bodyRow = e.target.parentNode ;
    else
        bodyRow = suppliersTbody.querySelector(`.body.row[data-id="${suppId}"]`);
    suppId = bodyRow.dataset.id;
    supplierLedger.dataset.id = suppId;
    let spinner = drawSpinner(document);
    let ledgerTbody = supplierLedger.querySelector(".tbody");
    removeAllElem("#supplier-ledger .body.row");
    (await ipcRenderer.invoke("Load-full-ledger",suppId))
    .forEach((obj,index)=>{
        let bodyRow = document.getElementById("supplier-ledger-bodyRow-temp").content.cloneNode(true).querySelector("div");
        for(let key in obj){
            let p = bodyRow.querySelector(`[data-colName="${key}"]`);
            if(p && key!=="entryNo")
                p.textContent = key==="date"?obj[key].toLocaleDateString("en-GB"):obj[key];
            else
            if(p && key==="entryNo")
                p.textContent = index + 1;
            bodyRow.dataset[key] = obj[key];
        }
        ledgerTbody.appendChild(bodyRow);
    });
    removeAllElem("#supplier-ledger .scroll-sym-common");
    spinner.remove(window);
    if(e){
        currentPage = 2;
        showPage();
        showOrHideNavBTN();
    }
    if(ledgerTbody.scrollHeight>ledgerTbody.clientHeight)
        scrollSymSet(ledgerTbody);
}

suppliersTbody.addEventListener("click",page2Init);

async function page3Init(){
    currentPage = 3;
    showPage();
    removeAllElem("#supplier-bills .body.row");
    let tbody = supplierBills.querySelector(".tbody");
    supplierBills.dataset.id = supplierLedger.dataset.id;
    (await ipcRenderer.invoke("get-all-bills",supplierLedger.dataset.id))
    .map(obj=>{
        let bodyRow = document.getElementById("supplier-bills-bodyRow-temp").content.cloneNode(true).querySelector("div");
        for(let key in obj){
            let p = bodyRow.querySelector(`[data-colName="${key}"]`);
            if(p)
                p.textContent = key==="billDate"?(new Date(obj[key])).toLocaleDateString("en-GB"):obj[key];
            bodyRow.dataset[key] = obj[key];
        }
        tbody.appendChild(bodyRow);
        return {billDate:new Date(obj.billDate),billAmt:obj.billAmt}
    })
    .reduce((acc,{billDate,billAmt})=>{
        acc[0][0] += billAmt;
        acc[0][1].push({date:billDate,amt:billAmt});
        return acc;
    },[[ 0, [] ]])
    .forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#purchase-graph","green","red");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    });
    removeAllElem("#supplier-bills .scroll-sym-common");
    (await ipcRenderer.invoke("get-out-payments",supplierLedger.dataset.id))
    .reduce((acc,{date,payment})=>{
        acc[0][0] += payment;
        acc[0][1].push({date:date,amt:payment});
        return acc;
    },[[ 0, [] ]])
    .forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#payment-graph","green","red");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    })
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
}

document.querySelector("nav").addEventListener("click",async function(e){
    let elem = e.target;
    if(elem.nodeName!=="BUTTON") return;
    let cmd = elem.dataset.cmd;
    let spinner = drawSpinner(document);
    if(cmd==="bills")
        await page3Init();
    else
    if(cmd==="back"){
        currentPage--;
        showPage(true);
    }
    else
    if(cmd==="addPayment"){
        let payForm = document.getElementById("add-payment-modal-template").content.cloneNode(true).querySelector("form");
        let modal = createModal("add-payment-modal");
        removeAllElem("#billNo-list");
        modal.appendChild(payForm);
        let dl = document.createElement("datalist");
        dl.id = "billNo-list";
        [...document.querySelectorAll("#supplier-bills .body.row[data-payment-status='false']")]
        .forEach(div=>{
            const { billAmt,billNo,payment } = div.dataset;
            let option = document.createElement("option");
            option.value = billNo;
            option.dataset.billAmt = billAmt;
            option.dataset.payment = payment;
            dl.appendChild(option);
            document.body.appendChild(dl);
        });
        document.getElementById("payDate").valueAsDate = new Date();
    }
    else
    if(cmd==="profile"){
        let profileForm = document.getElementById("profile-modal-template").content.cloneNode(true).querySelector("form");
        let modal = createModal("profile-modal");
        modal.appendChild(profileForm);
        let suppObj = await ipcRenderer.invoke("get-more-info-supplier",suppId);        
        [...profileForm.querySelectorAll("input")]
        .forEach(input=>{
            if(!["email","phones"].includes(input.name))
                input.value = suppObj[input.name];
            else
            if(input.name==="phones")
                input.value = suppObj["phones"].reduce((acc,phone,index,self)=>{
                    if(index<self.length-1)
                        acc += phone + ", "
                    else
                        acc += phone;
                    return acc;
                },"");
            else
                input.value = suppObj["moreInfo"]?.email;
        });
    }
    else
    if(cmd==="print-ledger")
        printModal(suppId);
    else
    if(cmd==="addSupplier"){
        let modal = createModal("add-supplier-modal");
        let addSupplierForm = document.getElementById("add-supplier-modal-template").content.cloneNode(true).querySelector("form");
        modal.appendChild(addSupplierForm);
    }
    showOrHideNavBTN();
    spinner.remove(window);
});

function showOrHideNavBTN(){
    [...document.querySelectorAll("nav *")]
        .forEach(elem=>{
            if(elem.classList.contains(`page${currentPage}-elem`))
                elem.classList.remove("hide");
            else
                elem.classList.add("hide");
        })
}

function showPage(reInit){
    [...document.querySelectorAll(".page")].forEach(page=>{
        if(page.classList.contains(`page${currentPage}`))
            page.classList.remove("hide");
        else
            page.classList.add("hide");
    });
    if(currentPage===2)
        page2Init();
    else
    if(currentPage===1 && reInit===true)
        init(true);
}

async function addPayment(e){
    e.preventDefault();
    let billNo = Number(e.target.billNo.value);
    let payDate = e.target.payDate.value;
    let payAmt = Number(e.target.payAmt.value);
    let billAmt = Number(e.target.querySelector("div").dataset.billAmt);
    let ref = e.target.ref.value;
    let paymentStatus = payAmt===billAmt?true:false;
    let id = supplierBills.dataset.id;
    let transStatus = await ipcRenderer.invoke("add-out-payment",{billNo,ref,billAmt,payDate,payAmt,paymentStatus,id});
    if(transStatus){
        let selectedDiv = supplierBills.querySelector(`[data-bill-no="${billNo}"]`);
        if(selectedDiv && payAmt===billAmt)
            selectedDiv.dataset.paymentStatus = "true";
        else
            selectedDiv.dataset.billAmt = billAmt - payAmt;
    }
    closeModal();
    let spinner = drawSpinner(document);
    await page3Init();
    spinner.remove(window);
}

function assignBillAmt(e){
    let billNo = e.target.value;
    let firstDiv = document.querySelector(".modal form>div:first-child");
    firstDiv.querySelector("h2")?.remove();
    if(billNo==="") return;
    let option = e.target.list.querySelector(`[value="${billNo}"]`);
    if(!option) return alert("Choose correct bill number.");
    let { billAmt,payment } = option.dataset;
    firstDiv.dataset.billAmt = Number(billAmt) - Number(payment);
    let h2 = document.createElement("h2");
    h2.innerText = `Due amount is Rs. ${Number(billAmt) - Number(payment)}`;
    firstDiv.appendChild(h2);
}

function validateBillAmt(e){
    let enteredAmt = Number(e.target.value);
    let billAmt = Number(document.querySelector(".modal form div").dataset.billAmt);
    if(enteredAmt>billAmt){
        alert("The entered amount cannot be greater than the selected bill amount.");
        e.target.value = "";
    }
}

function handlePrint(e){
    e.preventDefault();
    document.querySelector('[data-name="cancel"]').click();
    let period = e.target["ledger-period"].value;
    ipcRenderer.send("print-ledger",suppId,period,1);
}

function enableInput(e){
    let input = e.target;
    input.classList.add("hide");
    [...document.querySelectorAll("#profile-modal input")].forEach(input=>input.removeAttribute("disabled"));
    document.querySelector("#profile-modal form>div:last-child>button:nth-child(2)").classList.remove("hide");
}

function updateSupplierProfile(e,ipcMsg){
    e.preventDefault();
    let form = e.target;
    let suppUpdateObj = [...form.querySelectorAll("input")]
    .reduce((acc,input)=>{
        if(!["phones","email"].includes(input.name))
            acc[input.name] = input.value;
        else
        if(input.name==="phones")
            acc.phones = input.value.split(",").map(phone=>phone.trim());
        else
            acc.moreInfo = {email:input.value};
        return acc;
    },{});
    suppUpdateObj.id = ipcMsg!=="new-supplier" ? suppId : UUID.v5(suppUpdateObj.name+"_supplier","6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    closeModal();
    ipcRenderer.send(ipcMsg,suppUpdateObj);
}

supplierBills.querySelector(".tbody").addEventListener("click",async function(e){
    const bodyRow = e.target.parentNode;
    if(!bodyRow.classList.contains("row")) return;
    const billObj = bodyRow.dataset,spinner = drawSpinner(document);
    let itemList = await ipcRenderer.invoke("get-bill-items",billObj.billItemTable);
    spinner.remove(window);
    let modal = createModal("bill-item-modal");
    let billItemDivs = document.getElementById("bill-item-modal-template").content.cloneNode(true);
    modal.appendChild(billItemDivs);
    [...modal.querySelectorAll("[data-colName]")]
    .forEach(p=>{
        if(!["billDate","paymentStatus"].includes(p.dataset.colname))
            p.textContent = billObj[p.dataset.colname];
        else
        if(p.dataset.colname==="billDate")
            p.textContent = new Date(billObj[p.dataset.colname]).toLocaleDateString("en-GB");
        else
            p.textContent = billObj.paymentStatus==="true"?"Paid":"Unpaid";
    });
    let tbody = modal.querySelector(".tbody");
    itemList.forEach(({name,quantity,unit,rate,tax})=>{
        let _bodyRow = document.createElement("div");
        _bodyRow.className = "body row";
        tbody.appendChild(_bodyRow);
        for(let i=0;i<4;i++){
            let p = document.createElement("p");
            p.className = "col eq-space";
            if(i===0)
                p.textContent = name;
            else
            if(i===1)
                p.textContent = `${quantity} ${unit}`;
            else
            if(i===2)
                p.textContent = rate;
            else
                p.textContent = tax;
            _bodyRow.appendChild(p);
            p.className = "col eq-space";
        }
    });
});

function searchHandler(e){
    let text = e.target.value;
    if(text.length===0)
        [...document.querySelectorAll(".body.row")].forEach(div=>div.classList.remove("hide"));
    if(e.target.className==="page1-elem"){
        [...document.querySelectorAll("#all-suppliers .body.row")]
        .forEach(bodyRow=>{
            const {name,id} = bodyRow.dataset;
            if([name,id].some(key=>new RegExp(text,"i").test(key)))
                bodyRow.classList.remove("hide");
            else
                bodyRow.classList.add("hide");
        })
    }
    else{
        if(/\//.test(text))
            text = text.split("/").reduce((acc,str,index)=>{
                if(index>0)
                    acc += "\\/" + str;
                else
                    acc += str;
                return acc;
                },"");
        [...document.querySelectorAll("#supplier-bills .body.row")]
        .forEach(bodyRow=>{
            let {billDate,billNo,paymentStatus} = bodyRow.dataset;
            paymentStatus = paymentStatus==="true"?"paid":"unpaid";
            billDate = new Date(billDate).toLocaleDateString("en-GB");
            if(/\//.test(text) && new RegExp(text,"i").test(billDate))
                bodyRow.classList.remove("hide");
            else
            if([billNo,paymentStatus].some(key=>new RegExp(text,"i").test(key)))
                bodyRow.classList.remove("hide");
            else
                bodyRow.classList.add("hide");
        });
    }
}