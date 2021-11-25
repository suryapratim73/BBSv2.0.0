const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput, drawSpinner} = require("../js/common");
const {noReturn} = require("../../config/policy.json");


toggleDevTool(document);

let customerObjs = [],
    supplierObjs = [],
    selectedCustomer,
    selectedSupplier,
    dateFeild = document.querySelector("#date"),
    suppDateFeild = document.querySelector("#supp-date"),
    langSet = [
        {value:1,word:"one" },
        {value:2,word:"two" },
        {value:3,word:"three" },
        {value:4,word:"four" },
        {value:5,word:"five" },
        {value:6,word:"six" },
        {value:7,word:"seven" },
        {value:8,word:"eight" },
        {value:9,word:"nine" },
        {value:10,word:"ten" },
        {value:11,word:"eleven" },
        {value:12,word:"twelve" }
    ],
    page_2 = document.getElementById("page-2"),
    itemTable = document.getElementById("tbody"),
    returnObj = {},
    toggle = document.getElementById("toggle"),
    mode = 1;

returnObj.itemList = [];

async function initForm(mode){
    let spinner = drawSpinner(document);
    document.querySelectorAll(".ret-date").forEach(input=>input.valueAsDate = new Date());
    if(mode===1){
        returnObj.mode = 1;
        if(!document.getElementById("customer-name"))
            ipcRenderer.send("get-customer-names");
        document.getElementById("name").focus();
    }
    else{
        returnObj.mode = 2;
        if(!document.getElementById("supplier-name")){
            let suppliers = await ipcRenderer.invoke("get-supplier-names");
            let dl = document.createElement("datalist");
            dl.id = "supplier-name";
            suppliers.forEach(({name,id})=>{
                createOptions(name,id,dl);
                supplierObjs.push({name,id});
            });
            document.body.appendChild(dl);
        }
        document.getElementById("supp-name").focus();
    }
    spinner.remove(window);
}
initForm(mode);

function createOptions(name,id,dl){
    let option = document.createElement("option");
    option.value = name;
    option.dataset.custId = id;
    dl.appendChild(option);
}

document.querySelectorAll(".ret-date").forEach(input=>{
    input.addEventListener("change",function(){
        returnObj.retDate = this.value;
    });
})

returnObj.retDate = new Date();

function handleToggle(e){
    if(["dot","knob","slide","knob right-1rem"].includes(e.target.className)){
        let knob = document.querySelector(".knob");
        if(knob.classList.contains("right-1rem")){
            document.querySelector("[data-section='customer']>span").classList.add("highlight-2");
            document.querySelector("[data-section='supplier']>span").classList.remove("highlight-2");
            knob.classList.remove("right-1rem");
            document.getElementById("supplier-bill-div").classList.add("hide");
            document.getElementById("customer-bill-div").classList.remove("hide");
            mode = 1;
            initForm(mode);
        }
        else{
            document.querySelector("[data-section='customer']>span").classList.remove("highlight-2");
            document.querySelector("[data-section='supplier']>span").classList.add("highlight-2");
            knob.classList.add("right-1rem");
            document.getElementById("supplier-bill-div").classList.remove("hide");
            document.getElementById("customer-bill-div").classList.add("hide");
            mode = 2;
            initForm(mode);
        }
    }
}

page_2.addEventListener("click",function(e){
    if(e.target.dataset.cmd==="delete-row"){
        let targetRow = e.target.parentNode.previousSibling;
        let targetInput = targetRow.querySelector("input");
        let name = targetInput.value;
        targetInput.list.querySelector(`[value='${name}']`).removeAttribute("disabled");
        returnObj.itemList = returnObj.itemList.filter(itemObj=>itemObj.name!==name);
        targetRow.remove();
        [...document.querySelectorAll(".body.row>p:first-child")].forEach((p,index)=>{
            p.textContent = index + 1;
        });
        return document.getElementById("option-div")?.remove();
    }
    document.getElementById("option-div")?.remove();
    if(e.target.dataset.cmd==="add-item" && document.getElementById("item-list").children.length>[...document.querySelectorAll(".itemName")].length){
        [...document.querySelectorAll(".itemName")].forEach(input=>{
            let name = input.value;
            input.list.querySelector(`[value='${name}']`).setAttribute("disabled","disabled");
        });
        let slNo = [...document.querySelectorAll(".body.row")].length + 1;
        itemTable.appendChild(getBodyRow(slNo));
        ([...document.querySelectorAll(".itemName")].pop()).focus();
    }
    else
    if(e.target.dataset.cmd==="add-item" && document.getElementById("item-list").children.length===[...document.querySelectorAll(".itemName")].length)
        return alert("Return item count cannot be greater than the purchased item count.");
    if(e.target.dataset.cmd==="confirm-return")
        ipcRenderer.send(`${mode===2?"supp-":""}return-obj`,returnObj);
    if(e.target.parentNode.className==="row body")
        e.target.parentNode.after(showOptionsDiv());
    if(e.target.dataset.cmd==="back"){
        page_2.classList.add("hide");
        [...page_2.querySelectorAll(".body.row")].forEach(div=>div.remove());
        let divId = mode===1?"customer-bill-div":"supplier-bill-div"
        document.getElementById(divId).classList.remove("hide");
        document.getElementById("toggle").classList.remove("hide");
        initForm(mode);
        returnObj = {itemList:[]};
        document.querySelector(`#${divId} #${mode===2?"supp-":""}name`).removeAttribute("disabled");
        document.querySelector(`#${divId} #${mode===2?"supp-":""}name`).focus();
        document.querySelector(`#${divId} #${mode===2?"supp-":""}name`).value = "";
        document.querySelector(`#${divId} #${mode===2?"supp-":""}date`).removeAttribute("disabled");
        document.querySelector(`#${divId} #${mode===2?"supp-":""}date`).value = "";
        document.querySelector(`#${divId} #${mode===2?"supp-":""}billNo`).removeAttribute("disabled");
        document.querySelector(`#${divId} #${mode===2?"supp-":""}billNo`).value = "";

    }
});

ipcRenderer.on("customer-names",(e,customerNames)=>{
    let dl = document.createElement("datalist");
    dl.id = "customer-name";
    customerNames.forEach(({name,id})=>{
        createOptions(name,id,dl);
        customerObjs.push({name,id});
    });
    document.body.appendChild(dl);
});

function searchHandler(e){
    let text = e.target.value;
    let startDate,endDate;
    if(e.target.name==="name" && mode===1){
        selectedCustomer = customerObjs.find(({name})=>text===name);
        if(!selectedCustomer) return;
        e.target.setAttribute("disabled","disabled")
        dateFeild.removeAttribute("disabled");
        dateFeild.focus();
    }// Set selected customer
    else
    if(e.target.name==="name" && mode===2){
        selectedSupplier = supplierObjs.find(({name})=>text===name);
        if(!selectedSupplier) return;
        e.target.setAttribute("disabled","disabled")
        suppDateFeild.removeAttribute("disabled");
        suppDateFeild.focus();
    }
    else
    if(e.target.name==="date"){
        let textMatch = text.match(/(\d+.+\d)|(\d+.months?|\d+.weeks?|\d+.days?)/g)?.[0] ?? null;
        if(!textMatch){
            let replaceWord = [];
            text.split(/\b/g).forEach(_word=>{
                let match = langSet.find(({word})=>word===_word);
                if(match)
                    replaceWord.push({word:_word,replaceValue:match.value})
            });//Text to value conversion
            replaceWord.forEach(({word,replaceValue})=>{
                text = text.replace(word,replaceValue);
            });
            textMatch = text.match(/(\d+.+\d)|(\d+.months?|\d+.weeks?|\d+.days?)/g)?.[0] ?? null;            
            if(!textMatch)
                return document.getElementById("billNo").setAttribute("disabled","disabled");
            else
                text = textMatch;
        }
        else
            text = textMatch;
        // New condition starts
        if(/\//g.test(text)){
            let textArr = text.match(/[tobewnad\- ]+/gi) ? text.split(/[tobewnad\- ]+/gi):text;
            if(textArr?.length===2){
                [startDate,endDate] = textArr;
                const [stDay,stMnth,stYear=(new Date()).getFullYear()] = startDate.split("/");
                const [endDay,endMnth,endYear=(new Date()).getFullYear()] = endDate.split("/");
                startDate = new Date(stYear,+stMnth-1,stDay);
                endDate = new Date(endYear,+endMnth-1,endDay);
            }
            else{
                const [stDay=null,stMnth=null,stYear=(new Date()).getFullYear()] = textArr.split("/") ?? [];
                startDate = new Date(stYear,+stMnth-1,stDay);
                endDate = new Date();
            }
        }// dd/mm/yyyy pattern filter
        else{
            if(/months?/.test(text) && /\d+/.test(text)){
                let noMonths = Number(text.match(/\d+/)[0]);
                endDate = new Date();
                startDate = new Date(Date.now() - noMonths*30*24*60*60*1000);
                startDate.setDate(1);
            }
            else
            if(/weeks?/.test(text) && /\d+/.test(text)){
                let noDays = Number(text.match(/\d+/)[0])*7;
                endDate = new Date();
                startDate = new Date(Date.now() - noDays*24*60*60*1000);
            }
            else
            if(/days?/.test(text) && /\d+/.test(text)){
                let noDays = Number(text.match(/\d+/)[0]);
                endDate = new Date();
                startDate = new Date(Date.now() - noDays*24*60*60*1000);
            }
        }// 'X' month/week pattern filter
        let diff = Math.ceil((Math.abs(endDate - startDate))/(1000*60*60*24));
        if(!startDate || !endDate || startDate>endDate || !diff) return document.getElementById("billNo").setAttribute("disabled","disabled");
        if(diff>noReturn){
            if(mode===1)
                document.getElementById("billNo").setAttribute("disabled","disabled");
            return alert("Return not possible");
        }
        // console.log({diff,startDate,endDate});
        if(mode===1)
            ipcRenderer.send("get-bill-numbers",selectedCustomer.id,startDate,endDate);
        else
            ipcRenderer.send("get-supp-bill-numbers",selectedSupplier.id,startDate,endDate);
    }// set and find bill numbers in specified date range
}

function assignBillDate(e){
    let {value} = e.target;
    let {billDate} = e.target.list.querySelector(`[value="${value}"]`).dataset;
    e.target.dataset.billDate = billDate;
}

ipcRenderer.on("get-bill-numbers-response",(e,billNumbers)=>{
    document.getElementById("billNo-list")?.remove();
    let dl = document.createElement("datalist");
    dl.id = "billNo-list";
    billNumbers.forEach(({billNo,date})=>{
        let option = document.createElement("option");
        option.value = billNo;
        option.dataset.billDate = date;
        dl.appendChild(option);
    })
    document.body.appendChild(dl);
    let billNoFeild = document.querySelector(`#${mode===2?"supp-":""}billNo`);
    billNoFeild.removeAttribute("disabled");
    billNoFeild.focus();
});

function assignQtyRate(e){
    let {value} = e.target;
    let input = e.target;
    if(value.length===0){
        let itemNames = [...document.querySelectorAll(".itemName")].map(input=>input.value);
        returnObj.itemList = returnObj.itemList.filter(itemObj=>{
            if(itemNames.includes(itemObj.name))
                return true;
            else{
                input.list.querySelector(`[value='${itemObj.name}']`).removeAttribute("disabled");
                input.parentNode.querySelector("input:nth-child(4)").value = "";
                input.parentNode.querySelector("input:nth-child(3)").value = "";
                input.parentNode.querySelector("p:last-child").textContent = 0;
                return false;
            }
        });
    }
    let {quantity,rate} = input.list.querySelector(`[value='${value}']`)?.dataset ?? [null,null];
    if(!quantity || !rate) return;
    input.dataset.quantity = quantity;
    input.dataset.rate = rate;
    input.dataset.name = value;
    input.parentNode.querySelector("input:nth-child(3)").removeAttribute("disabled");
    input.parentNode.querySelector("input:nth-child(3)").focus();
    input.parentNode.querySelector("input:nth-child(4)").value = rate;
    returnObj.itemList.push({name:value,max_quantity:+quantity,rate:+rate});
}

function checkQty2(e){
    let qty = e.target.value;
    let {quantity,rate,name} = e.target.parentNode.querySelector("input:nth-child(2)")?.dataset;
    if(!quantity || !rate) return;
    if(+qty>+quantity){
        e.target.value = "";
        return alert("Return quantity cannot be greater than bought quantity!!")
    }
    else{
        e.target.parentNode.querySelector("p:last-child").textContent = Math.round(+qty * +rate);
        returnObj.itemList = returnObj.itemList.map((itemObj)=>{
            const {name:_name} = itemObj;
            if(_name===name)
                itemObj.qty = +qty;
            return itemObj;
        });
    }
}

function getBodyRow(slNo=1){
    let div = document.createElement("div");
    div.className = "row body";
    div.innerHTML = `
        <p class="col eq-space">${slNo}</p>
        <input class="itemName eq-space" type="text" list="item-list" onchange="assignQtyRate(event)" />
        <input class="eq-space" type="text" data-type="Number" disabled data-subtype="price" onkeypress="validateInput(event)" oninput="checkQty2(event)" />
        <input class="eq-space" type="text" disabled />
        <p class="col eq-space"></p>
    `;
    return div;
}

function handle_proceed(e){
    e.preventDefault();
    let billNo = e.target.billNo.value,
        {billDate} = e.target.billNo.dataset;
    returnObj.billMeta = {};
    if(!billNo) return alert("Please select a bill number");
    toggle.classList.add("hide");
    returnObj.billMeta.billNo = billNo;
    returnObj.id = mode===1?selectedCustomer.id:selectedSupplier.id;
    returnObj.billMeta.billDate = billDate;
    let billDiv = mode===1?document.getElementById("customer-bill-div"):document.getElementById("supplier-bill-div");
    billDiv.classList.add("animation-common");
    let id = mode===1?selectedCustomer.id:selectedSupplier.id;
    setTimeout(()=>{
        billDiv.classList.add("hide")
        page_2.classList.remove("hide");
        page_2.classList.add("move-up");
        ipcRenderer.send("get-bill-items",id,billNo,billDate,mode);
    },201);
}

function showOptionsDiv(){
    let div = document.createElement("div");
    div.id = "option-div";
    div.innerHTML = `<button data-cmd="delete-row">Delete row</button>`
    return div;
}

ipcRenderer.on("get-bill-items-response",(e,billItems)=>{
    let bodyRow = getBodyRow();
    itemTable.appendChild(bodyRow);
    ([...document.querySelectorAll(".itemName")].pop()).focus();
    document.getElementById("item-list")?.remove();
    let dl = document.createElement("datalist");
    dl.id = "item-list";
    billItems.forEach(({name,quantity,rate})=>{
        let option = document.createElement("option");
        option.value = name;
        option.dataset.quantity = quantity;
        option.dataset.rate = rate;
        dl.appendChild(option);
    })
    document.body.appendChild(dl);
});

document.addEventListener("keydown",(e)=>{
    if(e.ctrlKey && e.key==="+")
        document.querySelector('[data-cmd="add-item"]').click();
    else
    if(e.ctrlKey && e.key==="-")
        document.getElementById("option-div").click();
    else
    if(e.ctrlKey && e.key==="Enter")
        document.querySelector('[data-cmd="confirm-return"]').click();
    else
    if(e.ctrlKey && e.key==="Tab")
        document.querySelector("#toggle .dot").click();
});