const { ipcRenderer } = require("electron");
const {toggleDevTool} = require("../js/common");

toggleDevTool(document);
ipcRenderer.on("supplier-ledger-detail",async (e,data)=>{
    console.log(data)
})