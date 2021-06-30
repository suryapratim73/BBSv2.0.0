const { ipcRenderer } = require("electron");
const { toggleDevTool } = require("../js/common");


toggleDevTool(document);

let customerList = [];

function searchHandler(e){
    e.preventDefault();
}

ipcRenderer.send("get-customer");

ipcRenderer.on("customer-list",(e,_customerList)=>{
    customerList = _customerList;
    _customerList.forEach(({name})=>{
        let startLetter = name.charAt(0).toLowerCase();
        let selectedDiv = document.querySelector(`[data-letter="${startLetter}"]`);
        let p = document.createElement("p");
        p.textContent = name;
        p.classList.add("name");
        selectedDiv.appendChild(p);
        selectedDiv.classList.remove("hide");       
    })
})