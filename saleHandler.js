const { ipcMain, dialog } = require("electron");
const {createModal} = require("./createModal");
const fs = require("fs");
const { BrowserWindow } = require("electron/main");
const { customer, stock, transporters } = require("./model/dbConfig");
const { Op } = require("sequelize");
const { getLedgerModel, getBillModel } = require("./common");
const { customerLedgerSchema, billItemSchema } = require("./model/dynamicSchemas");
const {scriptFile} = require("./config/saleConfig.json");
const {billPDF} = require(`./scripts/${scriptFile}`);
const { printOnLinuxOrMac, printOnWindows } = require("./printHandler");


let closeFlag = false,saleWindow;
let windowOptions = {
    width: 1020,
    height: 600,
    resizable:false,
    webPreferences: {
        nodeIntegration: true,
        devTools:true
    },
    show:false,
    contextIsolation:true
}

function cancelBill(){
    let rawData = fs.readFileSync(__dirname+"/config/saleConfig.json").toString();
    let saleConfig=rawData!==""?JSON.parse(rawData):{};
    saleConfig.billNo--;
    fs.writeFileSync(__dirname+"/config/saleConfig.json",JSON.stringify(saleConfig));
}

exports.saleWindow = ()=>{
    return ()=>{
        let pathToHTML = "./template/html/salePage.html";
        saleWindow = createModal(windowOptions,pathToHTML);
        saleWindow.on("close",(e)=>{
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
        console.log("Show Sales");
    }
}

ipcMain.handle("get-sale-bill-number",()=>{
    let rawData = fs.readFileSync(__dirname+"/config/saleConfig.json").toString();
    let saleConfig=rawData!==""?JSON.parse(rawData):{};
    saleConfig.billNo = saleConfig.billNo?saleConfig.billNo+1:1;
    fs.writeFileSync(__dirname+"/config/saleConfig.json",JSON.stringify(saleConfig));
    return saleConfig.billNo;
});

ipcMain.on("cancel-sale-bill",(e,currentStep)=>{
    if(currentStep>1)
        cancelBill();
    closeFlag = true;
    BrowserWindow.getFocusedWindow().close();
});

function save_exist(e,{billMeta,customer:customerObj,orderItems}){
    closeFlag = true;
    saleWindow.close();
    if(!Object.keys(billMeta).includes("printObj"))
        billMeta.printObj = {captions:["Original Buyer's Copy"]}
    const { name, address, phones,gst } = customerObj;
    const { billStatus, delivery, netDue, billNo, billDate, payment="due",returnOrder=[],retAmt=0 } = billMeta;
    closeFlag = true;
    const { type,transporterName="",transporterAddress="",transporterContact="",transporterCharge=0 } = delivery;
    if(type!=="hand")
        transporters.sync()
        .then(model=>
            model.findOrCreate({
                where:{name:transporterName},
                defaults:{
                    name:transporterName,
                    address:transporterAddress,
                    phone:transporterContact,
                    charge:transporterCharge
                }
            })
            .then(()=>console.log("Transporter db updated!!"))
            .catch(console.log)
        )
    customer.sync()
    .then(async model=>{
        let customerId = (await model.findOrCreate({
            where:{
                [Op.or]:[{name},{gst}]
            },
            defaults:{
                name,
                address,
                phones:JSON.stringify(phones),
                gst
            }
        }))[0].dataValues.id;
        let billModel = await getBillModel(customerId,billNo,billDate,billItemSchema);
        let customerLedger = await getLedgerModel(customerId,customerLedgerSchema);
        Promise.all([
            ...orderItems.map(({name,qty,unit,rate,amt,cgst,sgst,igst,hsn,type})=>{
                let tax = igst>0?igst:cgst+sgst;
                return billModel.create({
                    name,
                    type,
                    hsn,
                    quantity:qty,
                    unit,
                    rate,
                    tax:tax*amt
                })
            }),
            customerLedger.create({
                billStatus,
                date:billDate,
                billNo,
                paymentStatus:netDue===0?true:false,
                payments:payment,
                netDue,
                itemList:`${customerId}_${billNo}_${billDate}`,
                delivery,
                returnOrder,
                retAmt
            }),
            ...orderItems.map(async ({name,qty})=>{
                let item = await stock.findOne({where:{name}});
                item.reduceStock=qty;
                return item.save();
            })//updating stock
        ])
        .then(()=>console.log("Added to DB!!"))
        .catch(console.log);
    })
    .catch(console.log)
    return billPDF({billMeta,customer:customerObj,orderItems});
}

ipcMain.on("save-exit-sale-bill",save_exist);

ipcMain.handle("get-customers",async ()=>{
    return (await customer.sync()).findAll();
});

ipcMain.on("salepage-print-doc",(e,billObj)=>{
    let path2pdf = save_exist(e,billObj);
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
    return (await transporters.sync()).findAll();
});