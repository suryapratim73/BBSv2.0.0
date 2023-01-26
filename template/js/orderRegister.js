const { toggleDevTool,appendToDL,getsaleConfigPolicyPath,applyTheme,selectionHandler } = require("../js/common");
const fs = require("fs");
const { ipcRenderer } = require("electron");


const { unitMap = [] } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

toggleDevTool(document);

let choice,
    nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    transporterDatalist = document.createElement("datalist"),
    unitDatalist = document.createElement("datalist"),
    currentStep;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";

async function init(){
    appendToDL("get-stocks",nameDatalist);
    appendToDL("get-services",nameDatalist);
    appendToDL("get-customers",customerNameDatalist);
    appendToDL("get-transporter",transporterDatalist)
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key==="Bag"?"Bag (=50 Kg)":key;
        unitDatalist.appendChild(option);
    });
    document.body.appendChild(unitDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
}
init();// Datalist linking and selection handler work

function firstChoice(e){
    choice = Number(e.target.dataset.choice);
    if(!choice) return;
    document.getElementById("first-display").classList.add("hide");
    document.querySelector("main").classList.remove("hide");
    let host = document.getElementById("mode-host");
    let formId;
    if(choice===1)//Detail
        formId = "customer-form-template";
    else//quick
        formId = "";
    let form = document.getElementById(formId)?.content.cloneNode(true).querySelector("form");
    if(form)
        host.appendChild(form);
}

function proceedOrFinishHandler(e){

}