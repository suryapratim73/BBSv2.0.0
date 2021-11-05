const { BrowserWindow } = require("electron");
const { ipcMain } = require("electron/main");
const { getLedgerModel, getBillModel, appLogger, closeAndDisplay, People } = require("./common");
const { createModal } = require("./createModal");
const { supplier, stock, purchase, outPayments, freight, people, sequelize } = require("./model/dbConfig");
const { supplierLedgerSchema, billItemSchema } = require("./model/dynamicSchemas");
const { suppliers } = require("./supplierHandler");
const { getFreights } = require("./peopleHandler");
const { stockList } = require("./handleStock");

let windowOptions = {
    width: 800,
    height: 600
} 
exports.addPurchase = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/purchaseTemplate.html",{maxWinCount:2,label:"Purchase-Entry"});
    }
}

exports.showPurchase = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/purchaseDisplay.html",{maxWinCount:1,label:"Purchase-Display"});
    }
}

ipcMain.on("purchase-data",async (e,{supplier:suppObj,billMeta,itemList,payObj})=>{
    let { id,name,address,phones,moreInfo,gst } = suppObj;
    let { billNo,billDate,freightName,freightCharge=0,totalTax,total,paymentStatus=false,moreInfo:_moreInfo={} } = billMeta;
    let { payMethod,detail,payDate,amount,receiverName,balance } = payObj;
    let freights = getFreights();
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
                    unit = unit==="Bag" ? 50 : 1;
                    let tax = Number(sgst) + Number(cgst) + Number(igst);
                    let type = "type" in pInfo ? pInfo.type : "Undefined";
                    quantity = Number(quantity) * unit;
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
                        // console.log({rate,orgRt:stockObj.rate})
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
                            pHistory
                        }
                        let newStockObj = {
                            ...stockObj,
                            ...obj
                        };
                        ["rate","cgst","sgst","igst","uid"].forEach(key=>key in newStockObj && Reflect.deleteProperty(newStockObj,key));
                        stockList.push(new People(newStockObj))
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