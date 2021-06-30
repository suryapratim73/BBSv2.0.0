const {ipcRenderer} = require("electron");
const {toggleDevTool,validateInput,init} = require("../js/common.js");


const header = document.getElementById("header");
const body = document.getElementById("body");
const command = document.getElementById("command");
let billerPhones = [], billDetail={}, suppliers = [], selectedSupplier,itemList = [];


toggleDevTool(document);

function pushPhoneNumber(){
    let phoneNoField = document.getElementById("billerPhone");
    billerPhones.push(phoneNoField.value);
    phoneNoField.value = "";
    phoneNoField.focus();    
}

function assignFieldValuesStep1(name,address,phones,gst,comment,setName){
    if(setName)
        document.getElementById("billerName").value = name;
    document.getElementById("billerAddress").value = address;
    if(!setName)
        document.getElementById("billerPhone").value = JSON.parse(phones)[0];
    else
        document.getElementById("billerPhone").value = phones[0];
    document.getElementById("billerGST").value = gst;
    document.getElementById("billerComment").value = comment;
}

function assignFieldValuesStep2(){
    let dateField = document.getElementById("billerDate");
    dateField.value = (new Date()).toISOString().split("T")[0];
    if(!billDetail.billNo)
        document.getElementById("billerNo").focus()
    else
        document.getElementById("billerNo").value = billDetail.billNo;
    if(billDetail.paymentStatus!==undefined){
        let paymentStatusField = document.getElementById("payment-status");
        let partialPaymentDiv = document.getElementById("partial-payment-div");
        if(billDetail.paymentStatus===true){
            paymentStatusField.value = "Yes";
            partialPaymentDiv.style.visibility = "visible";
            partialPaymentDiv.querySelector("input").value = billDetail.payment;
        }
        else
            paymentStatusField.value = "No";
    }
}

function assignFieldValuesStep3(){
    if(itemList.length>0)
        itemList.forEach(data=>{
            fillTable(data);
        })
}

async function supplierSelection(e){
    let name = e.target.value;
    selectedSupplier = suppliers.find(suppObj=>suppObj.name===name)
    if(selectedSupplier.name===name){
        let {dataValues:{address,gst,phones,comment}} =await ipcRenderer.invoke("get-more-info-supplier",selectedSupplier.id);
        assignFieldValuesStep1(undefined,address,phones,gst,comment,false);
        selectedSupplier.address = address;
        selectedSupplier.phones = JSON.parse(phones);
        selectedSupplier.gst = gst;
        selectedSupplier.comment = comment;
        document.getElementById("proceed-btn").focus()
    }
}

function step1P(){
    return "<span>Step 1:</span> Add supplier detail";
}

function step2P(){
    return "<span>Step 2:</span>Add date and bill number for your purchase."
}

function step1BodyHTML(){
    return `
    <div>
        <div class="row0"><span>Name</span></div>
        <div class="row1">
            <input type="text" list="existing-suppliers" onchange="supplierSelection(event)" autofocus id="billerName" />
            <datalist id="existing-suppliers"></datalist>
        </div>
    </div>
    <div>
        <div class="row0"><span>Address</span></div>
        <div class="row1"><input type="text" id="billerAddress" /></div>
    </div>
    <div>
        <div class="row0"><span>Phone</span></div>
        <div class="row1">
            <input type="text" id="billerPhone" />
            <button tabindex="-1" onclick="pushPhoneNumber()">+</button>
        </div>
    </div>
    <div>
        <div class="row0"><span>GST Number</span></div>
        <div class="row1"><input type="text" id="billerGST" /></div>
    </div>
    <div>
        <div class="row0"><span>Comment</span></div>
        <div class="row1"><input type="text" id="billerComment" /></div>
    </div>
`;
}

function step1CommandHTML(){
    return `
            <div>
                <button onclick="closeWindow()" id="cancel-btn">Cancel</button>
                <button data-step="1" onclick="loadAddItem(event)" id="proceed-btn">Proceed</button>
            </div>
        `
}

function paymentInput(e){
    if(!["yes","no","y","ye","n"].includes(e.target.value.toLowerCase()))
        e.target.value = "";
    if(["yes","no"].includes(e.target.value.toLowerCase()))
        e.target.value = e.target.value.toLowerCase()==="yes"?"Yes":"No";
    if(e.target.value.toLowerCase()==="no" && document.getElementById("partial-payment-div")){
        document.getElementById("partial-payment-div").style.visibility = "hidden";
        document.getElementById("partial-payment").value = 0;
    }
    if(e.target.value.toLowerCase()==="yes" && document.getElementById("partial-payment-div")){
        document.getElementById("partial-payment-div").style.visibility = "visible";
    }
}

function step2BodyHTML(){
    return `
            <div>
                <div class="row0"><span>Bill Date</span></div>
                <div class="row1"><input type="date" id="billerDate" /></div>
            </div>
            <div>
                <div class="row0"><span>Bill Number</span></div>
                <div class="row1"><input type="text" id="billerNo" /></div>
            </div>
            <div>
                <div class="row0"><span>Payment Status</span></div>
                <div class="row1"><input type="text" oninput="paymentInput(event)" onkeypress="validateInput(event)" list="yes-no-choice" id="payment-status" /></div>
                <datalist id="yes-no-choice">
                    <option value="Yes">Yes</option>
                    <option value="No" selected>No</option>
                </datalist>
            </div>
            <div id="partial-payment-div" style="visibility:hidden">
                <div class="row0">
                    <p>Add partial payment if any</p>
                </div>
                <div class="row1">
                    <input id="partial-payment" type="text" onkeypress="validateInput(event)" />
                </div>
            </div>
        `;
}

function addBackBTN(e,pageNo){
    let button = document.createElement("button");
    button.textContent = "Back"
    button.id = "back-btn";
    button.dataset.step = pageNo;
    button.addEventListener("click",loadAddItem)
    e.target.before(button);
}

function reInit(){
    let datalist = document.getElementById("existing-suppliers");
    suppliers.forEach(({id,name})=>{
        let option = document.createElement("option");
        option.textContent = id;
        option.value = name;
        datalist.appendChild(option);
    })
    if(selectedSupplier){
        const {name,address,phones,gst,comment} = selectedSupplier;
        assignFieldValuesStep1(name,address,phones,gst,comment,true)
    }
}

async function loadAddItem(e){
    let p = header.querySelector("p");
    if(e.target.dataset.step==="1" && e.target.id==="proceed-btn"){
        let billerName = document.getElementById("billerName").value;
        let billerAddress = document.getElementById("billerAddress").value;
        billerPhones.push(document.getElementById("billerPhone").value);
        let billerComment = document.getElementById("billerComment").value;
        let billerGST = document.getElementById("billerGST").value;
        if(!billerName && !billerAddress){
            alert("Please fill the required fields");
            document.getElementById("billerName").focus();
            return;
        }
        let billerInfo = {billerName,billerAddress,billerPhones,billerGST,billerComment};
        supplier = await ipcRenderer.invoke("save-supplier",billerInfo);
        if(supplier===null){
            alert("Something went wrong while saving the data.");
            setTimeout(()=>{ipcRenderer.send("close")},5000);
            return;
        }
        p.innerHTML = step2P()
        e.target.dataset.step = "2";
        body.innerHTML = step2BodyHTML();
        assignFieldValuesStep2();
        addBackBTN(e,1)
    }
    else if(e.target.dataset.step==="1" && e.target.id==="back-btn"){
        p.innerHTML = step1P();
        body.innerHTML = step1BodyHTML();
        if(suppliers.length>0)
            reInit();
        command.innerHTML = step1CommandHTML();
    }
    else if(e.target.dataset.step==="2" && e.target.id==="proceed-btn"){
        billDetail.supplierId = supplier.id;
        billDetail.supplierName = supplier.name;
        billDetail.billDate = document.getElementById("billerDate").value;
        billDetail.billNo = document.getElementById("billerNo").value;
        billDetail.payment = document.getElementById("partial-payment")?.value ?? 0;
        p.innerHTML = "<span>Step 3: </span>Add purchased items."
        e.target.dataset.step = "3";
        body.innerHTML = `
                            <table>
                                <thead>
                                    <tr>
                                        <th data-field="sl">Sl No</th>
                                        <th data-field="Particular">Particular</th>
                                        <th data-field="Type">Type</th>
                                        <th data-field="HSN No.">HSN No.</th>
                                        <th data-field="Quantity">Quantity</th>
                                        <th data-field="Unit">Unit</th>
                                        <th data-field="Rate">Rate</th>
                                        <th data-field="noTax">Taxable Amount</th>
                                        <th data-field="CGST">CGST</th>
                                        <th data-field="SGST">SGST</th>
                                        <th data-field="IGST">IGST</th>
                                        <th data-field="withTax">Total</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            <div>
                                <button onclick="ipcRenderer.send('create-add-item-modal')">+</button>
                            </div>
                        `;
        assignFieldValuesStep3();
        e.target.previousSibling.dataset.step = "2";
    }
    else if(e.target.dataset.step==="2" && e.target.id==="back-btn"){
        p.innerHTML = step2P()
        body.innerHTML = step2BodyHTML();
        assignFieldValuesStep2();
        e.target.dataset.step = "1";
        e.target.nextSibling.dataset.step = "2";
    }
    else if(e.target.dataset.step==="3" && e.target.id==="proceed-btn"){
        let sum = 0;
        document.querySelectorAll("tbody tr td:last-child").forEach(amtCol=>{
            sum+=+amtCol.textContent
        })
        sum = Math.round(sum);
        billDetail.billAmt = sum;
        p.textContent = "That's it! You're now ready to add this bill."
        body.innerHTML = `
                            <h1>Your net bill Amount is ${sum}.</h1>
                            <p>Save/Defer this bill</p>
                        `;
        e.target.previousSibling.dataset.step = "3";
        e.target.dataset.step = "4";
        document.getElementById("proceed-btn").textContent = "Save";
        document.getElementById("back-btn").setAttribute("disabled","disabled");
    }
    else if(e.target.dataset.step==="4" && e.target.id==="proceed-btn"){
        billDetail.paymentStatus = billDetail.payment===billDetail.billAmt?true:false;
        ipcRenderer.send("save-defer-bill",billDetail)
    }
}

function fillTable(data){
    let theadTr = body.querySelector("thead>tr");
    let columnLength = theadTr.children.length;
    let tbody = body.querySelector("tbody")
    let tr = document.createElement("tr");
    let keys = Object.keys(data)
    for(let i=0;i<columnLength;i++){
        let td = document.createElement("td");
        if(i===0)
            td.textContent = tbody.children.length + 1;
        else if(keys.includes(theadTr.children[i].dataset.field)){
            if(!(["CGST","SGST","IGST"].includes(theadTr.children[i].dataset.field)))
                td.textContent = data[theadTr.children[i].dataset.field]
            else
                td.textContent = (+(tr.children[7].textContent) * +(data[theadTr.children[i].dataset.field]))/100;
        }
        else if(theadTr.children[i].dataset.field==="noTax"){
            td.textContent = +(tr.children[4].textContent) * +(tr.children[6].textContent)}
        else 
            td.textContent = +(tr.children[7].textContent) *1.18;
        tr.appendChild(td);
    }
    tbody.appendChild(tr);
}

ipcRenderer.on("add-item",(e,data)=>{
    itemList.push(data);
    fillTable(data);
    billDetail.itemList = billDetail?.itemList?[...billDetail.itemList,data]:[data];
})

function closeWindow(){
    ipcRenderer.send("close")
}

body.innerHTML = step1BodyHTML();
command.innerHTML = step1CommandHTML();

(async ()=>{
    let datalist = document.getElementById("existing-suppliers");
    suppliers = await init(datalist);
})()