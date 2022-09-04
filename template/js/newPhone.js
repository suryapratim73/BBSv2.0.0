const { ipcRenderer } = require("electron");
const { toggleDevTool,validateInput, applyTheme } = require("../js/common.js");
toggleDevTool(document);

let form = document.querySelector("form");

form.addEventListener("submit",e=>{
    e.preventDefault();
    ipcRenderer.send("new-number-supplier",e.target["new-number"].value)
});

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

document.querySelector("input").focus();