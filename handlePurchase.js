const { BrowserWindow, dialog } = require("electron");
const { ipcMain } = require("electron/main");
const { Op } = require("sequelize");
const { getLedgerModel, getBillModel, appLogger, closeAndDisplay } = require("./common");
const { createModal } = require("./createModal");
const { supplier, stock, purchase, outPayments, freight, people, sequelize } = require("./model/dbConfig");
const { supplierLedgerSchema, billItemSchema } = require("./model/dynamicSchemas");
const { getSuppliers } = require("./supplierHandler");
const { getFreights } = require("./peopleHandler");


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

ipcMain.on("purchase-data",async (e,{supplier:suppObj,billMeta,itemList,payObj})=>{
    let { id,name,address,phones,moreInfo,gst } = suppObj;
    let { billNo,billDate,freightName,freightCharge=0,totalWithoutTax,totalTax,total,paymentStatus=false,moreInfo:_moreInfo={} } = billMeta;
    let { payMethod,detail,payDate,amount,receiverName,balance } = payObj;
    let suppliers = getSuppliers();
    let freights = getFreights();
    new Promise(async (res,rej)=>{
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
            if(supplierObj)
                res(supplierObj[0].dataValues.id);
            else
                rej("NO ID")
        }
        else
            res((suppliers.find(suppObj=>suppObj.id===id)).id)
    })
    .then(async (id)=>{
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
        if(freightName)
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
            let rateIncrement = _moreInfo.reduce ? _moreInfo.reduce?.((acc,{kind="",value=0})=>{
                if(kind!=="charge") return acc;
                return acc + Number(value);
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
                ...itemList.map(async ({id,name,hsn,quantity,unit,rate,sgst=0,cgst=0,igst=0,pInfo})=>{
                    unit = unit==="Bag" ? 50 : 1;
                    let tax = Number(sgst) + Number(cgst) + Number(igst);
                    let type = "type" in pInfo ? pInfo.type : "Undefined";
                    quantity = Number(quantity) * unit;
                    rate = Number(rate);
                    if(freightCharge>0)
                        rate += freightCharge;
                    rate += rateIncrement;
                    rate /= quantity;
                    if(id){
                        await stock.update(
                            {
                                buyPrice:rate,
                                standardSellPrice:1.1*rate
                            },
                            {
                                where:{
                                    name
                                }
                        });
                        let item = await stock.findOne({where:{id}})
                        item.updateStock = {quantity,price:0};
                        return item.save();
                    }
                    else
                        return stock.create({
                            name,
                            hsn,
                            type,
                            quantity,
                            buyPrice:rate,
                            standardSellPrice:1.1*rate,
                            tax,
                            pInfo
                        })
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
                        freightCharge
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
            })
            .catch(console.log)
        }
    })
    .catch(err=>console.log({err}));
});

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
})