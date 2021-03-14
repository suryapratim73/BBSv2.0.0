const {BrowserWindow, dialog} = require("electron");
const { ipcMain } = require("electron/main");
const { Op, DataTypes } = require("sequelize");
const { createModal } = require("./createModal");
const {sequelize,supplier,stock,purchase, outPayments} = require("./model/dbConfig");
let purchaseWindows = [];
sequelize.sync({force:false});

exports.addPurchase = mainWindow=>{
    return ()=>{
        let purchaseWindow = new BrowserWindow({
            width: 800,
            height: 600,
            resizable:false,
            webPreferences: {
            nodeIntegration: true,
            devTools:true
            },
            show:false,
            parent:mainWindow,
            // modal:true,
            contextIsolation:true
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
})

ipcMain.on("close",()=>{
    if(purchaseWindows.length>0)
        purchaseWindows = purchaseWindows.filter(purchaseWindow=>purchaseWindow!==BrowserWindow.getFocusedWindow())
    BrowserWindow.getFocusedWindow().close();
})

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

const supplierLedgerSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    date:{
        type:DataTypes.DATE
    },
    billNo:{
        type: DataTypes.INTEGER
    },
    billAmt:{
        type:DataTypes.INTEGER
    },
    paymentStatus:{
        type:DataTypes.BOOLEAN
    },
    payments:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    netDue:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    itemList:{
        type:DataTypes.TEXT,
        allowNull:false
    }
}

const billItemSchema = {
    itemNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name:{
        type:DataTypes.TEXT,
        allowNull:false
    },
    type:{
        type:DataTypes.TEXT
    },
    hsn:{
        type:DataTypes.INTEGER,
        defaultValue:7318
    },
    quantity:{
        type: DataTypes.INTEGER
    },
    unit:{
        type: DataTypes.TEXT,
        defaultValue:"Kg"
    },
    rate:{
        type:DataTypes.INTEGER,
        allowNull:false
    },
    tax:{
        type: DataTypes.TEXT
    }
}

function closeAndDisplay(msg){
    let parentWindow = BrowserWindow.getFocusedWindow().getParentWindow();
    let focusedWindow = BrowserWindow.getFocusedWindow();
    purchaseWindows = purchaseWindows.filter(window=>window!==focusedWindow);
    focusedWindow.close();
    dialog.showMessageBox(parentWindow,msg)
}

function updateLedger(ledger,paymentStatus,netDue,billAmt,billDate,billNo,itemList,payment){
    if(paymentStatus){
        payment = payment.length>0?payment:billAmt;
        if(+payment<+billAmt)
            netDue += +billAmt - +payment;
    }
    else {
        payment = 0;
        netDue += billAmt;
    }
    return ledger.create({
        date:billDate,
        billAmt,
        billNo,
        paymentStatus,
        payments:payment,
        netDue,
        itemList
    })
}

ipcMain.on("save-defer-bill",async (e,{supplierId:id,supplierName,billNo,billDate,itemList,paymentStatus,billAmt,payment})=>{
    let supplierLedger = `${id}Ledger`;
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
    let netDue = 0;
    let tables = await sequelize.showAllSchemas();
    let ledger = await sequelize.define(supplierLedger,supplierLedgerSchema,{
        freezeTableName:true,
        timestamps:false
    }).sync()
    if(tables.find(table=>table.name===supplierLedger))
        netDue = (await ledger.findOne({
            attributes:["netDue"],
            order:[["entryNo","DESC"]]
        })).dataValues.netDue;
    let billItemTable = (await sequelize.define(itemListTable,billItemSchema,{
        freezeTableName:true,
        timestamps:false
    }).sync());
    Promise.all([
        updateLedger(ledger,paymentStatus,netDue,billAmt,billDate,billNo,itemListTable,payment),
        ...itemList.map(item=>{
            return billItemTable.create({
                name:item.Particular,
                type: item.Type,
                hsn:item['HSN No.'],
                quantity:item.Quantity,
                unit:item.Unit,
                rate:Number(item.Rate)*((100+Number(item.CGST)+Number(item.SGST)+Number(item.IGST))/100),
                tax: `${Number(item.CGST)+Number(item.SGST)+Number(item.IGST)}%`
            })
        }),
        ...itemList.map(async item=>{
            let _stock = await stock.sync();
            let selectedStock = await _stock.findOne({
                where:{
                    name:item.Particular,
                    type:item.Type
                }
            });
            if(selectedStock)
                return _stock.update({
                    quantity: selectedStock.dataValues.quantity + Number(item.Quantity),
                    buyPrice: Number(item.Rate),
                    standardSellPrice:1.1*Number(item.Rate)
                },{
                    where:{
                        name:item.Particular,
                        type:item.Type
                    }
                })
            else 
                return _stock.create({
                    name: item.Particular,
                    type: item.Type,
                    hsn: item["HSN No"],
                    unit: item.unit,
                    quantity: item.Quantity,
                    buyPrice: Number(item.Rate),
                    standardSellPrice:1.1*Number(item.Rate)
                })
        }),
        (await purchase.sync()).create({
            supplierId:id,
            supplierName,
            billNo,
            billDate,
            billAmt,
            billItemTable:itemListTable
        })
    ]).then(async ()=>{
        if(paymentStatus){
            payment = payment.length>0?payment:billAmt;
            return (await outPayments.sync()).create({
                supplierId:id,
                payment,
                date:billDate
            })
        } else 
            return;
    })
    .catch(console.warn)
    .finally(()=>{
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Bill added to your purchase and stocks and/or ledger updated."
        }
        closeAndDisplay(msg)
    })
})

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
})

ipcMain.handle("get-stock-detail",async (e,itemNo)=>{
    return (await stock.findOne({where:{itemNo}})).dataValues;
})