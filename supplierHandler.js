const { ipcMain, dialog, BrowserWindow,app } = require("electron");
const { Op,DataTypes, where } = require("sequelize");
const { createModal, getMainWindow } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const { supplier, sequelize, outPayments, purchase } = require("./model/dbConfig");
const { getLedgerModel, getStartDate, appLogger, People, getBillModel, getFivePercentOfMemory, getFinYearStrtEndDt, getOutPayments, initSuppliers } = require("./common");
const path = require("path");
const fs = require("fs");
const { deserializeSchema } = require("./model/schemaLoader");


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;

let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.json");

if(!(fs.existsSync(dynamicSchemaPath)))
    dynamicSchemaPath = "./model/dynamicSchemas.json";

const dynamicSchemaJson = fs.readFileSync(dynamicSchemaPath, 'utf8');
const { billItemSchema, supplierLedgerSchema } = deserializeSchema(dynamicSchemaJson, DataTypes);

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
        let pathToHTML = getTemplatePath("supplierPortal");
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
        let pathToHTML = getTemplatePath("checkOutPayments");
        createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Supplier-Payments"});
    }
}

ipcMain.on("get-out-payments",async e=>{
    let _outPayments = typeof global.outPayments!="undefined" ? global.outPayments : await getOutPayments(outPayments,appLogger,getFivePercentOfMemory);
    e.sender.send("show-out-payments",_outPayments);
});

ipcMain.handle("get-supplier-name",async (e,id)=>{
    return (await supplier.findOne({where:{id}})).dataValues;
});

ipcMain.handle("get-suppliers", async (e,reload)=>{
    if(reload===false && global.suppliers?.length>0 && global.suppliers?.every(suppObj=>["name","netPurchase","netDebt"].every(key=>key in suppObj))) 
        return global.suppliers?.map(({id,name,netPurchase,netDebt})=>({id,name,netPurchase,netDebt}));
    if(typeof global.suppliers=="undefined" || reload===true)
        await initSuppliers(supplier,appLogger,getFivePercentOfMemory);
    return (await global.suppliers.filter(suppObj=>Object.keys(suppObj).length!==0).reduce(async (acc,suppObj)=>{
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
        where:{
            date:{
                [Op.gte]:getFinYearStrtEndDt(0).strtDt
            }
        },
        order:[
            ["entryNo","DESC"]
        ]
    })).map(({dataValues})=>({...dataValues}));
});

ipcMain.handle("get-all-bills",async (e,id)=>{
    return (await purchase.findAll({
        where:{
            supplierId:id,
            billDate:{
                [Op.gte]:getFinYearStrtEndDt(0).strtDt
            }
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
        appLogger({title:"paid to supplier", message:JSON.stringify({id,billNo,billAmt,payment:payAmt,type:"bill"}), func:"add-out-payment"});
        return true;
    }
    catch(err){
        console.log(err);
        appLogger({title:"failed to add payment", message:JSON.stringify({err}), func:"add-out-payment"});
        return false;
    }
});

ipcMain.handle("get-more-info-supplier",async (e,id)=>{
    let supplierSelected = global.suppliers.find((suppObj)=>suppObj.id===id);
    if("phones" in supplierSelected) return supplierSelected;
    let suppMoreInfo = (await supplier.findOne({where:{id}})).dataValues;
    supplierSelected.append(suppMoreInfo);
    return supplierSelected;
});

ipcMain.on("update-supplier",async (e,obj)=>{
    const { id } = obj;
    let suppObj = global.suppliers.find(suppObj=>suppObj.id===id);
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
        appLogger({title:"supplier information updated successfully", message:JSON.stringify({id,name:obj.name}), func:"update-supplier"});
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
        global.suppliers.push(new People(dataValues));
        let msg = {
            type: "info",
            title: "Supplier Added",
            message: "New Supplier added to database."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        const {id=null,name=""} = dataValues;
        appLogger({title:"new Supplier added to database", message:JSON.stringify({id,name}), func:"new-supplier"});
        console.log(global.suppliers.find(obj=>obj.id===id));
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
            date:{
                [Op.gte]:getFinYearStrtEndDt(0).strtDt
            },
            beneficiaryId:id
        },
        attributes:["payment","date"]
    })).map(({dataValues:{payment,date}})=>({payment,date}));
});

ipcMain.handle("get-supplier-names",async ()=>{
    if(typeof global.suppliers === "undefined")
        await initSuppliers(supplier,appLogger,getFivePercentOfMemory);
    return global.suppliers.map(({id,name})=>({id,name}));    
});