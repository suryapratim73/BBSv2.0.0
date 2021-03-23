const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,init} = require("../js/common.js");
toggleDevTool(document);


let form = document.querySelector("form");
let datalist = document.querySelector("datalist");
let suppliers = [];

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
                        <button>Load full ledger</button>
                        <button>Back</button>
                    </div>
    `;
    let tbody = page2root.querySelector("tbody");
    page2root.querySelector("button:nth-child(1)").addEventListener("click",()=>ipcRenderer.send("Load full ledger",{name,id}));
    page2root.querySelector("button:nth-child(2)").addEventListener("click",()=>location.reload());
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
    let selectedSupplier = suppliers.find(suppObj=>suppObj.name===e.target[0].value);
    if(selectedSupplier){
        let ledgerObj= await ipcRenderer.invoke("get-supplier-ledger",selectedSupplier);
        loadLedgerSummary(ledgerObj,selectedSupplier);
    } else 
        alert("Please select a supplier.");
})