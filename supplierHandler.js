const { ipcMain, dialog, BrowserWindow } = require("electron");
const { createModal } = require("./createModal");
const { supplier } = require("./model/dbConfig");

exports.getSuplier = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            resizable:false,
            webPreferences: {
            nodeIntegration: true,
            devTools:true
            },
            show:false,
            parent:mainWindow,
            contextIsolation:true
        }   
        let pathToHTML = "./template/html/getSupplier.html";
        createModal(windowOptions,pathToHTML);
    }
}

exports.getLedger = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            resizable:false,
            webPreferences: {
            nodeIntegration: true,
            devTools:true
            },
            show:false,
            parent:mainWindow,
            contextIsolation:true
        }   
        let pathToHTML = "./template/html/getSupplierLedger.html";
        createModal(windowOptions,pathToHTML);
    }
}

exports.addPaymentForSupplier = mainWindow=>{
    return ()=>{
        console.log("Add Payments")
    }
}

ipcMain.handle("get-supplier-names",e=>{
    return supplier.findAll({
        attributes:["name","id"]
    })
});

ipcMain.handle("get-more-info-supplier",(e,id)=>{
    return supplier.findOne({where:{id}})
})

ipcMain.on("get-new-phone-number",()=>{
    let windowOptions = {
        width: 400,
        height: 200,
        resizable:false,
        webPreferences: {
        nodeIntegration: true,
        devTools:true
        },
        show:false,
        parent:BrowserWindow.getFocusedWindow(),
        contextIsolation:true,
        movable:false
    }   
    let pathToHTML = "./template/html/newPhone.html";
    createModal(windowOptions,pathToHTML);
});

ipcMain.on("new-number-supplier",(e,phone)=>{
    console.log(phone);
    let focusedWindow = BrowserWindow.getFocusedWindow();
    let getSupplierWindow = focusedWindow.getParentWindow();
    getSupplierWindow.webContents.send("new-number",phone);
    focusedWindow.close();
})

ipcMain.on("update-supplier-detail",(e,dataObj)=>{
    dataObj.type = "supplier";
    console.log(dataObj)
    let windowOptions = {
        width: 400,
        height: 200,
        resizable:false,
        webPreferences: {
        nodeIntegration: true,
        devTools:true
        },
        show:false,
        parent:BrowserWindow.getFocusedWindow(),
        contextIsolation:true,
        movable:false
    }   
    let pathToHTML = "./template/html/updater.html";
    let modal = createModal(windowOptions,pathToHTML);
    modal.on("ready-to-show",()=>{
        modal.webContents.send("update-data-obj",dataObj)
    })
})

ipcMain.on("update-data-obj-complete",(e,dataObj)=>{
    e.sender.browserWindowOptions.parent.webContents.send("update-supplier-detail-done",dataObj);
    e.sender.destroy();
})

ipcMain.on("update-supplier-db",(e,{name,gst,address,phones,comment,id})=>{
    supplier.update({name,gst,address,phones,comment},{where:{id}})
    let msg = {
        type: "info",
        title: "Successfully updated",
        message: "Selected supplier information has been updated."
    }
    dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
})