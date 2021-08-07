const {BrowserWindow, dialog} = require("electron");
const { ipcMain } = require("electron/main");
const { Op } = require("sequelize");
const { getLedgerModel, getBillModel } = require("./common");
const { createModal } = require("./createModal");
const {supplier,stock,purchase, outPayments} = require("./model/dbConfig");
const {supplierLedgerSchema,billItemSchema} = require("./model/dynamicSchemas");


let purchaseWindows = [];

exports.addPurchase = mainWindow=>{
    return ()=>{
        let purchaseWindow = new BrowserWindow({
            width: 1020,
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
        purchaseWindows.push(purchaseWindow);
        purchaseWindow.loadFile("./template/html/purchaseTemplate.html");
        purchaseWindow.removeMenu();
    }
}

ipcMain.on("openDevTool",(e)=>{
    console.log("Opening DevTool")
    e.sender.toggleDevTools();
});

ipcMain.on("close",()=>{
    if(purchaseWindows.length>0)
        purchaseWindows = purchaseWindows.filter(purchaseWindow=>purchaseWindow!==BrowserWindow.getFocusedWindow())
    BrowserWindow.getFocusedWindow().close();
});

ipcMain.handle("save-supplier",async (e,{billerName,billerAddress,billerPhones,billerGST,billerComment})=>{
    // console.log({billerID,billerName,billerGST,billerPhones,billerAddress,billerComment});
    try{
        let savedSupplier = await (await supplier.sync()).findOrCreate({
            where:{
                [Op.or]:[
                    {gst:billerGST},
                    {name:billerName}
                ]
            },
            defaults:{
                name:billerName,
                address:billerAddress,
                phones:JSON.stringify(billerPhones),
                gst:billerGST,
                comment:billerComment
            }
        })
        // console.log(savedSupplier[0].dataValues)
        return savedSupplier[0].dataValues;
    }
    catch(error) {
        console.log(error);
        return null;
    }
});

function closeAndDisplay(msg){
    let parentWindow = BrowserWindow.getFocusedWindow().getParentWindow();
    let focusedWindow = BrowserWindow.getFocusedWindow();
    purchaseWindows = purchaseWindows.filter(window=>window!==focusedWindow);
    focusedWindow.close();
    dialog.showMessageBox(parentWindow,msg)
}

ipcMain.on("save-defer-bill",async (e,{supplierId:id,supplierName,billNo,billDate,itemList,paymentStatus,billAmt,payment=0})=>{    
    let itemListTable = `${id}_${billNo}_${billDate}`;
    if(!id){
        let msg = {
            type: "error",
            title: "Bill not saved",
            message: "An error occoured while saving the bill.",
            detail: "No Supplier ID error."
        }
        closeAndDisplay(msg);
        return;
    }
    let ledger = await getLedgerModel(id,supplierLedgerSchema);
    let lastBalance = (await (ledger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    let billItemTable = await getBillModel(id,billNo,billDate,billItemSchema);
    let _tax = itemList.map(({CGST,SGST,IGST,Rate,Quantity})=>{
        let tax;
        if(Number(IGST)>0)
            tax = Number(IGST);
        else
            tax = Number(CGST) + Number(SGST);
        return (tax * Number(Rate) * Number(Quantity))/100;
    }).reduce((acc,val)=>val+acc);
    Promise.all([
        ledger.create({
            date:billDate,
            billAmt,
            tax:_tax,
            billNo,
            paymentStatus,
            payments:payment, 
            itemList:itemListTable,
            balance:lastBalance + billAmt + _tax - payment
        }),
        ...itemList.map(item=>{
            return billItemTable.create({
                name:item.Particular,
                type: item.Type,
                hsn:item['HSN No.'],
                quantity:item.Quantity,
                unit:item.Unit,
                rate:Number(item.Rate),
                tax: Number(item.IGST)===0?`${Number(item.CGST)+Number(item.SGST)}%`:`${item.IGST}%`
            })
        }),
        ...itemList.map(async item=>{
            let _stock = await stock.sync();
            let selectedStock = item.Type!="charge"? await _stock.findOne({
                where:{
                    name:item.Particular,
                    type:item.Type
                }
            }):null;
            if(selectedStock)
                return _stock.update({
                    quantity: selectedStock.dataValues.quantity + Number(item.Quantity),
                    buyPrice: Number(item.Rate),
                    standardSellPrice:1.1*Number(item.Rate),
                    tax: Number(item.IGST)===0?`${Number(item.CGST)+Number(item.SGST)}%`:`${item.IGST}%`
                },{
                    where:{
                        name:item.Particular,
                        type:item.Type
                    }
                });
            else{
                if(item.Type!=="charge")
                    return _stock.create({
                        name: item.Particular,
                        type: item.Type,
                        hsn: item["HSN No"],
                        unit: item.unit,
                        quantity: item.Quantity,
                        buyPrice: Number(item.Rate),
                        standardSellPrice:1.1*Number(item.Rate),
                        tax: Number(item.CGST)+Number(item.SGST)+Number(item.IGST)
                    });
                else
                    Promise.resolve();
            }
        }),
        (await purchase.sync()).create({
            supplierId:id,
            supplierName,
            billNo,
            billDate,
            billAmt,
            tax:_tax,
            paymentStatus,
            payment, 
            billItemTable:itemListTable
        })
    ])
    .then(async ()=>{
        if(payment>0)
            return (await outPayments.sync()).create({
                beneficiaryId:id,
                type:"bill",
                payment,
                date:billDate
            })
    })
    .catch(console.log)
    .finally(()=>{
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Bill added to your purchase and stocks and/or ledger updated."
        }
        closeAndDisplay(msg)
    })
});

ipcMain.on("create-add-item-modal",e=>{
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
        movable:false
    };
    let pathToHTML = "./template/html/addItem.html";
    createModal(windowOptions,pathToHTML);
});

ipcMain.on("add-item",async (e,data)=>{
    let focusedWindow = BrowserWindow.getFocusedWindow();
    let parentWindow = focusedWindow.getParentWindow();
    parentWindow.webContents.send("add-item",data);
    focusedWindow.close();
});

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

ipcMain.handle("get-item-names",e=>{
    return stock.findAll({attributes:["name","itemNo"]})
});

ipcMain.handle("get-stock-detail",async (e,itemNo)=>{
    return (await stock.findOne({where:{itemNo}})).dataValues;
});