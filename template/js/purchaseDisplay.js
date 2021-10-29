const { ipcRenderer } = require("electron");
let { toggleDevTool,removeAllElem,searchHandler, scrollSymSet } = require("../js/common.js");

let tbody = document.querySelector("#tbody"),
    bodyRow,
    modal = document.querySelector(".modal"),
    cover = document.querySelector(".cover"),
    purchases = [];

toggleDevTool(document);

(async ()=>{
    let slNo = ++[...document.querySelectorAll(".row.body")].length;
    purchases = await ipcRenderer.invoke("get-purchases");
    let bodyRowTemplate = document.getElementById("body-row-template");
    purchases.forEach(purchaseObj=>{
        let clonedBodyRow = bodyRowTemplate.content.cloneNode(true);
        clonedBodyRow.querySelector("p").textContent = slNo++;
        for(let key in purchaseObj){
            if(["billAmt","billDate","supplierName","billNo"].includes(key))
                clonedBodyRow.querySelector(`p[data-colName='${key}']`).textContent = key!=="billDate" ? purchaseObj[key] : purchaseObj[key].toLocaleDateString("en-GB");
            clonedBodyRow.children[0].dataset[key] = typeof purchaseObj[key]!=="string" ? JSON.stringify(purchaseObj[key]) : purchaseObj[key];
            if(key==="billDate")
            clonedBodyRow.children[0].dataset[key] = purchaseObj[key];
        }
        tbody.appendChild(clonedBodyRow);
    });
    if(tbody.clientHeight<tbody.scrollHeight)
        mousedownTimer = scrollSymSet(tbody);
})();

tbody.addEventListener("scroll",function(e){
    if(tbody.scrollTop == Math.abs(tbody.clientHeight-tbody.scrollHeight)){
        tbody.querySelector(".scroll-sym-div")?.classList.add("hide");
        tbody.querySelector(".scroll-top-sym")?.classList.remove("hide");
    }
    else{
        tbody.querySelector(".scroll-sym-div")?.classList.remove("hide");
        tbody.querySelector(".scroll-top-sym")?.classList.add("hide");
    }
});

tbody.addEventListener("click",async function(e){
    bodyRow = e.target.parentNode;
    let { billItemTable,moreInfo,payment,paymentStatus,tax } = bodyRow.dataset;
    if(!billItemTable) return;
    let itemList = await ipcRenderer.invoke("get-table",billItemTable);
    modal.classList.remove("hide");
    cover.classList.remove("hide");
    removeAllElem(".modal div");
    let supplier = bodyRow.querySelector(`[data-colName="supplierName"]`).textContent;
    let billModalTemplateDF = document.getElementById("bill-modal-template");
    let clonedBMT = billModalTemplateDF.content.cloneNode(true);
    clonedBMT.querySelector(`[data-feildName="supplier"]`).textContent = supplier;
    clonedBMT.querySelector(`[data-feildName="date"]`).textContent = bodyRow.querySelector(`[data-colName="billDate"]`).textContent;
    clonedBMT.querySelector(`[data-feildName="paymentStatus"]`).textContent = paymentStatus ? true : false;
    clonedBMT.querySelector(`[data-feildName="billAmt"]`).textContent = document.querySelector(`[data-colName="billAmt"]`).textContent;
    let billBody = clonedBMT.querySelector(`[data-feildName="bill-body"]`);
    let billHeader = clonedBMT.querySelector(`[data-feildName="bill-header"]`);
    moreInfo = JSON.parse(moreInfo);
    let tbody = document.createElement("div");
    for(let key in moreInfo){
        if(key!=="freightId"){
            let div = document.createElement("div");
            div.innerHTML = `
                <p>${key}</p>
                <p class="highlight-3">${moreInfo[key]}</p>
            `;
            billHeader.appendChild(div);
        }
    }
    billBody.appendChild(tbody);
    tbody.id = "modal-tbody"
    itemList.forEach(({name,quantity,unit,rate})=>{
        let div = document.createElement("div");
        div.innerHTML = `
            <p class="highlight-3">${name}</p>
            <p class="highlight-3">${quantity}</p>
            <p class="highlight-3">${unit}</p>
            <p class="highlight-3">${rate}</p>
        `;
        tbody.appendChild(div);
    });
    modal.appendChild(clonedBMT);
});

cover.addEventListener("click",closeModal);

function closeModal(){
    modal.classList.add("hide");
    cover.classList.add("hide");
}

function _searchHandler(e){
    searchHandler(e,purchases);
}