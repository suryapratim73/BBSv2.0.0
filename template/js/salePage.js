const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,roundOffTo2DecimalPlace} =  require("../js/common");


toggleDevTool(document);

let nameDatalist = document.createElement("datalist");
let itemList = [],customer={},currentStep=1, selectedItem = {}, slNo=1, orderItems = [], billMeta = {},_itemList = [];
let oldQtyValues = [];

nameDatalist.id="stock-names";

async function init(){
    if(itemList.length===0){
        itemList = (await ipcRenderer.invoke("get-stocks")).map(({dataValues})=>dataValues);
        oldQtyValues = itemList.map(({quantity})=>quantity);
        itemList.forEach(({name})=>{
            let option = document.createElement("option");
            option.value = name;
            nameDatalist.appendChild(option);
        });
        buildPage();
    }
    document.body.appendChild(nameDatalist);
}
init();

function addPhone(e){
    let customerPhoneInput = document.getElementById("customer-phone");
    customer.phones = customer.phones?[...customer.phones,Number(customerPhoneInput.value)]:[Number(customerPhoneInput.value)];
    customerPhoneInput.value = "";
    customerPhoneInput.focus();
    customerPhoneInput.setAttribute("placeholder","Add new phone number");
    customer.phones = Array.from(new Set(customer.phones));
}

async function proceedOrFinishHandler(e){
    if(currentStep===1 && e.target.dataset.type==="proceed"){
        let inputFeilds = document.querySelectorAll(".row1>input");
        if(Array.from(inputFeilds).some(input=>input.value==="") && !Array.from(inputFeilds).some(input=>input.value==="cash")) return alert("Cannot proceed with empty fields!");
        inputFeilds.forEach(input=>{
            if(input.dataset.name!=="phones")
                customer[input.dataset.name] = input.value;
            else
                customer.phones = customer.phones?[...customer.phones,+input.value]:[+input.value];
        });
        customer.phones = Array.from(new Set(customer.phones));
        billMeta.billNo = await ipcRenderer.invoke("get-sale-bill-number");
    }
    if(currentStep===3 && ["proceed","back"].includes(e.target.dataset.type) && Object.keys(selectedItem).length>0){
        orderItems.push(selectedItem);
        selectedItem = {};
    }
    // if(currentStep===3 && e.target.dataset.type==="proceed")
    //     console.log({customer,billMeta,orderItems});
    if(e.target.dataset.type==="proceed")
        currentStep++;
    else if(e.target.dataset.type==="back")
        currentStep--;
    buildPage();
    init();
}

function cancelAction(){
    ipcRenderer.send('cancel-sale-bill',currentStep)
}// More need to be done...

function footer(){
    let proceedBtn = `<button data-type="proceed" onclick="proceedOrFinishHandler(event)">Proceed</button>`;
    let backBtn = `<button data-type="back" onclick="proceedOrFinishHandler(event)">Back</button>`;
    let printBtn = `<button data-type="print">Print</button>`;
    let finishBtn = `<button data-type="save" onclick="proceedOrFinishHandler(event)">Save & Exit</button>`;
    return `<footer>
                <div>
                    <button onclick="cancelAction()">Cancel</button>
                    ${currentStep>1?backBtn:""}
                    ${currentStep===4?printBtn:""}
                    ${currentStep<4?proceedBtn:""}
                    ${currentStep===4?finishBtn:""}
                </div>
            </footer>`
}

function stepDetail(){
    if(currentStep===1) return `Add customer detail`;//design done
    if(currentStep===2) return `Add bill detail`;
    if(currentStep===3) return `Add item detail`;
    if(currentStep===4) return `Add payment detail`;
}

function getTotal(nodeList){
    return Array.from(nodeList).reduce((acc,p)=>{
        acc += p.textContent?Number(p.textContent):0;
        return acc;
    },0);
}

function getBillSummary(){
    let billSummDiv = document.createElement("div");
    billSummDiv.id = "bill-summary";
    let netAmountPs = document.querySelectorAll(".row.body>div:nth-child(11)>p");
    let amountPs = document.querySelectorAll(".row.body>div:nth-child(7)>p");
    let totalNetAmt = getTotal(netAmountPs);
    let totalAmt = getTotal(amountPs);
    billSummDiv.innerHTML = `
                <div><p>Net Tax:</p><p class="bold">${roundOffTo2DecimalPlace(totalNetAmt - totalAmt)}</p></div>
                <div><p>Net Amount:</p><p class="bold">${roundOffTo2DecimalPlace(totalNetAmt)}</p></div>
    `;
    billMeta.netAmt = roundOffTo2DecimalPlace(totalNetAmt);
    billMeta.netTax = roundOffTo2DecimalPlace(totalNetAmt - totalAmt);
    return billSummDiv;
}

function getItemDiv({name,buyPrice,quantity:availQty,standardSellPrice,tax}){
    let itemDiv = document.createElement("div");
    itemDiv.id = "item-summary";
    itemDiv.innerHTML = `
                    <div class="row0">
                        <div><p>Item Name:</p><p class="bold">${name}</p></div>
                        <div><p>Last Buy Price:</p><p class="bold">${buyPrice}</p></div>
                        <div><p>Available Qty:</p><p data-name="availQty" class="bold">${availQty}</p></div>
                        <div><p>Input Tax:</p><p class="bold">${tax}</p></div>
                    </div>
                    <div class="row1">
                        <div><p>Standard Sell Price:</p><p class="bold">${standardSellPrice}</p></div>
                        <div><p>Last Sell Price:</p><p class="bold">${standardSellPrice}</p></div>
                        <div><p>Special Sell Price:</p><p class="bold">${standardSellPrice}</p></div>
                    </div>
    `;
    return itemDiv;
}

function displaySection(){
    let section = document.querySelector("section");
    [...section.children].forEach(node=>node.remove());
    section.appendChild(getItemDiv(selectedItem));
    section.appendChild(getBillSummary());
    section.style.display = "flex";
    if(selectedItem.quantity<0)
        document.querySelector("[data-name='availQty']").classList.add("red");
    else
        document.querySelector("[data-name='availQty']").classList.remove("red");
}

function itemSelectionHandler(e){
    selectedItem = itemList.find(({name})=>name===e.target.value);
    if(!selectedItem) return;
    let {hsn,standardSellPrice,unit} = selectedItem;
    let bodyRow = e.target.parentNode.parentNode;
    let allP = bodyRow.querySelectorAll("p");
    let allInput = bodyRow.querySelectorAll("input");
    allP[1].textContent = hsn;
    allInput[2].value = unit;
    allInput[3].value = Math.round(standardSellPrice);
    displaySection();
    bodyRow.querySelector("div:nth-child(4) input").focus();
}

function calculateAmounts(e){
    let bodyRow = e.target.parentNode.parentNode;
    let quantity = Number(bodyRow.querySelector("div:nth-child(4)>input").value);
    let rate = Number(bodyRow.querySelector("div:nth-child(6)>input").value);
    bodyRow.querySelector("div:nth-child(7)>p").textContent = quantity * rate;
    let cgst = Number(bodyRow.querySelector("div:nth-child(8)>input").value)/100 || 0;
    let sgst = Number(bodyRow.querySelector("div:nth-child(9)>input").value)/100 || 0;
    let igst = Number(bodyRow.querySelector("div:nth-child(10)>input").value)/100 || 0;
    selectedItem = {
        ...selectedItem,
        qty:quantity,
        rate,
        cgst:cgst*100,
        sgst:sgst*100,
        igst:igst*100,
        amt:quantity * rate,
        netAmt:roundOffTo2DecimalPlace(quantity * rate * (1 + cgst + sgst + igst))
    }
    cgst *= quantity * rate;
    sgst *= quantity * rate;
    igst *= quantity * rate;
    bodyRow.querySelector("div:nth-child(11)>p").textContent = roundOffTo2DecimalPlace(quantity * rate + cgst + sgst + igst);
    if(e.target.dataset.name==="quantity");{
        let index = itemList.findIndex(({name})=>name===selectedItem.name);
        itemList[index].quantity = oldQtyValues[index];
        itemList[index].quantity -= quantity;
        selectedItem.quantity = itemList[index].quantity;
    }
    displaySection();
}

function addRow(e){
    let clonedBodyRow = document.createElement("div");
    clonedBodyRow.className = `row body`;
    clonedBodyRow.innerHTML = getBodyRow();
    e.target.parentNode.before(clonedBodyRow);
    clonedBodyRow.querySelectorAll("div p").forEach(p=>p.textContent="");
    clonedBodyRow.querySelectorAll("div input").forEach(input=>input.value="");
    clonedBodyRow.querySelector("div:nth-child(1)>p").textContent = ++slNo;
    clonedBodyRow.querySelector("div:nth-child(2)>input").focus();
    e.target.scrollIntoView();
    if(Object.keys(selectedItem).length>0){
        orderItems.push(selectedItem);
        selectedItem = {};
    }
    itemList.forEach(({quantity},index)=>oldQtyValues[index]=quantity);
}

function getBodyRow(){
    return `
            <div class="col sm"><p>${slNo}</p></div>
            <div class="col lg"><input type="text" list="stock-names" onchange="itemSelectionHandler(event)" /></div>
            <div class="col md"><p></p></div>
            <div class="col md"><input data-name="quantity" type="text" oninput="calculateAmounts(event)" data-type="Number" onkeypress="validateInput(event)" /></div>
            <div class="col md"><input type="text" /></div>                            
            <div class="col md"><input type="text" oninput="calculateAmounts(event)" data-type="Number" onkeypress="validateInput(event)" /></div>                            
            <div class="col md"><p></p></div>
            <div class="col sm"><input type="text" oninput="calculateAmounts(event)" data-type="Number" onkeypress="validateInput(event)" /></div>                            
            <div class="col sm"><input type="text" oninput="calculateAmounts(event)" data-type="Number" onkeypress="validateInput(event)" /></div>                            
            <div class="col sm"><input type="text" oninput="calculateAmounts(event)" data-type="Number" onkeypress="validateInput(event)" /></div>                            
            <div class="col md"><p></p></div>
            <div class="row-control-div">
                <button data-name="delete-row">x</button>
            </div>
    `;
}

function mainForm(){
    slNo = 1;
    if(currentStep===1)
        return `<div>
                    <p class="row0">Name: </p>
                    <div class="row1">
                        <input type="text" data-name="name" list="customer-names"/>
                    </div>
                </div>
                <div>
                    <p class="row0">Address: </p>
                    <div class="row1">
                        <input type="text" data-name="address" />
                    </div>
                </div>
                <div>
                    <p class="row0">Phone:</p>
                    <div class="row1">
                        <input type="text" data-name="phones" data-type="Number" id="customer-phone" onkeypress="validateInput(event)" />
                        <button id="add-new-phone" onclick="addPhone(event)">+</button>
                    </div>
                </div>
                <div>
                    <p class="row0">GST Number</p>
                    <div class="row1">
                        <input type="text" data-name="gst" id="customer-gst" />
                    </div>
                </div>`;
    if(currentStep===2)
        return `
                <div>
                    <p class="row0">Date: </p>
                    <div class="row1">
                        <input type="date" data-name="billDate" />
                    </div>
                </div>
                <div>
                    <p class="row0">Bill Number: </p>
                    <div class="row1">
                        <input type="text" data-name="billNo" />
                    </div>
                </div>
        `;
    if(currentStep===3)
        return `
                <div id="table">
                    <div class="row head">
                        <div class="col sm"><p>Sl No.</p></div>
                        <div class="col lg"><p>Particular</p></div>
                        <div class="col md"><p>HSN No</p></div>
                        <div class="col md"><p>Quantity</p></div>
                        <div class="col md"><p>Unit</p></div>
                        <div class="col md"><p>Rate</p></div>
                        <div class="col md"><p>Amount</p></div>
                        <div class="col sm"><p>CGST</p></div>
                        <div class="col sm"><p>SGST</p></div>
                        <div class="col sm"><p>IGST</p></div>
                        <div class="col md"><p>Total</p></div>
                    </div>
                    <div id="tbody">
                        <div class="row body">
                            ${getBodyRow()}
                        </div>
                        <div class="row row-control-div" id="add-item">
                            <button onclick="addRow(event)">+</button>
                        </div>
                    </div>
                </div>
        `;
    if(currentStep===4)
        return `

        `;//Payment and delivery detail
}

function summaryBlock(){
    return `
        <section>
            <p>Nothing to show now</p>
        </section>
    `
}

function reInitCurrentPage(){
    if(currentStep===3 && orderItems.length>0){
        orderItems.forEach(({name,hsn,qty,unit,rate,amt,cgst,sgst,igst,netAmt},index)=>{
            let bodyRowDivs = document.querySelectorAll(".row.body:nth-last-child(2)>div");
            bodyRowDivs[0].querySelector("p").textContent = index + 1;
            bodyRowDivs[1].querySelector("input").value = name;
            bodyRowDivs[2].querySelector("p").textContent = hsn;
            bodyRowDivs[3].querySelector("input").value = qty;
            bodyRowDivs[4].querySelector("input").value = unit;
            bodyRowDivs[5].querySelector("input").value = rate;
            bodyRowDivs[6].querySelector("p").textContent = amt;
            bodyRowDivs[7].querySelector("input").value = cgst;
            bodyRowDivs[8].querySelector("input").value = sgst;
            bodyRowDivs[9].querySelector("input").value = igst;
            bodyRowDivs[10].querySelector("p").textContent = netAmt;
            slNo = index + 1;
            if(slNo<orderItems.length)
                document.querySelector("#add-item>button").click();
            selectedItem = itemList.find(item=>item.name===name);
        });
        displaySection();
    }
    if(currentStep===1 && Object.keys(customer).length>0){
        let inputFeilds = document.querySelectorAll(".row1>input");
        inputFeilds.forEach(input=>{
            if(input.dataset.name!=="phones")
                input.value = customer[input.dataset.name]
            else
                input.value = customer.phones[customer.phones.length-1]!==0?customer.phones[customer.phones.length-1]:"";
        })
    }
    if(currentStep===2){
        let inputFeilds = document.querySelectorAll(".row1>input");
        inputFeilds.forEach(input=>{
            if(input.dataset.name==="billDate"){
                input.value = new Date().toISOString().split("T")[0];
                billMeta.billDate = new Date().toISOString().split("T")[0];
            }
            else
                input.value = billMeta.billNo;
        })
    }
}

function buildPage(){
    document.body.innerHTML = `
                    <header>
                        <h1>Sale registor</h1>
                        <p>
                            <span>Step ${currentStep}:</span>
                            ${stepDetail()}
                        </p>
                    </header>
                    <main onclick="mainClickHandler(event)">
                        ${mainForm()}
                    </main>
                    ${currentStep===3?summaryBlock():""}
                    ${footer()}
    `;
    reInitCurrentPage()
}

function mainClickHandler(e){
    if(e.target.dataset.name==="delete-row" && e.target.parentNode.parentNode.className==='row body'){
        if(Object.keys(selectedItem).length>0){
            orderItems.push(selectedItem);
            selectedItem = {};
        }
        let bodyRow = e.target.parentNode.parentNode;
        let indexForDeletion = +bodyRow.querySelector("div:first-child>p").textContent - 1;
        let itemName = bodyRow.querySelector("div:nth-child(2)>input").value;
        let itemQty = +bodyRow.querySelector("div:nth-child(4)>input").value;
        orderItems = orderItems.filter((_,index)=>index!==indexForDeletion);
        let _slNo = 1;
        bodyRow.remove();
        document.querySelectorAll(".row.body").forEach(bodyRow=>{
            bodyRow.querySelector("div:first-child>p").textContent = _slNo++;
        })
        slNo--;
        let itemIndex = itemList.findIndex(({name})=>name===itemName);
        itemList[itemIndex].quantity += itemQty;
        oldQtyValues[itemIndex] += itemQty;
    }
}// Need more testing