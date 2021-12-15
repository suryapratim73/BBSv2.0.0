const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { roadChallanPDF } = require("./scripts/makePDF.default");


let windowOptions = {
    width: 600,
    height: 400,
    resizable:false,
    webPreferences: {
      nodeIntegration: true,
      devTools:true
    },
    show:false,
    contextIsolation:true
  };

exports.genRoadChallan = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"template/html/roadChallan.html",{maxWinCount:1,label:"Road-Challan-Generator"});
    }
}

ipcMain.on("generate-road-challan",async (e,roadChallanObj)=>{
  let path2pdf = roadChallanPDF(roadChallanObj);
  ipcMain.emit("show-print-modal",path2pdf);
})