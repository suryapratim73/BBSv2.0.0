const {toggleDevTool,drawSpinner,searchHandler, scrollSymSet, applyTheme,createModal,closeModal, appendToHost,removeAllElem, traverseParent, showToastNotification, contextMenuFunction} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

const header = document.querySelector("header"),salesArr = [];
const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
    ];
let spinner = drawSpinner(document),saleList = [];
let tbody = document.querySelector("#tbody"),selectedRow;

tbody.addEventListener("contextmenu",(e)=>contextMenuFunction(e,"Sale-Dsiplay"));

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
    let monthlySales = sales.reduce((acc,saleObj)=>{
        let month = new Date(saleObj.billDate).getMonth();
        let year = new Date(saleObj.billDate).getFullYear();
        acc[month+"_"+year] = [...(acc?.[month+"_"+year] ?? []),saleObj];
        return acc; 
    },{});
    Object.keys(monthlySales)
    .forEach(month=>{
        let _month = Number(month.split("_")[0]);
        let sales = monthlySales[month];
        let monthDiv = document.createElement("div");
        monthDiv.className = "row body monthly-div";
        tbody.appendChild(monthDiv);
        let h2 = document.createElement("h2");
        monthDiv.appendChild(h2);
        h2.textContent = monthNames[+_month]
        sales.sort(({billDate},{billDate:_billDate})=>_billDate-billDate).forEach((saleObj,i)=>{
            saleList.push(saleObj);
            let bodyDiv = document.createElement("div");
            bodyDiv.className = "row body";
            monthDiv.appendChild(bodyDiv)
            bodyDiv.dataset.billObj = JSON.stringify(saleObj);
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

ipcRenderer.on("show-bill",(e,billObj)=>{
    selectedRow.querySelector(".col").click();
});

ipcRenderer.on("msg-from-backend",(e,msg,type)=>{
    let classList = ["animation-common","move-left","blue-toast-box"];
    if(type==="error")
        classList = ["animation-common","move-left","red-toast-box"];
    showToastNotification(msg,classList);
});