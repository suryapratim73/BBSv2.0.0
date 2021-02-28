const {BrowserWindow, dialog} = require("electron");
const { ipcMain } = require("electron/main");
const { Op, DataTypes } = require("sequelize");
const {sequelize,supplier,stock,purchase} = require("./model/dbConfig");
sequelize.sync();
let purchaseWindows = [];

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
        let savedSupplier = await supplier.findOrCreate({
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
        type:DataTypes.INTEGER
    },
    netDue:{
        type:DataTypes.INTEGER
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

function updateLedger(ledger,paymentStatus,netDue,billAmt,billDate,billNo,itemList){
    let payment;
    if(paymentStatus)
            payment = billAmt;
    else {
        payment = 0;
        netDue += billAmt;
    }
    ledger.create({
        date:billDate,
        billAmt,
        billNo,
        paymentStatus,
        payments:payment,
        netDue,
        itemList
    }).catch(console.warn)
}

ipcMain.on("save-defer-bill",async (e,{supplierId:id,supplierName,billNo,billDate,itemList,paymentStatus,billAmt})=>{
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
        (await ledger.findAll({where:{paymentStatus:false},attributes:["billAmt"]})).forEach(entry=>{
            netDue += +entry.dataValues.billAmt
        });
    updateLedger(ledger,paymentStatus,netDue,billAmt,billDate,billNo,itemListTable);
    let billItemTable = (await sequelize.define(itemListTable,billItemSchema,{
        freezeTableName:true,
        timestamps:false
    }).sync());
    Promise.all([...itemList.map(item=>{
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
        let selectedStock = await stock.findOne({
            where:{
                name:item.Particular,
                type:item.Type
            }
        });
        if(selectedStock)
            return stock.update({
                quantity: selectedStock.dataValues.quantity + Number(item.Quantity),
                buyPrice: Number(item.Rate)*((100+Number(item.CGST)+Number(item.SGST)+Number(item.IGST))/100),
                standardSellPrice:1.1*Number(item.Rate)*((100+Number(item.CGST)+Number(item.SGST)+Number(item.IGST))/100)
            },{
                where:{
                    name:item.Particular,
                    type:item.Type
                }
            })
        else 
            return stock.create({
                name: item.Particular,
                type: item.Type,
                quantity: item.Quantity,
                buyPrice: Number(item.Rate)*((100+Number(item.CGST)+Number(item.SGST)+Number(item.IGST))/100),
                standardSellPrice:1.1*Number(item.Rate)*((100+Number(item.CGST)+Number(item.SGST)+Number(item.IGST))/100)
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
    ]).then(()=>{
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Bill added to your purchase and stocks and/or ledger updated."
        }
        closeAndDisplay(msg)
    })
    .catch(console.warn)
})

ipcMain.on("create-add-item-modal",e=>{
    let addItemModal = new BrowserWindow({
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
    });
    addItemModal.removeMenu();
    addItemModal.loadFile("./template/html/addItem.html")
});

ipcMain.on("add-item",async (e,data)=>{
    let focusedWindow = BrowserWindow.getFocusedWindow();
    let parentWindow = focusedWindow.getParentWindow();
    parentWindow.webContents.send("add-item",data);
    focusedWindow.close();
});

exports.showPurchase = mainWindow =>{
    return ()=>{
        let purchaseDisplay = new BrowserWindow({
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
        })
        purchaseDisplay.on("ready-to-show",purchaseDisplay.show);
        purchaseDisplay.loadFile("./template/html/purchaseDisplay.html");
        purchaseDisplay.removeMenu();
    }
}