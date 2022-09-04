const { validateInput, validateInput2, toggleDevTool,createModal,closeModal,removeAllElem, drawSpinner, retractHandler, capitalize, makeKey, initSearchHandler, scrollSymSet, applyTheme } = require("../js/common");
const { ipcRenderer } = require("electron");
const uuid = require("uuid");


toggleDevTool(document);

async function initPage(){
    let spinner = drawSpinner(document);
    let page1 = document.getElementById("page1-template").content.cloneNode(true).querySelector("div");
    removeAllElem(".page1");
    let tbody = page1.querySelector(".tbody");
    document.querySelector("main").appendChild(page1);
    let bodyRowTem = document.getElementById("body-row-template");
    (await ipcRenderer.invoke("get-own-employees"))
    .forEach((empObj,i)=>{
        let bodyRow = bodyRowTem.content.cloneNode(true).querySelector("div");
        let attendedDays = empObj.moreInfo.attendance.filter(({presence})=>presence===1).length;
        tbody.appendChild(bodyRow);
        bodyRow.querySelector("p").textContent = i + 1;
        for(let key in empObj){
            if(typeof empObj[key]==="object"){
                for(let i in empObj[key]){
                    if(i==="attendance")
                        bodyRow.querySelector(`[data-colname="attendance"]`).textContent = attendedDays;
                    else
                    if(i==="payHistory"){
                        let date = empObj.moreInfo.payHistory.length>0 ? new Date(empObj.moreInfo.payHistory.pop().date).toLocaleDateString("en-GB") : "Unpaid";
                        bodyRow.querySelector(`[data-colname="payDate"]`).textContent = date;
                    }
                }
            }
            else{
                let p = bodyRow.querySelector(`[data-colname='${key}']`);
                if(p)
                    p.textContent = empObj[key];
            }
            bodyRow.dataset[key] = typeof empObj[key]==="object" ? JSON.stringify(empObj[key]) : empObj[key];
        }        
    });
    tbody.removeEventListener("click",tbodyClickHandler);
    tbody.addEventListener("click",tbodyClickHandler);
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    spinner.remove(window);
    closeModal();
}
initPage();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

let bodyRow,updateFlag;

document.querySelector("nav").addEventListener("click",navListener);

function navListener(e){
    let btn = e.target;
    if(btn.dataset.cmd==="addEmployee"){
        let modal = createModal("new-employee-modal");
        let modalForm = document.getElementById("new-employee-template").content.cloneNode(true).querySelector("form");
        modal.appendChild(modalForm);
        document.body.appendChild(modal)
    }
    else
    if(btn.dataset.cmd==="take-attendance")
        ipcRenderer.send("take-attendance");
    else
    if(btn.dataset.cmd==="add-payment")
        ipcRenderer.send("open-salary-modal");
}

function assignValToRow(newRowTem,modal,key,obj){
    let div = newRowTem.content.cloneNode(true).querySelector("div");
    div.querySelector("p").textContent = capitalize(key);
    div.querySelector("input").value = obj[key];
    div.querySelector("input").dataset.key = key;
    modal.querySelector("div:nth-child(2)").appendChild(div);
}

function tbodyClickHandler(e){
    bodyRow = e.target.parentNode;
    updateFlag = false;
    let empObj = {...bodyRow.dataset};
    let modal = createModal("emp-modal",true);
    let page1 = document.getElementById("employee-modal-template").content.cloneNode(true).querySelector("div");
    modal.appendChild(page1);
    let newRowTem = document.getElementById("new-row-template");
    for(let key in empObj){
        if(["id","relation"].includes(key)) continue;
        if(key!=="moreInfo")
            assignValToRow(newRowTem,modal,key,empObj)
        else{
            let moreInfo = JSON.parse(empObj.moreInfo);
            for(let key in moreInfo){
                if(!["payHistory","attendance"].includes(key))
                    assignValToRow(newRowTem,modal,key,moreInfo);
            }
        }
    }
}

function newEmployee(e){
    e.preventDefault();
    let empObj = {};
    [...e.target.querySelectorAll("input")]
    .forEach(input=>{
        if(input.name==="name")
            empObj.id = uuid.v5(input.value+"_employee","6ba7b814-9dad-11d1-80b4-00c04fd430c8");
        empObj[input.name] = input.value;
    });
    ipcRenderer.send("new-employee",empObj);
}

ipcRenderer.on("new-employee-response",()=>{
    closeModal();
    initPage();
});

function addNewRow(e){
    let page1Form = e.target.parentNode.parentNode;
    page1Form.classList.add("hide");
    removeAllElem(".page2-elem");
    let page2Form = document.getElementById("new-emp-form-page2-template").content.cloneNode(true).querySelector("form");
    document.getElementById("new-employee-modal").appendChild(page2Form);
}

function newFeildToNewEmp(e){
    e.preventDefault();
    let page2Form = e.target;
    let page1Form = document.querySelector("form.page1-elem");
    let btnDiv = document.getElementById("add-feild").parentNode;
    let div = document.createElement("div");
    div.innerHTML = `
        <div>
            <label>${page2Form.key.value}</label>
        </div>
        <div>
            <input type="text" name="${makeKey(page2Form.key.value)}" value="${page2Form.val.value}">
        </div>
    `;
    removeAllElem(".page2-elem");
    btnDiv.before(div);
    page1Form.classList.remove("hide");
}

function showPage1(e){
    removeAllElem(".page2-elem");
    document.querySelector("#new-employee-modal form").classList.remove("hide");
}

function getBodyRow(){
    return {bodyRow,initPage}
}

ipcRenderer.on("attendance-registered",initPage);

function searchHandler(e){
    const {bodyRows,searchText} = initSearchHandler(e);
    let i = 1;
    bodyRows.forEach(bodyRow=>{
        if(Object.values({...bodyRow.dataset}).some(val=>new RegExp(searchText,"i").test(val))){
            bodyRow.classList.remove("hide");
            bodyRow.querySelector("p").textContent = i++;
        }
    })
}

async function removeEmployee(){
    let {id} = {...bodyRow.dataset}
    ipcRenderer.invoke("fire-employee",id)
    .then(initPage)
    .catch(()=>{
        console.log("You don't have enough permission")
    })
}

async function _closeModal(){
    if(updateFlag){
        let empObj = [...document.querySelectorAll(".page1 input")]
        .reduce((acc,input)=>{
            acc[input.dataset.key] = input.value;
            return acc;
        },{});
        empObj.id = bodyRow.dataset.id;
        await ipcRenderer.invoke("update-employee",empObj);
        initPage()
    }
    else
        return closeModal();
}

function updateEmployee(){
    updateFlag = true;
    [...document.querySelectorAll("input")]
    .forEach(input=>input.removeAttribute("disabled"));
    document.querySelector(".page1 button:first-child").textContent = "Update";
}