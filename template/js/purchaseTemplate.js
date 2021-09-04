const {ipcRenderer} = require("electron");
const {toggleDevTool,validateInput,init,removeAllElem} = require("../js/common.js");


toggleDevTool(document);

let supplier = {},
    firstPage = document.getElementById("page1"),
    secondPage = document.getElementById("page2"),
    thirdPage = document.getElementById("page3"),
    addItemDiv = document.getElementById("add-item"),
    modal = document.getElementById("purchase-page-modal"),
    cover = document.querySelector(".cover"),
    stockDl = document.getElementById("stock-dl"),
    bodyRow,timer,
    itemObj = {pInfo:{}},
    itemList = [];

document.querySelector("#tbody")?.addEventListener("click",function(e){
    removeAllElem(".body-row-options")
    if(["P","INPUT"].includes(e.target.nodeName)){
        bodyRow = e.target.parentNode.parentNode;
        let optionTemplate = document.getElementById("item-options");
        bodyRow.after(optionTemplate.content.cloneNode(true));
        clearTimeout(timer);
        timer = setTimeout(removeAllElem,5000,".body-row-options")
    }
    else{
        if(e.target.dataset.cmd==="delete"){
            bodyRow.remove();
        }
        else
        if(e.target.dataset.cmd==="add-info"){
            modal.classList.remove("hide");
            cover.classList.remove("hide");
            removeAllElem(".deletable");
            //
        }
    }
});

(async ()=>{
   let stockNames = await ipcRenderer.invoke("get-stock-names");
   [...stockDl.children].forEach(elem=>elem.remove());
   stockNames.forEach(({dataValues:{name}})=>{
        let option = document.createElement("option");
        option.value = name;
        stockDl.appendChild(option);
   })
})();

function validateInput2(e){
    validateInput(e)
    if(e.defaultPrevented) return;
    if(e.target.dataset.subtype==="price" && !/\d/.test(e.key)) e.preventDefault();
}

function addSupplier(e){
    e.preventDefault();
    const { name,address,phones,email,gst } = e.target;
    supplier.name = name.value;
    supplier.address = address.value;
    supplier.phones = supplier.phones ? [...supplier.phones,phones.value] : [phones.value];
    supplier.moreInfo = email.value ? {
        email: email.value
    } : {};
    supplier.gst = gst.value;
    firstPage.classList.add("hide");
    secondPage.classList.remove("hide");
}

function addNewNumber(e){
    let input = e.target.previousSibling.previousSibling;
    supplier.phones = supplier.phones ? [...supplier.phones,input.value] : [input.value];
    input.value = "";
    input.focus();
}

function addRow(e){
    let slNo = ++[...document.querySelectorAll(".row.body")].length;
    let bodyRowTemplate = document.getElementById("body-row-template");
    let clonedBodyRow = bodyRowTemplate.content.cloneNode(true);
    clonedBodyRow.querySelector(".sm>p").textContent = slNo;
    e.target.parentNode.before(clonedBodyRow);
}

function addFeild(e){
    document.querySelector(".popup2").classList.remove("hide");
}

function setFeild(e){
    e.preventDefault();
    closeModal(undefined,"popup2")
    let btnFeild = document.querySelector("#purchase-page-modal .feild:last-child");
    let { label,value } = e.target,
        newFeild = document.createElement("div");
    label = label.value;
    value = value.value;
    document.querySelector(`[data-feild="${label}"]`)?.remove();
    newFeild.className = "feild deletable";
    newFeild.dataset.feild = label;
    newFeild.innerHTML = `
        <label for="${label}">${label}</label>
        <input type="text" data-catagory="pInfo" required id="${label}" name="${label}" value="${value}">
    `;
    btnFeild.before(newFeild);
    btnFeild.scrollIntoView();
}

function closeModal(e,popup){
    let controller = popup ? popup : e.target.dataset.modal;
    if(controller!="popup2"){
        modal.classList.add("hide");
        cover.classList.add("hide");
    }
    document.querySelector(".popup2").classList.add("hide");
}

function addItem(e){
    e.preventDefault();
    [...modal.querySelectorAll(".feild input")].forEach(input=>{
        itemObj.pInfo[input.name] = input.value;
    });
    closeModal(undefined,"NA")
    bodyRow.dataset.pInfo = JSON.stringify(itemObj.pInfo);
}