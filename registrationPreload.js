let { toggleDevTool } = require("./template/js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

ipcRenderer.on("call-register-link",async(e,gst)=>{
    window.gst = gst;
    window.Buffer = Buffer;
    connectRegServer();
});