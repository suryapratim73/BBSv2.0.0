const {ipcRenderer} = require("electron");
module.exports = function(document){
    document.addEventListener("keyup",e=>{
        if(e.code==="F1")
            ipcRenderer.send("openDevTool");
    });
}