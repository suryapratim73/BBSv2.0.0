const { ipcRenderer } = require("electron");
const {toggleDevTool, applyFilter, filterSelector} = require("../js/common");


let filter = document.querySelector("#filter");
let filterBtn = document.querySelector("header button");
let tbody = document.querySelector("tbody");
let rowNo = 1;

toggleDevTool(document);

filterBtn.addEventListener("click",()=>filter.classList.toggle("hide"));

filter.addEventListener("click",filterSelector);

ipcRenderer.send("get-out-payments");

ipcRenderer.on("show-out-payments",async (e,outPaymentList)=>{
    outPaymentList.forEach(async ({beneficiaryId,date,payment,type}) => {
        if(type==="bill"){
            let {name} = await ipcRenderer.invoke("get-supplier-name",beneficiaryId);
            let tr = document.createElement("tr");
            tr.innerHTML = `
                        <td>${rowNo++}</td>
                        <td>${name}</td>
                        <td>${type}</td>
                        <td>${payment}</td>
                        <td>${date.toDateString()}</td>
            `;
            tbody.appendChild(tr);
        }
    });
    applyFilter(tbody);
})