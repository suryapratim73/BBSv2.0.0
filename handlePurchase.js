const { BrowserWindow } = require("electron");
const { ipcMain } = require("electron/main");
const { Op } = require("sequelize");
const { getLedgerModel, getBillModel } = require("./common");
const { createModal } = require("./createModal");
const { supplier, stock, purchase, outPayments} = require("./model/dbConfig");
const { supplierLedgerSchema, billItemSchema } = require("./model/dynamicSchemas");


exports.addPurchase = mainWindow=>{
    return ()=>{
        let purchaseWindow = new BrowserWindow({
            width: 800,
            height: 600,
            resizable: false,
            webPreferences: {
                nodeIntegration: true,
                devTools: true
            },
            show: false,
            parent: mainWindow,
            // modal:true,
            contextIsolation: true
        });
        purchaseWindow.on("ready-to-show",purchaseWindow.show);
        purchaseWindow.loadFile("./template/html/purchaseTemplate.html");
        purchaseWindow.removeMenu();
    }
}

exports.showPurchase = mainWindow =>{
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
        let pathToHTML = "./template/html/purchaseDisplay.html";
        createModal(windowOptions,pathToHTML)
    }
}