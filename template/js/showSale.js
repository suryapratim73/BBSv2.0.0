const {toggleDevTool,drawSpinner,searchHandler, scrollSymSet} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

const header = document.querySelector("header"),salesArr = [];
let spinner = drawSpinner(document),saleList = [];

header.addEventListener("click",function(e){
    const filterOptions = this.querySelector("#filter-options"),
        bodyRows = [...document.querySelectorAll(".body.row")];
    if(e.target.dataset.cmd==="toggle-filter-option")
        filterOptions.classList.toggle("hide");
    else{
        [...document.querySelectorAll(".selected")].forEach(p=>p.classList.remove("selected"));
        e.target.classList.add("selected")
        if(["paid","unpaid","open","close"].includes(e.target.dataset.cmd))
            bodyRows.forEach(bodyRow=>{
                let {paymentStatus,billStatus} = bodyRow.dataset;
                paymentStatus = paymentStatus===true?"paid":"unpaid";
                bodyRow.classList.remove("hide");
                if(![paymentStatus,billStatus].includes(e.target.dataset.cmd))
                    bodyRow.classList.add("hide");
            });
        else
            bodyRows.forEach(row=>row.classList.remove("hide"));
    }
    
});

document.body.addEventListener("click",function(e){
    if(e.target!==document.querySelector("body > header > button")) 
        document.querySelector("#filter-options").classList.add("hide");
});

ipcRenderer.send("get-sales");

ipcRenderer.on("get-sales-response",(e,sales)=>{
    sales.forEach((saleObj,i)=>{
        saleList.push(saleObj);
        let bodyDiv = document.createElement("div");
        bodyDiv.className = "row body";
        let tbody = document.querySelector("#tbody");
        tbody.appendChild(bodyDiv);
        const {
            billDate,
            billNo,
            billAmt,
            tax,
            billItemTable,
            billStatus,
            name,
            customerId,
            paymentStatus
        } = saleObj;
        salesArr.push(saleObj);
        bodyDiv.dataset.billStatus = billStatus;
        bodyDiv.dataset.billNo = billNo;
        bodyDiv.dataset.billDate = billDate;
        bodyDiv.dataset.customerId = customerId;
        bodyDiv.dataset.name = name;
        bodyDiv.dataset.paymentStatus = paymentStatus;
        Object.keys({i,billDate,billNo,billAmt,tax}).forEach(key=>{
            let p = document.createElement("p");
            if(key==="billAmt" || key==="tax")
                p.textContent = Math.round(saleObj[key]);
            else
            if(key==="billDate")
                p.textContent = saleObj[key].toLocaleDateString("en-GB");
            else
            if(key in saleObj)
                p.textContent = saleObj[key];
            else
                p.textContent = i+1;
            p.className = `col eq-space`;
            bodyDiv.appendChild(p);
        });
        bodyDiv.dataset.itemTable = billItemTable;
    });
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    let defaultTbody = document.querySelector("#emphasis-tables .tbody");
    let suppliers = Array.from(new Set(saleList.map(({name})=>name).sort())).map(name=>{
        let { customerId } = saleList.find(obj=>obj.name===name);
        return {name,customerId}; 
    });
    suppliers.forEach(async ({customerId,name})=>{
        let balance = await ipcRenderer.invoke("get-ledger-balance",customerId);
        if(balance>0){
            let div = document.createElement("div");
            div.className = "row body";
            div.innerHTML = `
                <p class="col eq-space">${name}</p>
                <p class="col eq-space">${balance}</p>
            `;
            defaultTbody.appendChild(div);
        }
    });
    document.querySelector("#filter-options p:last-child").classList.add("selected");
    spinner.remove(window);
});

function _searchHandler(e){
    searchHandler(e,saleList);
}