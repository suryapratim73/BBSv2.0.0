const { exec } = require("child_process");
const { ipcMain,dialog,BrowserWindow, app, webContents } = require("electron");
const { createModal, getMainWindow } = require("./createModal");
const fs = require("fs");
const { setTimeout } = require("timers");
const path = require("path");


let modal,pageFit;

exports.printOnLinuxOrMac = function printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation){
    if(!path2pdf && fs.existsSync(path2pdf)) return;
    if(!/\.pdf$/.test(path2pdf))
        path2pdf+=".pdf";
    let cmd = `lp -d ${printer} -n ${copies} ${pageFit && pageFit!==""?pageFit:""} -o ${paperSize} -o orientation-requested=${printOrientation} "${path2pdf}" `;
    execCMD.call(printOnLinuxOrMac,cmd,path2pdf,printer,copies,paperSize,printOrientation);
}

exports.printOnWindows = function printOnWindows(path2pdf,printer,copies,paperSize){
    if(!path2pdf && fs.existsSync(path2pdf)) return;
    if(!/\.pdf$/.test(path2pdf))
        path2pdf+=".pdf";
    let path2SumatraPDF = path.resolve(__dirname,"scripts/SumatraPDF.exe");
    let cmd = `"${path2SumatraPDF}" -print-to "${printer}" -print-settings "${copies}x,paper=${paperSize}" "${path2pdf}" -silent`;
    execCMD.call(printOnWindows,cmd,path2pdf,printer,copies,paperSize);
}

function checkPrintersOnLinuxOrMac(os){
    return new Promise((resolve,reject)=>{
        exec("lpstat -p",(err,stdout)=>{
            if(err) reject(err);
            resolve({stdout,os});
        });
    });
}

function execCMD(cmd,path2pdf,printer,copies,paperSize,printOrientation){
    let timer;
    exec(cmd,(err,stdout)=>{
        if(err){
            console.warn({err});
            timer = setTimeout(this,1000,path2pdf,printer,copies,paperSize,printOrientation)
        }
        clearTimeout(timer);
        let msg = {
            type: "info",
            title: "Document on print",
            message: stdout
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        BrowserWindow.getFocusedWindow()?.webContents.send("print-done");
    });
}

ipcMain.handle("get-printers",()=>{
    switch(process.platform){
        case "linux":
            return checkPrintersOnLinuxOrMac("linux");
        case "darwin":
            return checkPrintersOnLinuxOrMac("mac");
        default:
            return getMainWindow().webContents.getPrinters()
    }
});

ipcMain.on("show-print-modal",(e,...arg)=>{
    if(arg.some(obj=>"pageFit" in obj))
        pageFit = arg.find(obj=>"pageFit" in obj).pageFit;
    let pathToHTML = "./template/html/printDialog.html";
    let parentWindow = BrowserWindow.fromId((e?.sender?.id ?? getMainWindow().id));
    let windowOptions = {
        width: 400,
        height: 450,
        resizable:false,
        webPreferences: {
            nodeIntegration: true,
            devTools:true
        },
        parent:parentWindow,
        contextIsolation:true,
        movable:false,
        frame:false,
        titleBarStyle:"hidden"
    }
    modal = createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Custom-Print-Dialog"});
    if(typeof e==="string"){
        modal.addListener("show",()=>{
            modal.webContents.send("hide-label",e);
        })
    }
    modal.on("close",()=>{
        ipcMain.removeListener("print-obj",_print);
    });
    function _print(e,printObj){
        modal.close();  
        if(!(parentWindow instanceof BrowserWindow))
            parentWindow = BrowserWindow.getFocusedWindow();
        parentWindow.webContents.send("print-obj",printObj);
    }
    ipcMain.once("print-obj",_print);
});

ipcMain.on("forward-printObj",(e,printObj,path2pdf)=>{
    modal.close();
    e.sender.browserWindowOptions.parent.webContents.send("printObj",printObj);
    ipcMain.emit("printObj",{printObj,path2pdf});    
});

exports.printDialog = function(cb){
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
    return createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Custom-Print-Dialog",cb});
}