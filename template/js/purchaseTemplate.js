const {ipcRenderer} = require("electron");
require("../js/common.js")(document)
const header = document.getElementById("header");
const body = document.getElementById("body");
const command = document.getElementById("command");

let billerPhones = [], supplier={},billDetail={};

function pushPhoneNumber(){
    let phoneNoField = document.getElementById("billerPhone");
    billerPhones.push(phoneNoField.value);
    phoneNoField.value = "";
    phoneNoField.focus();    
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
        <div class="row1"><input type="text" autofocus id="billerName" /></div>
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

function step2BodyHTML(){
    return `
            <div>
                <div class="row0"><span>Bill Date</span></div>
                <div class="row1"><input type="date" autofocus id="billerDate" /></div>
            </div>
            <div>
                <div class="row0"><span>Bill Number</span></div>
                <div class="row1"><input type="text" id="billerNo" /></div>
            </div>
            <div>
                <div class="row0"><span>Payment Status</span></div>
                <div class="row1"><input type="text" list="yes-no-choice" id="payment-status" /></div>
                <datalist id="yes-no-choice">
                    <option value="Yes"></option>
                    <option value="No"></option>
                </datalist>
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
        addBackBTN(e,1)
    }
    else if(e.target.dataset.step==="1" && e.target.id==="back-btn"){
        p.innerHTML = step1P();
        body.innerHTML = step1BodyHTML();
        command.innerHTML = step1CommandHTML();
    }
    else if(e.target.dataset.step==="2" && e.target.id==="proceed-btn"){
        billDetail.supplierId = supplier.id;
        billDetail.supplierName = supplier.name;
        billDetail.billDate = document.getElementById("billerDate").value;
        billDetail.paymentStatus = document.getElementById("payment-status").value==="Yes"?true:false;
        billDetail.billNo = document.getElementById("billerNo").value;
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
        e.target.previousSibling.dataset.step = "2";
    }
    else if(e.target.dataset.step==="2" && e.target.id==="back-btn"){
        p.innerHTML = step2P()
        body.innerHTML = step2BodyHTML;
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
        console.log(billDetail)
        ipcRenderer.send("save-defer-bill",billDetail)
    }
}

ipcRenderer.on("add-item",(e,data)=>{
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
    billDetail.itemList = billDetail?.itemList?[...billDetail.itemList,data]:[data];
})

function closeWindow(){
    ipcRenderer.send("close")
}

body.innerHTML = step1BodyHTML()
command.innerHTML = step1CommandHTML();