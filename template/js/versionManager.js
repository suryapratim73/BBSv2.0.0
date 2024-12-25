const { toggleDevTool, noDataPlaceholder, appendToHost, removeAllElem } = require("../js/common");
const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

toggleDevTool(document);

let main = document.querySelector("main");

ipcRenderer.send("get-version-contents");

ipcRenderer.on("get-version-contents-response",(e,preVersions,currentVersion)=>{
    let select = document.getElementById("version-list");
    preVersions = preVersions.filter(({appVersion})=>appVersion!==currentVersion);
    if(preVersions.length===0)
        return noDataPlaceholder(main);
    preVersions.forEach((versionObj,i)=>{
        let { appVersion } = versionObj;
        let option = document.createElement("option");
        select.appendChild(option);
        option.value = appVersion;
        option.textContent = appVersion;
        option.dataset.versionObj = JSON.stringify(versionObj);
        option.dataset.currentVersion = currentVersion;
        if(i===0)
            option.setAttribute("selected",true);
    });
    initMainDiv();
});

function initMainDiv(e){
    let option = typeof e!=="undefined" ? e.target.options[e.target.options.selectedIndex] : document.querySelector("#version-list>option");
    let versionObj = JSON.parse(option.dataset.versionObj);
    removeAllElem("#version-details");
    let mainContentDiv = appendToHost("#version-details-template",main,"DIV");
    mainContentDiv.querySelector("h2").textContent = "Selected version: "+versionObj.appVersion;
    let ul = mainContentDiv.querySelector("ul");
    versionObj.changelog.highlights.forEach(text=>{
        let li = document.createElement("li");
        li.textContent = text;
        ul.appendChild(li);
    });
    document.querySelector('#ctrl-btn').dataset.versionObj = JSON.stringify(versionObj);
}

async function btnCtrl(e){
    let btn = e.target;
    let cmd = btn.dataset.cmd;
    let appPath = await ipcRenderer.invoke("get-app-path");
    let versionObj = JSON.parse(btn.parentNode.dataset?.versionObj ?? "{}");
    if(cmd==="restore"){
        let appVersion = versionObj.appVersion;
        if(fs.existsSync(path.resolve(appPath,"./Backup/version_"+appVersion)))
            ipcRenderer.send("btn-ctrl-backend",cmd,versionObj);
    }
    else
    if(cmd==="open-folder")
        ipcRenderer.send("btn-ctrl-backend",cmd,versionObj);
    else
    if(cmd==="delete-version")
        ipcRenderer.send("btn-ctrl-backend",cmd,versionObj);
}
// changelog,
// fileName,
// installDate,
// installerLoc,
// lastInstalledVersion,
// platform,
// releaseDate