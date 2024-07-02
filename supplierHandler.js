const { ipcMain, dialog, BrowserWindow,app } = require("electron");
const { Op,DataTypes } = require("sequelize");
const { createModal, getMainWindow } = require("./createModal");
const { supplier, sequelize, outPayments, purchase } = require("./model/dbConfig");
const { getLedgerModel, getStartDate, appLogger, People, getBillModel } = require("./common");
const path = require("path");


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;

const { billItemSchema, supplierLedgerSchema } = require(path.resolve(appPath,"./model/dynamicSchemas")).init(DataTypes);
const suppliers = [];

let windowOptions = {
    width: 800,
    height: 600,
    resizable:false,
    show:false,
    contextIsolation:true
}  

exports.getSuplierPortal = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        let pathToHTML = "./template/html/supplierPortal.html";
        createModal(windowOptions,pathToHTML,{
            maxWinCount:1,
            label:"Supplier-Page",
            cb:function(){
                this.on("close",()=>{
                    getMainWindow().webContents.send("update-content");
                });
            }
        });
    }
}

exports.checkOutPayments = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;  
        let pathToHTML = "./template/html/checkOutPayments.html";
        createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Supplier-Payments"});
    }
}

async function initSuppliers(){
    return (await supplier.findAll())
        .map(({dataValues})=>dataValues)
        .forEach(suppObj=>{
            suppObj._type = "supplier";
            suppliers.push(new People(suppObj))
        });
}

ipcMain.on("get-out-payments",async e=>{
    e.sender.send("show-out-payments",(await outPayments.findAll()).map(({dataValues})=>dataValues));
});

ipcMain.handle("get-supplier-name",async (e,id)=>{
    return (await supplier.findOne({where:{id}})).dataValues;
});

exports.suppliers = suppliers;
exports.initSuppliers = initSuppliers;

ipcMain.handle("get-suppliers", async (e,reload)=>{
    if(reload===false && suppliers.length>0 && suppliers.every(suppObj=>["name","netPurchase","netDebt"].every(key=>key in suppObj))) 
        return suppliers.map(({id,name,netPurchase,netDebt})=>({id,name,netPurchase,netDebt}));
    if(suppliers.length===0)
        await initSuppliers();
    return (await suppliers.filter(suppObj=>Object.keys(suppObj).length!==0).reduce(async (acc,suppObj)=>{
        const { id } = suppObj;
        let ledger = await getLedgerModel(id,supplierLedgerSchema);
        let {netPurchase=0} = (await ((await purchase.sync()).findOne({
            where:{
                supplierId:id
            },
            attributes:[
                [sequelize.fn("sum",sequelize.col("billAmt")),"netPurchase"]
            ]
        })))?.dataValues ?? {}; 
        let {balance=0} = (await ((await ledger.sync()).findOne({
            attributes:["balance"],
            order:[
                ["entryNo","DESC"]
            ]
        })))?.dataValues ?? {}; 
        netPurchase = netPurchase!==null?netPurchase:0;
        acc = await acc;
        suppObj.append({netPurchase,netDebt:balance});
        acc.push(suppObj);
        return acc;
    },[])).map(({id,name,netPurchase,netDebt})=>({id,name,netPurchase,netDebt}));
});

ipcMain.handle("Load-full-ledger",async (e,id)=>{
    let supplierLedger = await getLedgerModel(id,supplierLedgerSchema)
    return (await supplierLedger.findAll({
        order:[
            ["entryNo","DESC"]
        ]
    })).map(({dataValues})=>({...dataValues}));
});

ipcMain.handle("get-all-bills",async (e,id)=>{
    return (await purchase.findAll({
        where:{
            supplierId:id
        }
    })).map(({dataValues})=>dataValues);
});

ipcMain.handle("add-out-payment",async (e,obj)=>{
    const {billNo,billAmt,payDate,payAmt,paymentStatus,id} = obj;
    let supplierLedger = await getLedgerModel(id,supplierLedgerSchema);
    let lastBalance = (await (supplierLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    }))).dataValues?.balance ?? 0;
    let lastPayment = (await purchase.findOne({
        where:{
            [Op.and]:[
                {supplierId:id},
                {billNo}
            ]
        },
        attributes:["payment"]
    })).dataValues.payment ?? 0;
    try{
        await Promise.all([
            outPayments.create({
                beneficiaryId:id,
                type:"bill",
                payment:payAmt,
                date:payDate
            }),
            purchase.update({
                payment:lastPayment + payAmt,
                paymentStatus
            },{
                where:{
                    [Op.and]:[
                        {supplierId:id},
                        {billNo}
                    ]
                }
            }),
            supplierLedger.create({
                date: payDate,
                type:"out-payment",
                billNo,
                billAmt,
                paymentStatus,
                payments: payAmt,
                itemList:JSON.stringify(obj),
                balance:Math.round(lastBalance - payAmt)
            })
        ]);
        let msg = {
            type: "info",
            title: "Payment added and ledger updated",
            message: "Payment added and ledger updated."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("paid to supplier",JSON.stringify({id,billNo,billAmt,payment:payAmt,type:"bill"}));
        return true;
    }
    catch(err){
        console.log(err);
        appLogger("failed to add payment",JSON.stringify({err}));
        return false;
    }
});

ipcMain.handle("get-more-info-supplier",async (e,id)=>{
    let supplierSelected = suppliers.find((suppObj)=>suppObj.id===id);
    if("phones" in supplierSelected) return supplierSelected;
    let suppMoreInfo = (await supplier.findOne({where:{id}})).dataValues;
    supplierSelected.append(suppMoreInfo);
    return supplierSelected;
});

ipcMain.on("update-supplier",async (e,obj)=>{
    const { id } = obj;
    let suppObj = suppliers.find(suppObj=>suppObj.id===id);
    for(let key in obj)
        suppObj[key] = obj[key];
    supplier.update(obj,{where:{id}})
    .then(()=>{
        let msg = {
            type: "info",
            title: "Update Successful",
            message: "Supplier information updated successfully."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("supplier information updated successfully",JSON.stringify({id,name:obj.name}));
    })
    .catch(err=>{
        console.log({err});
    });
});

ipcMain.on("new-supplier",async (e,obj)=>{
    supplier.findOrCreate({
        where:{
            id:obj.id
        },
        defaults:obj
    })
    .then(([{dataValues}])=>{
        suppliers.push(new People(dataValues));
        let msg = {
            type: "info",
            title: "Supplier Added",
            message: "New Supplier added to database."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        const {id=null,name=""} = dataValues;
        appLogger("new Supplier added to database",JSON.stringify({id,name}));
        console.log(suppliers.find(obj=>obj.id===id));
    })
    .catch(err=>{
        console.log(err);
    });
});

ipcMain.handle("get-bill-items",async (e,tableName)=>{
    return (await (await (await sequelize.define(tableName,billItemSchema,{
        freezeTableName: true,
        timestamps: false
    })).sync()).findAll()).map(({dataValues})=>dataValues);
});

ipcMain.handle("get-out-payments",async (e,id)=>{
    return (await (await outPayments.sync()).findAll({
        where:{
            beneficiaryId:id
        },
        attributes:["payment","date"]
    })).map(({dataValues:{payment,date}})=>({payment,date}));
});

ipcMain.handle("get-supplier-names",async ()=>{
    if(suppliers.length===0)
        await initSuppliers();
    return suppliers.map(({id,name})=>({id,name}));    
});