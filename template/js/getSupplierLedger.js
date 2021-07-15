const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,init,printModal} = require("../js/common.js");
toggleDevTool(document);


let form = document.querySelector("form");
let datalist = document.querySelector("datalist");
let suppliers = [], selectedSupplier = {};

(async ()=>{
    suppliers = await init(datalist)
})();

function loadLedgerSummary(balance,last5Entries,netPayment,{name,id}){
    let page2root = document.createElement("div");
    page2root.id = "contact-div";
    page2root.innerHTML = `
                    <section>
                        <div>
                            <p>Name: <span>${name}</span></p>
                        </div>
                        <div>
                            <p>Net Due: <span>${balance}</span></p>
                        </div>
                        <div>
                            <p>Net Purchase: <span>${netPayment + balance}</span></p>
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
                                    <th>Balance</th>
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
        // let paymentStatus = entry.paymentStatus;
        Object.keys(entry).forEach(col=>{
            if(!["paymentStatus","itemList","entryNo","tax"].includes(col)){
                let td = document.createElement("td");
                td.textContent = col!=="date"?entry[col]:entry[col].toDateString();
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
        let { balance,lastFiveEntries,netPayment } = await ipcRenderer.invoke("get-supplier-ledger",selectedSupplier);
        loadLedgerSummary(balance,lastFiveEntries,netPayment,selectedSupplier);
    } else 
        alert("Please select a supplier.");
});

function handlePrint(e){
    e.preventDefault();
    let period = Number(e.target["ledger-period"].value);
    ipcRenderer.send("print-ledger",selectedSupplier.id,period,1)
    document.querySelector('[data-name="cancel"]').click();
}