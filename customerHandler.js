const { ipcMain, shell, app, dialog, BrowserWindow } = require("electron");
const { getLedgerModel, print, getBillModel, appLogger } = require("./common");
const { createModal } = require("./createModal");
const { customer, sale, inPayments, sequelize, returnRegister, outPayments, stock, purchase } = require("./model/dbConfig");
const { customerLedgerSchema,billItemSchema, supplierLedgerSchema } = require("./model/dynamicSchemas");
const path = require("path");
const { Op } = require("sequelize");
const { customerList } = require("./saleHandler");
const { People } = require("./common");


const { stockList,queryStock } = require("./handleStock");

exports.customerPortal = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            parent:mainWindow,
        }   
        let pathToHTML = "./template/html/customerPortal.html";
        createModal(windowOptions,pathToHTML,{
            maxWinCount:1,
            label:"customer-portal"
        });
    }
}

ipcMain.on("get-customer",async e=>{
    let _customerObj = (await (await customer.sync()).findAll()).map(({dataValues})=>dataValues);
    let customerObj = await _customerObj.reduce(async (acc,customerObj)=>{
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
    ipcMain.emit("show-print-modal",null,{pageFit:"-o fit-to-page"});
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
    let customerNames = [];
    if(customerList.length>0)
        customerNames = customerList.map(({name,id})=>({name,id}));
    else
        customerNames = (await customer.findAll())
            .map(({dataValues})=>dataValues)
            .map(obj=>{
                customerList.push(new People(obj));
                return {name:obj.name,id:obj.id};
            })
    e.sender.send("customer-names",customerNames);
});

ipcMain.on("get-bill-items",async (e,id,billNo,billDate,mode)=>{
    if(mode===1)
        billDate = (await sale.findOne({
            where:{
                [Op.and]:[
                    {customerId:id},
                    {billNo}
                ]
            },
            attributes:["billDate"]
        })).dataValues.billDate;
    else
    billDate = (await purchase.findOne({
        where:{
            [Op.and]:[
                {supplierId:id},
                {billNo}
            ]
        },
        attributes:["billDate"]
    })).dataValues.billDate;
    billDate = (new Date(billDate)).toISOString().split("T")[0];
    let billModel = await getBillModel(id,billNo,billDate,billItemSchema);
    e.sender.send("get-bill-items-response",(await billModel.findAll()).map(({dataValues})=>dataValues));
});

async function returnOps(id,itemList,billMeta,retDate,mode){
    let ledger = await getLedgerModel(id,customerLedgerSchema);
    let retAmt = itemList.reduce((acc,{rate,qty})=>acc+=rate*qty,0);
    await Promise.all([
        (await returnRegister.sync()).create({
            itemList,
            billMeta,
            retAmt,
            retDate: new Date(retDate),
            id
        }),
        ...itemList.map(async ({name,qty})=>{
            let item = await (await stock.sync()).findOne({
                where:{
                    name
                }
            });
            item.reduceStock = mode * qty;
            if(stockList.length===0)
                await queryStock();
            let itemObj = stockList.find(obj=>obj.name===name);
            itemObj.quantity -= mode * qty;
            return item.save();
        }),
        ledger.update({
            returnable:false
        },{
            where:{
                billNo:billMeta.billNo
            }
        })
    ]);
    return {retAmt};
}

function displayConfirmMsg(msg,appLogMsg,id,itemList,retAmt,retDate){
    let focussedWindow = BrowserWindow.getFocusedWindow()
    dialog.showMessageBox(focussedWindow,msg)
        .then(()=>focussedWindow.close());
    appLogger(appLogMsg,JSON.stringify({id,itemList,retAmt,retDate}));
}

ipcMain.on("return-obj",async (e,{itemList,billMeta,retDate,id})=>{
    try{
        const {retAmt} = await returnOps(id,itemList,billMeta,retDate,-1);
        (await outPayments.sync()).create({
            beneficiaryId: id,
            type: "return",
            payment: retAmt,
            date: new Date(retDate)
        })
        .then(()=>{
            let msg = {
                type: "info",
                title: "Stocks updated",
                message: "Returned items registered successfully and the selected bill is now unreturnable."
            };
            displayConfirmMsg(msg,"received goods return from customer",id,itemList,retAmt,retDate);
        })
        .catch(console.log);
    }
    catch(err){console.log({err})}
});

ipcMain.on("supp-return-obj",async (e,{itemList,billMeta,retDate,id})=>{
    try{
        const {retAmt} = returnOps(id,itemList,billMeta,retDate,1);
        (await inPayments.sync()).create({
            id,
            type: "return",
            payment: retAmt,
            date: new Date(retDate)
        })
        .then(()=>{
            let msg = {
                type: "info",
                title: "Stocks updated",
                message: "Returned items registered successfully."
            };
            displayConfirmMsg(msg,"returned goods to supplier",id,itemList,retAmt,retDate);
        })
        .catch(console.log)
    }
    catch(err){
        console.log({err});
    }
});

async function billNoResponse(model,e,startDate,endDate){
    let billNumbers = (await model.findAll({
        where:{
            returnable:true,
            date:{
                [Op.between]:[startDate,endDate]
            },
            paymentStatus:true
        },
        attributes:["billNo","date"]
    })).map(({dataValues:{billNo,date}})=>({billNo,date})).filter(({billNo,date})=>billNo!==null && date!==null);
    billNumbers = billNumbers.filter((obj,i,self)=>(i===self.findIndex(({billNo})=>billNo===obj.billNo)));
    e.sender.send("get-bill-numbers-response",billNumbers);
}

ipcMain.on("get-supp-bill-numbers",async (e,suppId,startDate,endDate)=>{
    let supplierLedger = await getLedgerModel(suppId,supplierLedgerSchema);
    billNoResponse(supplierLedger,e,startDate,endDate);
});

ipcMain.on("get-bill-numbers",async (e,id,startDate,endDate)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    billNoResponse(customerLedger,e,startDate,endDate);
});

ipcMain.handle("customer-id-to-name",async (e,id)=>{
    if(customerList.length===0)
        return (await (await customer.sync()).findOne({where:{id},attributes:["name"]})).dataValues;
    else
        return customerList.find(obj=>obj.id===id);
});