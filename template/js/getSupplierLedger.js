const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,init} = require("../js/common.js");
toggleDevTool(document);


let form = document.querySelector("form");
let datalist = document.querySelector("datalist");
let suppliers = [], selectedSupplier = {};

(async ()=>{
    suppliers = await init(datalist)
})();

function loadLedgerSummary({last5Entries,total,totalPayment},{name,id}){
    let page2root = document.createElement("div");
    page2root.id = "contact-div";
    page2root.innerHTML = `
                    <section>
                        <div>
                            <p>Name: <span>${name}</span></p>
                        </div>
                        <div>
                            <p>Net Due: <span>${total-totalPayment}</span></p>
                        </div>
                        <div>
                            <p>Net Purchase: <span>${total}</span></p>
                        </div>
                    </section>
                    <section>
                        <table>
                            <caption>Last 5 ledger entries</caption>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Bill No</th>
                                    <th>Bill Amount</th>
                                    <th>Payments</th>
                                    <th>Net Due</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </section>
                    <div>
                        <button onclick="printModal()">Print ledger</button>
                        <button>Load full ledger</button>
                        <button>Back</button>
                    </div>
    `;
    let tbody = page2root.querySelector("tbody");
    page2root.querySelector("button:nth-child(2)").addEventListener("click",()=>ipcRenderer.send("Load full ledger",{name,id}));
    page2root.querySelector("button:nth-child(3)").addEventListener("click",()=>location.reload());
    last5Entries.forEach(entry=>{
        let tr = document.createElement("tr");
        let paymentStatus = entry.paymentStatus;
        Object.keys(entry).forEach(col=>{
            if(!["paymentStatus","itemList","entryNo"].includes(col)){
                let td = document.createElement("td");
                td.textContent = col!=="date"?entry[col]:entry[col].toDateString();
                if(col==="billAmt"){
                    if(entry.payments!==entry.billAmt && paymentStatus)
                        td.classList.add("partial-payment");
                    else if(entry.payments===entry.billAmt && paymentStatus){
                        td.classList.add("paid");
                    } else
                        td.classList.add("unpaid");
                }
                tr.appendChild(td);
            }
        })
        tbody.appendChild(tr);
    })
    form.replaceWith(page2root);
}

form.addEventListener("submit",async e=>{
    e.preventDefault();
    selectedSupplier = suppliers.find(suppObj=>suppObj.name===e.target[0].value);
    if(selectedSupplier){
        let ledgerObj= await ipcRenderer.invoke("get-supplier-ledger",selectedSupplier);
        loadLedgerSummary(ledgerObj,selectedSupplier);
    } else 
        alert("Please select a supplier.");
});

function printModal(){
    let modal = document.createElement("div");    
    modal.classList.add("modal");
    let cover = document.createElement("div");    
    cover.classList.add("cover");
    modal.innerHTML = `
            <form onsubmit="handlePrint(event)">
                <div>
                    <label for="ledger-period">Please select the period of ledger.</label>
                    <select id="ledger-period" name="ledger-period">
                        <option value="0">1 month</option>
                        <option value="2">3 month</option>
                        <option value="5">6 month</option>
                        <option value="11">1 year</option>
                    </select>
                </div>
                <div>
                    <button type="submit">Print</button>
                    <button type="button" data-name="cancel">Cancel</button>
                </div>
            </form>
    `
    document.body.appendChild(cover);
    document.body.appendChild(modal);
    document.querySelector('[data-name="cancel"]').addEventListener("click",function closeModal(){
        document.body.removeChild(cover);        
        document.body.removeChild(modal);
        this.removeEventListener("click",closeModal);        
    })
}

function handlePrint(e){
    e.preventDefault();
    let period = Number(e.target["ledger-period"].value);
    ipcRenderer.send("get-supplier-ledger-for-print",{selectedSupplier,period})
    document.querySelector('[data-name="cancel"]').click();
}