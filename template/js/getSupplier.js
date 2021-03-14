const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput,init} = require("../js/common.js");
toggleDevTool(document);


let form = document.querySelector("form");
let datalist = document.querySelector("datalist");

let suppliers = [],plusBTN,fieldmap={
    "Name":{
        id:"name",
        index:0
    },
    "GST Number":{
        id:"gst",
        index:1
    },
    "Contact Numbers":{
        id:"phones",
        index:2
    },
    "Address":{
        id:"address",
        index:3
    },
    "Comment":{
        id:"comment",
        index:4
    }
};

(async ()=>{
    suppliers = await init(datalist);
})()

function addNumber(e){
    ipcRenderer.send("get-new-phone-number")
    plusBTN = e.target;
}

function editBTNClick(e){
    let selectedDiv = e.target.parentNode.parentNode;
    let field = selectedDiv.children[0].textContent;
    field = field.substring(0,field.length-2);
    let _field = fieldmap[field].id;
    let dataObj = {
        field,
        value:suppliers[0][_field]
    };
    ipcRenderer.send("update-supplier-detail",dataObj);
};

function hoverToggler(e){
    [...this.children].forEach(elem=>{
        elem.classList.remove("hover");
    })
    if(e.target===this)
        return;
    let hoveredDiv;
    if([...this.children].includes(e.target))
        hoveredDiv = e.target;
    else{
        if([...this.children].includes(e.target.parentNode))
            hoveredDiv = e.target.parentNode
        else if([...this.children].includes(e.target.parentNode.parentNode)){
                hoveredDiv = e.target.parentNode.parentNode;}
    }
    if(hoveredDiv!==this.children[this.children.length-1])
        hoveredDiv.classList.add("hover");
}

function backHandler(){
    document.getElementById("contact-div").remove();
    document.body.appendChild(form);
    datalist = document.createElement("datalist");
    datalist.id = "supplier-names";
    form.querySelector("datalist").replaceWith(datalist);
    init(datalist);
    form.querySelector("input").value = "";
    form.querySelector("input").focus();
    form.addEventListener("submit",formSubmitHandler)
}

function updateSupplierDB(e){
    if(e.target.textContent!=="Back")//Save to Supplier DB
        ipcRenderer.send("update-supplier-db",suppliers[0]);
    backHandler();
}

ipcRenderer.on("new-number",(e,phone)=>{
    let p = document.createElement("p");
    p.textContent = ", " + phone;
    plusBTN.before(p);
    let {phones} = suppliers[0].getAllData();
    phones = JSON.parse(phones);
    phones.push(phone);
    phones = JSON.stringify(phones);
    suppliers[0].phones = phones;
    document.getElementById("back-done-btn").textContent = "Save & Back";
})

async function formSubmitHandler(e){
    e.preventDefault();
    let selectedSupplier = e.target["supplier-names"].value;
    let moreInfo = suppliers.map(supplier=>{
        selectedSupplier = supplier.getDetail(selectedSupplier,selectedSupplier);
        if(selectedSupplier)
            return {
                id:selectedSupplier.id,
                info:function(id){return ipcRenderer.invoke("get-more-info-supplier",id)},
                selectedSupplier
            };
        else{
            selectedSupplier = e.target["supplier-names"].value;
            return;
        }
    }).filter(entry=>entry!==undefined).pop();
    const {dataValues} = await moreInfo.info(moreInfo.id)
    if(dataValues){
        moreInfo.selectedSupplier.setDetail(dataValues);
        suppliers = suppliers.filter(supplier=>supplier === moreInfo.selectedSupplier);
        let {name,gst,address,phones,comment} = suppliers[0].getAllData();
        phones = JSON.parse(phones);
        let contactDiv = document.createElement("div");
        contactDiv.innerHTML = `
                            <div>
                                <p>Name: </p>
                                <p>${name}</p>
                                <div class="edit-btn-div">
                                    <button onclick="editBTNClick(event)">Edit</button>
                                </div>
                            </div>
                            <div>
                                <p>GST Number: </p>
                                <p>${gst}</p>
                                <div class="edit-btn-div">
                                    <button onclick="editBTNClick(event)">Edit</button>
                                </div>
                            </div>
                            <div>
                                <p>Contact Numbers: </p>
                                <div>
                                    ${phones.map(phone=>`<p>${phone}</p>`)}
                                    <button contenteditable="false" onclick="addNumber(event)">+</button>
                                </div>
                                <div class="edit-btn-div">
                                    <button onclick="editBTNClick(event)">Edit</button>
                                </div>
                            </div>
                            <div>
                                <p>Address: </p>
                                <p>${address}</p>
                                <div class="edit-btn-div">
                                    <button onclick="editBTNClick(event)">Edit</button>
                                </div>
                            </div>
                            <div>
                                <p>Comment: </p>
                                <p>${comment}</p>
                                <div class="edit-btn-div">
                                    <button onclick="editBTNClick(event)">Edit</button>
                                </div>
                            </div>
                            <div>
                                <button id="back-done-btn" onclick="updateSupplierDB(event)">Back</button>
                            </div>
        `;
        contactDiv.id = "contact-div";
        contactDiv.addEventListener("mouseover",hoverToggler.bind(contactDiv))
        contactDiv.addEventListener("mouseout",e=>{
            if(e.target===contactDiv)
                [...contactDiv.children].forEach(elem=>elem.classList.remove("hover"));
        });
        form.removeEventListener("submit",formSubmitHandler);
        form.replaceWith(contactDiv)
    }
}

form.addEventListener("submit",formSubmitHandler);

ipcRenderer.on("update-supplier-detail-done",(e,{field,value})=>{
    let contactDiv = document.querySelector("#contact-div");
    let {index,id} = fieldmap[field];
    let hoveredDiv = contactDiv.children[index];
    value = JSON.parse(value);
    if(id!=="phones"){
        value = value[0];
        let p = document.createElement("p");
        p.textContent = value;
        hoveredDiv.children[1].replaceWith(p);
        suppliers[0][id] = value;
    } else {
        hoveredDiv.children[1].innerHTML = `${value.map(data=>`&nbsp;<p>${data}</p>`)}
                                            <button contenteditable="false" onclick="addNumber(event)">+</button>
                                            `;
        suppliers[0][id] = JSON.stringify(value);
    }
    document.getElementById("back-done-btn").textContent = "Save & Back";
})