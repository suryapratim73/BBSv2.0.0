const { ipcMain, dialog } = require("electron");
const { createModal } = require("./createModal");
const { BrowserWindow } = require("electron/main");
const { customer, stock, freight, inPayments, sale, people, sequelize } = require("./model/dbConfig");
const { getLedgerModel, getBillModel, billNoCounter, reduceBillNo, appLogger, People } = require("./common");
const { customerLedgerSchema, billItemSchema } = require("./model/dynamicSchemas");
const { scriptFile } = require("./config/saleConfig.json");
const { billPDF } = require(`./scripts/${scriptFile}`);
const { printOnLinuxOrMac, printOnWindows } = require("./printHandler");
const { unitMap } = require("./config/saleConfig.json");
const { stockList } = require("./handleStock");


let closeFlag = false,
    saleWindow,
    customerList = [],
    windowOptions = {
        width: 800,
        height: 600
    };

exports.saleWindow = ()=>{
    return ()=>{
        windowOptions.parent = undefined;
        saleWindow = createModal(windowOptions,"./template/html/salePage.html");
        saleWindow?.on("close",(e)=>{
            if(!closeFlag){
                e.preventDefault();
                e.sender.send("get-current-step");
            } else
                closeFlag = false;
        })
    }
}

exports.showSales = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;
        saleWindow = createModal(windowOptions,"./template/html/showSale.html",{maxWinCount:1,label:"Sale-Dsiplay"});
    }
}

ipcMain.handle("get-sale-bill-number",()=>{
    return billNoCounter();
});

ipcMain.on("cancel-sale-bill",(e,currentStep)=>{
    if(currentStep>1)
        reduceBillNo();
    closeFlag = true;
    BrowserWindow.getFocusedWindow().close();
});

async function save_exist(e,{billMeta,customer:customerObj,orderItems}){
    closeFlag = true;
    saleWindow.close();
    if(!Object.keys(billMeta).includes("printObj"))
        billMeta.printObj = {captions:["Original Buyer's Copy"]}
    const { name, address, phones, gst, email, id:custId } = customerObj;
    let { 
        billStatus, 
        deliveryType,
        transportName="",
        transportId="",
        transportAddress="",
        transportContact="",
        transportCharge="",
        coolieName="",
        coolieContact="",
        coolieCharge="",
        netDue, 
        billNo, 
        billDate, 
        netTax,
        payment,
        netAmt,
        id="",
        paymentStatus 
    } = billMeta;
    return billPDF({billMeta,customer:customerObj,orderItems});// Temporary blocking
    closeFlag = true;
    let netPayment = Math.round(payment?.reduce((acc,obj)=>acc+obj.payment,0) ?? 0);
    if(!netDue && paymentStatus===false)
        netDue = Math.round(netAmt + netTax);
    else
        netDue = Math.round(netAmt + netTax - netPayment);
    let deliveryCharge = Math.round(Number(transportCharge) + Number(coolieCharge));
    if(deliveryType!=="hand")
        freight.sync()
        .then(model=>
            model.findOrCreate({
                where:{id:transportId},
                defaults:{
                    id:transportId,
                    name:transportName,
                    address:transportAddress,
                    phone:transportContact,
                    charge:transportCharge
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
    let billModel = await getBillModel(custId,billNo,billDate,billItemSchema);
    let customerLedger = await getLedgerModel(custId,customerLedgerSchema);
    let lastBalance = (await ((await customerLedger.sync()).findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    Promise.all([
        ...orderItems.filter(obj=>obj.type!=="service")
        .map(({name,qty,sellUnit,rate,amt,cgst=0,sgst=0,igst=0,hsn,type})=>{
            let tax = igst>0?igst:cgst+sgst;
            let multiplier = Object.values(unitMap.find(obj=>sellUnit in obj))[0];
            return billModel.create({
                name,
                type,
                hsn,
                quantity:qty,
                sellUnit,
                rate:rate*multiplier,
                tax:tax*amt/100
            })
        }),
        customerLedger.create({
            billStatus,
            date:billDate,
            billNo,
            billAmt:Math.round(netAmt),
            tax:Math.round(netTax),
            paymentStatus,
            payments:Math.round(netPayment),
            netDue,
            itemList:`${custId}_${billNo}_${billDate}`,
            delivery:deliveryType!=="hand"?{transportName,transportAddress,transportContact,transportCharge,coolieName,coolieCharge,coolieContact}:"hand",
            balance: Math.round(lastBalance + billMeta.netAmtTax + deliveryCharge - netPayment)
        }),
        ...orderItems
        .filter(obj=>obj.type!=="service")
        .map(async ({qty,id,sellUnit,rate})=>{
            let multiplier = Object.values(unitMap.find(obj=>sellUnit in obj))[0];
            let item = await stock.findOne({where:{id}});
            item.reduceStock = qty*multiplier;
            await item.save();
            let match = stockList.find(obj=>obj.id===id);
            match.quantity -= qty*multiplier;
            match.specialPrice?.push({
                customerId:custId,
                rate,
                billDate,
                billNo
            })
            return await stock.update({
                specialPrice:match.specialPrice
            },{
                where:{id}
            });
        }),//updating stock
        (await sale.sync()).create({
            billStatus,
            customerId:custId,
            name,
            billNo,
            billDate,
            billAmt:Math.round(billMeta.netAmtTax+deliveryCharge),
            tax:Math.round(netTax),
            payment:Math.round(netPayment),
            paymentStatus,
            netDue:Math.round(netDue),
            billItemTable:`${custId}_${billNo}_${billDate}`
        }),
        (await people.sync()).findOrCreate({
            where:{id},
            defaults:{
                id,
                relation:"Coolie",
                name:coolieName,
                phones:coolieContact,
                moreInfo:{charge:transportCharge}
            }
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
        appLogger("sale",JSON.stringify({name,billNo,netPayment}))
    })
    .catch(console.log);
    return billPDF({billMeta,customer:customerObj,orderItems});
}

ipcMain.on("save-exit-sale-bill",save_exist);

async function initCustomerList(){
    (await (await customer.sync()).findAll())
    .map(({dataValues})=>dataValues)
    .forEach(obj=>{
        obj._type = "customer";
        customerList.push(new People(obj));
    });
}

ipcMain.handle("get-customers",async ()=>{
    if(customerList.length>0) return customerList;
    await initCustomerList();
    return customerList;
});

ipcMain.on("salepage-print-doc",async (e,billObj)=>{
    let path2pdf = await save_exist(e,billObj);
    return path2pdf; // Temporary blocking
    let {billMeta:{billStatus,printObj:{ printer,copies=1,paperSize,printOrientation } } } = billObj;
    if(billStatus!=="open")
        switch(process.platform){
            case "linux":
                return printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
            case "win32":
                return printOnWindows(path2pdf);
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
    e.sender.send("get-sales-response",(await (await sale.sync()).findAll({order:[["entryNo","DESC"]]})).map(({dataValues})=>dataValues));
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

exports.customerList = customerList;
exports.initCustomerList = initCustomerList;