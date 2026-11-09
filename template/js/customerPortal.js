const { toggleDevTool, closeModal:_closeModal, dataModal , retractHandler , createModal , showDeleteBTN ,validateInput, validateInput2 , printModal, drawSpinner, renderPieChart, scrollSymSet, removeAllElem, appendToDL, roundOffTo2DecimalPlace, drawLineGraph, applyTheme, appendToHost, textRollAnnimation, traverseParent, contextMenuFunction, showToastNotification, scrollHelper, fuzzySearchHandler, setNGramIndex, gstChecksum, upperCaseInput } = require("../js/common");
const { ipcRenderer, net } = require("electron");
const uuid = require("uuid");
const { getsaleConfigPolicyPath } = require("../js/common");
let fs = require("fs");
const doc = require("pdfkit");
const { unitMap = [] } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());


toggleDevTool(document);

let customerList = [],
    page2BTNS = document.querySelector("#form>div:nth-child(1)"),
    selectedDiv,selectedCustomer,
    canvas = document.querySelector("#canvas-container>canvas"),
    ctx = canvas.getContext("2d"),
    total=0,
    colorCode = [],
    spinner = drawSpinner(document),
    itemList = [], stockList, timer,
    bills,
    ledgerEntries = [],
    currentPage,rows = [],rows2 = [];

let shipInfoWorking = [];// Shipping-address modal working copy (saved on commit)

const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
    ];


async function initPage(){
    // Inject the pre-built n-gram index from the main process so appendToDL
    // skips the expensive trigram-calculation loop.
    // var preBuiltIndex = await ipcRenderer.invoke("get-ngram-index");
    // if (preBuiltIndex) setNGramIndex(preBuiltIndex);
    // stockList = await appendToDL.call({tableName:"stock"},"get-stocks",document.getElementById("stock-names"));
    // await appendToDL.call({tableName:"customer"},"get-customers",document.getElementById("customer-names"));
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        document.getElementById("unit-dl").appendChild(option);
    });
}
initPage();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

document.querySelector("#canvas-container").addEventListener("click",function(e){
    ctx.restore();
    drawPieChart();
    let {offsetX:x,offsetY:y} = e;
    canvas = e.target;
    ctx = canvas.getContext("2d");
    let angle = Math.atan2(100-y,x-100);
    angle = Math.abs(angle>0 ? 2*Math.PI - angle : angle);
    let {id,startAngle,endAngle} = colorCode.find(({startAngle,endAngle})=>(angle>=startAngle && angle<=endAngle)) ?? {};
    let customerDiv = document.querySelector(`[data-cust-id="${id}"]`)
    customerDiv.scrollIntoView(false);
    customerDiv.style.borderColor = "red";
    let {width,height} = canvas;
    ctx.beginPath();
    ctx.fillStyle = `hsla(360, 100%, 100%, 0.5)`;
    ctx.arc(width/2,height/2,width/2-8,startAngle,endAngle,true);
    ctx.lineTo(width/2,height/2);
    ctx.closePath();
    ctx.fill();
});

document.querySelector("#form [name='searchText']").addEventListener("input",searchHandler);

function searchHandler(e){
    e.preventDefault();
    let searchText = e.target.value;
    if(searchText.length>0){
        let ids = customerList.map((customerObj)=>{
            let {name,id,gst} = customerObj;
            if([name,id,gst].includes(searchText) || name.match(new RegExp(searchText,"i")))
                return customerObj;
            else
                return null;
        })
        .filter(obj=>obj!==null)
        .map(({id})=>id);        
        if(!ids) return;
        [...document.querySelectorAll(".occupied")].forEach(div=>div.classList.add("hide"));
        ids.forEach(id=>{
            let customerDiv = document.querySelector(`[data-cust-id='${id}']`);
            let alphabetDiv = customerDiv.parentNode;
            alphabetDiv.classList.remove("hide");
            [...alphabetDiv.children].forEach(div=>{
                if(!ids.includes(div.dataset.custId) && div.nodeName==="DIV")
                    div.classList.add("hide");
                else
                    div.classList.remove("hide");
            });
        })
    }
    else
        [...document.querySelectorAll(".occupied")].forEach(div=>{
            div.classList.remove("hide");
            [...div.children].forEach(div=>div.classList.remove("hide"));
        });
    let blocks = [...document.querySelectorAll(".occupied")]
                .filter(div=>!(div.classList.contains("hide")));
    rows = blocks.map(block=>([...block.querySelectorAll(".customer-div")])).flat()
                .filter(div=>!(div.classList.contains("hide")));
    rows.forEach(row=>{
        delete row.dataset.hasFocus;
    });
}

ipcRenderer.send("get-customer");

function drawPieChart(){
    colorCode = [];
    ctx = canvas.getContext("2d");
    let netBalance = 0,startAngle = 0;
    customerList.sort(({name:a},{name:b})=>a.localeCompare(b, 'fr', {ignorePunctuation: true}));
    customerList.forEach(({netPurchase:balance,id})=>{
        netBalance += balance;
        let endAngle = 2*Math.PI*netBalance/total;
        let customerDiv = document.querySelector(`[data-cust-id='${id}']`);
        renderPieChart(canvas,startAngle,endAngle);
        colorCode.push({color:ctx.fillStyle,id,startAngle,endAngle});
        startAngle = endAngle;
        [...customerDiv.children].forEach(p=>{
            p.style.color=ctx.fillStyle;
        });
    });
    ctx.save();
}

ipcRenderer.on("customer-list",(e,customerObj)=>{
    console.log(customerObj);
    customerList = [];
    currentPage = 1;
    rows = [];
    spinner.remove(window);
    removeAllElem("#customer-list .customer-div");
    customerObj.forEach((_customerList)=>{
        let { name,balance=0,id,netPurchase=0 } = _customerList;
        name = name.trim();
        if(parseInt(netPurchase)===NaN || parseInt(balance)===NaN || typeof netPurchase === "string") return console.log(_customerList);
        let startLetter = name.charAt(0).toLowerCase();
        if(!startLetter || !/[a-z]/.test(startLetter)) return;
        customerList.push(_customerList);
        let selectedDiv = document.querySelector(`[data-letter="${startLetter}"]`);
        selectedDiv.classList.add("occupied");
        let div = appendToHost("#customer-div-template",selectedDiv,"DIV");
        let p = div.querySelector("p.name");
        p.textContent = name;
        p = div.querySelector("p.balance");
        p.textContent = Math.round(balance);
        div.dataset.custId = id;
        selectedDiv.classList.remove("hide");
        total += netPurchase;
    });
    document.querySelector("#form>div:last-child input").value = "";
    drawPieChart();
});

async function drawGraphs(id,reverseFlag=true){
    bills = await ipcRenderer.invoke("show-customer-bills",id);
    bills
    .reduce((acc,{billDate,billAmt})=>{
        acc[0][0] += billAmt;
        acc[0][1].push({date:billDate,amt:billAmt});
        return acc;
    },[[0 , []]])
    .forEach(([total,objs])=>{
        if(reverseFlag)
            objs = objs.reverse();
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#bill-graph","green","red",{yLegend:"Amount",lOffset:25,xLegend:"Date",yLegOffset:0.4});
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    });
    (await ipcRenderer.invoke("get-customer-out-payments",selectedCustomer.id))
    .reduce((acc,{date,payment})=>{
        acc[0][0] += payment;
        acc[0][1].push({date,amt:payment});
        return acc;
    },[[0 , []]])
    .forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#payment-graph","yellow","green",{yLegend:"Payment",xLegend:"Date",lOffset:15});
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    });
}

async function loadLedgerTable(_name){
    [...document.querySelectorAll("#canvas-container,#chart-div>p")]
    .forEach(elem=>{
        elem.classList.add("hide");
    });
    // let spinner = drawSpinner(document);
    // spinner.remove(window);
    selectedCustomer = customerList.find(({name})=>name===_name);
    page2BTNS.dataset.id = selectedCustomer.id;
    page2BTNS.dataset.name = selectedCustomer.name;
    if(!("phones" in selectedCustomer) || typeof selectedCustomer.phones==="undefined")
        selectedCustomer.phones = "[]";
    let phones = selectedCustomer.phones instanceof Array ? selectedCustomer.phones : JSON.parse(selectedCustomer.phones);
    this?.classList?.add("hide");
    let ledgerDiv = document.getElementById("ledger-div-template").content.cloneNode(true).querySelector("div");
    let sideDiv = document.getElementById("chart-div");
    sideDiv.classList.add("page2-sidebar");
    removeAllElem("#page2-side-panel")
    let customerDiv = document.getElementById("card-template").content.cloneNode(true).querySelector("div");    
    [...customerDiv.querySelectorAll(".col-1")]
    .forEach(p=>{
        if(p.dataset.colname!=="phones")
            p.textContent = selectedCustomer[p.dataset.colname];
        else
            p.innerHTML = phones?.map?.((phone,index)=>{
                if(index<phones.length-1)
                    return `<p class="col-1">${phone},</p>`
                else
                    return `<p class="col-1">${phone}</p>`
            }).reduce((acc,str)=>acc+str,"");
    });
    ledgerEntries = await ipcRenderer.invoke("get-full-customer-ledger",selectedCustomer.id);
    removeAllElem("#ledger-div")
    //Implement realtime Ledger update logic

    let tbody = ledgerDiv.querySelector("#tbody");
    // Opening balance row: the stored value, ignored when not set. A legacy
    // "opening-balance" entry already carries it, so no row is added then and
    // running balances are not shifted. Entries stay newest-first below it.
    const rawOb = selectedCustomer.moreInfo?.openingBalance;
    const storedOpening = Number(rawOb);
    const hasStoredOpening = rawOb !== undefined && rawOb !== null && rawOb !== "" && !Number.isNaN(storedOpening);
    const hasTypedOpening = ledgerEntries.some(obj=>obj.type==="opening-balance");
    const openingShift = (hasStoredOpening && !hasTypedOpening) ? storedOpening : 0;
    if(hasStoredOpening && !hasTypedOpening){
        let row = document.createElement("div");
        row.innerHTML = `
            <p class="col eq-space"></p>
            <p class="col eq-space">Opening balance</p>
            <p class="col eq-space">—</p>
            <p class="col eq-space">${roundOffTo2DecimalPlace(openingShift)}</p>
        `;
        row.classList.add("row");
        row.classList.add("body");
        tbody.appendChild(row);
    }
    ledgerEntries.forEach(obj=>{
        let {date,billNo,billAmt,type,payments,balance,itemList,entryNo} = obj;
        let row = document.createElement("div");
        let particular,drcr;
        if(type==="sale"){
            particular = `Sale: Bill Number:${billNo}`;
            drcr = `${Math.round(billAmt-payments)} Dr`;
        }
        else if(type==="opening-balance"){
            particular = "Opening balance";
            drcr = "—";
        }
        else{
            particular = `Payment: Rs.${payments}`;
            drcr = `${payments} Cr`;
        }
        row.innerHTML = `
            <p class="col eq-space">${new Date(date).toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${particular}</p>
            <p class="col eq-space">${drcr}</p>
            <p class="col eq-space">${roundOffTo2DecimalPlace(balance + openingShift)}</p>
        `;
        row.classList.add("row");
        row.classList.add("body");
        row.dataset.itemList = itemList;
        row.dataset.entryNo = entryNo;
        tbody.appendChild(row);
    });
    document.getElementById("customer-list").after(ledgerDiv);
    document.getElementById("bill-table")?.classList?.add("hide");
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    sideDiv.appendChild(customerDiv);
    // Credit-limit warning from the customer's saved policy
    const custPolicy = await ipcRenderer.invoke("get-customer-policy",selectedCustomer.id);
    if(custPolicy && custPolicy.creditLimit > 0 && Number(selectedCustomer.balance) > custPolicy.creditLimit){
        let warn = document.createElement("p");
        warn.className = "cust-policy-warn";
        warn.textContent = `Over credit limit — outstanding Rs. ${Math.round(selectedCustomer.balance)}, limit Rs. ${custPolicy.creditLimit}`;
        customerDiv.appendChild(warn);
    }
    await drawGraphs(selectedCustomer.id);
    [...document.querySelectorAll("#btn-container>button")]
    .forEach(btn=>{
        if(btn.dataset.view==="ledger")
            btn.classList.add("hide");
        else
            btn.classList.remove("hide");
    });
    // spinner.remove(window);
} // WORK in Progress

document.getElementById("customer-list").addEventListener("click",function(e){
    if(!e.target.classList.contains("customer-div") && !e.target.classList.contains("customer-p")) return;
    currentPage = 2;
    let name = (e.target.classList.contains("customer-div") ? e.target.children[0] : e.target.parentNode.querySelector(".customer-p.name")).textContent;
    loadLedgerTable.call(this,name);
    document.querySelector("#form>div:last-child").classList.add("hide");
    document.querySelector("#chart-div > p:nth-child(3)").classList.add("hide");
    page2BTNS.classList.remove("hide");
});

function resetPortal(e){
    spinner = drawSpinner(document);
    document.querySelector("#back-btn-div")?.removeEventListener("click",arguments.callee);
    removeAllElem("#page2-side-panel,.table");
    document.getElementById("customer-list").classList.remove("hide");
    page2BTNS.classList.add("hide");    
    document.querySelector("#form>div:last-child").classList.remove("hide");
    document.getElementById("canvas-container").classList.remove("hide");
    [...document.querySelectorAll("#chart-div>p")].forEach(p=>p.classList.remove("hide"));
    document.querySelector(".page2-sidebar").classList.remove("page2-sidebar");
    total = 0;
    ipcRenderer.send("get-customer");
}

function closeModal(){
    _closeModal();
    if(itemList.length>0)
        itemList = [];
}

async function addPayment(e){
    e.preventDefault();
    let payObj = Object.fromEntries(new FormData(e.target).entries());
    const { name,id } = e.target.dataset;
    try{
        await ipcRenderer.invoke("add-payment",name,payObj,id);
        await loadLedgerTable(name);
    }
    catch(err){
        console.log(err);
    }
    closeModal();
}

function billPageInit(){
    document.querySelector("#ledger-div").classList.add("hide");    
    let mainDiv = document.getElementById("main-section");
    removeAllElem("#bill-table")
    let billsDiv = document.createElement("div");
    billsDiv.addEventListener("contextmenu",e=>{
        selectedDiv = traverseParent(e.target,"row");
        contextMenuFunction(e,"customer-portal")
    });
    billsDiv.dataset.id = this.dataset.id;
    billsDiv.classList.add("table");
    billsDiv.id = "bill-table";
    billsDiv.classList.add("bill-table-2");
    billsDiv.addEventListener("click",showBillOptions.bind(billsDiv));
    let h1 = document.createElement("h1");
    h1.textContent = "Bills";
    billsDiv.appendChild(h1);
    let headRow = document.createElement("div");
    headRow.className = `head row`;
    headRow.innerHTML = `
        <p data-name="date" class="col eq-space">Date</p>
        <p data-name="billNo" class="col eq-space">Bill No</p>
        <p data-name="billAmt" class="col eq-space">Bill Amt</p>
        <p data-name="payment" class="col eq-space">Payment</p>
        <p data-name="balance" class="col eq-space">Due</p>
    `;
    billsDiv.appendChild(headRow);
    let tbody = document.createElement("div");
    tbody.id = "tbody";
    billsDiv.appendChild(tbody);
    document.getElementById("graph-container").classList.remove("hide");
    bills.forEach(billObj=>{
        let {billAmt,billDate,billItemTable,billNo,billStatus,payment,paymentStatus} = billObj;
        let row = document.createElement("div");
        row.dataset.billObj = JSON.stringify(billObj);
        if(billNo==="spot")
            billNo = monthNames[billDate.getMonth()];
        row.innerHTML = `
            <p class="col eq-space">${billDate.toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${billNo}</p>
            <p class="col eq-space">${Math.round(billAmt)}</p>
            <p class="col eq-space">${paymentStatus?Math.round(billAmt):payment}</p>
            <p class="col eq-space ${paymentStatus?"paid":"unpaid"}">${paymentStatus?"Paid":Math.round(billAmt - payment)}</p>
        `;
        row.classList.add("row");
        row.classList.add("body");
        row.dataset.itemList = billItemTable.replace("spot",monthNames[billDate.getMonth()]);
        row.dataset.paymentStatus = paymentStatus?paymentStatus:false;
        row.dataset.billStatus = billStatus;
        row.dataset.billAmt = billAmt;
        row.dataset.payment = payment;
        tbody.appendChild(row);
    });
    mainDiv.appendChild(billsDiv);
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    [...document.querySelectorAll("#btn-container>button")]
    .forEach(btn=>{
        if(btn.dataset.view==="bills")
            btn.classList.add("hide");
        else
            btn.classList.remove("hide");
    });// Nav buttons
}

page2BTNS.addEventListener("click",async function(e){
    if(e.target.dataset.cmd==="back") return;
    if(e.target.dataset.cmd==="bills")
        billPageInit.call(this);
    else
    if(e.target.dataset.cmd==="print-ledger")
        printModal("customer-ledger-dialog");
    else
    if(e.target.dataset.cmd==="filter")
        document.getElementById("filter-option").classList.toggle("hide");
    else
    if(e.target.dataset.cmd==="ledger"){
        [...document.querySelectorAll("#btn-container>button")]
        .forEach(btn=>{
            if(btn.dataset.view==="ledger")
                btn.classList.add("hide");
            else
                btn.classList.remove("hide");
        });
        document.getElementById("ledger-div").classList.remove("hide");
        document.getElementById("bill-table").classList.add("hide");
    }
    else
    if(e.target.dataset.cmd==="update-profile"){
        let updateForm = document.getElementById("update-profile-template").content.cloneNode(true).querySelector("form");
        removeAllElem("#update-profile-modal");
        let modal = createModal("update-profile-modal",false);
        modal.appendChild(updateForm);
        let custId = e.target.parentNode.dataset.id;
        let selectedCustomer = customerList.find(obj=>obj.id===custId);
        updateForm.dataset.id = custId;
        [...modal.querySelectorAll("input")]
        .forEach(input=>{
            let colName = input.name;
            if(colName==="email")
                input.value = selectedCustomer.moreInfo.email;
            else
            if(colName!=="phones")
                input.value = selectedCustomer[colName];
            else
                input.value = JSON.parse(selectedCustomer.phones)
                .reduce((acc,num,index,self)=>{
                    if(self.length===1 && index===0)
                        acc += num;
                    else
                        acc += num + ", ";
                    return acc;
                },"");
        });
    }
    else
    if(e.target.dataset.cmd==="add-balance"){
        let custId = traverseParent(e.target,"btn-container").dataset.id;
        removeAllElem("#opening-balance-modal");
        let modal = document.getElementById("opening-balance-modal-template").content.cloneNode(true).querySelector("div");
        document.body.appendChild(modal);
        modal.classList.remove("hide");
        modal.querySelector("input").focus();
        modal.querySelector("form").dataset.id = custId;
    }
    else
    if(e.target.dataset.cmd==="cust-policy"){
        let custId = traverseParent(e.target,"btn-container").dataset.id;
        let _cust = customerList.find(obj=>obj.id===custId);
        if(!_cust) return;
        removeAllElem("#cust-policy-modal");
        let modal = createModal("cust-policy-modal",false);
        let form = document.getElementById("cust-policy-template").content.cloneNode(true).querySelector("form");
        form.dataset.id = custId;
        form.querySelector(".cust-policy-name").textContent = _cust.name;
        const policy = await ipcRenderer.invoke("get-customer-policy",custId);
        if(policy){
            form.querySelector("input[name='dueDays']").value = policy.dueDays;
            form.querySelector("input[name='creditLimit']").value = policy.creditLimit;
            form.querySelector("input[name='epPercent']").value = policy.earlyPayDiscount.percent;
            form.querySelector("input[name='epWithinDays']").value = policy.earlyPayDiscount.withinDays;
            form.querySelector("input[name='saleDiscount']").value = policy.saleDiscount;
            const rem = policy.reminder || {};
            form.querySelector("input[name='reminderEnabled']").checked = !!rem.enabled;
            form.querySelector("input[name='onDueDate']").checked = !!rem.onDueDate;
            form.querySelector("select[name='repeatFreq']").value = rem.repeat?.enabled ? rem.repeat.frequency : "none";
            form.querySelector("input[name='remindTime']").value = rem.repeat?.time || "10:00";
            (rem.repeat?.days || []).forEach(day=>{
                const cb = form.querySelector(`input[name='remindDay'][value='${day}']`);
                if(cb) cb.checked = true;
            });
            const tpl = policy.template || {};
            form.querySelector("textarea[name='message']").value = tpl.message || "";
            form.querySelector("input[name='includePDF']").checked = !!tpl.includePDF;
            form.querySelector("input[name='includePaymentLink']").checked = !!tpl.includePaymentLink;
            form.querySelector("input[name='includeLedgerBalance']").checked = !!tpl.includeLedgerBalance;
        }
        modal.appendChild(form);
    }
    else
    if(e.target.dataset.cmd==="ship-info"){
        let custId = traverseParent(e.target,"btn-container").dataset.id;
        let _cust = customerList.find(obj=>obj.id===custId);
        if(!_cust) return;
        removeAllElem("#ship-info-modal");
        let modal = createModal("ship-info-modal",false);
        let form = document.getElementById("ship-info-template").content.cloneNode(true).querySelector(".ship-info-form");
        form.dataset.id = custId;
        form.querySelector(".ship-info-name").textContent = _cust.name;
        shipInfoWorking = (await ipcRenderer.invoke("get-ship-infos",custId)) ?? [];
        shipInfoRenderList(form);
        modal.appendChild(form);
    }
    else
    if(e.target.dataset.cmd==="new-bill")
        ipcRenderer.send("new-bill",selectedCustomer);
    else
    if(e.target.dataset.cmd==="pay"){
        let modal = createModal("add-payment-modal");
        let { name,id } = {...e.target.parentNode.dataset};
        let addPaymentForm = document.getElementById("add-payment-template").content.cloneNode(true).querySelector("form");
        modal.appendChild(addPaymentForm);
        addPaymentForm.dataset.id = id;
        addPaymentForm.dataset.name = name;
        let cashSegment = document.getElementById("cash-feild-template").content.cloneNode(true).querySelector("div");
        addPaymentForm.querySelector("#first-section").appendChild(cashSegment);
        document.body.appendChild(modal);
        // Early-pay hint from the customer's saved policy
        const custPolicy = await ipcRenderer.invoke("get-customer-policy",id);
        const ep = custPolicy && custPolicy.earlyPayDiscount;
        if(ep && ep.percent > 0 && ep.withinDays > 0 && Array.isArray(ledgerEntries)){
            const within = ledgerEntries.filter(obj=>{
                const daysOld = (Date.now() - new Date(obj.date).getTime()) / 86400000;
                return obj.type === "sale" && (Number(obj.billAmt) - Number(obj.payments)) > 0 && daysOld <= ep.withinDays;
            });
            if(within.length){
                const due = within.reduce((a,obj)=>a + (Number(obj.billAmt) - Number(obj.payments)),0);
                let hint = document.createElement("p");
                hint.className = "cust-policy-note cust-policy-hint";
                hint.textContent = `Early-pay discount ${ep.percent}% applies on Rs. ${Math.round(due)} (bills within ${ep.withinDays} days) — pay Rs. ${Math.round(due * (1 - ep.percent/100))}.`;
                addPaymentForm.querySelector("#first-section").appendChild(hint);
            }
        }
    }
    else{
        [...document.getElementById("filter-option").children].forEach(div=>div.classList.remove("selected"));
        let elem = e.target.nodeName!=="DIV"?e.target.parentNode:e.target;
        elem.classList.add("selected");
        [...document.querySelectorAll("#bill-table .row.body")].forEach(div=>{
            let elem = e.target.nodeName==="DIV"?e.target.children[0]:e.target;
            if(elem.dataset.cmd==="unpaid" && div.dataset.paymentStatus==="true")
                div.classList.add("hide");
            else
            if(elem.dataset.cmd==="paid" && div.dataset.paymentStatus==="false")
                div.classList.add("hide");
            else
                div.classList.remove("hide");
        });
    }
}); // Ok Complete

async function updateProfile(e){
    e.preventDefault();
    let custData = Object.fromEntries(new FormData(e.target).entries());
    // GST validation — warn only (same checksum used on salePage)
    if(custData.gst && !gstChecksum(custData.gst))
        showToastNotification("GST number may be not valid. You may consider a recheck.",["animation-common","move-left","red-toast-box"],document.body);
    custData.phones = custData.phones.split(",").map(str=>str.trim());
    selectedCustomer = {
        ...selectedCustomer,
        ...custData
    };
    selectedCustomer.moreInfo.email = custData.email;
    Reflect.deleteProperty(selectedCustomer,"email");
    [...e.target.querySelectorAll("input")].forEach(input=>input.setAttribute("disabled","disabled"));
    [...document.querySelectorAll(".card p")]
    .forEach(p=>{
        if(p.dataset.colname && p.dataset.colname!=="phones")
            p.textContent = custData[p.dataset.colname];
        else
            p.textContent = custData.phones.reduce((acc,num,index,self)=>{
                if(self.length===1 || index===self.length-1)
                    acc += num;
                else
                    acc += num + ", ";
                return acc;
            },"");
    });
    custData.id = selectedCustomer.id;
    custData.phones = JSON.stringify(custData.phones);// Remove this line after db reset.
    try{
        await ipcRenderer.invoke("update-customer-profile",custData);
    }
    catch(err){
        console.log(err);
    }
    closeModal();
} // Need a check later

function enableInputs(e){
    let form = document.querySelector("#update-profile-modal form");
    [...form.querySelectorAll("input")]
    .forEach(input=>input.removeAttribute("disabled"));
    if(e.target.nodeName==="BUTTON")
        e.target.classList.add("hide");
    form.querySelector("[type='submit']").classList.remove("hide");
}

document.body.addEventListener("click",(e)=>{
    document.getElementById("filter-option")?.classList.add("hide");
    if(e.target.nodeName!=="CANVAS"){
        ctx.restore();
        drawPieChart();
    }
    renderPieChart();
    [...document.querySelectorAll(".customer-div")].forEach(div=>div.style.borderColor = "black");
},true);

async function showBillOptions(e){
    let bodyRow = e?.target?.parentNode ?? this;
    if(!bodyRow.classList.contains("body") && !bodyRow.classList.contains("row")) return;
    let modal = createModal("bill-option-modal");
    let modalContent = document.getElementById("bill-option-template").content.cloneNode(true).querySelector("#bill-option-content");
    modal.appendChild(modalContent);
    modalContent.dataset.billObj = JSON.stringify({...bodyRow.dataset});
    let tbody = modalContent.querySelector("#tbody");
    const { itemList,paymentStatus,billStatus } = bodyRow.dataset;
    if(!itemList) return;
    let [ custId,billNo,billDate ] = itemList.split("_");
    let billItems =[...await ipcRenderer.invoke("get-bill-items-portal",custId,billNo,billDate)]
    // console.log(billItems)
    billItems.forEach((obj,i)=>{
        let row = document.getElementById("bill-body-row-template").content.cloneNode(true).querySelector("div");
        row.querySelector(`[data-name="slNo"]`).textContent = i + 1;
        for(let key in obj){
            let p = row.querySelector(`[data-name='${key}']`);
            if(p)
                p.textContent = obj[key];
        }
        tbody.appendChild(row);
    });
}

async function billUtils(e){
    const {cmd} = e.target.dataset;
    let billOptionContent = e.target.parentNode.parentNode;
    let { entryNo } = JSON.parse(JSON.parse(billOptionContent.dataset.billObj).billObj);
    let opt = document.getElementById("bill-option-content");
    if(!opt) return;
    const {itemList,billAmt,payment,netDue} = JSON.parse(opt.dataset.billObj);
    if(cmd==="close" || (!itemList || !billAmt || !payment)) return;
    let name = selectedCustomer.name;
    let [id,billNo,billDate] = itemList.split("_");
    if(cmd==="open")
        ipcRenderer.send("open-ext",name,billDate,billNo);
    else if(cmd==="print")
        ipcRenderer.send("print",name,billDate,billNo,entryNo);
    else if(cmd==="add-item"){
        let itemList = await ipcRenderer.invoke("get-bill-items-portal",id,billNo,billDate);
        itemList = itemList.map(obj=>{
            return {
                ...obj,
                qty:obj.quantity
            }
        })
        ipcRenderer.send("edit-bill",id,itemList,entryNo);
    }
    else
    if(cmd==="cancel-bill")
        ipcRenderer.invoke("cancel-bill",id,billNo,billDate,billAmt,entryNo);
}

function handlePrint(e){
    e.preventDefault();
    let period = e.target["ledger-period"].value;
    ipcRenderer.send("print-ledger",selectedCustomer.id,period,2);
    document.querySelector('[data-name="cancel"]').click();
}

function selectionHandler(e){
    if(e.target.dataset.name!=="name") return;
    let input = e.target;
    let bodyRow = input.parentNode.parentNode;
    let rowNo = bodyRow.querySelector("p").textContent;
    let rowId = uuid.v5(rowNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    let option = input.list.querySelector(`[data-name='${input.value}']`);
    let obj = {...option.dataset};
    let itemObj = itemList.find(obj=>obj.rowId===rowId);
    for(let key in obj)
        itemObj[key] = obj[key];
    [...bodyRow.querySelectorAll("input")]
    .forEach(input=>{
        if(["qty","unit","amt","cgst","sgst","igst","name"].includes(input.dataset.name)) return;
        input.value = roundOffTo2DecimalPlace(itemObj[input.dataset.name])
    });
}

function calculateAmounts(e){
    let bodyRow = e.target.parentNode.parentNode;
    let qty = Number(bodyRow.querySelector(`[data-name='qty']`).value);
    let rate = Number(bodyRow.querySelector(`[data-name='standardSellPrice']`).value);
    let sgst = Number(bodyRow.querySelector(`[data-name='sgst']`).value);
    let cgst = Number(bodyRow.querySelector(`[data-name='cgst']`).value);
    let igst = Number(bodyRow.querySelector(`[data-name='igst']`).value);
    if(qty && rate)
        bodyRow.querySelector("p.amt").textContent = roundOffTo2DecimalPlace(rate * qty);
    let tax = igst>0?igst:sgst+cgst;
    if(qty && rate && tax)
        bodyRow.querySelector("p.amt-with-tax").textContent = roundOffTo2DecimalPlace(rate * qty * (1 + (tax/100)));
}

function back2page1(){
    [...document.querySelectorAll("#bill-option-modal .page")]
    .forEach((page,i)=>{
        if(i+1===1)
            page.classList.remove("hide");
        else
            page.classList.add("hide");
    });
}

function progressCancel(e){
    ipcRenderer.send("cancel-"+e.target.dataset.cancelToken);
}

function refreshHelper(){
    billPageInit.call(page2BTNS);
    ipcRenderer.send("refresh-customer-list");
    loadLedgerTable(selectedCustomer.name)
}

ipcRenderer.on("close-modal", ()=>{
    refreshHelper()
    _closeModal();
});

ipcRenderer.on("reload-tables",refreshHelper)

function showBillPage(){
    removeAllElem("#bill-option-modal .page");
    removeAllElem("#bill-option-modal form");
    document.getElementById("bill-option-content").classList.remove("hide");
}

function setPayFeilds(e){
    let payMode = e.target.value;
    removeAllElem(".removable-section");
    let paySegment = document.getElementById(`${payMode}-feild-template`).content.cloneNode(true).querySelector("div");
    document.getElementById("first-section").appendChild(paySegment);
}

async function saveCustomerPolicy(e){
    e.preventDefault();
    let form = e.target;
    let custId = form.dataset.id;
    let f = new FormData(form);
    let days = [...form.querySelectorAll("input[name='remindDay']:checked")].map(cb=>Number(cb.value));
    let repeatFreq = f.get("repeatFreq");
    let policy = {
        dueDays: Number(f.get("dueDays")) || 0,
        creditLimit: Number(f.get("creditLimit")) || 0,
        earlyPayDiscount: { percent: Number(f.get("epPercent")) || 0, withinDays: Number(f.get("epWithinDays")) || 0 },
        saleDiscount: Number(f.get("saleDiscount")) || 0,
        reminder: {
            enabled: !!f.get("reminderEnabled"),
            onDueDate: !!f.get("onDueDate"),
            repeat: {
                enabled: repeatFreq !== "none",
                frequency: repeatFreq === "none" ? "daily" : repeatFreq,
                days,
                time: f.get("remindTime") || "10:00"
            }
        },
        template: {
            message: f.get("message"),
            includePDF: !!f.get("includePDF"),
            includePaymentLink: !!f.get("includePaymentLink"),
            includeLedgerBalance: !!f.get("includeLedgerBalance")
        }
    };
    let res = await ipcRenderer.invoke("set-customer-policy",custId,policy);
    if(res && res.ok){
        showToastNotification("Customer policy saved.",["animation-common","move-left","blue-toast-box"],document.body);
        closeModal();
    }
    else
        showToastNotification((res && res.error) ? res.error : "Could not save the policy.",["animation-common","move-left","red-toast-box"],document.body);
}

// ---------- shipping addresses (shipTo) manager ----------
function shipInfoEsc(s){
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function shipInfoRenderList(form){
    let list = form.querySelector(".ship-info-list");
    while(list.firstChild) list.removeChild(list.firstChild);
    form.querySelector(".ship-info-empty").hidden = shipInfoWorking.length > 0;
    shipInfoWorking.forEach((info,index)=>{
        let row = document.createElement("div");
        row.className = "ship-info-row";
        let sub = [info.shipAddr,info.shipPh,info.shipGST].filter(v=>v && String(v).trim()).map(shipInfoEsc).join(" · ");
        row.innerHTML = `
            <div class="ship-info-row-main">
                <p class="ship-info-row-name">${shipInfoEsc(info.shipTo)}</p>
                ${sub ? `<p class="ship-info-row-sub">${sub}</p>` : ""}
            </div>
            <div class="ship-info-row-btns">
                <button type="button" class="main-ui-btn hover bottom" onclick="editShipInfoRow(event)" data-idx="${index}">Edit</button>
                <button type="button" class="ship-info-remove-btn hover bottom" onclick="removeShipInfoRow(event)" data-idx="${index}">Remove</button>
            </div>`;
        list.appendChild(row);
    });
}

function shipInfoEditorShow(form){
    let editor = form.querySelector(".ship-info-editor");
    editor.hidden = false;
    editor.scrollIntoView({block:"nearest"});
    ["shipTo","shipAddr","shipPh","shipGST"].forEach(k=>editor.querySelector(`input[name='${k}']`).value = "");
    form.querySelector(".ship-info-editor-title").textContent = "Add shipping address";
    delete editor.dataset.idx;
}

function addShipInfoRow(e){
    let form = traverseParent(e.target,"ship-info-form");
    shipInfoEditorShow(form);
    form.querySelector(".ship-info-editor input[name='shipTo']").focus();
}

function editShipInfoRow(e){
    let form = traverseParent(e.target,"ship-info-form");
    let info = shipInfoWorking[Number(e.target.dataset.idx)];
    if(!info) return;
    shipInfoEditorShow(form);
    let editor = form.querySelector(".ship-info-editor");
    ["shipTo","shipAddr","shipPh","shipGST"].forEach(k=>editor.querySelector(`input[name='${k}']`).value = info[k] ?? "");
    form.querySelector(".ship-info-editor-title").textContent = "Edit shipping address";
    editor.dataset.idx = e.target.dataset.idx;
}

function saveShipInfoEntry(e){
    let form = traverseParent(e.target,"ship-info-form");
    let editor = form.querySelector(".ship-info-editor");
    let customerName = form.querySelector(".ship-info-name").textContent.trim();
    let entry = {};
    ["shipTo","shipAddr","shipPh","shipGST"].forEach(k=>entry[k] = editor.querySelector(`input[name='${k}']`).value.trim());
    if(!entry.shipTo){
        showToastNotification("Ship-to name is required.",["animation-common","move-left","red-toast-box"],document.body);
        return;
    }
    if(editor.dataset.idx !== undefined){
        let prev = shipInfoWorking[Number(editor.dataset.idx)];
        entry.name = (prev && prev.name) || customerName;
        shipInfoWorking[Number(editor.dataset.idx)] = entry;
    }
    else{
        // `name` mirrors what saleHandler stores on bill save (the customer's
        // name) — the sale page's superkey/dedupe logic depends on it
        entry.name = customerName;
        shipInfoWorking.push(entry);
    }
    editor.hidden = true;
    shipInfoRenderList(form);
    shipInfoPersist(form,"Shipping address saved.");
}

function cancelShipInfoEdit(e){
    let form = traverseParent(e.target,"ship-info-form");
    let editor = form.querySelector(".ship-info-editor");
    editor.hidden = true;
    delete editor.dataset.idx;
}

function removeShipInfoRow(e){
    let btn = e.target;
    if(btn.dataset.armed === "1"){// two-step: first click arms, second removes
        clearTimeout(Number(btn.dataset.tid));
        shipInfoWorking.splice(Number(btn.dataset.idx),1);
        let form = traverseParent(btn,"ship-info-form");
        shipInfoRenderList(form);
        shipInfoPersist(form,"Shipping address removed.");
        return;
    }
    btn.dataset.armed = "1";
    btn.textContent = "Sure?";
    btn.dataset.tid = String(setTimeout(()=>{
        btn.dataset.armed = "";
        btn.textContent = "Remove";
    },3000));
}

function shipInfoSyncRendererList(custId,infos){
    // keep the portal's renderer customer list in sync (fresh shipInfos for
    // any later use, e.g. reopening the modal in this session)
    let c = customerList.find(obj=>obj.id===custId);
    if(!c) return;
    let mi = c.moreInfo;
    if(typeof mi === "string"){
        try{
            let obj = JSON.parse(mi);
            if(!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
            obj.shipInfos = infos;
            c.moreInfo = JSON.stringify(obj);
        }catch(_){}
    }
    else{
        if(!mi || typeof mi !== "object" || Array.isArray(mi)) mi = {};
        mi.shipInfos = infos;
        c.moreInfo = mi;
    }
}

// Auto-save: every add/edit/remove commits the working list immediately —
// the modal has no Save/Cancel footer, so a failed write must roll the UI
// back to whatever the DB actually holds.
async function shipInfoPersist(form,successMsg){
    let custId = form.dataset.id;
    let res;
    try{
        res = await ipcRenderer.invoke("set-ship-infos",custId,shipInfoWorking);
    }catch(err){
        res = { ok:false, error:String((err && err.message) || err) };
    }
    if(res && res.ok){
        shipInfoSyncRendererList(custId,res.shipInfos);
        showToastNotification(successMsg,["animation-common","move-left","blue-toast-box"],document.body);
    }
    else{
        showToastNotification((res && res.error) ? res.error : "Could not save shipping addresses.",["animation-common","move-left","red-toast-box"],document.body);
        try{ shipInfoWorking = (await ipcRenderer.invoke("get-ship-infos",custId)) ?? []; }catch(_){}
        shipInfoRenderList(form);
    }
}

function updateLedger(e){
    e.preventDefault();
    let custId = e.target.dataset.id;
    let balance = Number(e.target.balance.value);
    ipcRenderer.send("add-opening-balance",custId,balance);
}

ipcRenderer.on("msg-from-backend",(e,msg,type,mode=0,obj)=>{
    let classList = ["animation-common","move-left","blue-toast-box"];
    if(type==="error")
        classList = ["animation-common","move-left","red-toast-box"];
    showToastNotification(msg,classList);
    if(mode===1)
        loadLedgerTable(obj.name);
});

ipcRenderer.on("show-bill",(e,billObj)=>{
    if(selectedDiv)
        selectedDiv.querySelector(".col").click();
});

function scrollHelper2(e,mainSection,secMainSection,rows){
    let focusssedRow = rows.find(row=>(row.dataset?.hasFocus=="1"));
    let focussedIndex;
    if(typeof focusssedRow==="undefined"){
        focusssedRow = rows[0];
        focusssedRow.dataset.hasFocus = 1;
        focussedIndex = 0;
        scrollHelper(rows,focussedIndex,e.key,true,mainSection,secMainSection);
    }
    else{
        focussedIndex = rows.findIndex(row=>(row.dataset?.hasFocus=="1"));
        scrollHelper(rows,focussedIndex,e.key,false,mainSection,secMainSection);
    }
}

document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
        if(document.querySelector(".modal:not(.hide)")){
            closeModal();
            return;
        }
    }
    if(currentPage===1){
        if(e.key==="ArrowUp" || e.key==="ArrowDown"){
            let mainSection = document.getElementById("customer-list");
            let secMainSection = mainSection.querySelector(".occupied h1");
            if(rows.length===0)
                rows = [...document.querySelectorAll(".customer-div")]
            scrollHelper2(e,mainSection,secMainSection,rows);
        }
        if(e.key==="Enter"){
            rows.find(row=>(row.dataset?.hasFocus=="1")).click();
        }
    }
    else
    if(currentPage===2){
        if(e.key==="Backspace")
            document.querySelector("#btn-container button[data-cmd='back']").click();
        else
        if(e.key==="ArrowUp" || e.key==="ArrowDown"){
            rows2 = [...document.querySelectorAll("#bill-table .body.row")];
            let mainSection = document.getElementById("bill-table");// Work in progress
            let secMainSection = mainSection.querySelector(".head.row");
            scrollHelper2(e,mainSection,secMainSection,rows2);
        }
        else
        if(e.ctrlKey){
            if(e.key==="f"){
                e.preventDefault();
                let filterBtn = document.getElementById("filter-btn");
                if(!filterBtn.classList.contains("hide"))
                    filterBtn.click();
            }
            else
            if(e.key==="e" && document.getElementById("bill-option-modal"))
                document.querySelector("#bill-option-BTNs button[data-cmd='add-item']").click();
            else
            if(e.key==="p" && document.getElementById("bill-option-modal"))
                document.querySelector("#bill-option-BTNs button[data-cmd='print']").click();
            else
            if(e.key==="o" && document.getElementById("bill-option-modal"))
                document.querySelector("#bill-option-BTNs button[data-cmd='open']").click();
            else
                [...document.querySelectorAll("#btn-container button[data-keymap]")]
                .forEach(btn=>{
                    if(btn.classList.contains("hide")) return;
                    if(e.key===btn.dataset.keymap)
                        btn.click();
                });
        }
        else
        if(e.key==="Enter"){
            let row = rows2.find(row=>(row.dataset?.hasFocus=="1"));
            showBillOptions.call(row);
        }
    }
});

function openShipInfoListForm(e){// Work in progress
    e.preventDefault();
    let form = traverseParent(e.target,"top-level-form","FORM");
    let modal = form.parentNode;
    form.classList.add("hide");
    let shipInfoListForm = document.getElementById("ship-info-list-template").content.cloneNode(true).querySelector("div");
    shipInfoListForm.classList.add("main-ui-form","rear-level-form");
    let shipInfoList = selectedCustomer.moreInfo.shipInfos;
    let tbody = shipInfoListForm.querySelector("#tbody");
    tbody.insertBefore(document.getElementById("ship-info-input-row-template").content.cloneNode(true).querySelector("div"),tbody.querySelector("button"));
    // work in progress
    shipInfoList?.forEach((obj,index)=>{
        let row = document.getElementById("ship-info-list-row-template").content.cloneNode(true).querySelector("div");
        row.querySelector("[data-name='slNo']").textContent = index + 1;
        for(let key in obj){
            let p = row.querySelector(`[data-name='${key}']`);
            if(p)
                p.textContent = obj[key];
        }
        tbody.appendChild(row);
    });
    modal.appendChild(shipInfoListForm);
}

function addRow(e){
    let tbody = e.target.parentNode;
    tbody.insertBefore(document.getElementById('ship-info-input-row-template').content.cloneNode(true).querySelector('div'),e.target);
}

function closeShipInfoListForm(e){
    e.preventDefault();
    let form = traverseParent(e.target,"rear-level-form","FORM");
    let modal = form.parentNode;
    form.remove();
    // document.getElementById("ship-info-list").remove();
    let topLevelForm = modal.querySelector(".top-level-form");
    topLevelForm.classList.remove("hide");
}

document.addEventListener("mouseover",e=>{
    let row = traverseParent(e.target,"customer-div","DIV");
    if(row){
        [...document.querySelectorAll(".customer-div")]
        .forEach(_row=>{
            if(_row===row){
                row.dataset.hasFocus = 1;
                row.classList.add("focus");
            }
            else{
                delete _row.dataset.hasFocus;
                _row.classList.remove("focus");
            }
        });
    }
    row = traverseParent(e.target,"bill-table-2","DIV")
    if(row){
        let selectedRow = traverseParent(e.target,"row","DIV");
        rows2 = [...document.querySelectorAll("#bill-table .body.row")];
        rows2.forEach(_row=>{
            if(_row===selectedRow){
                selectedRow.dataset.hasFocus = 1;
                selectedRow.classList.add("focus");
            }
            else{
                delete _row.dataset.hasFocus;
                _row.classList.remove("focus");
            }
        });
    }
});