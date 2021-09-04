const {toggleDevTool,validateInput} = require("../js/common.js");
const {ipcRenderer} = require("electron");


toggleDevTool(document);
let firstDiv = document.querySelector("main form div");
let selectedStock,feildMap = {};

document.querySelector("form").addEventListener("submit",e=>{
    e.preventDefault();
    let {"0":{value:name},"1":{value:quantity=0},"2":{value:price=0},"3":{value:location=""}} = e.target;
    ipcRenderer.send("update-stock",{name,quantity,price,location,feildMap});
});

document.addEventListener("DOMContentLoaded",async ()=>{
    let datalist = document.createElement("datalist");
    datalist.id = "stock-name";
    (await ipcRenderer.invoke("get-stock-names")).forEach(entry=>{
        let {name} = entry.dataValues;
        let option = document.createElement("option");
        option.value = name;
        datalist.appendChild(option);
    });
    firstDiv.appendChild(datalist);
});

function saveFeildValues(e){
    e.preventDefault();
    let keys = [...document.querySelectorAll(".key")].map(elem=>elem.textContent),
        vals = [...document.querySelectorAll(".val")].map(elem=>elem.value);
    keys.forEach((key,i)=>feildMap[key]=vals[i]);
    closeModal()
}

function closeModal(){
    document.querySelector(".modal").classList.add("hide");
    document.querySelector(".cover").classList.add("hide");
}

function addFeild(e,key="",val=""){
    let btnDiv = e?e.target.parentNode:document.querySelector("#feild-container > div:last-child");
    let div = document.createElement("div");
    div.className = "product-feild";
    div.innerHTML = `
        <div contenteditable="true" class="key">${key}</div>
        <div>
            <input type="text" value="${val}" class="val"/>
            <button class="delete-btn" type="button">x</button>
        </div>
    `;
    btnDiv.before(div);
}

function showModal(){
    document.querySelector(".modal").classList.remove("hide");
    document.querySelector(".cover").classList.remove("hide");
}

async function setSelectedStock(e){
    if(e.target.value.length>0){
        selectedStock = e.target.value;
        document.querySelector("#more-info").removeAttribute("disabled");
        [...document.querySelectorAll(".product-feild")].forEach(div=>div.remove());
        let { pInfo } = await ipcRenderer.invoke("get-more-info-on-selected-stock",selectedStock);
        for(let key in pInfo)
            addFeild(null,key,pInfo[key]);        
    }
    else{
        document.querySelector("#more-info").setAttribute("disabled","disabled")
        feildMap = {};
    }
}

document.querySelector("#feild-map").addEventListener("click",e=>{
    if(e.target.className==="delete-btn")
        e.target.parentNode.parentNode.remove();
})