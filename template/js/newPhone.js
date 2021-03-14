const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);

let form = document.querySelector("form");

form.addEventListener("submit",e=>{
    e.preventDefault();
    ipcRenderer.send("new-number-supplier",e.target["new-number"].value)
});

document.querySelector("input").focus();