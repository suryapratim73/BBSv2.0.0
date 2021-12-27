const { toggleDevTool, appendToDL, validateInput, validateInput2 , removeAllElem, showDeleteBTN, makeKey } = require("../js/common");
const { ipcRenderer } = require("electron");
const { unitMap } = require("../../config/saleConfig.json");
const { v5 } = require("uuid");


toggleDevTool(document);

let reqSlipObj = {
    header:{},
    body:[]
};

async function initPage(){
    appendToDL("get-supplier-names",document.getElementById("supplier-list"));
    appendToDL("get-stocks",document.getElementById("stock-dl"));
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key==="Bag"?"Bag (=50 Kg)":key;
        document.getElementById("unit-dl").appendChild(option);
    });
    document.getElementById("reqNo").value = await ipcRenderer.invoke("get-requirement-number");
    document.getElementById("date").valueAsDate = new Date();
}
initPage();

function inputChangeHandler(e){
    let bodyRow = e.target.parentNode.parentNode;
    let rowNo = bodyRow.querySelector("p").textContent;
    let rowId = v5(rowNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    if(e.target.dataset.name==="name"){
        let stockName = e.target.value;
        let stockObj = {...e.target.list.querySelector(`[data-name='${stockName}']`)?.dataset} ?? {};
        reqSlipObj.body.push({
            rowId,
            "Stock Name": stockName,
            stockId:stockObj.id,
            "HSN":stockObj.hsn
        });
    }
}

function inputHandler(e){
    if(["quantity","unit","rate"].includes(e.target.dataset.name)){
        let bodyRow = e.target.parentNode.parentNode;
        let rowNo = bodyRow.querySelector("p").textContent;
        let rowId = v5(rowNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
        let itemObj = reqSlipObj.body.find(obj=>obj.rowId===rowId);
        let val = e.target.value;
        itemObj[e.target.dataset.name] = e.target.dataset.name==="unit" ? val : Number(val);
        if(["quantity","rate"].every(key=>key in itemObj))
            bodyRow.querySelector("#amt").textContent = itemObj.quantity * itemObj.rate;
    }
}

function addRow(e){
    let btnDiv = e.target.parentNode;
    btnDiv.before(document.getElementById("body-row-template").content.cloneNode(true));
    [...document.querySelectorAll(".body.row")]
    .forEach((div,i)=>div.querySelector("p").textContent=i+1);
    btnDiv.scrollIntoView();
    document.querySelector(".body.row:nth-last-child(2) input")?.focus();
}

function proceedToPage2(e){
    e.preventDefault();
    document.querySelector(".page1").classList.add("hide");
    if(!document.querySelector(".page2")){
        let page2 = document.getElementById("page2-template").content.cloneNode(true);
        document.body.appendChild(page2);
    }
    else
        document.querySelector(".page2").classList.remove("hide");
    let form = e.target;
    [...form.querySelectorAll("input")]
    .forEach(input=>{
        reqSlipObj.header[input.name] = input.name!=="print" ? input.value : input.checked;
    });
}

function generateReqSlip(){
    [...document.querySelectorAll("input")].forEach(input=>input.setAttribute("disabled","disabled"));
    ipcRenderer.send("generate-request-slip",reqSlipObj);
}

function backToPage1(){
    document.querySelector(".page2")?.classList.add("hide");
    document.querySelector(".page3")?.classList.add("hide");
    document.querySelector(".page1").classList.remove("hide");
}

function deleteRow(e){
    let bodyRow = e.target.parentNode.parentNode;
    if(!bodyRow.classList.contains("body") && !bodyRow.classList.contains("row")) return;
    if(e.target.nodeName!=="BUTTON") return;
    let indexNo = bodyRow.querySelector("p").textContent;
    let indexId = v5(indexNo,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    reqSlipObj.body.splice(reqSlipObj.body.findIndex(obj=>obj.rowId===indexId),1);
    bodyRow.remove();
    [...document.querySelectorAll(".body.row")]
    .forEach((row,i)=>{
        row.querySelector("p").textContent = i+1;
    });
}

function newFeildForm(e){
    [...document.querySelectorAll(".page")].forEach(page=>page.classList.add("hide"));
    removeAllElem(".page3");
    let page3Form = document.getElementById("new-feild-form-template").content.cloneNode(true).querySelector("form");
    document.body.appendChild(page3Form);
}

function newFeild(e){
    e.preventDefault();
    let key = e.target.key.value,val = e.target.val.value;
    backToPage1()
    removeAllElem(".page3");
    let btnDiv = document.getElementById("btn-div");
    let newFeildDiv = document.getElementById("new-feild-template").content.cloneNode(true).querySelector("div");
    btnDiv.before(newFeildDiv);
    let label = newFeildDiv.querySelector("label");
    let input = newFeildDiv.querySelector("input");
    label.setAttribute("for",key);
    label.textContent = key;
    input.setAttribute("id",key);
    input.setAttribute("name",key);
    input.setAttribute("required",true);
    input.value = val;
}