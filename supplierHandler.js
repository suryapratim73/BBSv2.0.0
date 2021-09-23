const { ipcMain, dialog, BrowserWindow } = require("electron");
const { Op } = require("sequelize");
const { createModal } = require("./createModal");
const { supplier, sequelize, outPayments, purchase } = require("./model/dbConfig");
const { billItemSchema, supplierLedgerSchema } = require("./model/dynamicSchemas");
const { getLedgerModel, getStartDate, appLogger, People } = require("./common");
const { ledgerPDF } = require("./scripts/makePDF.default");


const suppliers = [];

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

exports.checkOutPayments = mainWindow=>{
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
        let pathToHTML = "./template/html/checkOutPayments.html";
        createModal(windowOptions,pathToHTML);
    }
}

exports.getSuppliers = ()=>(suppliers);

ipcMain.handle("get-supplier-names",async e=>{
    if(suppliers.length>0) return suppliers;
    let suppList = (await supplier.findAll({
        attributes:["name","id"]
    })).map(({dataValues})=>dataValues);
    suppList.forEach(suppObj=>{
        suppObj._type = "supplier";
        suppliers.push(new People(suppObj))
    });
    return suppliers;
});

ipcMain.handle("get-more-info-supplier",async (e,id)=>{
    let supplierSelected = suppliers.find((suppObj)=>suppObj.id===id);
    if("phones" in supplierSelected) return supplierSelected;
    let suppMoreInfo = (await supplier.findOne({where:{id}})).dataValues;
    supplierSelected.append(suppMoreInfo);
    return supplierSelected;
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
    let focusedWindow = BrowserWindow.getFocusedWindow();
    let getSupplierWindow = focusedWindow.getParentWindow();
    getSupplierWindow.webContents.send("new-number",phone);
    focusedWindow.close();
});

ipcMain.on("update-supplier-detail",(e,dataObj)=>{
    dataObj.type = "supplier";
    // console.log(dataObj)
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
});

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
    appLogger("supplier detail update",JSON.stringify({name,gst,address,phones,comment}))
});

ipcMain.handle("get-supplier-ledger",async (e,{name,id})=>{
    let supplierLedger = await getLedgerModel(id,supplierLedgerSchema)
    let lastFiveEntries = (await supplierLedger.findAll({
        limit:5,
        order:[
            ["entryNo","DESC"]
        ]
    })).map(({dataValues})=>{return {...dataValues}});
    let {balance} = (await supplierLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })).dataValues;
    let netPayment = (await (await outPayments.sync()).findOne({
        where:{"beneficiaryId":id},
        attributes:[
            [sequelize.fn("sum",sequelize.col("payment")),"netPayment"]
        ]
    })).dataValues.netPayment;
    return {lastFiveEntries,balance,netPayment};
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
    return (await (await purchase.sync()).findAll({
        where:{
            [Op.and]:[
                {paymentStatus:false},
                {supplierId:id}
            ]
        }
    })).map(({dataValues})=>dataValues);
});

ipcMain.on("add-out-payment",async (e,{id,billNo,billAmt,payment,type})=>{
    let supplierLedger = await getLedgerModel(id,supplierLedgerSchema);
    let lastBalance = (await (supplierLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    let oldPayment = (await (await purchase.sync()).findOne({
        where:{
            [Op.and]:[
                {supplierId:id},
                {billNo}
            ]
        },
        attributes:["payment"]
    })).dataValues.payment;
    let netPayment = Math.round(oldPayment + payment);
    let netDue = Math.round(billAmt - netPayment);
    Promise.all([
        outPayments.create({
            beneficiaryId:id,
            type,
            payment,
            date:new Date()
        }),
        supplierLedger.create({
            date:new Date(),
            payments:payment, 
            balance:lastBalance - payment
        }),
        purchase.update({
            payment:netPayment,
            paymentStatus:netDue===0?true:false
        },{
            where:{
                [Op.and]:[
                    {supplierId:id},
                    {billNo}
                ]
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
        if(type==="bill")
            appLogger("paid to supplier",JSON.stringify({id,billNo,billAmt,payment,type}))
        else
            appLogger("paid out",JSON.stringify({id,billNo,billAmt,payment,type}))
    })
    .catch(console.log);
});

ipcMain.on("get-out-payments",async e=>{
    e.sender.send("show-out-payments",(await outPayments.findAll()).map(({dataValues})=>dataValues));
});