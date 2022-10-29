const { toggleDevTool } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

function handleForm(e){
    let form = e.target;
    
}

function clickHandler(e){
    let { target:{dataset:{cmd}} } = e;
    console.log({cmd});
}

ipcRenderer.on("first-launch",()=>{
    console.log("first-launch")
    let introductoryDiv = document.getElementById("introductory-template").content.cloneNode(true).querySelector("div");
    document.body.appendChild(introductoryDiv);
});