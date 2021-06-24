const { exec } = require("child_process");
const { ipcMain,dialog,BrowserWindow } = require("electron");
const { createModal } = require("./createModal");
const fs = require("fs");


let modal;

exports.printOnLinuxOrMac = function printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation){
    let cmd = `lp -d ${printer} -n ${copies} -o fit-to-page -o ${paperSize} -o orientation-requested=${printOrientation} ${path2pdf} `;
    if(fs.existsSync(path2pdf))
        exec(cmd,(err,stdout)=>{
            if(err){
                console.log({err});
                setTimeout(printOnLinuxOrMac,1000,path2pdf,printer,copies,paperSize,printOrientation)
            }
            let msg = {
                type: "info",
                title: "Document on print",
                message: stdout
            }
            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        });
}

exports.printOnWindows = function(path2pdf){
    exec(
        'ptp ' + path2pdf, {
            windowsHide: true
        }, (e) => {
            if (e) {
                throw e;
            }
        });
}

function checkPrintersOnLinuxOrMac(os){
    return new Promise((resolve,reject)=>{
        exec("lpstat -p",(err,stdout)=>{
            if(err) reject(err);
            resolve({stdout,os});
        });
    });
}

ipcMain.handle("get-printers",()=>{
    switch(process.platform){
        case "linux":
            return checkPrintersOnLinuxOrMac("linux");
        case "darwin":
            return checkPrintersOnLinuxOrMac("mac");
        default:
            return Promise.reject({err:"OS unsupported"});
    }
});

ipcMain.on("show-print-modal",e=>{
    let pathToHTML = "./template/html/printDialog.html";
    let windowOptions = {
        width: 400,
            height: 450,
            resizable:false,
            webPreferences: {
              nodeIntegration: true,
              devTools:true
            },
            parent:BrowserWindow.getFocusedWindow(),
            contextIsolation:true,
            movable:false,
            frame:false,
            titleBarStyle:"hidden"
    }
    modal = createModal(windowOptions,pathToHTML);
    if(typeof e==="string"){
        modal.addListener("show",()=>{
            modal.webContents.send("hide-label");
        })
    }
});

ipcMain.on("forward-printObj",(e,printObj)=>{
    modal.close();
    e.sender.browserWindowOptions.parent.webContents.send("printObj",printObj);
    ipcMain.emit("printObj",[printObj]);    
});


