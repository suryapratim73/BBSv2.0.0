const { validateInput,validateInput2,toggleDevTool,createModal,closeModal,removeAllElem, drawSpinner } = require("../js/common");
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
        tbody.appendChild(bodyRow);
        bodyRow.querySelector("p").textContent = i + 1;
        for(let key in empObj){
            if(typeof empObj[key]==="object")
                Object.keys(empObj[key])
                .map(key=>typeof key==="object")
                .forEach(key=>{
                    if(key==="attendance"){

                    }
                    else
                    if(key==="payHistory"){

                    }
                })
            else{
                let p = bodyRow.querySelector(`[data-colname='${key}']`);
                if(p)
                    p.textContent = empObj[key];
            }
            bodyRow.dataset[key] = typeof empObj[key]==="object" ? JSON.stringify(empObj[key]) : empObj[key];
        }        
    })
    spinner.remove(window);
}
initPage();

document.querySelector("nav").addEventListener("click",function(e){
    let btn = e.target;
    if(btn.dataset.cmd==="addEmployee"){
        let modal = createModal("new-employee-modal");
        let modalForm = document.getElementById("new-employee-template").content.cloneNode(true).querySelector("form");
        modal.appendChild(modalForm);
        document.body.appendChild(modal)
    }
});

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