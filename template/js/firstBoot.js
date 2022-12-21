const { toggleDevTool,chooseFile, removeAllElem,showToastNotification, appendToDL, validateInput, validateInput2 } = require("../js/common");
const { ipcRenderer } = require("electron");
const fs = require("fs");


toggleDevTool(document);
let modeHost = document.getElementById("mode-host"),pageWiseData = {},dbInitialized = false;

ipcRenderer.invoke("get-policy")
.then(policyObj=>{
    if("wallpaper" in policyObj && policyObj.wallpaper!==""){
        if(fs.existsSync(policyObj.wallpaper))
            document.body.style.backgroundImage =  `url('${policyObj.wallpaper}')`;
        else
            document.body.style.backgroundImage =  `url("../../images/default-wallpaper.svg")`;    
    }
    else
        document.body.style.backgroundImage =  `url("../../images/default-wallpaper.svg")`;
});

function page4Common(){
    
}

async function saveToDB(e,pageNo){
    let form = e.target.nodeName==="FORM" ? e.target : document.querySelector("form");
    let data = Object.fromEntries(new FormData(form).entries());
    pageWiseData[pageNo] = data;
    if(pageNo===3){
        pageWiseData[3].isSaved = true;
        if(!("name" in data)) return;
        if(data.name.toLowerCase().trim()==="admin") return alert("Cannot use a system reserved name as username.")
        if(data.passwd !== data["re-passwd"]){
            document.getElementById("re-passwd").focus()
            return alert("Password entered doesn't match.")
        }
        await ipcRenderer.invoke("add-user",data);
        cancelUsrAddComm();
    }
    else
    if(pageNo===3 && !dbInitialized){
        dbInitialized = await ipcRenderer.invoke("db-init-status");
        if(dbInitialized) return saveToDB(e,pageNo);
    }
    else // For page 1,2,4
        ipcRenderer.invoke("save-settings",{pageNo,data})
        .then(isSaved=>{
            pageWiseData[pageNo].isSaved = isSaved;
            if(isSaved)
                showToastNotification("Data saved","first-boot-toast");
            else
                showToastNotification("Database is not initialized yet.","first-boot-toast");
            if(pageNo===4)
                Object.keys(pageWiseData)
                .forEach(page=>{
                    if(!("isSaved" in pageWiseData[page]))
                        ipcRenderer.invoke("save-settings",{pageNo:page,data:pageWiseData[page]});
                });
        });
}

ipcRenderer.on("save-settings",()=>{
    ipcRenderer.send("write-settings",pageWiseData);
    ipcRenderer.send("first-load");
});

function restoreFormData(pageNo){
    if(!(pageNo in pageWiseData)) return;
    let form = document.querySelector("form");
    let data = pageWiseData[pageNo];
    Object.keys(data)
    .forEach(key=>{
        form[key].value = data[key];
    });
}

function cancelUsrAddComm(){
    removeAllElem("#create-user-form");
    document.querySelector("#page-3-host [data-cmd='create-user']").classList.remove("hide");
    [...document.querySelectorAll("form button")]
    .forEach(btn=>{
        btn.removeAttribute("disabled");
    });
}

function submitHandler(e){
    e.preventDefault();
    let allowedNodeNames = ["BUTTON","FORM"];
    let { target:{dataset:{cmd},nodeName},type } = e;
    if(!allowedNodeNames.includes(nodeName)) return;
    if(cmd.startsWith("page")){
        let pageNo = Number(cmd.split("-")[1]);
        if(type==="submit"){
            saveToDB(e,pageNo);
            pageNo += pageNo<4 ? 1 : 0;
        }
        document.querySelector("form").dataset.cmd = `page-${pageNo}`;
        removeAllElem("#mode-host .page")
        let content = document.getElementById(`page-${pageNo}-template`).content.cloneNode(true).querySelector("div");
        modeHost.appendChild(content);
        restoreFormData(pageNo);
    }
    else
    if(cmd==="skip"){
        ipcRenderer.send("first-load");
    }
    else
    if(cmd==="create-user"){
        e.target.classList.add("hide");
        [...document.querySelectorAll("form button")]
        .forEach(btn=>{
            btn.setAttribute("disabled",true);
        });
        let host = document.getElementById("page-3-host");
        let content = document.getElementById(cmd+"-template").content.cloneNode(true).querySelector("div");
        host.appendChild(content);
    }
    else
    if(cmd==="cancel-user-add")
        cancelUsrAddComm();
    else
    if(cmd==="add-user"){
        saveToDB(e,3);
    }
}

ipcRenderer.on("first-launch",async ()=>{
    console.log("first-launch");
    dbInitialized = await ipcRenderer.invoke("db-init-status");
    let introductoryDiv = document.getElementById("page-1-template").content.cloneNode(true).querySelector("div");
    modeHost.appendChild(introductoryDiv);
    let dl = document.createElement("datalist");
    dl.id = "user-list";
    appendToDL("get-users",dl);
});

ipcRenderer.on("Database initialized",()=>{
    dbInitialized = true;
});

window.addEventListener("keypress",e=>{
    if(e.key==="Enter"){
        e.preventDefault();
        document.querySelector("form button[type='submit']").click();
    }
});