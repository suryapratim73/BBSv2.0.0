const { ipcRenderer } = require("electron");
const {toggleDevTool, filterSelector, scrollSymSet, drawSpinner} = require("../js/common");


let filter = document.querySelector("#filter");
let filterBtn = document.querySelector("header button");
let tbody = document.querySelector("#tbody");
let rowNo = 1;
let spinner = drawSpinner(document),isFilterDivHidden = true;

toggleDevTool(document);

filterBtn.addEventListener("click",()=>{
    if(isFilterDivHidden)
        filter.classList.remove("hide");
    else
        filter.classList.add("hide");
    isFilterDivHidden = !isFilterDivHidden;
    console.log({isFilterDivHidden})
});

filter.addEventListener("click",function(e){
    isFilterDivHidden = !isFilterDivHidden;
    filterSelector.call(this,e)
});

document.body.addEventListener("click",e=>{
    if([filter,[...filter.querySelectorAll("button")],document.getElementById("filter-btn")].includes(e.target)) return;
    if(!isFilterDivHidden){
        filter.classList.add("hide");
        isFilterDivHidden = !isFilterDivHidden;
    }
});

ipcRenderer.send("get-out-payments");

ipcRenderer.on("show-out-payments",async (e,outPaymentList)=>{
    await outPaymentList.reduce(async (acc,{beneficiaryId,date,payment,type}) => {
        if(type==="bill"){
            let {name} = await ipcRenderer.invoke("get-supplier-name",beneficiaryId);
            let tr = document.createElement("div");
            tr.className = "body row";
            tr.innerHTML = `
                        <p class="col eq-space">${rowNo++}</p>
                        <p class="col eq-space">${name}</p>
                        <p class="col eq-space">${type}</p>
                        <p class="col eq-space">${payment}</p>
                        <p class="col eq-space">${date.toDateString()}</p>
            `;
            tr.dataset.date = date;
            tbody.appendChild(tr);
        }
        return acc;
    });
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    spinner.remove(window);
});