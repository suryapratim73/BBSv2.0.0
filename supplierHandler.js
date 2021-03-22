const { ipcMain, dialog, BrowserWindow } = require("electron");
const { Op, Sequelize } = require("sequelize");
const { createModal } = require("./createModal");
const { supplier, sequelize, outPayments } = require("./model/dbConfig");
const {supplierLedgerSchema,billItemSchema} = require("./model/dynamicSchemas");

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
        let pathToHTML = "./template/html/outPayments.html";
        createModal(windowOptions,pathToHTML);
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
});

async function getLedgerModel(id){
    let supplierLedger = `${id}Ledger`;
    supplierLedger = await sequelize.define(supplierLedger,supplierLedgerSchema,{
        freezeTableName: true,
        timestamps: false
    }).sync();
    return supplierLedger
}

ipcMain.handle("get-supplier-ledger",async (e,{name,id})=>{
    let supplierLedger = await getLedgerModel(id)
    let last5Entries = (await supplierLedger.findAll({
        limit:5,
        order:[["entryNo","DESC"]]
    })).map(({dataValues})=>{return {...dataValues}});
    let total = (await supplierLedger.findAll({
        attributes:[
            [sequelize.fn("sum",sequelize.col("billAmt")),"total"]
        ]
    }))[0].dataValues.total;
    return {last5Entries,total};
});

ipcMain.on("Load full ledger",async (e,{name,id})=>{
    let windowOptions = {
        width: 800,
        height: 600,
        resizable:false,
        webPreferences: {
            nodeIntegration: true,
            devTools:true
        },
        parent:BrowserWindow.getFocusedWindow(),
        show:false,
        contextIsolation:true
    }   
    let pathToHTML = "./template/html/fullLegder.html";
    let ledgerWindow = createModal(windowOptions,pathToHTML);
    let supplierLedger = `${id}Ledger`;
    let fullLedger = (await sequelize.model(supplierLedger).findAll()).map(({dataValues})=>dataValues)
    ledgerWindow.on("ready-to-show",function(){
        this.webContents.send("supplier-ledger-detail",{name,id,fullLedger})
    })
});

ipcMain.handle("load-purchase-itemList",async (e,itemListTable)=>{
    itemListTable = sequelize.define(itemListTable,billItemSchema,{
        freezeTableName:true,
        timestamps:false
    });
    let itemList = (await itemListTable.findAll()).map(({dataValues})=>dataValues);
    return itemList
});

ipcMain.handle("get-supplier-name",async (e,id)=>{
    return (await supplier.findOne({where:{id}})).dataValues;
});

ipcMain.handle("get-unpaid-bills",async (e,{name,id})=>{
    let supplierLedger = await getLedgerModel(id);
    return (await supplierLedger.findAll({
        where:{
            billAmt:{
                [Op.ne]:Sequelize.col("payments")
            }
        }
    })).map(({dataValues:{date,billNo,billAmt,payments,entryNo}})=>({date,billNo,billAmt,payments,entryNo}));
});

ipcMain.on("add-out-payment",async (e,{id,billNo,billAmt,payment,type,entryNo})=>{
    let supplierLedger = await getLedgerModel(id);
    let {netDue,entryNo:lastEntryNo} = (await supplierLedger.findOne({
        attributes:["netDue","entryNo"],
        order:[["entryNo","DESC"]]
    })).dataValues;
    Promise.all([
        outPayments.create({
            beneficiaryId:id,
            type,
            payment,
            date:new Date()
        }),
        supplierLedger.update({
            paymentStatus:true,
            payments:billAmt
        },{
            where:{
                entryNo
            }
        }),
        supplierLedger.update({
            netDue:netDue-payment
        },{
            where:{
                entryNo:lastEntryNo
            }
        })
    ])
    .then(()=>{
        let msg = {
            type: "info",
            title: "Payment added and ledger updated",
            message: "Payment added and ledger updated."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        BrowserWindow.getFocusedWindow().close();
    })
    .catch(console.warn);
})