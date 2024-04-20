const { ipcMain, shell, app, dialog, BrowserWindow } = require("electron");
const { createModal, getMainWindow } = require("./createModal");
const { customer, sale, inPayments, sequelize, returnRegister, outPayments, stock, purchase } = require("./model/dbConfig");
const { customerLedgerSchema,billItemSchema, supplierLedgerSchema } = require("./model/dynamicSchemas");
const path = require("path");
const { Op } = require("sequelize");
const { getLedgerModel, People, customerList, initCustomerList, print, getBillModel, appLogger } = require("./common");
const { stockList,queryStock } = require("./handleStock");
const { roundOffTo2DecimalPlace,getSchedulerPath, getsaleConfigPolicyPath } = require("./template/js/common");
const { printDialog } = require("./printHandler");
const fs = require("fs");


exports.customerPortal = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            parent:mainWindow,
            webPreferences: {
                nodeIntegration: true,
                enableRemoteModule: true
            }
        }   
        let pathToHTML = "./template/html/customerPortal.html";
        createModal(windowOptions,pathToHTML,{
            maxWinCount:1,
            label:"customer-portal",
            cb:function(){
                this.on("close",()=>{
                    getMainWindow().webContents.send("update-content");
                    // this.webContents.toggleDevTool();
                });
            }
        });
    }
}

ipcMain.on("get-customer",async e=>{
    if(customerList.length===0)
        await initCustomerList();
    let _customerList = customerList.reduce(async (acc,custObj)=>{
        let customerLedger = await getLedgerModel(custObj.id,customerLedgerSchema);
        let {balance=0} = (await customerLedger.findOne({
            attributes:["balance"],
            order:[
                ["entryNo","DESC"]
            ]
        }))?.dataValues ?? {};
        let netPurchase = (await sale.findOne({
            where:{
                customerId:custObj.id
            },
            attributes:[
                [sequelize.fn("SUM",sequelize.col("billAmt")),"netPurchase"]
            ]
        }))?.dataValues.netPurchase;
        acc = await acc;
        acc.push({...custObj,balance,netPurchase});
        return acc;
    },[]);
    e.sender.send("customer-list",await _customerList);
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
    shell.openExternal(path.resolve(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}.pdf`))
    .then(console.log)
    .catch((err)=>{
        console.log("Failed to open",err)
    });
});

ipcMain.on("print",(e,name,billDate,billNo)=>{
    let path2pdf = path.join(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}`);
    ipcMain.once("print-obj",(function(e,printObj){
        print({printObj,path2pdf});
        this.close();
    }).bind(printDialog()))
});

ipcMain.handle("add-payment",async (e,name,billNo,payObj,id,billAmt)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let {payment,paymode} = payObj;
    payment = Number(payment);
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
    billAmt = Number(billAmt);
    let netDue = Math.round(billAmt - oldPay - payment);
    try{
        Promise.all([
            sale.update({
                payment:Math.round(oldPay+payment),
                paymentStatus:netDue===0 && paymode==="cash" ? true : false
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
                billNo,
                payments:payment,
                balance:Math.round(lastBalance - payment),
            }),
            (await inPayments.sync()).create({
                id,
                payment,
                date:new Date(),
                moreInfo:payObj
            })
        ]);
        appLogger("received payment",JSON.stringify({name,billNo,payment}));
        let topLine = (await (customerLedger.findOne({
            order:[
                ["entryNo","DESC"]
            ]
        }))).dataValues;
        let msg = {
            type: "info",
            title: "Payment Added",
            message: "Customer payment registered successfully."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("customer-payment",JSON.stringify({billNo,payment}));
        return {payment:payment+oldPay,netDue,topLine};
    }
    catch(err){
        return err;
    }
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

async function retreiveBillItems(id,billNo,billDate,mode){
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
    return await getBillModel(id,billNo,billDate,billItemSchema);
}

ipcMain.on("get-bill-items",async (e,id,billNo,billDate,mode)=>{
    let billModel = await retreiveBillItems(id,billNo,billDate,mode);
    e.sender.send("get-bill-items-response",(await billModel.findAll()).map(({dataValues})=>dataValues));
});

ipcMain.handle("get-bill-items-2",async (e,id,billNo,billDate)=>{
    let billModel = await retreiveBillItems(id,billNo,billDate,1);
    return (await billModel.findAll()).map(({dataValues})=>dataValues);
})

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

ipcMain.on("add-item-to-bill",async (e,newItemObj)=>{
    let {custId:id,billNo,billStatus,itemList,billDate} = newItemObj;
    billNo = Number(billNo);
    let billItemModel = await getBillModel(id,billNo,billDate,billItemSchema);
    let {amt,amtWithTax} = itemList.reduce((acc,{qty,standardSellPrice,cgst,sgst,igst})=>{
        standardSellPrice = Number(standardSellPrice);
        qty = Number(qty);
        let _tax = Number(igst)>0?Number(igst):Number(sgst) + Number(cgst);
        acc.amt += qty * standardSellPrice;
        acc.amtWithTax += roundOffTo2DecimalPlace(qty * standardSellPrice * (1+_tax/100));
        return acc;
    },{amt:0,amtWithTax:0});
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let lastBalance = (await ((await customerLedger.sync()).findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    let {netDue,billAmt:lastAmt,tax:lastTax} = (await (await sale.sync()).findOne({
        where:{
            [Op.and]:[
                {customerId:id},
                {billNo}
            ]
        },
        attributes:["netDue","billAmt","tax"]
    })).dataValues;
    Promise.all([
        ...itemList.map(({name,hsn,type,qty:quantity,standardSellPrice,unit,cgst,sgst,igst})=>{
            return billItemModel.create({
                name,
                type,
                hsn,
                quantity,
                unit,
                rate:Number(standardSellPrice),
                tax: Number(igst)>0?Number(igst):Number(cgst)+Number(sgst)
            });
        }),
        sale.update({
            billAmt:lastAmt + amtWithTax,
            tax:lastTax + amtWithTax - amt,
            billStatus,
            netDue,
            paymentStatus:false
        },{
            where:{
                billNo
            }
        }),
        ...itemList.map(async ({qty,name})=>{
            if(!name) return;
            let selectedStock = await stock.findOne({
                where:{
                    name
                }
            });
            selectedStock.reduceStock = qty;
            return selectedStock.save();
        }),
        customerLedger.create({
            billStatus,
            date:billDate,
            billNo,
            billAmt:lastAmt + amtWithTax,
            tax:amtWithTax-amt,
            netDue,
            itemList:`${id}_${billNo}_${billDate}`,
            balance: Math.round(lastBalance +  amtWithTax)
        })
    ])
    .then(async ()=>{
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Items added to the bill."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("sale",JSON.stringify({billNo,itemList}));
        let topLine = (await (customerLedger.findOne({
            order:[
                ["entryNo","DESC"]
            ]
        }))).dataValues;
        e.sender.send("close-modal",topLine);
    })
    .catch(console.log)
});

ipcMain.handle("get-bill-items-portal",async (e,id,billNo,billDate)=>{
    let billModel = await getBillModel(id,billNo,billDate,billItemSchema);
    return (await billModel.findAll()).map(({dataValues})=>dataValues);
});

ipcMain.handle("get-customer-out-payments",async (e,id)=>{
    return (await inPayments.findAll({
        where:{
            id
        }
    })).map(({dataValues})=>dataValues);
});

ipcMain.handle("update-customer-profile",async (e,custData)=>{
    let selectedCustomer = customerList.find(obj=>obj.id===custData.id);
    for(let key in custData){
        if(key==="email")
            selectedCustomer.moreInfo.email = custData.email;
        else
            selectedCustomer[key] = custData[key];
    }
    try{
        await customer.update(selectedCustomer,{
            where:{
                id:selectedCustomer.id
            }
        });
        let msg = {
            type: "info",
            title: "Customer Profile Updated",
            message: "Customer profile updated successfully."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("customer-profile-update",JSON.stringify(selectedCustomer));
        return "Updated!!"

    }
    catch(err){
        console.log(err);
        return err;
    }
});

ipcMain.handle("get-customer-details",async (e,id)=>{
    if(customerList.length===0)
        await initCustomerList();
    return customerList.find(obj=>obj.id===id);
});

ipcMain.handle("cancel-bill",async (e,id,billNo,billDate,billAmt)=>{
    // Check if the bill is eligible for deletion
    // if(Date.now()-(new Date(billDate)).getTime()>3*24*60*60*1000) return dialog.showErrorBox("Bill cannot be cancelled","Bill cancellation date expired");
    let billItemModel = await getBillModel(id,billNo,billDate,billItemSchema);
    let billItems = (await billItemModel.findAll()).map(({dataValues})=>dataValues);
    billNo = Number(billNo);
    billDate = new Date(billDate);
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    return Promise.all([
        // Delete billItemModel
        sequelize.dropSchema(`${id}_${billNo}_${billDate}`),
        // Remove sale record
        sale.destroy({
            where:{
                customerId:id,
                billNo,
                billDate
            }
        }),
        // Update Ledger
        customerLedger.destroy(
            {
                where:{
                    date:billDate,
                    billNo
                }
            }
        ),
        // Restore reduced stock
        ...billItems.map(async ({qty,name})=>{
            if(!name) return;
            let selectedStock = await stock.findOne({
                where:{
                    name
                }
            });
            if(!selectedStock) return;
            selectedStock.reduceStock = -qty;
            return selectedStock.save();
        })
    ])
    .then(async ()=>{
        // Remove associated event
        let path2scheduler = getSchedulerPath();
        let jsData = JSON.parse(fs.readFileSync(path2scheduler).toString());
        let schedules = jsData.schedules;
        let i = schedules.findIndex(({billObj:{billNo:_billNo,id:_id,billDate:_billDate}})=>{
            if(_id===id && _billNo===billNo && _billDate===billDate)
                return true;
            else
                return false;
        });
        if(i){
            schedules.splice(i,1);
            jsData.schedules = schedules;
            fs.writeFileSync(path2scheduler,JSON.stringify(jsData));
            // getMainWindow().webContents.send("update-content");
            let path2config = getsaleConfigPolicyPath()
            let saleConfig = JSON.parse(fs.readFileSync(path2config).toString());
            if(!("availableBillNo" in saleConfig))
                saleConfig.availableBillNo = [billNo];
            else
                saleConfig.availableBillNo.push(billNo);
            fs.writeFileSync(path2config,JSON.stringify(saleConfig));
            let topLine = (await (customerLedger.findOne({
                order:[
                    ["entryNo","DESC"]
                ]
            }))).dataValues;
            e.sender.send("close-modal",topLine);
        }
        else
            appLogger({title:"Error removing event",message:"Event not found"})
    })
});