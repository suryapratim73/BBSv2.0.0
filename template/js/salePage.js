const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,roundOffTo2DecimalPlace,getAmtToWord} =  require("../js/common");


toggleDevTool(document);

let nameDatalist = document.createElement("datalist"),
    itemList = [],
    customerList = [],
    customerNameDatalist = document.createElement("datalist"),
    customer = {},
    currentStep = 1, 
    selectedItem = {}, 
    slNo=1, 
    orderItems = [], 
    billMeta = {},
    payment = [],
    transporterDatalist = document.createElement("datalist"),
    transporters = [],
    printers = [],
    printerDatalist = document.createElement("datalist"),
    selectedPrinter;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
printerDatalist.id = "printer-names";

async function init(){
    if(itemList.length===0){
        itemList = (await ipcRenderer.invoke("get-stocks")).map(({dataValues})=>dataValues);
        itemList.forEach(({name})=>{
            let option = document.createElement("option");
            option.value = name;
            nameDatalist.appendChild(option);
        });
        customerList = (await ipcRenderer.invoke("get-customers")).map(({dataValues})=>dataValues);
        customerList.forEach(({name})=>{
            let option = document.createElement("option");
            option.value = name;
            customerNameDatalist.appendChild(option);
        });
        buildPage();
    }
    document.body.appendChild(nameDatalist);
    document.body.appendChild(customerNameDatalist);
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

// Proceed or Back contrtoller.....
async function proceedOrFinishHandler(e){
    document.querySelector("main").removeEventListener("focus",mainFocusHandler,true);
    if(currentStep===1 && e.target.dataset.type==="proceed"){
        let inputFeilds = document.querySelectorAll(".row1>input");
        if(Array.from(inputFeilds).some(input=>input.value==="") && !Array.from(inputFeilds).some(input=>input.value==="cash")) return alert("Cannot proceed with empty fields!");
        inputFeilds.forEach(input=>{
            if(input.dataset.name!=="phones")
                customer[input.dataset.name] = input.value;
            else
                customer.phones = customer.phones?[...customer.phones,+input.value]:[+input.value];
        });
        billMeta.billStatus=([...document.getElementsByName("bill-status")].filter(input=>input.checked===true))[0].dataset.name
        customer.phones = Array.from(new Set(customer.phones));
        billMeta.delivery = { type: "hand" };
        billMeta.billNo = !billMeta.billNo?await ipcRenderer.invoke("get-sale-bill-number"):billMeta.billNo;
    }
    if(currentStep===2 && e.target.dataset.type==="proceed"){
        if(billMeta.delivery.type!=="hand")
            [...document.querySelectorAll("input")].forEach(input=>{
                if(input.dataset.name.startsWith("transp"))
                    billMeta.delivery[input.dataset.name] = input.value;
            });
        else
            billMeta.delivery = { type: "hand" };
        // console.log(billMeta)
    }
    if(currentStep===3 && ["proceed","back"].includes(e.target.dataset.type)){
        orderItems = [];
        [...document.querySelectorAll(".row.body")].forEach(bodyRow=>{
            let name = bodyRow.querySelector("div:nth-child(2)>input").value ?? "",
                qty = +bodyRow.querySelector("div:nth-child(4)>input").value ?? 0,
                unit = bodyRow.querySelector("div:nth-child(5)>input").value ?? "Kg",
                rate = Number(bodyRow.querySelector("div:nth-child(6)>input").value) ?? 0,
                amt = qty * rate,
                cgst = Number(bodyRow.querySelector("div:nth-child(8)>input").value)/100 ?? 0,
                sgst = Number(bodyRow.querySelector("div:nth-child(9)>input").value)/100 ?? 0,
                igst = Number(bodyRow.querySelector("div:nth-child(10)>input").value)/100 ?? 0,
                netAmt = roundOffTo2DecimalPlace(qty * rate * (1 + cgst + sgst + igst)) ?? 0
                item = itemList.find((itemObj)=>itemObj.name===name);
            if(name==="") return;
            orderItems.push({ 
                name,
                qty,
                unit,
                rate,
                amt,
                cgst:cgst*100,
                sgst:sgst*100,
                igst:igst*100,
                netAmt,
                hsn:item.hsn,
                type:item.type
            });
        })
    }
    if(currentStep===4 && e.target.dataset.type!="back")
        return ipcRenderer.send("save-exit-sale-bill",{billMeta,customer,orderItems})
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
    let printBtn = `<button data-type="print" onclick="showPrintDialog()">Print</button>`;
    let finishBtn = `<button data-type="save" onclick="proceedOrFinishHandler(event)">Save & Exit</button>`;
    let returnBtn = `<button data-type="return" id="return-btn" onclick="returnHandler(event)">Return Register</button>`;
    return `<footer>
                ${currentStep===4?returnBtn:""}
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

function calculateR_O(){
    let retAmt = 0;
    if(Object.keys(billMeta).includes("retAmt"))
        retAmt = billMeta.retAmt;
    let total = billMeta.netAmt - retAmt;
    if((Math.ceil(total) - total)<0.5){
        let r_o = Math.ceil(total) - total;
        return Math.round(r_o*100)/100;
    }
    else{
        let r_o = -1*(total - Math.floor(total));
        return Math.round(r_o*100)/100;
    }
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
    billMeta.r_o = roundOffTo2DecimalPlace(calculateR_O());
    return billSummDiv;
}

function getAvailQty(){
    let quantity = 0;
    [...document.querySelectorAll(".row.body")].forEach(bodyRow=>{
        let itemName = bodyRow.querySelector("div:nth-child(2)>input").value;
        if(itemName===selectedItem.name){
            quantity += Number(bodyRow.querySelector("div:nth-child(4)>input").value);
        }
    });
    return selectedItem.quantity - quantity
}

function getItemDiv({name="",buyPrice=0,standardSellPrice=0,tax=9}){
    let itemDiv = document.createElement("div");
    itemDiv.id = "item-summary";
    itemDiv.innerHTML = `
                    <div class="row0">
                        <div><p>Item Name:</p><p class="bold">${name}</p></div>
                        <div><p>Last Buy Price:</p><p class="bold">${buyPrice}</p></div>
                        <div><p>Available Qty:</p><p data-name="availQty" class="bold">${getAvailQty()}</p></div>
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
    if(!selectedItem || Object.keys(selectedItem).length===0) return;
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

function selectionHandler(e,hideDisplaySection){
    if(e.target.dataset.name==="stock-name"){
        selectedItem = itemList.find(({name})=>name===e.target.value);
        if(!selectedItem) return;
        let {hsn,standardSellPrice,unit} = selectedItem;
        let bodyRow = e.target.parentNode.parentNode;
        let allP = bodyRow.querySelectorAll("p");
        let allInput = bodyRow.querySelectorAll("input");
        allP[1].textContent = hsn;
        allInput[2].value = unit;
        allInput[3].value = Math.round(standardSellPrice);
        hideDisplaySection===false && displaySection();
        bodyRow.querySelector("div:nth-child(4) input").focus();
    }
    if(e.target.dataset.name==="name"){
        let selectedCustomer = customerList.find(({name})=>name===e.target.value);
        if(!selectedCustomer) return;
        let {address,phones,gst} = selectedCustomer;
        document.querySelector("[data-name='address']").value = address;
        document.querySelector("[data-name='phones']").value = JSON.parse(phones)[0];
        document.querySelector("[data-name='gst']").value = gst;
        document.querySelector("[data-name='close']").checked = true;
    }
    if(e.target.dataset.name==="transporterName"){
        let selectedTransporter = transporters.find(({name})=>name===e.target.value);
        if(!selectedTransporter) return;
        let {address,phone,charge} = selectedTransporter;
        document.querySelector("[data-name='transporterAddress']").value = address;
        document.querySelector("[data-name='transporterContact']").value = phone;
        document.querySelector("[data-name='transporterCharge']").value = charge;
    }
}

function calculateAmounts(e,updateRetForm){
    let bodyRow = e.target.parentNode.parentNode;
    let quantity = Number(bodyRow.querySelector("div:nth-child(4)>input").value);
    let rate = Number(bodyRow.querySelector("div:nth-child(6)>input").value);
    bodyRow.querySelector("div:nth-child(7)>p").textContent = quantity * rate;
    let cgst = Number(bodyRow.querySelector("div:nth-child(8)>input").value)/100 ?? 0;
    let sgst = Number(bodyRow.querySelector("div:nth-child(9)>input").value)/100 ?? 0;
    let igst = Number(bodyRow.querySelector("div:nth-child(10)>input").value)/100 ?? 0;
    cgst *= quantity * rate;
    sgst *= quantity * rate;
    igst *= quantity * rate;
    bodyRow.querySelector("div:nth-child(11)>p").textContent = roundOffTo2DecimalPlace(quantity * rate + cgst + sgst + igst);
    if(!updateRetForm)
        displaySection();
    if(updateRetForm)
        updateReturnForm(roundOffTo2DecimalPlace(quantity * rate + cgst + sgst + igst))
}

function addRow(e,returnClassName=""){
    let clonedBodyRow = document.createElement("div");
    clonedBodyRow.className = `row body`;
    clonedBodyRow.innerHTML = getBodyRow(returnClassName);
    e.target.parentNode.before(clonedBodyRow);
    clonedBodyRow.querySelectorAll("div p").forEach(p=>p.textContent="");
    clonedBodyRow.querySelectorAll("div input").forEach(input=>input.value="");
    clonedBodyRow.querySelector("div:nth-child(1)>p").textContent = ++slNo;
    clonedBodyRow.querySelector("div:nth-child(2)>input").focus();
    e.target.scrollIntoView();
}

function getBodyRow(returnClassName=""){
    return `
            <div class="col sm"><p>${slNo}</p></div>
            <div class="col lg"><input type="text" data-name="stock-name" list="stock-names" onchange="selectionHandler(event,${returnClassName===''?false:true})" /></div>
            <div class="col md"><p></p></div>
            <div class="col md"><input data-name="quantity" type="text" oninput="calculateAmounts(event,${returnClassName===''?false:true})" data-type="Number" data-subtype="price" onkeypress="validateInput2(event)" /></div>
            <div class="col md"><input type="text" /></div>                            
            <div class="col md"><input type="text" oninput="calculateAmounts(event,${returnClassName===''?false:true})" data-type="Number" data-subtype="price" onkeypress="validateInput2(event)" /></div>                            
            <div class="col md"><p></p></div>
            <div class="col sm"><input type="text" oninput="calculateAmounts(event,${returnClassName===''?false:true})" data-type="Number" data-subtype="price" onkeypress="validateInput2(event)" /></div>                            
            <div class="col sm"><input type="text" oninput="calculateAmounts(event,${returnClassName===''?false:true})" data-type="Number" data-subtype="price" onkeypress="validateInput2(event)" /></div>                            
            <div class="col sm"><input type="text" oninput="calculateAmounts(event,${returnClassName===''?false:true})" data-type="Number" data-subtype="price" onkeypress="validateInput2(event)" /></div>                            
            <div class="col md"><p></p></div>
            <div class="row-control-div ${returnClassName}">
                <button tabindex="-1" data-name="delete-row">x</button>
            </div>
    `;
}

async function showDeliveryDetail(e){
    let transporterDiv = document.getElementById("transporter-detail-div");
    billMeta.delivery = {type : e.target.value};
    if(e.target.value==="hand")
        return transporterDiv.classList.add("hide");
    transporterDiv.classList.remove("hide");
    if(transporters.length===0){
        transporters = (await ipcRenderer.invoke("get-transporter")).map(({dataValues})=>dataValues);
        transporters.forEach(({name})=>{
            let option = document.createElement("option");
            option.value = name;
            transporterDatalist.appendChild(option);
        });
        transporterDatalist.id = "transporter-names";
        document.body.appendChild(transporterDatalist);
    }
}

function reassignSummaryDivFeilds(netPayment=0){
    if(netPayment===0 && Object.keys(billMeta).includes("payment"))
        billMeta.payment.forEach((payObj)=>{
            netPayment += payObj.payment;
            document.querySelector('[data-name="payment"]').value = payObj.payment;
            if(payObj.type==="cash")
                document.querySelector("#cash-payment input").value = payObj.payment;
            else if(payObj.type==="check"){
                paymentModeDiv.querySelector("[data-name='bankName']").value = payObj.bnk;
                paymentModeDiv.querySelector("[data-name='bankBranch']").value = payObj.branch;
                paymentModeDiv.querySelector("[data-name='bankACNo']").value = payObj.a_c_No;
                paymentModeDiv.querySelector("[data-name='chkNo']").value = payObj.chkNo;
            }
            else if(payObj.type==="online"){
                paymentModeDiv.querySelector("[data-name='bankName']").value = payObj.bnk;
                paymentModeDiv.querySelector("[data-name='bankTrnRef']").value = payObj.ref;
            }
        });
    let retAmt = 0;
    if(Object.keys(billMeta).includes("retAmt"))
        retAmt = billMeta.retAmt;
    let deliveryCharge = billMeta.delivery.type==="hand"?0:Number(billMeta.delivery.transporterCharge);
    document.querySelector("[data-name='billAmt']").textContent = billMeta.netAmt;
    document.querySelector("[data-name='paymentAmt']").textContent = netPayment;
    if(Math.sign(deliveryCharge + billMeta.netAmt + billMeta.r_o - netPayment - retAmt)<=0){
        document.querySelector("[data-name='dueAmt']").textContent = 0;
        billMeta.netDue = 0;
        document.querySelector("[data-name='return']").textContent = roundOffTo2DecimalPlace(retAmt + netPayment - (billMeta.netAmt + billMeta.r_o + deliveryCharge));
    }
    else{
        document.querySelector("[data-name='dueAmt']").textContent = roundOffTo2DecimalPlace(deliveryCharge + billMeta.netAmt + billMeta.r_o - netPayment - retAmt);
        billMeta.netDue = roundOffTo2DecimalPlace(deliveryCharge + billMeta.netAmt + billMeta.r_o - netPayment - retAmt);
        document.querySelector("[data-name='return']").textContent = 0;
    }
}

function updateBillValue(e){
    if(e.target.dataset.name!=="payment") return;
    //Update summary and billMeta
    let paymentModeDiv = e.target.parentNode.parentNode;
    let payObj = {
        payment:Number(e.target.value)
    };
    if(paymentModeDiv.id==="cash-payment")
        payObj.type = "cash";
    else if(paymentModeDiv.id==="check-payment"){
        payObj.type = "check";
        payObj.bnk = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.branch = paymentModeDiv.querySelector("[data-name='bankBranch']").value;
        payObj.a_c_No = paymentModeDiv.querySelector("[data-name='bankACNo']").value;
        payObj.chkNo = paymentModeDiv.querySelector("[data-name='chkNo']").value;
    }
    else{
        payObj.type = "online";
        payObj.bnk = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.ref = paymentModeDiv.querySelector("[data-name='bankTrnRef']").value;
    }
    let netPayment = 0, updateFlag = false;
    if(payment.length>0)
        for(let i=0;i<payment.length;i++)
            if(payment[i].type===payObj.type){
                payment[i] = payObj;
                updateFlag = true;
                break;
            }
    if(!updateFlag)
        payment.push(payObj);
    payment.forEach(_payObj=>{
        netPayment += _payObj.payment;
    });
    reassignSummaryDivFeilds(netPayment);
    billMeta.payment = payment;
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

function mainForm(){
    slNo = 1;
    if(currentStep===1)
        return `
                <div>
                    <p class="row0">Name: </p>
                    <div class="row1">
                        <input type="text" autofocus data-name="name" onchange="selectionHandler(event)" list="customer-names"/>
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
                </div>
                <div>
                    <p class="row0">Bill Status</p>
                    <div class="row1">
                        <div class="radio-btn-div">
                            <div>
                                <label for="bill-status-open">Open: </label>
                                <input type="radio" data-name="open"  name="bill-status" id="bill-status-open" value="open" />
                            </div>
                            <div>
                                <label for="bill-status-close">Close: </label>
                                <input type="radio" data-name="close" name="bill-status" id="bill-status-close" value="close" />
                            </div>
                        </div>
                    </div>
                </div>
                `;
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
                <div id="delivery-detail-div">
                    <div>
                        <label for="delivery-mode">Select delivery method: </label>
                        <select id="delivery-mode" onchange="showDeliveryDetail(event)">
                            <option value="hand" selected>By hand</option>
                            <option value="transport">By Transporter</option>
                        </select>
                    </div>
                    <div class="hide" id="transporter-detail-div" onkeypress="validateInput2(event)">
                        <div>
                            <p class="row0">Transporter Name</p>
                            <div class="row1">
                                <input type="text" onchange="selectionHandler(event)" list="transporter-names" data-name="transporterName" />
                            </div>
                        </div>
                        <div>
                            <p class="row0">Transporter Address</p>
                            <div class="row1">
                                <input type="text" data-name="transporterAddress" />
                            </div>
                        </div>
                        <div>
                            <p class="row0">Transporter Contact</p>
                            <div class="row1">
                                <input type="text" data-type="Number" data-name="transporterContact" />
                            </div>
                        </div>
                        <div>
                            <p class="row0">Transport Cost</p>
                            <div class="row1">
                                <input type="text" data-subtype="price" data-type="Number" data-name="transporterCharge" />
                            </div>
                        </div>
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
            <div id="payment-div" oninput="updateBillValue(event)" onkeypress="validateInput2(event)">
                <div id="payment-mode">
                    <label for="payment-mode">Select payment mode:</label>
                    <select id="payment-mode" onchange="showPaymentMode(event)">
                        <option value="due" selected>Due</option>
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="online">NEFT</option>
                    </select>
                </div>
                <div id="cash-payment" class="hide payment-detail">
                    <div>
                        <p>Enter amount</p>
                        <input data-type="Number" data-subtype="price" data-name="payment" />
                    </div>
                </div>
                <div id="check-payment" class="hide payment-detail">
                    <div>
                        <p>Bank Name</p>
                        <input type="text" data-name="bankName"/>
                    </div>
                    <div>
                        <p>Bank Branch</p>
                        <input type="text" data-name="bankBranch"/>
                    </div>
                    <div>
                        <p>Account No.</p>
                        <input type="text" data-subtype="price" data-name="bankACNo" data-type="Number" onkeypress="validateInput(event)"/>
                    </div>
                    <div>
                        <p>Check No.</p>
                        <input type="text" data-subtype="price" data-name="chkNo" data-type="Number" onkeypress="validateInput(event)"/>
                    </div>
                    <div>
                        <p>Amount paid</p>
                        <input type="text" data-name="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                    </div>
                </div>
                <div id="online-payment" class="hide payment-detail">
                    <div>
                        <p>Bank Name</p>
                        <input type="text" data-name="bankName" />
                    </div>
                    <div>
                        <p>Transaction Ref.</p>
                        <input type="text" data-name="bankTrnRef" />
                    </div>
                    <div>
                        <p>Amount paid</p>
                        <input type="text" data-name="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                    </div>
                </div>
            </div>
            <div id="summary-div"></div>
        `;//Payment and delivery detail
}

function summaryBlock(){
    return `
        <section>
            <p>Nothing to show now</p>
        </section>
    `
}

function populateTableFeilds(bodyRowDivs,{name,hsn,qty,unit,rate,amt,cgst,sgst,igst,netAmt},index){
    selectedItem = itemList.find(item=>item.name===name);
    if(!amt)
        amt = qty * rate;
    if(!netAmt)
        netAmt = igst>0?(1+igst/100)*amt:(1+(sgst+cgst)/100)*amt;
    bodyRowDivs[0].querySelector("p").textContent = index + 1;
    bodyRowDivs[1].querySelector("input").value = name;
    bodyRowDivs[2].querySelector("p").textContent = hsn ?? selectedItem.hsn;
    bodyRowDivs[3].querySelector("input").value = qty;
    bodyRowDivs[4].querySelector("input").value = unit;
    bodyRowDivs[5].querySelector("input").value = rate;
    bodyRowDivs[6].querySelector("p").textContent = amt;
    bodyRowDivs[7].querySelector("input").value = cgst;
    bodyRowDivs[8].querySelector("input").value = sgst;
    bodyRowDivs[9].querySelector("input").value = igst;
    bodyRowDivs[10].querySelector("p").textContent = netAmt;
}

async function reInitCurrentPage(){
    if(currentStep===3 && orderItems.length>0){
        orderItems.forEach((item,index)=>{
            let bodyRowDivs = document.querySelectorAll(".row.body:nth-last-child(2)>div");
            populateTableFeilds(bodyRowDivs,item,index)
            slNo = index + 1;
            if(slNo<orderItems.length)
                document.querySelector("#add-item>button").click();
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
        });
        [...document.getElementsByName("bill-status")].forEach(input=>{
            input.checked = input.dataset.name===billMeta.billStatus && true;
        }) 
    }
    if(currentStep===2){
        let inputFeilds = document.querySelectorAll(".row1>input");
        if(billMeta.delivery){
            [...document.querySelectorAll("#delivery-mode>option")].forEach(option=>{
                option.selected = option.value===billMeta.delivery.type && true
                if(option.selected && option.value==="transport")
                    document.getElementById("transporter-detail-div").classList.remove("hide");
                else
                    document.getElementById("transporter-detail-div").classList.add("hide");
            })
        }
        inputFeilds.forEach(input=>{
            if(input.dataset.name==="billDate"){
                input.value = new Date().toISOString().split("T")[0];
                billMeta.billDate = new Date().toISOString().split("T")[0];
            }
            else
            if(input.dataset.name.startsWith("trans"))
                input.value = billMeta.delivery[input.dataset.name]?billMeta.delivery[input.dataset.name]:"";
            else
                input.value = billMeta.billNo;
        })
    }
    if(currentStep===4){
        document.getElementById("summary-div").innerHTML = `
            <div>
                <p>Net Bill Amount</p>
                <p data-name="billAmt" class="highlight">${billMeta.netAmt + billMeta.r_o}</p>
            </div>
            <div>
                <p>Net Payment</p>
                <p data-name="paymentAmt" class="highlight">0</p>
            </div>
            <div>
                <p>Net Due</p>
                <p data-name="dueAmt" class="highlight">${billMeta.netAmt + billMeta.r_o}</p>
            </div>
            <div>
                <p>Net Return</p>
                <p data-name="return" class="highlight">0</p>
            </div>
        `;
        if(billMeta.delivery.type!=="hand"){
            let billAmtDiv = document.querySelector("#summary-div>div");
            billAmtDiv.after(((new DOMParser()).parseFromString(`
                <div>
                    <p>Delivery/Service Charge</p>
                    <p data-name="deliveryCharge" class="highlight">${billMeta.delivery.transporterCharge}</p>
                </div>
            `,"text/html")).body.querySelector("div"));
            document.querySelector("#summary-div>div:nth-last-child(2)>p:last-child").textContent = billMeta.netAmt + Number(billMeta.delivery.transporterCharge) + billMeta.r_o;
        }
        if(Object.keys(billMeta).includes("payment"))
            reassignSummaryDivFeilds();
        const {stdout,os} = await ipcRenderer.invoke("get-printers");
        if(["linux","mac"].includes(os)){
            printers = stdout.split("\n")
                                    .map(text=>{
                                        if(text!=="")
                                            return text.split(".")[0]
                                    })
                                    .map(text=>{
                                        if(!text) return;
                                        let obj = {};
                                        let matches = [...text.match(/(?=\b )\W[\w-]+(?<! )/g)]
                                        obj.printerName = matches[0].trim();
                                        obj.status = matches[2];
                                        return obj;
                                    })
                                    .filter(obj=>obj!==undefined)
        }
        printers.forEach(({printerName,status},i)=>{
            let option = document.createElement("option");
            if(i===0)
                selectedPrinter = printerName;
            option.value = printerName;
            option.textContent = status;
            printerDatalist.appendChild(option);
        });
        document.body.appendChild(printerDatalist);
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
                    <main onclick="mainClickHandler(event)" onfocus="mainFocusHandler(event)" class="${currentStep===4 && 'step-4'}">
                        ${mainForm()}
                    </main>
                    ${currentStep===3?summaryBlock():""}
                    ${footer()}
    `;
    document.querySelector("main").addEventListener("focus",mainFocusHandler,true);
    reInitCurrentPage()
}

function mainClickHandler(e){
    if(e.target.dataset.name==="delete-row" && e.target.parentNode.parentNode.className==='row body'){
        let bodyRow = e.target.parentNode.parentNode;
        let _slNo = 1;
        bodyRow.remove();
        document.querySelectorAll(".row.body").forEach(bodyRow=>{
            bodyRow.querySelector("div:first-child>p").textContent = _slNo++;
        })
        slNo--;
        displaySection();
    }
}

function mainFocusHandler(e){
    if(currentStep===3 && e.target.nodeName==="INPUT"){
        let bodyRow = e.target.parentNode.parentNode;
        selectedItem = itemList.find(({name})=>name===bodyRow.querySelector("div:nth-child(2)>input").value);
        displaySection();
    }
}

ipcRenderer.on("get-current-step",cancelAction);

function closeModal(){
    document.querySelector(".cover").remove();
    document.querySelector(".modal").remove();
}

function resetInput(event){
    event.target.value = ""
}

function showPrintDialog(){
    if(payment.length===0)
        payment.push({type:"due"})
    let cover = document.createElement("div");
    cover.classList.add("cover");
    let modal = document.createElement("div");
    modal.classList.add("modal");
    document.body.appendChild(cover);
    document.body.appendChild(modal);
    modal.innerHTML = `
            <h1>Print options</h1>
            <form onsubmit="printcmd(event)">
                <div>
                    <label for="printer-list">Select Printer</label>
                    <input id="printer-list" onclick="resetInput(event)" list="printer-names" value="${selectedPrinter}" />
                </div>
                <div>
                    <label for="no-of-copies">Number of copies</label>
                    <input id="no-of-copies" type="number" value="1" />
                </div>
                <div>
                    <input type="checkbox" checked id="buyer-copy" value="Original Buyer's Copy"/>
                    <label for="buyer-copy"> Original Buyer's Copy</label>
                </div>
                <div>
                    <input type="checkbox" id="transport-copy" value="Transporter's Copy"/>
                    <label for="transport-copy"> Transporter's Copy</label>
                </div>
                <div>
                    <input type="checkbox" id="book-copy" value="Book Copy"/>
                    <label for="book-copy"> Book Copy</label>
                </div>
                <div>
                    <button type="submit" data-name="print-btn">Continue to Print</button>
                    <button type="button" data-name="print-cancel-btn" onclick="closeModal()">Cancel</button>
                </div>
            </form>
    `;

}

function printcmd(e){
    let printObj = {};
    e.preventDefault();
    let captions = [];
    [...e.srcElement].forEach(elem=>{
        if(elem.nodeName==="INPUT"){
            if(elem.type==="checkbox" && !elem.checked) return;
            if(elem.checked)
                captions.push(elem.value);
            else
            if(elem.id==="printer-list")
                printObj.printer = elem.value;
            else
                printObj.copies = elem.value;
        }
    });
    if(captions.length===0)
        return alert("Check at least 1 box.");
    printObj.captions = captions;
    billMeta.printObj = printObj;
    ipcRenderer.send("salepage-print-doc",{billMeta,customer,orderItems})
}

function returnHandler(e){
    let body = document.body;
    let modal = document.createElement("div");
    modal.classList.add("modal");
    modal.id = "return-modal";
    let cover = document.createElement("div");
    cover.classList.add("cover");
    modal.innerHTML = `
                <div id="head-section">
                    <div id="current-bill-metadata">
                        <div>
                            <p class="col-1">Current Bill No:</p>
                            <p class="col-2">${billMeta.billNo}</p>
                        </div>
                        <div>
                            <p class="col-1">Current Bill Amount:</p>
                            <p class="col-2">${billMeta.netAmt}</p>
                        </div>
                        <div>
                            <p class="col-1">Amount in word:</p>
                            <p class="col-2">${getAmtToWord(billMeta.netAmt + billMeta.r_o)}</p>
                        </div>
                    </div>
                    <div id="return-bill-metadata">
                        <div>
                            <p class="col-1">Return Policy:</p>
                            <p class="col-2">all</p>
                        </div>
                        <div>
                            <label class="col-1">Return Bill Date:</label>
                            <input class="col-2" tabindex="2" type="date" data-name="returnBillDate" />
                        </div>
                        <div>
                            <label class="col-1">Return Bill No:</label>
                            <input class="col-2" type="text" tabindex="2" data-name="returnBillNo" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                        </div>
                    </div>
                </div>
                <div id="body-section" class="table">
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
                            ${getBodyRow("return-add-btn")}
                        </div>
                        <div class="row row-control-div" id="add-item">
                            <button onclick="addRow(event,'return-add-btn')">+</button>
                        </div>
                    </div>
                </div>
                <div id="footer-section">
                    <div id="updated-bill-amt">
                        <p class="col-1">Updated Bill amount:</p>
                        <p class="col-2">${billMeta.netAmt}</p>
                    </div>                
                    <div>
                        <button tabindex="2" onclick="recomputeBill()">Update</button>
                        <button tabindex="2" onclick="closeModal()">Cancel</button>
                    </div>                
                </div>
    `;
    body.appendChild(cover);
    body.appendChild(modal);
    document.querySelector('[data-name="returnBillNo"]').focus();
    [...document.querySelectorAll(".body.row input")].forEach(input=>input.setAttribute("tabindex","2"));
    if(Object.keys(billMeta).includes("returnOrder"))
        reInitReturnModal()
}   

function updateReturnForm(retAmt){
    let updatedBillAmt = document.querySelector("#updated-bill-amt>p:last-child");
    billMeta.retAmt = retAmt;
    updatedBillAmt.textContent = roundOffTo2DecimalPlace(billMeta.netAmt - retAmt);
}

function recomputeBill(){
    billMeta.returnOrder = [];
    [...document.querySelectorAll(".row.body")].forEach(bodyRow=>{
        let name = bodyRow.querySelector("div:nth-child(2)>input").value;
        if(!name) return;
        let qty = Number(bodyRow.querySelector("div:nth-child(4)>input").value);
        let rate = Number(bodyRow.querySelector("div:nth-child(6)>input").value);
        let cgst = Number(bodyRow.querySelector("div:nth-child(8)>input").value);
        let sgst = Number(bodyRow.querySelector("div:nth-child(9)>input").value);
        let igst = Number(bodyRow.querySelector("div:nth-child(10)>input").value);
        const { hsn,unit } = itemList.find(item=>item.name===name);
        billMeta.returnOrder.push({name,qty,rate,cgst,sgst,igst,hsn,unit});       
    });
    billMeta.r_o = calculateR_O();
    closeModal();
    reassignSummaryDivFeilds();
}

function reInitReturnModal(){
    billMeta.returnOrder.forEach((item,index)=>{
        if(!item) return;
        let bodyRowDivs = document.querySelectorAll(".row.body:nth-last-child(2)>div");
        populateTableFeilds(bodyRowDivs,item,index)
        if(index+1<orderItems.length)
            document.querySelector("#add-item>button").click();  
    })
}

document.addEventListener("keydown",e=>{
    if(e.ctrlKey && e.key==="Enter" && currentStep<4)
        document.querySelector("[data-type='proceed']").click();
    else
    if(e.ctrlKey && e.key==="Enter" && currentStep===4)
        document.querySelector('[data-type="save"]').click();
    if(e.ctrlKey && e.key==="ArrowLeft")
        document.querySelector('[data-type="back"]').click();
    if(e.shiftKey && e.key==="ArrowDown")
        document.querySelector("#add-item>button").click();
    if(e.shiftKey && e.key==="Delete")
        [...document.querySelectorAll('.row.body')].pop().querySelector('[data-name="delete-row"]').click();
    if(e.ctrlKey && e.key==="p" && currentStep===4)
        document.querySelector('[data-type="print"]').click();
    if(currentStep===4 && e.ctrlKey && e.key==="r")
        document.querySelector('[data-type="return"]').click();
    if(currentStep===4 && e.key==="Enter" && document.querySelector('[data-name="print-btn"]'))
        document.querySelector('[data-name="print-btn"]').click();
    if(currentStep===4 && e.key==="End" && document.querySelector('[data-name="print-cancel-btn"]'))
        document.querySelector('[data-name="print-cancel-btn"]').click();
});