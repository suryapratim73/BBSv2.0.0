const { exec } = require("child_process");
const { ipcMain,dialog,BrowserWindow, app, webContents } = require("electron");
const { createModal, getMainWindow } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const fs = require("fs");
const { setTimeout } = require("timers");
const path = require("path");
const uuid = require("uuid");


let modal,pageFit;
let windowOptions = {
        width: 400,
        height: 450,
        resizable:false,
        contextIsolation:true,
        movable:false,
        frame:false,
        titleBarStyle:"hidden"
    };


exports.printOnLinuxOrMac = function printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation){
    if(!path2pdf || !fs.existsSync(path2pdf)) return;
    if(!/\.pdf$/.test(path2pdf))
        path2pdf+=".pdf";
    let cmd = `lp -d ${printer} -n ${copies} ${pageFit && pageFit!==""?pageFit:""} -o ${paperSize} -o orientation-requested=${printOrientation} "${path2pdf}" `;
    execCMD.call(printOnLinuxOrMac,cmd,path2pdf,printer,copies,paperSize,printOrientation);
}

exports.printOnWindows = function printOnWindows(path2pdf,printer,copies,paperSize){
    if(!path2pdf || !fs.existsSync(path2pdf)) return;
    if(!/\.pdf$/.test(path2pdf))
        path2pdf+=".pdf";
    let path2SumatraPDF = path.resolve(__dirname,"scripts/SumatraPDF.exe");
    let cmd = `"${path2SumatraPDF}" -print-to "${printer}" -print-settings "${copies}x,paper=${paperSize}" "${path2pdf}" -silent`;
    execCMD.call(printOnWindows,cmd,path2pdf,printer,copies,paperSize);
}

/** Fire-and-forget silent print for the scheduler — no dialogs, no retry loop.
 *  cb(err) is called once when the print process exits. */
exports.printSilent = function printSilent(path2pdf,printer,copies,paperSize,cb){
    console.log({path2pdf,printer,copies,paperSize});
    if(!path2pdf || !fs.existsSync(path2pdf))
        return typeof cb==="function" && cb(new Error(`PDF not found: ${path2pdf}`));
    if(!/\.pdf$/.test(path2pdf))
        path2pdf+=".pdf";
    let cmd;
    if(process.platform==="win32"){
        let path2SumatraPDF = path.resolve(__dirname,"scripts/SumatraPDF.exe");
        cmd = `"${path2SumatraPDF}" -print-to "${printer}" -print-settings "${copies}x,paper=${paperSize}" "${path2pdf}" -silent`;
    } else {
        cmd = `lp -d ${printer} -n ${copies} -o ${paperSize} "${path2pdf}"`;
    }
    exec(cmd,(err,stdout,stderr)=>{
        if(err)
            err.message = (stderr || err.message || "print failed");
        typeof cb==="function" && cb(err || null,stdout);
    });
};

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

ipcMain?.handle("get-printers",()=>{
    switch(process.platform){
        case "linux":
            return checkPrintersOnLinuxOrMac("linux");
        case "darwin":
            return checkPrintersOnLinuxOrMac("mac");
        default:
            return getMainWindow().webContents.getPrintersAsync()
    }
});

ipcMain?.on("show-print-modal",(e,...arg)=>{
    if(arg.some(obj=>"pageFit" in obj))
        pageFit = arg.find(obj=>"pageFit" in obj).pageFit;
    let pathToHTML = getTemplatePath("printDialog");
    let parentWindow = typeof e!="string" ? BrowserWindow.fromId((e.sender.id)) : BrowserWindow.getFocusedWindow();
    windowOptions.parent = parentWindow;
    let uid = uuid.v4();
    createModal(windowOptions,pathToHTML,{
        label:"Custom-Print-Dialog"+uid,// Trying to distinguish listeners from similar modal
        cb:function(){
            if(typeof e==="string"){
                this.addListener("show",()=>{
                    this.webContents.send("hide-label",e);
                })
            }
            this.webContents.send("frame-id",this.id,uid)
            this.on("close",()=>{
                ipcMain.removeListener("print-obj",_print);
            });
            ipcMain.once("print-obj"+this.id,_print.bind({parentWindow,modal:this}));
        }
    });
    function _print(e,printObj){
        this.modal.close();  
        if(this.parentWindow instanceof BrowserWindow)
            this.parentWindow.webContents.send("print-obj",printObj);
    }
});

ipcMain.handle("show-custom-print-modal",async (e,modalOpts)=>{
    windowOptions.parent = BrowserWindow.fromId(e.sender.id) || getMainWindow();
    let pathToHTML = getTemplatePath("printDialog");
    return new Promise((res,rej)=>{
        createModal(windowOptions,pathToHTML,{
            label:"Custom-Print-Dialog",// Trying to distinguish listeners from similar modal
            maxWinCount:1,
            cb:function(){
                this.addListener("show",()=>{
                })
                this.webContents.send("custom-opts",modalOpts);
                ipcMain.once("print-obj",(e,printObj)=>{
                    this.close();
                    res(printObj);
                });
            }
        });
    });
});

ipcMain?.on("forward-printObj",(e,printObj,path2pdf)=>{
    modal.close();
    getMainWindow().webContents.send("printObj",printObj);
    ipcMain.emit("printObj",{printObj,path2pdf});    
});

exports.printDialog = function(cb){
    let pathToHTML = getTemplatePath("printDialog");
    windowOptions.parent = BrowserWindow.getFocusedWindow();
    return createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Custom-Print-Dialog",cb});
}