const { toggleDevTool, removeAllElem, applySpinner, appendToDL,drawSpinner } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

let saleDL = document.createElement("select"),
    purchaseDL = document.createElement("select"),
    ordersDL = document.createElement("select"),obj;

function templateHelper(id,dl){
    let temp = document.createElement("template");
    temp.id = id;
    temp.content.appendChild(dl);
    document.body.appendChild(temp);
}

applySpinner(async function(){
    let content = document.getElementById("reminder-template").content.cloneNode(true);
    document.getElementById("type-card").after(content);
    saleDL.id = "sale-dl";
    purchaseDL.id = "purchase-dl";
    ordersDL.id = "orders-dl";
    [ saleDL,purchaseDL,ordersDL ]
    .forEach(dl=>{
        dl.name = "billObj";
        dl.className = "removable-select";
        dl.dataset.cmd = "billObj";
    });
    await appendToDL("get-sales",saleDL,false,null,["name","billNo","billDate"]);
    await appendToDL("get-purchases",purchaseDL,false,null,["name","billNo","billDate"]);
    await appendToDL("get-orders",ordersDL,false,["fileList"]);
    [
        { id:"sales-select",dl:saleDL },
        { id:"purchase-select",dl:purchaseDL },
        { id:"orders-select",dl:ordersDL },
    ].forEach(({id,dl})=>templateHelper(id,dl));
});

function submitHandler(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries())
    if(data.type!=="reminder")
        data.billObj = obj ?? {...document.querySelector("#select-host option").dataset};
    ipcRenderer.send("manage-schedule",data,"a");
}

function clickHandler(e){
    let { cmd } = e.target.dataset;
    if(cmd==="cancel")
        ipcRenderer.send("close");
}

async function changeHandler(e){
    let { dataset:{ cmd },value } = e.target;
    if(cmd==="type"){
        removeAllElem(".removable");
        let content = document.getElementById(`${value}-template`).content.cloneNode(true);
        document.getElementById("type-card").after(content);
        if(["bill-payment","order-bill"].includes(value)){
            removeAllElem(".removable-select");
            let select = document.getElementById("sales-select").content.cloneNode(true).querySelector("select");
            document.getElementById("select-host").appendChild(select);
        }
    }
    else
    if(cmd==="billType"){
        removeAllElem(".removable-select");
        let select = document.getElementById(value).content.cloneNode(true).querySelector("select");
        document.getElementById("select-host").appendChild(select);
    }
    else
    if(cmd==="billObj"){
        let option = e.target.querySelector(`option:checked`);
        obj = {...option.dataset};
    }
}