const { ipcMain, shell, app, dialog, BrowserWindow } = require("electron");
const { getLedgerModel, print, getBillModel, appLogger } = require("./common");
const { createModal } = require("./createModal");
const { customer, sale, inPayments, sequelize, returnRegister, outPayments, stock } = require("./model/dbConfig");
const { customerLedgerSchema,billItemSchema, supplierLedgerSchema } = require("./model/dynamicSchemas");
const path = require("path");
const { Op } = require("sequelize");


exports.customerPortal = mainWindow =>{
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
        let pathToHTML = "./template/html/customerPortal.html";
        createModal(windowOptions,pathToHTML);
    }
}

ipcMain.on("get-customer",async e=>{
    let _customerObj = (await (await customer.sync()).findAll()).map(({dataValues})=>dataValues);
    let customerObj = await _customerObj.reduce(async (acc,customerObj,index)=>{
        let customerLedger = await getLedgerModel(customerObj.id,customerLedgerSchema);
        let {balance} = (await customerLedger.findOne({
            attributes:["balance"],
            order:[
                ["entryNo","DESC"]
            ]
        })).dataValues;
        customerObj.netPurchase = (await customerLedger.findOne({
            attributes:[
                [sequelize.fn("SUM",sequelize.col("billAmt")),"netPurchase"]
            ]
        })).dataValues.netPurchase;
        customerObj.balance = balance;
        acc = await acc;
        acc.push(customerObj)
        return acc
    },[]);
    e.sender.send("customer-list",{customerObj});
});

ipcMain.handle("get-full-customer-ledger",async (e,id)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    return (await (await customerLedger.sync()).findAll({
        order:[
            ["entryNo","DESC"]
        ]
    })).map(({dataValues})=>dataValues);    
});

ipcMain.on("open-ext",async (e,name,billDate,billNo)=>{
    shell.openExternal(path.join(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}`),{activate:true});
});

ipcMain.on("print",(e,name,billDate,billNo)=>{
    ipcMain.emit("show-print-modal");
    let path2pdf = path.join(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}`);
    ipcMain.on("printObj",print.bind(path2pdf))
});

ipcMain.on("add-payment",async (e,name,billNo,payment,id,billAmt,retAmt)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let {payment:oldPay} = (await (await sale.sync()).findOne({
        where:{
            [Op.and]:[
                {customerId:id},
                {billNo}
            ]
        },
        attributes:["payment"]
    })).dataValues;
    oldPay = Number(oldPay)
    let lastBalance = (await (customerLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    lastBalance = Number(lastBalance);
    let netDue = Math.round(billAmt - oldPay - payment - retAmt);
    if(netDue<0) return dialog.showErrorBox("Pament greater than Bill Amount","Please re-enter the payment making sure the pament is less than the bill amount.")
    Promise.all([
        await sale.update({
            payment:Math.round(oldPay+payment),
            paymentStatus: netDue==0?true:false
        },{
            where:{
                [Op.and]:[
                    {customerId:id},
                    {billNo}
                ]
            }
        }),
        (await customerLedger.sync()).create({
            date:new Date(),
            payments:payment,
            balance:Math.round(lastBalance - payment)
        }),
        (await inPayments.sync()).create({
            id,
            payment,
            date:new Date()
        })
    ])
    .then(()=>{
        e.sender.send("payment-successful",name,Math.round(lastBalance - payment));
        appLogger("received payment",JSON.stringify({name,billNo,payment}));
    })
    .catch(console.log)
});

ipcMain.handle("show-customer-bills",async (e,id)=>{
    return (await (await sale.sync()).findAll({
        where:{
            customerId:id
        },
        order:[["entryNo","DESC"]]
    })).map(({dataValues})=>dataValues)
});

ipcMain.on("get-customer-names",async e=>{
    let customerNames = (await customer.findAll({
        attributes:["name","id"]
    })).map(({dataValues})=>dataValues);
    e.sender.send("customer-names",customerNames);
});

ipcMain.on("get-bill-numbers",async (e,id,startDate,endDate)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let billNumbers = (await customerLedger.findAll({
        where:{
            returnable:true,
            date:{
                [Op.between]:[startDate,endDate]
            }
        },
        attributes:["billNo","date"]
    })).map(({dataValues:{billNo,date}})=>({billNo,date})).filter(({billNo,date})=>billNo!==null && date!==null);
    e.sender.send("get-bill-numbers-response",billNumbers)
});

ipcMain.on("get-bill-items",async (e,id,billNo,billDate)=>{
    billDate = (new Date(billDate)).toISOString().split("T")[0];
    let billModel = await getBillModel(id,billNo,billDate,billItemSchema);
    e.sender.send("get-bill-items-response",(await billModel.findAll()).map(({dataValues})=>dataValues));
});

ipcMain.on("return-obj",async (e,{itemList,billMeta,retDate,id:customerId})=>{
    let retAmt = itemList.reduce((acc,{rate,qty})=>acc+=rate*qty,0);
    let customerLedger = await getLedgerModel(customerId,customerLedgerSchema);
    Promise.all([
        (await returnRegister.sync()).create({
            itemList,
            billMeta,
            retAmt,
            retDate: new Date(retDate),
            id:customerId
        }),
        (await outPayments.sync()).create({
            beneficiaryId: customerId,
            type: "return",
            payment: retAmt,
            date: new Date(retDate)
        }),
        ...itemList.map(async ({name,qty})=>{
            let item = await (await stock.sync()).findOne({
                where:{
                    name
                }
            });
            item.reduceStock = -1 * qty;
            return item.save();
        }),
        customerLedger.update({
            returnable:false
        },{
            where:{
                billNo:billMeta.billNo
            }
        })
    ])
    .then(()=>{
        let msg = {
            type: "info",
            title: "Stocks updated",
            message: "Returned items registered successfully and the selected bill is now unreturnable."
        };
        let focussedWindow = BrowserWindow.getFocusedWindow()
        dialog.showMessageBox(focussedWindow,msg)
            .then(()=>focussedWindow.close());
        appLogger("received goods return from customer",JSON.stringify({customerId,itemList,retAmt,retDate}));
    })
    .catch(err=>dialog.showErrorBox("Error",err));
});

ipcMain.on("get-supp-bill-numbers",async (e,suppId,startDate,endDate)=>{
    let supplierLedger = await getLedgerModel(suppId,supplierLedgerSchema);
    let billNumbers = (await supplierLedger.findAll({
        where:{
            date:{
                [Op.between]:[startDate,endDate]
            }
        },
        attributes:["billNo","date"]
    })).map(({dataValues:{billNo,date}})=>({billNo,date})).filter(({billNo,date})=>billNo!==null && date!==null);
    e.sender.send("get-bill-numbers-response",billNumbers);
});

ipcMain.on("supp-return-obj",async (e,{itemList,billMeta,retDate,id})=>{
    let retAmt = itemList.reduce((acc,{rate,qty})=>acc+=rate*qty,0);
    let supplierLedger = await getLedgerModel(id,supplierLedgerSchema);
    //work with supplierLedger object.
    Promise.all([
        (await returnRegister.sync()).create({
            itemList,
            billMeta,
            retAmt,
            retDate: new Date(retDate),
            id
        }),
        (await inPayments.sync()).create({
            id,
            type: "return",
            payment: retAmt,
            date: new Date(retDate)
        }),
        ...itemList.map(async ({name,qty})=>{
            let item = await (await stock.sync()).findOne({
                where:{
                    name
                }
            });
            item.reduceStock = qty;
            return item.save();
        })
    ])
    .then(()=>{
        let msg = {
            type: "info",
            title: "Stocks updated",
            message: "Returned items registered successfully."
        };
        let focussedWindow = BrowserWindow.getFocusedWindow()
        dialog.showMessageBox(focussedWindow,msg)
            .then(()=>focussedWindow.close());
        appLogger("returned goods to supplier",JSON.stringify({customerId,itemList,retAmt,retDate}));
    })
    .catch(err=>dialog.showErrorBox("Error",err));
});