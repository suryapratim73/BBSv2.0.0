const {toggleDevTool,drawSpinner,searchHandler, scrollSymSet, applyTheme,createModal,closeModal, appendToHost,removeAllElem} = require("../js/common");
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

document.body.addEventListener("click",async function(e){
    if(e.target!==document.querySelector("body > header > button")) 
        document.querySelector("#filter-options").classList.add("hide");
    if(e.target.classList.contains("col")){
        let saleObj = {...e.target.parentNode.dataset};
        let modal = createModal("bill-modal");
        let billModal = appendToHost("#bill-view-modal-template",modal,"DIV");
        let [ id,billNo,billDate ] = saleObj.itemTable.split("_");
        let itemList = await ipcRenderer.invoke("get-bill-items-2",id,billNo,billDate);
        let { gst } = await ipcRenderer.invoke("get-customer-details",id);
        let { name } = saleObj;
        let obj = {name,billNo,billDate,gst};
        [...document.querySelectorAll(".bill-header")]
        .forEach(div=>{
            let h3 = div.querySelector(".value");
            h3.textContent = obj[div.dataset.name];
        });
        itemList.forEach((itemObj,i)=>{
            let bodyRow = appendToHost("#body-row-template",billModal.querySelector("#tbody"),"DIV");
            [...bodyRow.querySelectorAll("p")]
            .forEach(p=>{
                if(p.dataset.name==="slno")
                    p.textContent = i+1;
                else
                if(p.dataset.name==="quantity")
                    p.textContent = itemObj.quantity+" "+itemObj.unit;
                else
                    p.textContent = itemObj[p.dataset.name];
            });
        });
    }
});

ipcRenderer.send("get-sales");

ipcRenderer.on("get-sales-response",(e,sales)=>{
    sales.forEach((saleObj,i)=>{
        saleList.push(saleObj);
        let bodyDiv = document.createElement("div");
        bodyDiv.className = "row body";
        let tbody = document.querySelector("#tbody");
        tbody.appendChild(bodyDiv);
        salesArr.push(saleObj);
        Object.keys({i,...saleObj})
        .forEach(key=>{
            bodyDiv.dataset[key] = saleObj[key];
            let p = document.createElement("p");
            if(key==="billAmt" || key==="tax")
                p.textContent = Math.round(saleObj[key]);
            else
            if(key==="billDate")
                p.textContent = saleObj[key].toLocaleDateString("en-GB");
            else
            if(key==="billNo")
                p.textContent = saleObj[key];
            else
            if(key==="i")
                p.textContent = i+1;
            p.className = `col eq-space`;
            if(["billAmt","tax","billDate","billNo","i"].includes(key))
                bodyDiv.appendChild(p);
        });
        bodyDiv.dataset.itemTable =saleObj.billItemTable;
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

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function _searchHandler(e){
    searchHandler(e,saleList);
}