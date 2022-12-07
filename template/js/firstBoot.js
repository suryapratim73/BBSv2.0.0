const { toggleDevTool } = require("../js/common");
const { ipcRenderer } = require("electron");
const fs = require("fs");


toggleDevTool(document);
let modeHost = document.getElementById("mode-host");

ipcRenderer.invoke("get-policy")
.then(policyObj=>{
    if("wallpaper" in policyObj && policyObj.wallpaper!==""){
        if(fs.existsSync(policyObj.wallpaper))
            document.body.style.backgroundImage =  `url('${policyObj.wallpaper}')`;
        else
            document.body.style.backgroundImage =  `url("../../images/default-wallpaper.jpg")`;    
    }
    else
        document.body.style.backgroundImage =  `url("../../images/default-wallpaper.jpg")`;
});

function submitHandler(e){
    e.preventDefault();
    let allowedNodeNames = ["BUTTON","FORM"];
    let { target:{dataset:{cmd},nodeName},type } = e;
    if(!allowedNodeNames.includes(nodeName)) return;
    if(cmd.startsWith("page")){
        let pageNo = Number(cmd.split("-")[1]);
        let page = [...document.querySelectorAll("#mode-host .page")]
        .map(page=>{
            if(page.id!==cmd)
                page.classList.add("hide");
            else{
                page.classList.remove("hide");
                return page;
            }
        }).filter(page=>page!==undefined);
        if(page.length===0){
            let content = document.getElementById(cmd+"-template").content.cloneNode(true).querySelector("div");
            modeHost.appendChild(content);
        }
        if(type==="submit"){
            pageNo += pageNo<4 ? 1 : 0;
            e.target.dataset.cmd = `page-${pageNo}`;    
        }
        else{
            pageNo = Number(cmd.split("-")[1])+1;
            e.target.form.dataset.cmd = `page-${pageNo}`;
        }
    }
}

ipcRenderer.on("first-launch",()=>{
    console.log("first-launch")
    let introductoryDiv = document.getElementById("page-1-template").content.cloneNode(true).querySelector("div");
    modeHost.appendChild(introductoryDiv);
});