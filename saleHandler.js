const { ipcMain, dialog, Menu, app } = require("electron");
const { createModal, getMainWindow, getTargetWindow } = require("./createModal");
const { BrowserWindow } = require("electron/main");
const { customer, stock, freight, inPayments, sale, people, sequelize } = require("./model/dbConfig");
const { getLedgerModel, customerList, initCustomerList, getBillModel, billNoCounter, setBillNo, reduceBillNo, appLogger, People, getBaseDir, priceInspector, getLastBillNo, captionReducer, getFinYearStrtEndDt } = require("./common");
const { printOnLinuxOrMac, printOnWindows, printDialog } = require("./printHandler");
const { stockList } = require("./handleStock");
const { getsaleConfigPolicyPath, getOrderPath, roundOffTo2DecimalPlace, getUserPolicyPath } = require("./template/js/common");
const fs = require("fs");
const path = require("path");
const { billPDF } = require("./scripts/makePDF.default");
const uuid = require("uuid");
const { printPDF } = require("./main");
const { DataTypes, Op } = require("sequelize");

let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.js");

if(!(fs.existsSync(dynamicSchemaPath)))
    dynamicSchemaPath = "./model/dynamicSchemas.js";

const { customerLedgerSchema, billItemSchema } = require(dynamicSchemaPath).init(DataTypes);


let closeFlag = false,
    saleWindow,
    windowOptions = {
        width: 800,
        height: 600
    };

exports.saleWindow = ()=>{
    return ()=>{
        windowOptions.parent = undefined;
        saleWindow = createModal(windowOptions,"./template/html/salePage.html");
        // saleWindow.webContents.openDevTools()
        saleWindow.on("unresponsive",(e)=>{
            dialog.showErrorBox("Error",String(e))
        });
        // saleWindow.webContents.toggleDevTools()
        saleWindow?.on("close",(e)=>{
            if(!closeFlag){
                e.preventDefault();
                saleWindow.send("get-current-step");
            } else
                closeFlag = false;
            getMainWindow().webContents.send("update-content");
        })
    }
}

exports.showSales = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/showSale.html",{maxWinCount:1,label:"Sale-Dsiplay"});
    }
}

exports.orderRegister = ()=>{
    return ()=>{
        windowOptions.parent = undefined;
        let saleWindow = createModal(windowOptions,"./template/html/orderRegister.html",{label:"new-order"});
        saleWindow?.on("close",(e)=>{
            getMainWindow().webContents.send("update-content");
        })
    }
}

exports.orderManager = (main,cb)=>{
    return ()=>{
        windowOptions.parent = main;
        let saleWindow = createModal(windowOptions,"./template/html/orderManager.html",{label:"manage-order",cb});
        saleWindow.webContents.openDevTools();
        saleWindow?.on("close",(e)=>{
            getMainWindow().webContents.send("update-content");
        });
        return saleWindow;
    }
}

ipcMain.handle("get-sale-bill-number",()=>{
    let billNo = billNoCounter();
    appLogger({
        title:"Log",
        message:JSON.stringify({billNo}),
        func:"IPC event:get-sale-bill-number"
    });
    return billNo;
});

ipcMain.on("cancel-sale-bill",(e,currentStep)=>{
    if(currentStep>1 && process.presets?.target!="salePage")
        reduceBillNo();
    closeFlag = true;
    BrowserWindow.getFocusedWindow().close();
    if("presets" in process && process?.presets?.target==="salePage")
        process.presets = {};
});

function itemAnalyzer(orderItems){
    let itemList = JSON.parse(JSON.stringify(orderItems));
    itemList = itemList.reduce((acc,itemObj)=>{
        let match = acc.find(obj=>obj.name===itemObj.name);
        if(match && match.rate===itemObj.rate)
            match.qty += itemObj.qty;
        else
            acc.push(itemObj);
        return acc;
    },[]); // Item Grouping
    return itemList;
}

async function helperFunc1({id,name,qty,sellUnit,rate,amt,cgst=0,sgst=0,igst=0,hsn,type,desc=""},billModel,custId,billDate,billNo,grpTag=false,grpId,grpName,grpDesc){
    let tax = Number(igst)>0?Number(igst):Number(cgst)+Number(sgst);
    let { unitMap } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let multiplier = Object.values(unitMap.find(obj=>sellUnit in obj))[0];
    let billModelObj = {
        name,
        type,
        hsn,
        quantity:qty,
        sellUnit,
        rate:rate*multiplier,
        tax:tax*amt/100,
        sgst,
        cgst,
        igst,
        desc
    };
    if(grpTag){
        billModelObj.isGrouped = true;
        billModelObj.grpId = grpId;
        billModelObj.grpName = grpName;
        billModelObj.desc = grpDesc;
    }
    await billModel.create(billModelObj);
    if(!id)
        return ipcMain.emit("create-stock",null,{name,hsn});
    let item = await stock.findOne({where:{id}});
    item.reduceStock = qty*multiplier;
    await item.save();
    await stock.update({
        pInfo:{
            ...item.pInfo,
            taxSlab:tax
        }
    },{
        where:{id}
    })
    let match = stockList.find(obj=>obj.id===id);
    if(!match){
        match = {};
        match.quantity = 0;
        match.specialPrice = [];
    }
    match.quantity -= qty*multiplier;
    let customerSpPrices = match.specialPrice?.filter(obj=>obj.customerId==custId)?.slice(0,5);
    match.specialPrice = match.specialPrice?.filter(obj=>obj.customerId!=custId);
    match.specialPrice = [
        ...match.specialPrice,
        ...customerSpPrices
    ]
    match.specialPrice?.push({
        customerId:custId,
        rate,
        billDate,
        billNo
    })
    return stock.update({
        specialPrice:match.specialPrice
    },{
        where:{id}
    });
}

async function save_exist(e,{billMeta,customer:customerObj,orderItems,orderId=""},flag="regular"){
    closeFlag = true;
    if(flag==="regular")
        saleWindow.close();
    if(!Object.keys(billMeta).includes("printObj"))
        billMeta.printObj = {captions:[{first:"Original Buyer's Copy"},{third:"Book Copy"}]};    
    const { name, address, phones, gst, email, id:custId } = customerObj;
    if("presets" in process && process?.presets?.target==="salePage")
        process.presets = {};
    let { billExpiry = 14 } = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString())
    let { 
        billStatus, 
        deliveryType,
        transportName="",
        transportId="",
        transportAddress="",
        transportContact="",
        netDue, 
        billNo, 
        billDate, 
        netTax,
        payment=[],
        netAmt,
        paymentStatus,
        billType,
        autoBill,
        orderRef,
        netAmtTax
    } = billMeta;
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    billMeta.printObj.captions = captionReducer(billMeta.printObj.captions);
    if(Number(billNo)===getLastBillNo()){
        setBillNo(Number(billNo));
        saleConfig.billNo = Number(billNo);
    }
    else{
        reduceBillNo();
        saleConfig.availableBillNo = saleConfig.availableBillNo.filter(_billNo=>_billNo!=Number(billNo));
    }
    fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(saleConfig));
    // return billPDF({billMeta,customer:customerObj,orderItems});// Temporary blocking
    let netPayment = Math.round(payment?.reduce((acc,obj)=>acc+obj.payment,0) ?? 0);
    if(!netDue && paymentStatus===false)
        netDue = Math.round(netAmt + netTax);
    else
        netDue = Math.round(netAmt + netTax - netPayment);
    if(deliveryType!=="hand")
        freight.sync()
        .then(model=>
            model.findOrCreate({
                where:{id:transportId},
                defaults:{
                    id:transportId,
                    name:transportName,
                    address:transportAddress,
                    phone:transportContact
                }
            })
            .then(()=>console.log("Transporter db updated!!"))
            .catch(console.log)
        )
    let match = customerList.find(obj=>obj.id===custId);
    if(!match){
        customerObj._type = "customer";
        let custObj = {...customerObj,moreInfo:{email}};
        Reflect.deleteProperty(custObj,"email");
        customerList.push(new People(custObj));
        customer.findOrCreate({
            where:{
                id:custId
            },
            defaults:{
                id:custId,
                name,
                address,
                phones:JSON.stringify(phones),
                gst,
                moreInfo:{email}
            }
        })
        .then(()=>console.log("Customer db updated"))
        .catch(console.log);
    }
    if(billNo==="spot"){// Updating billDate for billNo==spot
        let [ dd,mn,yy ] = (new Date()).toLocaleDateString("en-IN").split("/");
        mn = mn<11?mn++:0;
        if(mn===0)
            yy++;
        billDate = (new Date((new Date(yy,mn,1)).getTime() - 24*60*60*1000))
                    .toLocaleDateString("en-IN",{
                        month:"2-digit",
                        day:"2-digit",
                        year:"numeric"
                    })
                    .split("/")
                    .reduce((acc,str,i)=>{
                        acc = i===0 ? str : str+"-"+acc;
                        return acc;
                    },"");
    }
    const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
    ];
    // if(billNo!=="spot"){
    //     let match_sale = await sale.findOne({
    //         where:{
    //             billNo,
    //             [Op.and]:{
    //                 billNo,
    //             },
    //             [Op.and]:{
    //                 customerId:custId
    //             }
    //         }
    //     })
    //     if(match_sale)
    //         return dialog.showErrorBox("Bill exist","The Bill number already exist for this bill date & customer. If you want to edit a bill then please use customer portal.");
    // }

    // Price inspection
    try{
        await Promise.all(orderItems.map(async itemObj=>{
            if(itemObj.type==="grp")
                return await Promise.all(itemObj.items.map(itemObj=>priceInspector(itemObj)))
            return priceInspector(itemObj)
        }));
    }
    catch(err){
        console.log(err)
        return dialog.showErrorBox("Price ceiling violation","Sorry you don't have enough permission to sell at above or below price ceiling decided for the item by your administrator. Please contact your administrator.")
    }
    let billModel = await getBillModel(custId,(billNo==="spot"?monthNames[new Date().getMonth()]:billNo),billDate,billItemSchema);    
    let customerLedger = await getLedgerModel(custId,customerLedgerSchema);
    let lastBalance = (await ((await customerLedger.sync()).findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    orderItems = itemAnalyzer(orderItems);
    Promise.all([
        ...orderItems
        .filter(obj=>obj.type!=="service")
        .map(obj=>{
            if(obj.type==="grp"){
                let grpId = uuid.v4();
                return obj.items.map(_obj=>helperFunc1(_obj,billModel,custId,billDate,billNo,true,grpId,obj.name,obj.desc));
            }
            else
                return helperFunc1(obj,billModel,custId,billDate,billNo);
        }),//updating stock
        (billNo!=="spot" && customerLedger.create({
            billStatus,
            date: billDate,
            billNo,
            billAmt:Math.round(netAmtTax),
            payments:Math.round(netPayment),
            itemList:`${custId}_${billNo}_${billDate}`,
            balance: Math.round(lastBalance + netAmtTax - netPayment)
        })),
        (await sale.sync()).create({// Update Sale Table to make room for discVal
            billStatus,
            customerId:custId,
            name,
            billNo,
            billType,
            billDate,
            billAmt:netAmtTax,
            netAmt,
            tax:netTax,
            payment:netPayment,
            paymentStatus,
            netDue:netDue,
            billItemTable:`${custId}_${billNo}_${billDate}`,
            autoBill,
            orderRef,
            delivery:deliveryType!=="hand"?{transportName,transportAddress,transportContact}:"hand",
            billformonth:monthNames[new Date().getMonth()]
        })
    ])
    .then(async ()=>{
        if(netPayment>0)
            await (await inPayments.sync())
            .create({
                id:custId,
                payment:netPayment,
                date:billDate
            });
        console.log("Added to DB!!");
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Bill added to your sale and stocks and/or ledger updated."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("sale",JSON.stringify({name,billNo,netPayment}));
        if(flag!="regular"){
            await manageOrder(null,{billMeta,customer:customerObj,orderItems,orderId},flag);
            BrowserWindow.fromId(e.sender.id).webContents.send("billing-complete");
        }
        else// Creating notification for regular bills
        if(flag==="regular" && paymentStatus===false){
            let evObj = {
                label:`Bill Number ${billNo} expired`,
                type: "bill-payment",
                billType: "sales-select",
                time: new Date(new Date(billDate).getTime() + billExpiry * 24 * 60 * 60 * 1000),
                tag: "Payment collection",
                color: "#0000FF",
                billObj:{
                    ...billMeta,
                    ...customerObj
                }
            }
            ipcMain.emit("manage-schedule",null,evObj,"a",false);
        }
        BrowserWindow.fromId(e.frameId).webContents.send("update-content");
    })
    .catch(console.log);
    if(billType!=="monthly")
        return billPDF({billMeta,customer:customerObj,orderItems});
    closeFlag = true;
}

ipcMain.on("save-exit-sale-bill",save_exist);

ipcMain.handle("get-customers",async ()=>{
    if(customerList.length>0) return customerList;
    await initCustomerList();
    return customerList;
});

ipcMain.on("salepage-print-doc",async (e,billObj,flag="regular")=>{
    let path2pdf = await save_exist(e,billObj,flag);
    if(!path2pdf) return;
    // return path2pdf; // Temporary blocking
    let {billMeta:{billStatus,printObj:{ printer,copies=1,paperSize,printOrientation } } } = billObj;
    if(billStatus!=="open")
        switch(process.platform){
            case "linux":
                return printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
            case "win32":
                return printOnWindows(path2pdf,printer,copies,paperSize);
            case "darwin":
                return printOnLinuxOrMac(path2pdf,printer,copies);
            default:
                dialog.showErrorBox("Unsupported OS","Print funcationality is not supported for your OS. Try print the bill manually.");
        }
    else
        dialog.showErrorBox("Print blocked","Bill status is currently 'open', set the bill status to 'close' and try again.")
});

ipcMain.handle("get-transporter",async ()=>{
    return (await (await freight.sync()).findAll()).map(({dataValues})=>dataValues);
});

ipcMain.on("get-sales",async e=>{
    try{
        let dt = getFinYearStrtEndDt()?.strtDt ?? new Date(new Date().getFullYear(),3,1)
        let sales = (await (await sale.sync())
        .findAll({
            where:{
                billDate:{
                    [Op.gte]:dt
                }
            },
            order:[["entryNo","DESC"]]
        }))
        .map(({dataValues})=>dataValues);
        e.sender.send("get-sales-response",sales);
    }
    catch(err){
        console.log(err)
    }

});

ipcMain.handle("get-sales",async e=>{
    return (await (await sale.sync()).findAll({order:[["entryNo","DESC"]]})).map(({dataValues})=>dataValues);
});

ipcMain.handle("get-ledger-balance",async (e,custId)=>{
    let customerLedger = await getLedgerModel(custId,customerLedgerSchema);
    return (await ((await customerLedger.sync()).findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
});

ipcMain.on("new-order",async (e,{billMeta,mode})=>{
    let { name="",address,gst,email,phones,netAmtTax,netDue,paymentStatus,orderItems } = billMeta;
    let orderId = uuid.v5(name+Date.now(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    // fs-base order management
    let baseDir = getBaseDir();
    let ordersFilePath = path.resolve(baseDir,"orders.json");
    let data = JSON.parse(fs.readFileSync(ordersFilePath).toString());
    billMeta.billDate = new Date()
                        .toLocaleDateString("en-IN",{
                            month:"2-digit",
                            day:"2-digit",
                            year:"numeric"
                        })
                        .split("/")
                        .reduce((acc,str,i)=>{
                            acc = i===0 ? str : str+"-"+acc;
                            return acc;
                        },"");
    if(paymentStatus===false && billMeta.netPayment===0){
        billMeta.netDue = Math.round(netAmtTax);
        netDue = billMeta.netDue;
    }
    let orderObj = {
        orderId,
        status:"queued",
        paymentStatus,
        name,
        netAmtTax,
        netDue,
        billDate:billMeta.billDate
    };
    if("fileList" in data)
        data.fileList.push(orderObj);
    else
        data.fileList = [orderObj];
    try{
        fs.writeFileSync(path.resolve(baseDir,orderId),JSON.stringify(billMeta));
        fs.writeFileSync(ordersFilePath,JSON.stringify(data));
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message,
            line:"manage order ipc- last try-catch"
        });
    }
    if(mode==="proforma"){
        billMeta.printObj = {
            captions:["Proforma Invoice"]
        };
        billMeta.billNo = "proforma_"+orderId.slice(0,orderId.length/3);
        let path2pdf = await billPDF({billMeta,customer:{name,address,email,phones,gst},orderItems});
        let resp = await dialog.showMessageBox({
            title:"Choose a action",
            message:"Do you like to print the proforma bill?",
            buttons:["Print","Save & Exit"]
        });
        if(resp.response===0){// Continue to print order
            let modal = printDialog(function(){
                this.webContents.send("hide-label");
            });
            let orderWin = modal.getParentWindow();
            function _print(e,printObj){
                billMeta.printObj = {
                    ...printObj,
                    captions:["Proforma Invoice"]
                };
                modal.close();
                orderWin.close();
                printPDF(path2pdf,billMeta.printObj);
            }
            modal.on("close",()=>ipcMain.removeListener("print-obj",_print));
            ipcMain.once("print-obj",_print);
        }
        else
            BrowserWindow.getFocusedWindow().close();
    }
    if(mode!="proforma")
        BrowserWindow.getFocusedWindow().close();
});

async function manageOrder(e,billMeta,flag){
    let baseDir = getBaseDir(),orderPath = getOrderPath();
    try{
        if(flag==="order-billed"){
            let id = billMeta.orderId;
            let orderJSON = JSON.parse(fs.readFileSync(orderPath).toString());
            orderJSON.fileList.splice(orderJSON.fileList.findIndex(obj=>obj.orderId===id),1)
            fs.writeFileSync(orderPath,JSON.stringify(orderJSON));
            if(fs.existsSync(path.resolve(baseDir,id)))
                  fs.unlinkSync(path.resolve(baseDir,id));
        }
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"manageOrder"
        });
    }
}

ipcMain.handle("manage-order",manageOrder);

ipcMain.on("set-listener-order-manager",(e)=>{
    ipcMain.once("print-obj",(ev,printObj)=>{
        getTargetWindow("Custom-Print-Dialog").close();
        e.sender.send("printObj",printObj);
    });
});

ipcMain.handle("get-order",(e,orderId)=>{
    return JSON.parse(fs.readFileSync(orderId).toString());
});

function traverseDate(date,annualHolidays,weeklyHolidays){
    if((annualHolidays.find(dt=>dt.getDate()===date.getDate() && dt.getMonth()===date.getMonth())) || weeklyHolidays.includes(date.getDay())){
        date.setDate(date.getDate()-1);
        return traverseDate(date,annualHolidays,weeklyHolidays);
    }
    else
        return date;
}

ipcMain.handle("get-date", ()=>{
    let date = new Date();
    let dayArray = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    let annualHolidays = (process.presets.annualHolidays?.split(",").map(dt=>dt.trim())
                        .map(dt=>{
                            let [ dd,mm,yyyy ] = dt.split("/");
                            mm--;
                            return new Date(yyyy,mm,dd)
                        }) ?? []);
    let weeklyHolidays = (process.presets.weeklyHolidays?.split(",").map(day=>day.trim())
                        .map(day=>dayArray.findIndex(entry=>entry===day)) ?? []);
    date = traverseDate(date,annualHolidays,weeklyHolidays);
    return date;
})