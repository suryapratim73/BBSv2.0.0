const { validateInput, toggleDevTool, scrollSymSet, drawSpinner, removeAllElem, createModal, closeModal, applyTheme } = require("../js/common");
const { ipcRenderer } = require("electron");
const uuid = require("uuid");


toggleDevTool(document);

let tbody = document.querySelector(".tbody"),
    currentPage = 1;

async function init(){
    let spinner = drawSpinner(document);
    removeAllElem(".body.row");
    let services = (await ipcRenderer.invoke("get-services"));
    if(services.length===0){
        tbody.classList.add("no-elem");
    }
    else{
        tbody.classList.remove("no-elem")
        services.forEach((servObj,index)=>{
            let bodyRow = document.getElementById("body-row-template").content.cloneNode(true).querySelector("div");
            bodyRow.querySelector("p").textContent = index + 1;
            for(let key in servObj){
                let p = bodyRow.querySelector(`[data-colname="${key}"]`);
                if(p)
                    p.textContent = servObj[key];
                bodyRow.dataset[key] = typeof servObj[key]==="object"?JSON.stringify(servObj[key]):servObj[key];
            }
            tbody.appendChild(bodyRow);
        });
    }
    if(tbody.scrollHeight>tbody.clientHeight)
        scrollSymSet(tbody);
    spinner.remove(window);
    currentPage = 1;
    showPage();
    showOrHideNavBTN();
}
init();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function showPage(){
    [...document.querySelectorAll(".page")].forEach(page=>{
        if(page.classList.contains(`page${currentPage}-elem`))
            page.classList.remove("hide");
        else
            page.classList.add("hide");
    });
}

function showOrHideNavBTN(){
    [...document.querySelectorAll("nav *")]
        .forEach(elem=>{
            if(elem.classList.contains(`page${currentPage}-elem`))
                elem.classList.remove("hide");
            else
                elem.classList.add("hide");
        })
}

document.querySelector("nav").addEventListener("click",e=>{
    let { cmd } = e.target.dataset;
    if(cmd==="new-service"){
        let modal = createModal("new-service-modal");
        let temp = document.getElementById("service-registor-modal-template").content.cloneNode(true);
        modal.appendChild(temp);
        modal.dataset.modalpage = 1;
    }
    else{
        removeAllElem("main .page2-elem");
        init();
    }
});

function addFeild(e){
    let modal = document.querySelector(".modal");
    let temp = document.getElementById("add-feild-template").content.cloneNode(true).querySelector("form");
    modal.dataset.modalpage = 2;
    modal.querySelector(".page1").classList.add("hide");
    removeAllElem(".page2");
    modal.appendChild(temp);
}

function closeAddFeild(e){
    let modal = document.querySelector(".modal");
    removeAllElem(".page2");
    modal.querySelector(".page1").classList.remove("hide");
}

function addNewFeild(e){
    e.preventDefault();
    let form = e.target;
    let secondLastDiv = document.querySelector(".modal .page1>div:nth-last-child(2)");
    secondLastDiv.dataset[form.key.value] = form.val.value;
    let newObj = {key:form.key.value,val:form.val.value};
    closeAddFeild();
    document.querySelector(".modal #more-feild-div").classList.add("hide");
    let moreFeildDiv = secondLastDiv.querySelector("#more-feild-div");
    secondLastDiv.querySelector("#more-feild-menu").classList.remove("hide");
    let temp = document.getElementById("feild-template").content.cloneNode(true).querySelector("div");
    moreFeildDiv.appendChild(temp);
    Object.keys(newObj).forEach(key=>{
        temp.querySelector(`[data-colname="${key}"]`).textContent = newObj[key];
    });
}

function showOrHideFeildDiv(e){
    if(["INPUT","P"].includes(e.target.nodeName)) return;
    document.querySelector("#more-feild-div").classList.toggle("hide");
}

function addNewService(e){
    e.preventDefault();
    let form = e.target;
    let servObj = ["name","rate","unit","hsn"].reduce((acc,key)=>({...acc,[key]:form[key].value}),{});
    let secondLastDiv = document.querySelector(".modal form>div:nth-last-child(2)");
    servObj = {
        ...servObj,
        pInfo: {...secondLastDiv.dataset},
        id: uuid.v5(servObj.name,"6ba7b814-9dad-11d1-80b4-00c04fd430c8")
    }
    closeModal();
    ipcRenderer.send("add-new-service",servObj);
}

ipcRenderer.on("db-process-done",init);

tbody.addEventListener("click",function(e){
    let bodyRow = e.target.parentNode;
    let dataObjs = {...bodyRow.dataset};
    currentPage = 2;
    let main = document.querySelector("main");
    main.querySelector(".page").classList.add("hide");
    let page2 = document.getElementById("page2-template").content.cloneNode(true).querySelector("div");
    main.appendChild(page2);
    Object.keys(dataObjs)
    .forEach(key=>{
        let input = main.querySelector(`.page2-elem [data-colname="${key}"]`);
        if(input)
            input.value = dataObjs[key];
        if(key==="pInfo"){
            let pInfo = JSON.parse(dataObjs[key]);
            let keys = Object.keys(pInfo);
            if(keys.length>0){
                let moreFeildMenu = main.querySelector("#more-feild-menu");
                moreFeildMenu.classList.remove("hide");
                keys.forEach(key=>{
                    let div = document.createElement("div");
                    moreFeildMenu.querySelector("#more-feild-div").appendChild(div);
                    div.innerHTML = `
                        <p>${key}</p>
                        <input type="text" disabled value="${pInfo[key]}" />
                    `;
                })
            }
        }
    });
    showOrHideNavBTN();
    page2.querySelector("div:first-child").dataset.id = dataObjs.id;
    // Populate right section ** Work need to be done here **
});

function enableBTNs(e){
    let mode = e.target.dataset.mode;
    [...document.querySelectorAll(".btn-container button")]
    .forEach(btn=>{
        btn.classList.toggle("hide");
    });
    [...document.querySelectorAll(".page2-elem input")]
    .forEach(input=>{
        if(mode==="1")
            input.removeAttribute("disabled");
        else
            input.setAttribute("disabled","disabled");
    });
    if(mode==="save"){
        let servObj = {};
        [...document.querySelectorAll(".page2-elem input[data-colname]")]
        .forEach(input=>{
            servObj[input.dataset.colname] = input.value;
        });
        servObj.id = document.querySelector(".page2-elem>div:first-child").dataset.id;
        servObj.pInfo = {};
        [...document.querySelectorAll("#more-feild-div>div")]
        .forEach(div=>{
            let key = div.querySelector("p").textContent;
            let val = div.querySelector("input").value;
            servObj.pInfo[key] = val;
        });
        ipcRenderer.send("update-service",servObj);
    }
}