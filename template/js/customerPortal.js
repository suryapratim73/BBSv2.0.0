const { ipcRenderer } = require("electron");
const { toggleDevTool,validateInput, printModal, drawSpinner, renderPieChart, scrollSymSet } = require("../js/common");


toggleDevTool(document);

let customerList = [];
let page2BTNS = document.querySelector("#form div:nth-child(1)");
let currentPage = 0,selectedDiv,selectedCustomer;
let canvas = document.querySelector("#canvas-container>canvas");
let ctx = canvas.getContext("2d");
let total=0;
let colorCode = [];
let spinner = drawSpinner(document);

function rgbToHex(r, g, b){
    if (r > 255 || g > 255 || b > 255)
        throw "Invalid color component";
    return ((r << 16) | (g << 8) | b).toString(16);
}

document.querySelector("#canvas-container").addEventListener("click",function(e){
    if(currentPage>0) return;
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

ipcRenderer.on("customer-list",(e,{customerObj})=>{
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

async function loadLedgerTable(_name){
    currentPage = 1;
    selectedCustomer = customerList.find(({name})=>name===_name);
    let { name,address,phones,gst,balance,id } = selectedCustomer;
    page2BTNS.classList.remove("hide");
    page2BTNS.dataset.id = id;
    phones = JSON.parse(phones);
    this.classList.add("hide");
    let ledgerDiv = document.createElement("div");
    [...document.querySelectorAll(".table")].forEach(table=>table.remove());
    [...document.querySelectorAll(".card")].forEach(card=>card.remove());
    ledgerDiv.innerHTML = `
        <h1>Ledger</h1>
        <div class="head row">
            <p data-name="date" class="col eq-space">Date</p>
            <p data-name="billNo" class="col eq-space">Bill No</p>
            <p data-name="billAmt" class="col eq-space">Bill Amt</p>
            <p data-name="payment" class="col eq-space">Payment</p>
            <p data-name="balance" class="col eq-space">Balance</p>
        </div>
        <div id="tbody"></div>
    `;
    ledgerDiv.className = "table";
    ledgerDiv.id = "ledger-div";
    let sideDiv = document.getElementById("chart-div");
    let customerDiv = document.createElement("div");
    customerDiv.className = "card";
    customerDiv.innerHTML = `
        <div>
            <p class="col-0">Name:</p>
            <p class="col-1">${name}</p>
        </div>
        <div>
            <p class="col-0">Address:</p>
            <p class="col-1">${address}</p>
        </div>
        <div>
            <p class="col-0">GST No:</p>
            <p class="col-1">${gst}</p>
        </div>
        <div>
            <p class="col-0">Phones:</p>
            <div class="col-1">${phones.map((phone,index)=>{
                if(index<phones.length-1)
                    return `<p>${phone},</p>`
                else
                    return `<p>${phone}</p>`
            })}</div>
        </div>
        <div>
            <p class="col-0">Net Due:</p>
            <p class="col-1">${balance}</p>
        </div>
    `;
    let ledgerEntries = await ipcRenderer.invoke("get-full-customer-ledger",id);
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
    let div = document.createElement("div");
    div.id = "back-btn-div";
    div.innerHTML = `
        <button><</button>
        <p>Back</p>
    `;
    div.addEventListener("click",resetPortal)
    sideDiv.appendChild(div);
    [...document.querySelectorAll("#chart-div>div#canvas-container,#chart-div>p")].forEach(elem=>{
        elem.classList.add("hide");
    });
}

document.getElementById("customer-list").addEventListener("click",function(e){
    if(!e.target.classList.contains("customer-div")) return;
    loadLedgerTable.call(this,e.target.children[0].textContent);
    document.querySelector("#form>div:last-child").classList.add("hide");
    document.querySelector("#chart-div > p:nth-child(3)").classList.add("hide");
});

function resetPortal(e){
    if(currentPage===1){
        document.querySelector("#back-btn-div").removeEventListener("click",arguments.callee);
        [".card","#back-btn-div"].forEach(selector=>document.querySelector(selector).remove());
        [...document.querySelectorAll(".table")].forEach(div=>div.remove());  
        document.getElementById("customer-list").classList.remove("hide");
        page2BTNS.classList.add("hide");
        document.querySelector('[data-cmd="bills"]').classList.remove("hide");
        document.querySelector('[data-cmd="filter"]')?.classList.add("hide");
        document.querySelector("#form>div:last-child").classList.remove("hide");
        currentPage = 0;
        document.querySelector("#chart-div > p:nth-child(3)").classList.remove("hide");
        [...document.querySelectorAll("#chart-div>div#canvas-container,#chart-div>p")].forEach(elem=>{
            elem.classList.remove("hide");
        });
    }
    else{
        currentPage = 1;
        document.getElementById("bill-table").classList.add("hide");
        document.getElementById("ledger-div").classList.remove("hide");
        let btnDiv = document.querySelector("#form>div:first-child");        
        btnDiv.children[0].classList.add("hide");
        btnDiv.children[1].classList.remove("hide");
    }
}

function closeModal(){
    document.querySelector(".modal").remove();
    document.querySelector(".cover").remove();
}

function addPayment(e){
    e.preventDefault();
    let payment = e.target.payment.value;
    const { name,billno:billNo,id,billamt:billAmt,retamt:retAmt } = e.target.dataset;
    closeModal();
    ipcRenderer.send("add-payment",name,billNo,payment,id,billAmt,retAmt);
}

function utilCMD(e){
    let bodyRow = e.target.parentNode.parentNode;
    let retAmt = bodyRow.dataset.retAmt;
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
        let modal = document.createElement("div");
        modal.classList.add("modal");
        modal.id="add-payment";
        modal.innerHTML = `
            <form onsubmit="addPayment(event)" data-retamt="${retAmt}" data-billamt="${billAmt}" data-id="${id}" data-name="${name}" data-billno="${billNo}">
                <div>
                    <label for="payment">Enter the payment amount:</label>
                    <input type="text" name="payment" id="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)" />
                </div>
                <div>
                    <button type="submit">Add Payment</button>
                    <button type="button" onclick="closeModal()">Cancel</button>
                </div>
            </form>
        `;
        document.body.appendChild(cover);
        document.body.appendChild(modal);
    }
}

ipcRenderer.on("payment-successful",(e,_name,balance,payment)=>{
    let selectedCustomer = customerList.find(({name})=>name===_name);
    selectedCustomer.balance = balance;
    if(currentPage===1)
        loadLedgerTable.call(document.getElementById("customer-list"),_name);
    else{
        selectedDiv.querySelector("p:nth-child(4)").textContent = payment;
        let {billAmt} = selectedDiv.dataset;
        let dueAmt = Math.round(Number(billAmt) - Number(payment));
        let lastP = selectedDiv.querySelector("p:last-child");
        lastP.textContent = dueAmt;
        selectedDiv.dataset.payment = Number(payment);
        let optionDiv = selectedDiv.parentNode.querySelector(".bill-option-div");
        optionDiv.dataset.payment = payment;
        if(dueAmt===0){
            lastP.classList.remove("unpaid");
            lastP.classList.add("paid");
            selectedDiv.dataset.paymentStatus = "true";
            optionDiv.querySelector("button:last-child").remove();
        }
        document.querySelector(".card>div:nth-last-child(2)>p:last-child").textContent = balance;
    }
})

page2BTNS.addEventListener("click",async function(e){
    if(e.target.dataset.cmd==="bills" && !document.getElementById("bill-table")){
        let bills = await ipcRenderer.invoke("show-customer-bills",this.dataset.id);
        document.querySelector(".table").classList.add("hide");
        currentPage = 2;
        let mainDiv = document.getElementById("main-section");
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
        });
        mainDiv.appendChild(billsDiv);
        if(tbody.scrollHeight>tbody.clientHeight)
            scrollSymSet(tbody);
        if(!document.getElementById("filter-btn")){
            let filterBTN = document.createElement("button");
            filterBTN.textContent = "Filter";
            filterBTN.type = "button";
            filterBTN.dataset.cmd = "filter";
            filterBTN.id = "filter-btn";
            let showBillsBTN = this.children[0];
            showBillsBTN.classList.add("hide");
            showBillsBTN.before(filterBTN);
        }
        else{
            this.children[0].classList.remove("hide");
            this.children[1].classList.add("hide");
        }
    }
    else
    if(e.target.dataset.cmd==="bills" && document.getElementById("bill-table")){
        document.getElementById("bill-table").classList.remove("hide");
        document.getElementById("ledger-div").classList.add("hide");
        let btnDiv = document.querySelector("#form>div:first-child");        
        btnDiv.children[0].classList.remove("hide");
        btnDiv.children[1].classList.add("hide");
        currentPage = 2;
    }
    else
    if(e.target.dataset.cmd==="print-ledger")
        printModal("customer-ledger-dialog");
    else
    if(e.target.dataset.cmd==="filter" && !document.getElementById("filter-option")){
        let div = document.createElement("div");
        div.id = "filter-option";
        div.innerHTML = `
            <div class="selected">
                <button type="button" data-cmd="all" class="filter-btn">All</button>
            </div>
            <div>
                <button type="button" data-cmd="unpaid" class="filter-btn">Unpaid</button>
            </div>
            <div>
                <button type="button" data-cmd="paid" class="filter-btn">Paid</button>
            </div>
        `;
        this.appendChild(div);
    }
    else
    if(e.target.dataset.cmd==="filter" && document.getElementById("filter-option"))
        document.getElementById("filter-option").classList.toggle("hide");
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
        // e.target.parentNode.parentNode.classList.add("hide");
    }
});

document.body.addEventListener("click",(e)=>{
    document.getElementById("filter-option")?.classList.add("hide");
    if(e.target.nodeName!=="CANVAS"){
        ctx.restore();
        drawPieChart();
    }
    renderPieChart();
    [...document.querySelectorAll(".customer-div")].forEach(div=>div.style.borderColor = "black");
},true);

function showBillOptions(e){
    if(e.target.parentNode.className!="row body") return;
    [...this.querySelectorAll(".bill-option-div")].forEach(div=>div.remove())
    let bodyRow = e.target.parentNode;
    selectedDiv = bodyRow;
    const { itemList,billAmt,retAmt,payment } = bodyRow.dataset;
    let optionDiv = document.createElement("div");
    optionDiv.className = "bill-option-div";
    optionDiv.dataset.itemList = itemList;
    optionDiv.dataset.billAmt = billAmt;
    optionDiv.dataset.retAmt = retAmt;
    optionDiv.dataset.payment = payment;
    optionDiv.innerHTML = `
        <button data-cmd="open">Open</button>
        <button data-cmd="print">Print</button>
        ${bodyRow.dataset.paymentStatus==="false" && '<button data-cmd="pay">Add Payment</button>'}
    `;
    optionDiv.addEventListener("click",billUtils)
    bodyRow.after(optionDiv);
}

function billUtils(e){
    const {cmd} = e.target.dataset;
    const {itemList,billAmt,retAmt,payment} = e.target.parentNode.dataset;
    let name = document.querySelector(".card>div:first-child>p:last-child").textContent;
    let [id,billNo,billDate] = itemList.split("_");
    if(cmd==="open")
        ipcRenderer.send("open-ext",name,billDate,billNo);
    else if(cmd==="print")
        ipcRenderer.send("print",name,billDate,billNo);
    else{
        let cover = document.createElement("div");
        cover.classList.add("cover");
        let modal = document.createElement("div");
        modal.classList.add("modal");
        modal.id = "add-payment-modal";
        modal.innerHTML = `
            <form onsubmit="addPayment(event)" data-retamt="${retAmt}" data-billamt="${billAmt}" data-id="${id}" data-name="${name}" data-billno="${billNo}">
                <h1>Add Payment</h1>
                <div>
                    <p>The bill amount is:</p>
                    <p class="highlight-1">${Math.round(billAmt - retAmt - payment)}</p>
                </div>
                <div>
                    <label for="payment">Enter payment amount: </label>
                    <input type="text" name="payment" id="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                </div>
                <div>
                    <button type="submit">Add Payment</button>
                    <button type="button" onclick="closeModal()">Cancel</button>
                </div>
            </form>
        `;
        document.body.appendChild(cover);
        document.body.appendChild(modal);
    }
}

function handlePrint(e){
    e.preventDefault();
    let period = e.target["ledger-period"].value;
    ipcRenderer.send("print-ledger",selectedCustomer.id,period,2);
    document.querySelector('[data-name="cancel"]').click();
}