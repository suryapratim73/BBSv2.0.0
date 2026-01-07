const { ipcMain,BrowserWindow,app } = require("electron");
const { getLedgerModel, getBillModel, appLogger, closeAndDisplay, People } = require("./common");
const { createModal, getMainWindow } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const { supplier, stock, purchase, outPayments, freight, people, sequelize } = require("./model/dbConfig");
const { suppliers } = require("./supplierHandler");
const { getFreights } = require("./peopleHandler");
const { stockList } = require("./handleStock");
const { getsaleConfigPolicyPath } = require("./template/js/common");
const fs = require("fs");
const path = require("path");
const { DataTypes } = require("sequelize");
const { deserializeSchema } = require("./model/schemaLoader");


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;

let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.json");

if(!(fs.existsSync(dynamicSchemaPath)))
    dynamicSchemaPath = "./model/dynamicSchemas.json";

const dynamicSchemaJson = fs.readFileSync(dynamicSchemaPath, 'utf8');
const { supplierLedgerSchema, billItemSchema } = deserializeSchema(dynamicSchemaJson, DataTypes);
let windowOptions = {
    width: 800,
    height: 600
} 
exports.addPurchase = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,getTemplatePath("purchaseTemplate"),{
            maxWinCount:2,
            label:"Purchase-Entry",
            cb:function(){
                this.on("close",()=>{
                    getMainWindow().webContents.send("update-content");
                });
            }
        });
    }
}

exports.showPurchase = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,getTemplatePath("purchaseDisplay"),{maxWinCount:1,label:"Purchase-Display"});
    }
}

ipcMain.on("purchase-data",async (e,{supplier:suppObj,billMeta,itemList,payObj})=>{
    let { id,name,address,phones,moreInfo,gst } = suppObj;
    let { billNo,billDate,freightName,freightCharge=0,totalTax,total,paymentStatus=false,services:_moreInfo={} } = billMeta;
    let { payMethod,detail,payDate,amount,receiverName,balance } = payObj;
    let freights = getFreights();
    let { unitMap } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    new Promise(async res=>{
        if(!suppliers.find(suppObj=>suppObj.id===id)){
            let supplierObj = await (await supplier.sync()).findOrCreate({
                where:{
                    id
                },
                defaults:{
                    name,
                    address,
                    phones,
                    gst,
                    moreInfo
                }
            });
            if(supplierObj){
                suppliers.push(new People(supplierObj[0].dataValues));
                res(supplierObj[0].dataValues.id);
            }
        }
        else
            res((suppliers.find(suppObj=>suppObj.id===id)).id)
    })
    .then(async id=>{
        let freightId;
        if(freightName && !freights.find(frghtObj=>frghtObj.name===freightName))
            freightId = (await (await freight.sync()).findOrCreate({
                where:{name:freightName},
                defaults:{
                    name:freightName,
                    charge:Number(freightCharge)
                }
            }))[0].dataValues?.id;
        else
        if(freightName)// Update required
            freightId = freights.find(frghtObj=>frghtObj.name===freightName)
        let receiverId = receiverName ? (await (await people.sync()).findOrCreate({
            where:{name:receiverName},
            defaults:{
                name:receiverName,
                relation:{
                    relTo:id,
                    relType:"employee"
                },
                moreInfo:{
                    relWith:"supplier"
                }
            }
        }))[0].dataValues?.id : "Undefined";
        if(id){
            let ledger = await getLedgerModel(id,supplierLedgerSchema);
            let itemListTable = await getBillModel(id,billNo,billDate,billItemSchema);
            let lastBalance = (await ledger.findOne({
                attributes:["balance"],
                order:[
                    ["entryNo","DESC"]
                ]
            }))?.dataValues.balance ?? 0;
            let rateIncrement = _moreInfo.reduce ? _moreInfo.reduce?.((acc,obj)=>{
                let tax = ["sgst","cgst","igst"].reduce((acc,key)=>{
                    if(key in obj)
                        return acc + Number(obj[key]);
                    else
                        return acc;
                },0);
                return acc + Number(obj.rate)*Number(obj.quantity)*(1+(tax/100));
            },0) : 0;
            rateIncrement /= itemList.length;
            freightCharge = Number(freightCharge) / itemList.length;
            Promise.all([
                ledger.create({
                    date: billDate,
                    billNo,
                    billAmt: total,
                    tax: totalTax,
                    paymentStatus,
                    payments: amount,
                    balance:Math.round(lastBalance + balance),
                    itemList:`${id}_${billNo}_${billDate}`
                }),
                ...itemList.map(({name,hsn,quantity,unit,rate,sgst=0,cgst=0,igst=0,pInfo})=>{
                    return itemListTable.create({
                        name,
                        type: Object.keys(pInfo).some(key=>key==="type") ? pInfo.type : "",
                        hsn: Number(hsn),
                        quantity: Number(quantity),
                        unit,
                        rate: Number(rate),
                        tax: Number(sgst) + Number(cgst) + Number(igst)
                    })
                }),
                ...itemList.map(async stockObj=>{
                    let {
                        id,
                        name,
                        quantity,
                        unit,
                        rate,
                        pHistory=[],
                        sgst=0,
                        cgst=0,
                        igst=0,
                        pInfo } = stockObj;
                    let multiplier = Object.values(unitMap.find(obj=>unit in obj))[0];
                    let tax =  Number(igst)>0 ?  Number(igst) : Number(sgst) + Number(cgst);
                    pInfo = {
                        ...pInfo,
                        taxSlab:tax
                    }
                    let type = "type" in pInfo ? pInfo.type : "Undefined";
                    quantity = Number(quantity) * multiplier;
                    rate = Number(rate);
                    if(freightCharge>0)
                        rate += freightCharge;
                    rate += rateIncrement;
                    rate /= quantity;
                    pHistory.push({
                        billDate,
                        rate
                    })
                    let selectedStock = stockList.find(obj=>obj.id===id);
                    if(selectedStock){
                        selectedStock.buyPrice = rate;
                        selectedStock.standardSellPrice = Math.round(1.1*rate);
                        selectedStock.pHistory = pHistory;
                        selectedStock.pInfo = pInfo;
                        selectedStock.type = type;
                        selectedStock.quantity += quantity;
                        selectedStock.name = name;
                        await stock.update(
                            {
                                buyPrice:rate,
                                standardSellPrice:Math.round(1.1*rate),
                                pHistory,
                                pInfo,
                                type,
                                name
                            },
                            {
                                where:{
                                    id
                                }
                        });
                        let item = await stock.findOne({where:{id}})
                        item.updateStock = {quantity,price:0};
                        return item.save();
                    }
                    else{
                        let obj = {
                            type,
                            quantity,
                            buyPrice:rate,
                            standardSellPrice:Math.round(1.1*rate),
                            tax,
                            pHistory,
                            pInfo
                        }
                        let newStockObj = {
                            ...stockObj,
                            ...obj
                        };
                        ["rate","cgst","sgst","igst","uid"].forEach(key=>key in newStockObj && Reflect.deleteProperty(newStockObj,key));
                        stockList.push(new People(newStockObj));
                        return stock.create({
                            ...stockObj,
                            ...obj
                        });
                    }
                }),
                purchase.create({
                    supplierId:id,
                    supplierName:name,
                    billNo,
                    billDate,
                    billAmt: Number(total),
                    tax: Number(totalTax),
                    payment: amount,
                    paymentStatus,
                    billItemTable: `${id}_${billNo}_${billDate}`,
                    moreInfo: freightId ? {
                        freightId,
                        freightName,
                        freightCharge,
                        ..._moreInfo
                    } : {}
                })
            ])
            .then(async ()=>{
                if(amount>0)
                    outPayments.create({
                        beneficiaryId:id,
                        type:"bill",
                        payment:amount,
                        date:payDate,
                        moreInfo:{
                            payMethod,
                            detail,
                            receiverId
                        }
                    });
                console.log("Added to DB!!");
                let msg = {
                    type: "info",
                    title: "Bill saved",
                    message: "Bill added to your purchase and stocks and/or ledger updated."
                };
                closeAndDisplay(msg);
                appLogger("sale",JSON.stringify({name,billNo,amount}));
                if(paymentStatus===false){
                    let evObj = {
                        label:`Purchase Bill Number ${billNo} expired`,
                        type: "bill-payment",
                        billType: "purchase-select",
                        time: new Date(new Date(billDate).getTime() + 30 * 24 * 60 * 60 * 1000),
                        tag: "Payment reminder",
                        color: "#00FF00",
                        billObj:{
                            ...billMeta,
                            ...payObj,
                            ...suppObj
                        }
                    }
                    ipcMain.emit("manage-schedule",null,evObj,"a",false);
                    BrowserWindow.fromId(e.frameId).webContents.send("update-content");
                }
            })
            .catch(console.log)
        }
    })
    .catch(err=>console.log({err}));
});// Update required

ipcMain.handle("get-purchases",async e=>{
    let purchases = (await purchase.findAll()).map(({dataValues})=>dataValues);
    return purchases;
});

ipcMain.handle("get-table",async (e,tableName)=>{
    if(e.sender.getTitle()==="Purchases"){
        return (await (await sequelize.define(tableName,billItemSchema,{
            freezeTableName: true,
            timestamps: false
        }).sync()).findAll()).map(({dataValues})=>dataValues);
    }
});