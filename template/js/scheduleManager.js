const { ipcRenderer } = require("electron");
const { toggleDevTool, drawSpinner, capitalize, applySpinner, noDataPlaceholder, bodyRowInpFillup, bodyRow, tableFillupHelper, removeAllElem, appendToHost, applyTheme } = require("../js/common");


toggleDevTool(document);

let currentStep = 1;

async function init(){
    removeAllElem(".page");
    appendToHost(`#page-${currentStep}-template`,document.body,"div");
    let schedules = await ipcRenderer.invoke("get-chedules");
    let orderTbody = document.querySelector("#page-1 .tbody");
    if(schedules.length===0) return noDataPlaceholder(orderTbody);
    tableFillupHelper(schedules,"#page-1 .row.head .col>p","#page-1 .tbody",bodyRow);
}

applySpinner(async ()=>{
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
    init();
});

function clickHandler(e){
    if(!("cmd" in e.target.dataset) && !(e.path.find(elem=>elem.classList?.contains("tbody")))) return;
    let { cmd } = (e.path?.find(elem=>elem.classList?.contains("tbody")) ?? e.target).dataset;
    if(cmd==="open-event"){
        currentStep = 2;
        removeAllElem(".page");
        appendToHost(`#page-${currentStep}-template`,document.body,"div");
        let evObj = JSON.parse(e.path.find(elem=>elem.classList.contains("body") && elem.classList.contains("row")).dataset.obj);
        Object.keys(evObj)
        .forEach(key=>{
            if(["id","user","color"].includes(key)) return;
            let child = appendToHost("#event-key-value-template","#page-2 #host","div");
            child.querySelector("[data-name='key']").textContent = capitalize(key);
            child.querySelector("[data-name='value']").textContent = evObj[key];
        })
        document.querySelector(`#page-2 button[data-cmd="edit"]`).dataset.obj = JSON.stringify(evObj);
        document.querySelector(`#page-2 button[data-cmd="remove"]`).dataset.id = evObj.id;
    }
    else
    if(cmd==="edit"){
        let evObj = JSON.parse(e.target.dataset.obj);
        currentStep = 3;
        removeAllElem(".page");
        let form = appendToHost(`#page-${currentStep}-template`,document.body,"form");
        [...form.querySelectorAll("input")]
        .forEach(input=>input.value=evObj[input.name]);
        form.dataset.obj = JSON.stringify(evObj);
    }
    else
    if(cmd==="remove"){
        ipcRenderer.send("manage-schedule",e.target.dataset.id,"r");
        clickHandler({target:{dataset:{cmd:"page-1"}}});
    }
    else
    if(cmd==="page-1"){
        applySpinner(()=>{
            currentStep = 1;
            init();
        });
    }
}

function submitHandler(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    let evObj = JSON.parse(e.target.dataset.obj);
    data = {
        ...evObj,
        ...data
    }
    ipcRenderer.send("manage-schedule",data,"e");
    clickHandler({target:{dataset:{cmd:"page-1"}}});
}