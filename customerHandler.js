const { ipcMain, shell, app, dialog, BrowserWindow } = require("electron");
const { createModal, getMainWindow, getTargetWindow } = require("./createModal");
const { customer, sale, inPayments, sequelize, returnRegister, outPayments, stock, purchase } = require("./model/dbConfig");
const path = require("path");
const { Op,DataTypes } = require("sequelize");
const { getLedgerModel, People, customerList, initCustomerList, print, getBillModel, appLogger, openFormatForDate, captionReducer, getFinYearStrtEndDt } = require("./common");
const { stockList,queryStock } = require("./handleStock");
const { roundOffTo2DecimalPlace,getSchedulerPath, getsaleConfigPolicyPath } = require("./template/js/common");
const { printDialog } = require("./printHandler");
const fs = require("fs");
const { billPDF } = require("./scripts/makePDF.default");


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.js");

if(!(fs.existsSync(dynamicSchemaPath)))
    dynamicSchemaPath = "./model/dynamicSchemas.js";

const { customerLedgerSchema,billItemSchema, supplierLedgerSchema } = require(dynamicSchemaPath).init(DataTypes);

exports.customerPortal = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            parent:mainWindow
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
        });//.openDevTools();
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
            ],
            where:{
                type:{
                    [Op.ne]:"opening-balance"
                }
            }
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
    let { strtDt=null,endDt=null } = getFinYearStrtEndDt(0) ?? {};
    // let bills = (await sale.findAll({ where:{ customerId:id } })).map(({dataValues})=>dataValues);
    // let payments = (await inPayments.findAll({ where:{ id } })).map(({dataValues})=>dataValues);
    // return [];
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    return (await (await customerLedger.sync()).findAll({
        where:{
            date:{
                [Op.between]:[strtDt,endDt]
            }
        },
        order:[
            ["entryNo","DESC"]
        ]
    })).map(({dataValues})=>dataValues);    
});

ipcMain.on("open-ext",async (e,name,billDate,billNo)=>{
    if(fs.existsSync(path.resolve(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}.pdf`))){
        shell.openExternal(path.resolve(app.getPath("documents"),`./Bills/${name}_${billDate}_${billNo}.pdf`))
        .then(console.log)
        .catch((err)=>{
            console.log("Failed to open",err)
        });
    }
    else
        dialog.showErrorBox("Unable to open the PDF file","The file you're trying to open don't exist.")
});

ipcMain.on("print",async(e,name,billDate,billNo)=>{
    let saleObj = (await sale.findOne({
        where:{
            name,
            billNo,
            billDate:new Date(billDate)
        }
    })).dataValues;
    let { customerId,delivery,tax,billAmt } = saleObj;
    let billItemModel = await getBillModel(customerId,billNo,billDate,billItemSchema)
    let orderItems = (await billItemModel.findAll()).map(({dataValues})=>dataValues);
    let _orderItems = [...orderItems];
    orderItems.forEach(itemObj=>{
        if(itemObj.isGrouped){
            let grpObj = _orderItems.find(obj=>obj.id===itemObj.grpId)
            if(grpObj?.items?.length>0){
                grpObj.items.push(itemObj);
                grpObj.qty += itemObj.qty;
            }
            else
                _orderItems.push({
                    cgst:itemObj?.cgst,
                    sgst:itemObj?.sgst,
                    igst:itemObj?.igst,
                    desc:itemObj.desc,
                    hsn:itemObj.hsn,
                    id:itemObj.grpId,
                    items:[itemObj],
                    name:itemObj.grpName,
                    qty:itemObj.qty,
                    rate:itemObj.rate,
                    sellUnit:itemObj.unit,
                    type:"grp"
                });
            _orderItems.splice(_orderItems.findIndex(obj=>obj.name===itemObj.name),1);
        }
    });
    let customerObj = await customer.findOne({
        where:{
            id:customerId
        }
    });
    ipcMain.once("print-obj",(async function(e,printObj){
        let billDate = openFormatForDate(new Date(saleObj.billDate))
        let billItemTable = await getBillModel(saleObj.customerId,saleObj.billNo,billDate,billItemSchema);
        let itemList = (await billItemTable.findAll()).map(({dataValues})=>dataValues);
        let netQty = itemList.reduce((acc,{quantity,unit})=>{
            if(unit==="Kg")
                acc+=quantity;
            return acc;
        },0);
        let billMeta = {
        ...saleObj,
        netTax:tax,
        netAmtTax:billAmt,
        printObj,
        billDate,
        shipGST:customerObj.gst,
        shipPh:JSON.parse(customerObj.phones)[0],
        shipAddr:customerObj.address,
        shipTo:saleObj.name,
        netQty,
        discVal:0,
        transportName:saleObj.delivery?.transportName ?? "Hand"
        };
        billMeta.printObj.captions = captionReducer(billMeta.printObj.captions);
        let path2pdf = await billPDF({billMeta,customer:customerObj,orderItems:_orderItems},true);
        print({printObj,path2pdf});
        this.close();
    }).bind(printDialog()))
});

ipcMain.handle("add-payment",async (e,name,payObj,id)=>{
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let {payment} = payObj;
    payment = Number(payment);
    let lastBalance = (await (customerLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    lastBalance = Number(lastBalance);
    try{
        Promise.all([
            (await customerLedger.sync()).create({
                date:payObj.paymode==="cash" ? new Date() : payObj["pay-dt"],
                type:"payment",
                payments:payment,
                itemList:JSON.stringify(payObj),
                balance:Math.round(lastBalance - payment),
            }),
            (await inPayments.sync()).create({
                id,
                payment,
                date:new Date(),
                moreInfo:payObj
            })
        ]);
        let { netPayment } = (await inPayments.findAll({
            where:{id},
            attributes:[[sequelize.fn("SUM",sequelize.col("payment")),"netPayment"]]
        })).map(({dataValues})=>dataValues).pop();
        (await sale.findAll({
            where:{ customerId:id }
        })).map(({dataValues})=>dataValues)
        .forEach(({billAmt,entryNo,paymentStatus})=>{
            if(netPayment>=billAmt){
                paymentStatus==false && sale.update({
                    netDue:0,
                    paymentStatus:true
                },{
                    where:{ entryNo }
                });
                netPayment -= billAmt;
            }
        })
        appLogger("received payment",JSON.stringify({name,payment}));
        let msg = {
            type: "info",
            title: "Payment Added",
            message: "Customer payment registered successfully."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        
        return;
    }
    catch(err){
        return err;
    }
});

ipcMain.handle("show-customer-bills",async (e,id)=>{
    let finYear = typeof process.presets.finYear!=="undefined" ? process.presets.finYear : 0;
    let { strtDt=null,endDt=null } = getFinYearStrtEndDt(finYear) ?? {};
    return (await (await sale.sync()).findAll({
        where:{
            billDate:{
                [Op.between]:[strtDt,endDt]
            },
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

ipcMain.on("add-item-to-bill",async (e,olditemList,newitemList,billMeta,customerObj,printObj)=>{
    let {billNo,billDate,customerId:id,entryNo} = billMeta;
    billNo = Number(billNo);
    let billItemModel = await getBillModel(id,billNo,billDate,billItemSchema);
    let customerLedger = await getLedgerModel(id,customerLedgerSchema);
    let billObj = await sale.findOne({
        where:{
            entryNo
        }
    });
    let { billAmt:_billAmt,netAmt:_netAmt,tax:_tax } =  olditemList.reduce((acc,{igst,sgst,quantity,rate})=>{
        let tax = igst>0 ? igst : 2*sgst;
        acc.netAmt += quantity*rate;
        acc.billAmt += quantity*rate*(1+tax/100);
        acc.tax += quantity*rate*tax/100;
        return acc;
    },{ billAmt:0,netAmt:0,tax:0 });
    let { billAmt,netAmt,tax } =  newitemList.reduce((acc,{igst,sgst,qty:quantity,rate})=>{
        let tax = igst>0 ? igst : 2*sgst;
        acc.netAmt += quantity*rate;
        acc.billAmt += quantity*rate*(1+tax/100);
        acc.tax += quantity*rate*tax/100;
        return acc;
    },{ billAmt:0,netAmt:0,tax:0 });
    let entries = (await customerLedger.findAll({
        where:{
            [Op.and]:[
                {date:{
                    [Op.gte]:new Date(billDate)
                }},
                {billNo:{
                    [Op.gte]:billNo
                }}
            ]
        }
    }));
    Promise.all([
        //Sale Table update
        (()=>{
            billObj.updateBillValues = {del_billAmt:billAmt-_billAmt,del_netAmt:netAmt-_netAmt,del_tax:tax-_tax};
            return billObj.save();
        })(),
        // Customer Ledger update
        ...entries.map(entry=>{
            entry.updateBalance = roundOffTo2DecimalPlace(billAmt-_billAmt);
            return entry.save();
        }),
        //Stock update
        ...olditemList.map(async itemObj=>{
            (await billItemModel.findOne({
                where:{
                    name:itemObj.name
                }
            })).destroy();
            let stockInst = await stock.findOne({
                where:{
                    name:itemObj.name
                }
            });
            stockInst.reduceStock = -itemObj.quantity;
            return stockInst.save();
        }),
        ...newitemList.map(async itemObj=>{
            billItemModel.create({
                name:itemObj.name,
                hsn:itemObj.hsn,
                quantity:itemObj.qty,
                unit:itemObj.sellUnit,
                rate:itemObj.rate,
                cgst:itemObj.cgst,
                sgst:itemObj.sgst,
                igst:itemObj.igst,
                tax:itemObj.igst>0?itemObj.igst:2*itemObj.cgst
            });
            let stockInst = await stock.findOne({
                where:{
                    id:itemObj.id
                }
            });
            stockInst.reduceStock = itemObj.qty;
            return stockInst.save();
        })
    ])
    .then(async ()=>{
        dialog.showMessageBox({
            title:"Bill updated",
            message:"Bill updated"
        });
        getTargetWindow("customer-portal").webContents.send("close-modal");
        // This should replace the pdfFile
        if(typeof printObj==="undefined")
            printObj = { captions:[{first:"Original Buyer's Copy"},{third:"Book Copy"}] };
        printObj.captions = captionReducer(printObj.captions);
        billMeta.printObj = printObj;
        let path2pdf = await billPDF({billMeta,customer:customerObj,orderItems:newitemList})
        if(printObj && Object.keys(printObj).length>1)
            print({printObj,path2pdf});
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
    // console.log({billItems})
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
        // customerLedger.update()
        // Restore reduced stock
        ...billItems.map(async ({quantity:qty,name})=>{
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
            e.sender.send("close-modal");
            ipcMain.emit("refresh-stocklist");
            let entries = await customerLedger.findAll({
                where:{
                    date:{
                        [Op.gte]:new Date(billDate)
                    }
                }
            });
            entries.forEach(entry=>{
                entry.updateBalance = -Math.round(Number(billAmt));
                entry.save()
            })
        }
        else
            appLogger({title:"Error removing event",message:"Event not found"})
    })
});

ipcMain.on("add-opening-balance",async (e,id,balance)=>{
    let selectedCustomer = await customer.findOne({
        where:{ id }
    });
    selectedCustomer.dataValues.moreInfo.openingBalance = balance;
    await customer.update(selectedCustomer.dataValues,{
        where:{ id }
    });
    getTargetWindow("customer-portal").webContents.send("close-modal");
});

async function markBillAsPaid(obj,targetWin){
    let billObj = this ? this : obj;
    let saleObj = (await sale.findOne({
        where:{
            entryNo:billObj.entryNo
        }
    })).dataValues;
    if(saleObj.paymentStatus)
        return getTargetWindow(targetWin).webContents.send("msg-from-backend","Bill was already marked paid.");
    let customerLedger = await getLedgerModel(billObj.customerId,customerLedgerSchema);
    let lastBalance = (await (customerLedger.findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    let mainWin = getMainWindow();
    mainWin.webContents.send("remove-row");
    ipcMain.once("echo-exp-event",(e,expiredSchedules)=>{
        let selectedEv = expiredSchedules.find((evObj)=>(evObj?.billObj?.id===billObj.customerId && Number(evObj?.billObj?.billNo)===billObj.billNo));
        if(selectedEv)
            ipcMain.emit("manage-schedule",null,selectedEv.id,"exp-r",false);
        mainWin.webContents.send("check-notification");
    });
    ipcMain.emit("manage-schedule",null,null,"exp-echo",false);
    Promise.all([
      sale.update({
        paymentStatus:true
      },{
        where:{
          entryNo:billObj.entryNo
        }
      }),
      inPayments.create({
        payment:Number(billObj.billAmt),
        id:billObj.customerId,
        date:new Date(),
        moreInfo:{
            billNo:billObj.billNo
        }
      }),
      (await customerLedger.sync()).create({
        date:new Date(),
        type:"payment",
        payments:Math.round(billObj.billAmt),
        balance:Math.round(lastBalance - Math.round(billObj.billAmt)),
      })
    ])
    .then(()=>{
        if(!targetWin)
            mainWin.webContents.send("msg-from-backend","Payment added.");
        else
            getTargetWindow(targetWin).webContents.send("msg-from-backend","Payment added.","info",1,billObj);
    })
    .catch(err=>{
        console.log(err)
    });
}

exports.markBillAsPaid = markBillAsPaid;