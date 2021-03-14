const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);
const {ipcRenderer} = require("electron");
let firstDiv = document.querySelector("main form div");
document.querySelector("form").addEventListener("submit",e=>{
    e.preventDefault();
    let {"0":{value:name},"1":{value:quantity},"2":{value:price},"3":{value:location}} = e.target;
    ipcRenderer.send("update-stock",{name,quantity,price,location});
});
document.addEventListener("DOMContentLoaded",async ()=>{
    let datalist = document.createElement("datalist");
    datalist.id = "stock-name";
    (await ipcRenderer.invoke("get-stock-names")).forEach(entry=>{
        let {name} = entry.dataValues;
        let option = document.createElement("option");
        option.value = name;
        datalist.appendChild(option);
    });
    firstDiv.appendChild(datalist);
})