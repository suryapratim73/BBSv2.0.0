const { ipcRenderer } = require("electron");
const { toggleDevTool, closeModal:_closeModal, dataModal , retractHandler , createModal , showDeleteBTN ,validateInput, validateInput2 , printModal, drawSpinner, renderPieChart, scrollSymSet, removeAllElem, appendToDL, roundOffTo2DecimalPlace, drawLineGraph } = require("../js/common");
const uuid = require("uuid");
const { unitMap } = require("../../config/saleConfig.json");


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
    ledgerEntries = [];


async function initPage(){
    stockList = await appendToDL("get-stocks",document.getElementById("stock-names"))
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        document.getElementById("unit-dl").appendChild(option);
    });
}
initPage();

function rgbToHex(r, g, b){
    if (r > 255 || g > 255 || b > 255)
        throw "Invalid color component";
    return ((r << 16) | (g << 8) | b).toString(16);
}

document.querySelector("#canvas-container").addEventListener("click",function(e){
    ctx.restore();
    drawPieChart();
    let {x,y} = e;
    canvas = e.target;
    y -= canvas.offsetTop;
    ctx = canvas.getContext("2d");
    let imgData = ctx.getImageData(x,y,1,1).data;
    let hex = "#" + ("000000" + rgbToHex(imgData[0], imgData[1], imgData[2])).slice(-6);
    [...document.querySelectorAll(".customer-div")].forEach(div=>div.style.borderColor = "black");
    let {id,startAngle,endAngle} = colorCode.find(({color})=>color===hex) ?? {};
    if(!id) return;
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
}

ipcRenderer.send("get-customer");

function drawPieChart(){
    colorCode = [];
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
    customerObj.forEach(_customerList=>{
        customerList.push(_customerList);
        const { name,balance,id,netPurchase } = _customerList;
        let startLetter = name.charAt(0).toLowerCase();
        let selectedDiv = document.querySelector(`[data-letter="${startLetter}"]`);
        selectedDiv.classList.add("occupied");
        let div = document.createElement("div");
        let p = document.createElement("p");
        p.textContent = name;
        div.appendChild(p);
        p = document.createElement("p");
        p.textContent = balance;
        div.appendChild(p);
        div.classList.add("customer-div");
        div.dataset.custId = id;
        selectedDiv.appendChild(div);
        selectedDiv.classList.remove("hide");
        total += netPurchase;
    });
    drawPieChart();
    spinner.remove(window);
});

async function drawGraphs(id){
    bills = await ipcRenderer.invoke("show-customer-bills",id);
    bills
    .reduce((acc,{billDate,billAmt})=>{
        acc[0][0] += billAmt;
        acc[0][1].push({date:billDate,amt:billAmt});
        return acc;
    },[[0 , []]])
    .forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#bill-graph","green","red");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    });
    (await ipcRenderer.invoke("get-customer-out-payments",selectedCustomer.id))
    .reduce((acc,{date,payment})=>{
        acc[0][0] += payment;
        acc[0][1].push({date,amt:payment});
        return acc;
    },[[0 , []]])
    .forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,"#payment-graph","yellow","green");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
    });
}

async function loadLedgerTable(_name){
    [...document.querySelectorAll("#canvas-container,#chart-div>p")]
    .forEach(elem=>{
        elem.classList.add("hide");
    });
    let spinner = drawSpinner(document);
    selectedCustomer = customerList.find(({name})=>name===_name);
    page2BTNS.dataset.id = selectedCustomer.id;
    phones = JSON.parse(selectedCustomer.phones);
    this.classList.add("hide");
    let ledgerDiv = document.getElementById("ledger-div-template").content.cloneNode(true).querySelector("div");
    let sideDiv = document.getElementById("chart-div");
    sideDiv.classList.add("page2-sidebar");
    let customerDiv = document.getElementById("card-template").content.cloneNode(true).querySelector("div");    
    [...customerDiv.querySelectorAll(".col-1")]
    .forEach(p=>{
        if(p.dataset.colname!=="phones")
            p.textContent = selectedCustomer[p.dataset.colname];
        else
            p.innerHTML = phones.map((phone,index)=>{
                if(index<phones.length-1)
                    return `<p class="col-1">${phone},</p>`
                else
                    return `<p class="col-1">${phone}</p>`
            }).reduce((acc,str)=>acc+str,"");
    });
    if(ledgerEntries.length===0)
        ledgerEntries = await ipcRenderer.invoke("get-full-customer-ledger",selectedCustomer.id);
    
    //Implement realtime Ledger update logic

    let tbody = ledgerDiv.querySelector("#tbody");
    ledgerEntries.forEach(obj=>{
        let {date,billNo,billAmt,tax,delivery,payments,balance,itemList,entryNo} = obj;
        let row = document.createElement("div");
        let deliveryCharge = 0;
        deliveryCharge += typeof delivery==="object" && "transportCharge" in delivery ? Number(delivery.transportCharge) : 0;
        deliveryCharge += typeof delivery==="object" && "coolieCharge" in delivery ? Number(delivery.coolieCharge) : 0;
        row.innerHTML = `
            <p class="col eq-space">${date.toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${billNo}</p>
            <p class="col eq-space">${Math.round(billAmt+tax+deliveryCharge)}</p>
            <p class="col eq-space">${payments}</p>
            <p class="col eq-space">${balance}</p>
        `;
        row.classList.add("row");
        row.classList.add("body");
        row.dataset.itemList = itemList;
        row.dataset.entryNo = entryNo;
        tbody.appendChild(row);
    });
    this.after(ledgerDiv);
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    sideDiv.appendChild(customerDiv);
    
    await drawGraphs(selectedCustomer.id);
    [...document.querySelectorAll("#btn-container>button")]
    .forEach(btn=>{
        if(btn.dataset.view==="ledger")
            btn.classList.add("hide");
        else
            btn.classList.remove("hide");
    });
    spinner.remove(window);
} // WORK in Progress

document.getElementById("customer-list").addEventListener("click",function(e){
    if(!e.target.classList.contains("customer-div")) return;
    loadLedgerTable.call(this,e.target.children[0].textContent);
    document.querySelector("#form>div:last-child").classList.add("hide");
    document.querySelector("#chart-div > p:nth-child(3)").classList.add("hide");
    page2BTNS.classList.remove("hide");
});

function resetPortal(e){
    document.querySelector("#back-btn-div")?.removeEventListener("click",arguments.callee);
    removeAllElem("#page2-side-panel,.table");
    document.getElementById("customer-list").classList.remove("hide");
    page2BTNS.classList.add("hide");    
    document.querySelector("#form>div:last-child").classList.remove("hide");
    document.getElementById("canvas-container").classList.remove("hide");
    [...document.querySelectorAll("#chart-div>p")].forEach(p=>p.classList.remove("hide"));
    document.querySelector(".page2-sidebar").classList.remove("page2-sidebar");
}

function closeModal(){
    _closeModal();
    if(itemList.length>0)
        itemList = [];
}

async function refreshGraphAndLedger(topLine,id){
    let ledgerRow = document.querySelector("#ledger-div .body.row");
    if(ledgerRow){
        let row = document.createElement("div");
        row.className = "body row";
        row.innerHTML = `
            <p class="col eq-space">${topLine.date.toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${topLine.billNo}</p>
            <p class="col eq-space">${Math.round(Number(topLine.billAmt)+Number(topLine.tax)+Number(topLine.deliveryCharge))}</p>
            <p class="col eq-space">${topLine.payments}</p>
            <p class="col eq-space">${topLine.balance}</p>
        `;
        ledgerRow.before(row);
    }
    await drawGraphs(id);
}

async function addPayment(e){
    e.preventDefault();
    let payObj = Object.fromEntries(new FormData(e.target).entries());
    const { name,billNo,id,billAmt,billDate } = e.target.dataset;
    try{
        let {lastBalance,netDue,topLine,payment} = await ipcRenderer.invoke("add-payment",name,billNo,payObj,id,billAmt);
        let billRow = document.querySelector(`#bill-table .body.row[data-item-list='${id}_${billNo}_${billDate}']`);
        if(billRow){
            billRow.querySelector("p:nth-child(4)").textContent = payment;
            billRow.querySelector("p:nth-child(5)").textContent = netDue;
            billRow.dataset.payment = payment;
            if(payObj.paymode==="cash" && netDue===0){
                billRow.dataset.paymentStatus = "true";
                billRow.querySelector("p:nth-child(5)").classList.remove("unpaid");
                billRow.querySelector("p:nth-child(5)").classList.add("paid");
            }
        }
        await refreshGraphAndLedger(topLine,id);
    }
    catch(err){
        console.log(err);
    }
    closeModal();
}

function utilCMD(e){
    let bodyRow = e.target.parentNode.parentNode;
    let billAmt = bodyRow.querySelector("p:nth-child(3)").textContent;
    let oldPayment = bodyRow.querySelector("p:nth-child(4)").textContent;
    let cmd = e.target.dataset.cmd;
    let [id,billNo,billDate] = bodyRow.dataset.itemList.split("_")
    let {name} = customerList.find((custObj)=>custObj.id===id);
    if(cmd==="open")
        ipcRenderer.send("open-ext",name,billDate,billNo);
    else
    if(cmd==="print")
        ipcRenderer.send("print",name,billDate,billNo);
    else{
        if(oldPayment>=Math.round(billAmt)) return;
        let cover = document.createElement("div");
        cover.classList.add("cover");
        let modal = document.getElementById("add-payment-template").content.cloneNode(true).querySelector("div");
        let form = modal.querySelector("form");
        form.dataset.billAmt = billAmt;
        form.dataset.id = id;
        form.dataset.name = name;
        form.dataset.billNo = billNo;
        document.body.appendChild(cover);
        document.body.appendChild(modal);
    }
}

async function billPageInit(){
    document.querySelector("#ledger-div").classList.add("hide");    
    let mainDiv = document.getElementById("main-section");
    if(!document.getElementById("bill-table")){
        let billsDiv = document.createElement("div");
        billsDiv.dataset.id = this.dataset.id;
        billsDiv.classList.add("table");
        billsDiv.id = "bill-table";
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
        bills.forEach(({billAmt,billDate,billItemTable,billNo,billStatus,payment,paymentStatus})=>{
            let row = document.createElement("div");
            row.innerHTML = `
                <p class="col eq-space">${billDate.toLocaleDateString("en-GB")}</p>
                <p class="col eq-space">${billNo}</p>
                <p class="col eq-space">${Math.round(billAmt)}</p>
                <p class="col eq-space">${payment}</p>
                <p class="col eq-space ${paymentStatus?"paid":"unpaid"}">${Math.round(billAmt - payment)}</p>
            `;
            row.classList.add("row");
            row.classList.add("body");
            row.dataset.itemList = billItemTable;
            row.dataset.paymentStatus = paymentStatus?paymentStatus:false;
            row.dataset.billStatus = billStatus;
            row.dataset.billAmt = billAmt;
            row.dataset.payment = payment;
            tbody.appendChild(row);
            return {billDate,billAmt}
        });
        mainDiv.appendChild(billsDiv);
        if(tbody.scrollHeight>tbody.clientHeight)
            scrollSymSet(tbody);
    }
    else{
        document.getElementById("ledger-div").classList.add("hide");
        document.getElementById("bill-table").classList.remove("hide");
    }
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
    let bodyRow = e.target.parentNode;
    if(!bodyRow.classList.contains("body") && !bodyRow.classList.contains("row")) return;
    let modal = createModal("bill-option-modal");
    let modalContent = document.getElementById("bill-option-template").content.cloneNode(true).querySelector("#bill-option-content");
    modal.appendChild(modalContent);
    modalContent.dataset.billObj = JSON.stringify({...bodyRow.dataset});
    let tbody = modalContent.querySelector("#tbody");
    const { itemList,paymentStatus,billStatus } = bodyRow.dataset;
    if(!itemList) return;
    if(paymentStatus==="false")
        modalContent.querySelector("[data-cmd='pay']").classList.remove("hide");
    if(billStatus==="open")
        modalContent.querySelector("[data-cmd='add-item']").classList.remove("hide");
    let [ custId,billNo,billDate ] = itemList.split("_");
    [...await ipcRenderer.invoke("get-bill-items-portal",custId,billNo,billDate)]
    .forEach((obj,i)=>{
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

function billUtils(e){
    const {cmd} = e.target.dataset;
    const {itemList,billAmt,payment} = JSON.parse(document.getElementById("bill-option-content")?.dataset.billObj) ?? {};
    if(cmd==="close" || (!itemList || !billAmt || !payment)) return;
    let name = selectedCustomer.name;
    let [id,billNo,billDate] = itemList.split("_");
    if(cmd==="open")
        ipcRenderer.send("open-ext",name,billDate,billNo);
    else if(cmd==="print")
        ipcRenderer.send("print",name,billDate,billNo);
    else if(cmd==="add-item"){
        document.getElementById("bill-option-content").classList.add("hide");
        let modal = document.getElementById("bill-option-modal");
        let div = document.getElementById("add-item-template").content.cloneNode(true).querySelector("div");
        modal.appendChild(div);
        modal.dataset.custId = id;
        modal.dataset.billNo = billNo;
        modal.dataset.billDate = billDate;
    }
    else{
        document.getElementById("bill-option-content").classList.add("hide");
        let modal = document.getElementById("bill-option-modal");
        let addPaymentForm = document.getElementById("add-payment-template").content.cloneNode(true).querySelector("form");
        modal.appendChild(addPaymentForm);
        addPaymentForm.dataset.billAmt = billAmt;
        addPaymentForm.dataset.id = id;
        addPaymentForm.dataset.name = name;
        addPaymentForm.dataset.billNo = billNo;
        addPaymentForm.dataset.billDate = billDate;
        modal.querySelector(`.highlight-1`).textContent = Math.round(billAmt - payment);
        let cashSegment = document.getElementById("cash-feild-template").content.cloneNode(true).querySelector("div");
        modal.querySelector("#first-section").appendChild(cashSegment);
    }
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

function addRow(e){
    let bodyRow = document.getElementById("body-row-template").content.cloneNode(true).querySelector(".body.row");
    document.getElementById("add-item").before(bodyRow);
    [...document.querySelectorAll("#bill-option-modal .page .body.row")]
    .forEach((row,i)=>{
        row.querySelector("p").textContent = i + 1;
    });
    let indexNo = bodyRow.querySelector("p").textContent;
    itemList = itemList.filter(obj=>obj.rowId!==uuid.v5(indexNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8"));
    itemList.push({rowId:uuid.v5(indexNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8")});
}

function deleteRow(e){
    if(e.target.nodeName==="BUTTON" && e.target.dataset.cmd==="DELETE"){
        let bodyRow = e.target.parentNode.parentNode;
        bodyRow.remove();
        [...document.querySelectorAll("#add-item-modal .body.row")]
        .forEach((row,i)=>{
            row.querySelector("p").textContent = i+1;
        });
    }
}

function proceedToPage2(){
    document.querySelector("#bill-option-modal .page1").classList.add("hide");
    if(!document.querySelector("#bill-option-modal .page2"))
        document.querySelector("#bill-option-modal").appendChild(document.getElementById("add-item-modal-page2-template").content.cloneNode(true));
    else
        document.querySelector("#bill-option-modal .page2").classList.remove("hide");
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

function addItem2Bill(){
    let modal = document.querySelector("#bill-option-modal");
    let {custId,billNo,billDate} = modal.dataset;
    [...document.querySelectorAll("#bill-option-modal .page")]
    .forEach((page,i)=>{
        if(i==0){
            [...page.querySelectorAll(".body.row")]
            .forEach(row=>{
                let rowNo = row.querySelector("p").textContent;
                let rowId = uuid.v5(rowNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
                let itemObj = itemList.find(obj=>obj.rowId===rowId);
                [...row.querySelectorAll("input")]
                .forEach(input=>{
                    itemObj[input.dataset.name] = input.value;
                });
                let selectedStock = stockList.find(obj=>obj.name===itemObj.name);
                if(selectedStock)
                    itemObj.type = selectedStock.type;
            });
        }
        else{
            [...page.querySelectorAll("input")]
            .forEach(input=>{
                if(input.checked){
                    let newItemObj = {
                        custId,
                        billNo,
                        billDate,
                        billStatus:input.id,
                        itemList
                    };
                    let total = Math.round(itemList.reduce((acc,{standardSellPrice,qty,cgst,sgst,igst})=>{
                        let amt = Number(standardSellPrice) * Number(qty);
                        let tax = Number(igst)>0 ? Number(igst) : Number(cgst) + Number(sgst);
                        acc += amt * (1+tax/100);
                        return acc;
                    },0));
                    let bodyRow = document.querySelector(`#bill-table [data-item-list='${custId}_${billNo}_${billDate}']`);
                    let no1 = Number(bodyRow.querySelector("p:nth-child(3)").textContent);
                    let no2 = Number(bodyRow.querySelector("p:nth-child(5)").textContent);
                    bodyRow.querySelector("p:nth-child(3)").textContent = no1 + total;
                    bodyRow.querySelector("p:nth-child(5)").textContent = no2 + total;
                    bodyRow.dataset.billStatus = input.id;
                    bodyRow.dataset.paymentStatus = "false";
                    bodyRow.dataset.billAmt = no1 + total;
                    bodyRow.querySelector("p:nth-child(5)").classList.remove("paid");
                    bodyRow.querySelector("p:nth-child(5)").classList.add("unpaid");
                    ipcRenderer.send("add-item-to-bill",newItemObj);
                }
            })
        }
    });
}

ipcRenderer.on("close-modal",async (e,topLine)=>{
    await refreshGraphAndLedger(topLine,selectedCustomer.id)
    _closeModal();
});

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