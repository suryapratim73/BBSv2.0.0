const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput} = require("../js/common.js");
const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);

let tbody = document.querySelector("tbody");
(async ()=>{
    let count = 1;
    let arr = await ipcRenderer.invoke("get-stocks")
    arr.forEach(({dataValues})=>{
        let tr = document.createElement("tr");
        let td = document.createElement("td");
        td.innerText = count++;
        tr.appendChild(td)
        Object.keys(dataValues).forEach(key=>{
            let td = document.createElement("td");
            if(typeof dataValues[key]==="string")
                td.innerText = dataValues[key];
            else
            td.innerText = Math.round(Number(dataValues[key]));
            tr.appendChild(td);
        })
        tbody.appendChild(tr)
    })
})();