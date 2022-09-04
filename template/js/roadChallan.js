const { toggleDevTool, makeKey, showDeleteBTN , capitalize , validateInput, validateInput2, appendToDL, removeAllElem, applyTheme } = require("../js/common");
const { ipcRenderer, } = require("electron");
const { unitMap } = require("../../config/saleConfig.json");


toggleDevTool(document);

let currentPage = 1,
    roadChallanObj = {
        header: [],
        body: []
    };

async function initPage(){
    mainPage();
    document.getElementById("delDate").valueAsDate = new Date();
    appendToDL("get-stocks",document.getElementById("stock-names"));
    unitMap.forEach(obj=>{
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        document.getElementById("unit-dl").appendChild(option);
    });
    appendToDL("get-customers",document.getElementById("consignee-list"));
}
initPage();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function mainPage(){
    [...document.querySelectorAll(".page")].forEach(page=>page.classList.add("hide"));
    if(!document.querySelector(`.page${currentPage}`)){
        let page = document.getElementById(`page${currentPage}-template`).content.cloneNode(true);
        document.querySelector("main").appendChild(page);
    }
    else
        document.querySelector(`.page${currentPage}`).classList.remove("hide");
}

function addNewFeild(){
    removeAllElem("page2-elem");
    document.querySelector(".page1").classList.add("hide");
    let newFeild = document.getElementById("new-feild-template").content.cloneNode(true).querySelector("form");
    document.querySelector("main").appendChild(newFeild);
}

function newFeildToNewEmp(e){
    e.preventDefault();
    let addBtnDiv = document.getElementById("new-feild-btn").parentNode;
    let form = e.target;
    let obj = {
        key: form.key.value,
        val: form.val.value,
    };
    form.remove();
    let div = document.createElement("div");
    div.innerHTML = `
        <div>
            <label for="${makeKey(obj.key)}">${obj.key}</label>
        </div>
        <div>
            <input required id="${makeKey(obj.key)}" data-colname="${obj.key}" name="${makeKey(obj.key)}" value="${obj.val}" />
        </div>
    `;
    addBtnDiv.before(div);
    showPage1();
}

function showPage1(){
    currentPage = 1;
    mainPage();
    removeAllElem(".page2-elem");
}

function initRoadChallan(e){
    e.preventDefault();
    [...document.querySelectorAll(".page1 input")]
    .forEach(input=>{
        roadChallanObj.header.push({[input.dataset.colname] : input.value});
    });
    document.querySelector(".page1").classList.add("hide");
    currentPage++;
    mainPage();
}

function addRow(e){
    let btnDiv = e.target.parentNode;
    btnDiv.before(document.getElementById("body-row-template").content.cloneNode(true));
    [...document.querySelectorAll(".body.row")]
    .forEach((div,i)=>div.querySelector("p").textContent=i+1);
    btnDiv.scrollIntoView();
    document.querySelector(".body.row:nth-last-child(2) input")?.focus();
}

function selectStock(e){
    let name = e.target.value;
    let option = e.target.list.querySelector(`[data-name='${name}']`);
    let itemObj = {...option.dataset};
    let bodyRow = e.target.parentNode.parentNode;
    for(let key in itemObj){
        let input = bodyRow.querySelector(`[data-name='${key}']`);
        if(input)
            input.value = itemObj[key];
    }
}

function calculateAmt(e){
    let bodyRow = e.target.parentNode.parentNode;
    let qty = Number(bodyRow.querySelector(`[data-name='qty']`).value);
    let rate = Number(bodyRow.querySelector(`[data-name='standardSellPrice']`).value);
    if(qty && rate)
        bodyRow.querySelector("p.amt").textContent = rate * qty;
}

function deleteRow(e){
    if(e.target.nodeName==="BUTTON" && e.target.dataset.cmd==="DELETE"){
        let bodyRow = e.target.parentNode.parentNode;
        bodyRow.remove();
        [...document.querySelectorAll(".body.row")]
        .forEach((row,i)=>{
            row.querySelector("p").textContent = i+1;
        });
    }
}

function generateRoadChallan(e){
    [...document.querySelectorAll(".body.row")]
    .forEach(row=>{
        let itemObj = {};
        [...row.querySelectorAll("input")]
        .forEach(input=>{
            itemObj[input.dataset.colname] = input.value;
        });
        roadChallanObj.body.push(itemObj);
    });
    ipcRenderer.send("generate-road-challan",roadChallanObj);
}

function setFeilds(e){
    let input = e.target;
    let option = input.list.querySelector(`[data-name='${input.value}']`);
    let obj = {...option.dataset};
    let { address,gst } = obj;
    document.querySelector(`#consigneeGST`).value = gst;
    document.querySelector('#consigneeAddress').value = address;
    document.querySelector('#delNoteNo').focus();
}

ipcRenderer.on("print-done",()=>{
    ipcRenderer.send("close","Road-Challan-Generator");
});

document.addEventListener("keydown",e=>{
    console.log(currentPage)
    if(e.ctrlKey && e.key==="Enter" && currentPage===2)
        document.querySelector("#generate-challan").click();
    if(e.ctrlKey && e.key==="ArrowLeft" && currentPage===2)
        document.querySelector('#back-to-page1').click();
    if(e.ctrlKey && e.key==="+" && currentPage===2)
        document.querySelector("#add-new-row").click();
    if(e.ctrlKey && e.key==="+" && currentPage===1)
        document.querySelector("#new-feild-btn").click();
});