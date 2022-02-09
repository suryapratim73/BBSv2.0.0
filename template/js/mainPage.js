const { ipcRenderer } = require("electron");
const { toggleDevTool, drawSpinner, retractHandler, removeAllElem, drawLineGraph, dataModal } = require("../js/common");



let currentMode = "overview",timer,reducedBills = [],reducedPurchases = [];
let mode = 1;

toggleDevTool(document);

async function initPage(){
    let spinner = drawSpinner(document);
    document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");
    await applyMode();
    spinner.remove(window);    
}
initPage();

async function modeSwitcher(e){
    if(e.target.nodeName!=="P") return;
    currentMode = e.target.dataset.cmd;
    if(currentMode){
        let spinner = drawSpinner(document);
        [...document.querySelectorAll("#nav-div p")]
        .forEach(p=>{
            if(p.dataset.cmd===currentMode)
                p.classList.add("selected");
            else
                p.classList.remove("selected");
        });
        await applyMode();
        spinner.remove(window);
    }
    else{
        currentMode = "overview";
        document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");

    }
}

function reducedArr(arr,id){
    return arr.reduce((acc,{billDate,billAmt})=>{
        acc[0][0] += billAmt;
        acc[0][1].push({date:billDate,amt:billAmt});
        return acc;
    },[[ 0, [] ]])
    .map(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,id,"green","red");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
        return [total,objs];
    });
}

async function overviewPageInit(){
    let {stocks,unPaidBills} = await ipcRenderer.invoke("get-overview-content");
    let [dt,mnth,yr] = new Date().toLocaleDateString("en-GB",{dateStyle:"long"}).split(" ");
    let dtEventDiv = document.querySelector("#scheduler-div .event-div>#dt-div");
    dtEventDiv.querySelector("h1").textContent = dt;
    dtEventDiv.querySelector("p").textContent = `${mnth}, ${yr}`;
    let billTbody = document.querySelector("#expired-bill-table-div .tbody");
    unPaidBills.forEach(billObj=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${billObj.billNo}</p>
            <p class="col eq-space">${billObj.billDate.toLocaleDateString('en-GB')}</p>
            <p class="col eq-space">${billObj.name}</p>
            <p class="col eq-space">${billObj.billAmt}</p>
        `;
        billTbody.appendChild(div);
        
    });
    let stockTbody = document.querySelector("#stock-div .tbody");
    stocks.forEach(stock=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${stock.name}</p>
            <p class="col eq-space">${stock.quantity}</p>
        `;
        stockTbody.appendChild(div);
    });
}

async function salePaageInit(){
    let {bills,allBills} = await ipcRenderer.invoke("get-sale-content");
    let orderQueueContainer = document.getElementById("order-queue-container");
    if(bills.length===0)
        document.getElementById("order-queue-container").innerHTML = '<p class="item-obj">Create bill to show up here</p>';
    bills.forEach(({name,billNo,billItems},i)=>{
        let oderQueueDiv = document.getElementById("order-queue-template").content.cloneNode(true).querySelector("div");
        orderQueueContainer.appendChild(oderQueueDiv);
        if(i===0)
            oderQueueDiv.classList.add("visible-order");
        oderQueueDiv.querySelector(".bill-header .highlight[data-colname='name']").textContent = name;
        oderQueueDiv.querySelector(".bill-header .highlight[data-colname='billNo']").textContent = billNo;
        oderQueueDiv.dataset.billNo = billNo;
        let billItemContainer = oderQueueDiv.querySelector(".bill-item-div");
        billItems.forEach(itemObj=>{
            let itemObjDiv = document.getElementById("item-list-template").content.cloneNode(true).querySelector("div");
            [...itemObjDiv.querySelectorAll("span")]
            .forEach(span=>{
                span.textContent = itemObj[span.dataset.colname];
            });
            billItemContainer.appendChild(itemObjDiv);
        });
    });
    reducedBills = reducedArr(allBills,"#sale-graph");
}

async function purchasePageInit(){
    let allPurchases = await ipcRenderer.invoke("get-purchase-content");
    let tbody = document.querySelector("#current-purchase .tbody");
    allPurchases
    .filter((billObj)=>(billObj.billDate.toLocaleDateString("en-GB")==new Date().toLocaleDateString("en-GB")))
    .forEach(({billNo,billDate,supplierName,billAmt})=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${billNo}</p>
            <p class="col eq-space">${billDate.toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${supplierName}</p>
            <p class="col eq-space">${billAmt}</p>
        `;
        tbody.appendChild(div);
    });
    reducedPurchases = reducedArr(allPurchases,"#purchase-graph");
    let canvas = document.querySelector("#purchase-graph");
    if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
        correctChart();
}

async function settingsPageInit(modeContent){
    document.querySelector("#main-div>div:first-child").appendChild(modeContent);
}

async function applyMode(){
    let modeContent;
    if(!currentMode)
        currentMode = "overview";
    [...document.querySelectorAll("#main-div>div:first-child>*")]
    .forEach(elem=>{
        elem.classList.remove("hide")
    });
    [...document.querySelectorAll(".mode-content")]
    .forEach(div=>div.classList.add("hide"));
    if(["settings",'help'].includes(currentMode))
        [...document.querySelectorAll("#main-div>div:first-child>*")]
        .forEach(elem=>elem.classList.add("hide"));
    if(!document.getElementById(`${currentMode}-div`)){
        modeContent = document.getElementById(`${currentMode}-page-template`).content.cloneNode(true).querySelector("div");
        if(["overview","sale","purchase"].includes(currentMode))
            document.getElementById("mode-host").appendChild(modeContent);
        if(!modeContent) return;
        if(currentMode==="overview")
            await overviewPageInit();
        else
        if(currentMode==="sale")
            await salePaageInit();
        else
        if(currentMode==="purchase")
            await purchasePageInit();
        else
        if(currentMode==="settings")
            await settingsPageInit(modeContent);
    }
    else{
        modeContent = document.getElementById(`${currentMode}-div`);
        modeContent.classList.remove("hide");
        correctChart();
    }
}

function expandOrCollapsePanel(){
    retractHandler(document.getElementById("panel"),"width","0","40","vw");
    document.getElementById("knob").classList.toggle("switch-arrow");
}

function controlAnimation(div,mode="opacity",val1="1",val2="0",unit=""){
    requestAnimationFrame(()=>{
        div.style[mode] = val2 + unit;
        requestAnimationFrame(()=>{
            div.style[mode] = val1 + unit;
        })
    });
}

function slideQueueCard(e){
    let transDir = e.target.dataset.translate;
    let oderQueueDiv = e.target.parentNode.parentNode;
    if(oderQueueDiv.classList.contains("oder-queue-div")){
        oderQueueDiv.classList.add(transDir);
        oderQueueDiv.classList.remove("visible-order");
        let oderQueueDivs = [...document.querySelectorAll(".oder-queue-div")]; 
        let currentIndex = oderQueueDivs.findIndex(div=>div===oderQueueDiv);
        currentIndex = currentIndex===oderQueueDivs.length-1?0:currentIndex + 1;
        let selectedDiv = oderQueueDivs[currentIndex];
        controlAnimation(selectedDiv);
        selectedDiv.classList.add("visible-order");
        selectedDiv.classList.remove(transDir);
    }
}

function updateChart(e,canvasId){
    if(e){
        let option = e.target.querySelector(`[value="${e.target.value}"]`);
        mode = Number(option.dataset.mode);
    }
    let arr = canvasId==="#sale-graph" ? reducedBills : reducedPurchases;
    arr.forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,canvasId,"green","red",{mode});
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
        if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
            correctChart();
    });
}

function correctChart(){
    if(["sale","purchase"].includes(currentMode)){
        let id = currentMode==="sale" ? "#sale-graph" : "#purchase-graph";
        updateChart(null,id);
        let canvas = document.querySelector(id);
        if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
            updateChart(null,id);
    }
}

window.addEventListener("resize",correctChart);

function switchSettingsNav(e){
    let settingsMode = e.target.dataset.mode;
    if(!settingsMode) return;
    [...document.querySelectorAll("#settings-div>nav>p")]
    .forEach(p=>{
        if(p.dataset.mode===settingsMode)
            p.classList.add("selected");
        else
            p.classList.remove("selected");
    });
    [...document.querySelectorAll(".settings")]
    .forEach(div=>{
        if(div.dataset.mode!==settingsMode)
            div.classList.add("hide");
        else
            div.classList.remove("hide");
    })
}

async function saveSettings(e){
    // work pending
}