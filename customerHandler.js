const { ipcMain, shell, app, dialog } = require("electron");
const { getLedgerModel, print, getStartDate } = require("./common");
const { createModal } = require("./createModal");
const { customer, sale, inPayments, sequelize } = require("./model/dbConfig");
const { customerLedgerSchema } = require("./model/dynamicSchemas");
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
    let customerObj = (await (await customer.sync()).findAll()).map(({dataValues})=>dataValues);
    await customerObj.forEach(async customerObj=>{
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
        e.sender.send("customer-list",{customerObj})
    });
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
            customerId:id,
            payment,
            date:new Date()
        })
    ])
    .then(()=>{
        e.sender.send("payment-successful",name,Math.round(lastBalance - payment))
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