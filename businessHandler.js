const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { sequelize, sale, purchase, outPayments, inPayments } = require("./model/dbConfig");
const { getLedgerModel } = require("./common");
const { getTemplatePath } = require("./viewManager");
const { Op, DataTypes } = require("sequelize");
const { getUserPolicyPath } = require("./template/js/common");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { deserializeSchema } = require("./model/schemaLoader");
// require('@electron/remote/main').initialize();


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.json");

if(!(fs.existsSync(dynamicSchemaPath)))
    dynamicSchemaPath = "./model/dynamicSchemas.json";

const dynamicSchemaJson = fs.readFileSync(dynamicSchemaPath, 'utf8');
const { supplierLedgerSchema,customerLedgerSchema } = deserializeSchema(dynamicSchemaJson, DataTypes);

let windowOptions = {
    width: 800,
    height: 600
}

exports.createGSTSummaryWindow = mainWindow => {
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,getTemplatePath("gstSummaryPage"),{
            maxWinCount:1,
            label:"GST-Summary"
        })//.webContents.openDevTools();
    }
}

exports.createBusinessStatPage = mainWindow => {
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,getTemplatePath("businessStat"),{
            maxWinCount:1,
            label:"Business-Stat"
        });//.webContents.openDevTools();
    }
}

async function calcNetTax(table,startDate,endDate){
    let tax = (await table.findOne({
        where:{
            billDate:{
                [Op.between]:[startDate,endDate]
            }
        },
        attributes:[
            [sequelize.fn("SUM",sequelize.col("tax")),"tax"]
        ]
    })).dataValues?.tax ?? 0;   
    return tax;
}

ipcMain.on("get-all-gst-current-month",async e=>{
    let { gstInterval=1,financialYearStartDate=new Date((new Date()).getFullYear(),3,1) } = process.presets;
    let startDate = new Date(),endDate = new Date();
    let [dt,mnth] = financialYearStartDate.toLocaleDateString("en-IN").split("/");
    let financialYearCommissionDt = new Date();
    financialYearCommissionDt.setMonth(+mnth-1,+dt);
    let financialYearTerminationDt = new Date(financialYearCommissionDt);
    let monthlyGSTs = [];
    financialYearTerminationDt.setFullYear(financialYearCommissionDt.getFullYear()+1,financialYearCommissionDt.getMonth(),0);
    if(gstInterval===1){
        startDate.setDate(1);
        endDate.setMonth(startDate.getMonth()+1,0);
    }
    else{
        let multiplier = Math.floor((startDate.getMonth()-financialYearCommissionDt.getMonth())/gstInterval);
        startDate.setMonth(financialYearCommissionDt.getMonth()+3*multiplier,1);
        endDate.setMonth(startDate.getMonth()+3,0);
    }
    // if((endDate - startDate)/(1000*60*60*24)>31) throw new Error("Period Calculator code NOT Working!!");
    let inTax = await calcNetTax(sale,startDate,endDate); 
    let outTax = await calcNetTax(purchase,startDate,endDate);
    // console.log("\x1b[31m%s\x1b[31m",{inTax,outTax,startDate:startDate.toDateString(),endDate:endDate.toDateString()})
    e.sender.send("get-all-gst-current-month-response",{outTax,inTax});
    startDate = new Date(financialYearCommissionDt.toDateString());
    for(let i=0;i<12/gstInterval;i++){
        if(gstInterval===1){
            endDate = new Date(startDate.toDateString());
            endDate.setMonth(startDate.getMonth()+1,0);
            inTax = await calcNetTax(sale,startDate,endDate); 
            outTax = await calcNetTax(purchase,startDate,endDate);
            startDate.setMonth(endDate.getMonth()+1,1);
            monthlyGSTs.push({inTax,outTax,month:startDate.getMonth()-1})        
        }
        else{
            let multiplier = Math.floor((startDate.getMonth()-financialYearCommissionDt.getMonth())/gstInterval);
            startDate.setMonth(financialYearCommissionDt.getMonth()+3*multiplier,1);
            endDate.setMonth(startDate.getMonth()+3,0);
            inTax = await calcNetTax(sale,startDate,endDate); 
            outTax = await calcNetTax(purchase,startDate,endDate);
            // console.log({
            //     inTax,
            //     outTax,
            //     startDate:startDate.toLocaleDateString("en-IN"),
            //     endDate:endDate.toLocaleDateString("en-IN")
            // })
            startDate.setMonth(endDate.getMonth()+1,1)
            monthlyGSTs.push({inTax,outTax,month:`${gstInterval} quater`});
        }
        if(startDate.getMonth()>new Date().getMonth()) break;
        // console.log("\x1b[33m%s\x1b[33m",{inTax,outTax,startDate:startDate.toDateString(),endDate:endDate.toDateString()})
    }
    e.sender.send("monthly-gst",monthlyGSTs);
});

async function getPeriodicSalePurchase(table,where,attributes){
    
    return (await (await table.sync()).findAll({
        where,
        attributes
    })).map(({dataValues})=>dataValues);
}

ipcMain.on("get-total-sale-purchase",async (e,period)=>{
    let startDate;
    let financialYearStartDate = new Date((JSON.parse(fs.readFileSync(getUserPolicyPath()).toString())?.financialYearStartDate ?? new Date(new Date().getFullYear(),3,1))).toLocaleDateString("en-IN");
    if(period===7)
        startDate = new Date(Date.now()-((period-1)+(new Date()).getHours()/24)*24*60*60*1000);
    else{
        startDate = new Date();
        let [dt,mnth] = financialYearStartDate.split("/");
        if(startDate.getMonth()>+mnth-1)
            startDate.setMonth(+mnth-1,dt);
        else
            startDate.setFullYear(startDate.getFullYear()-1,+mnth-1,+dt);
    }
    let where = period===7? {
        billDate:{
            [Op.between]:[startDate,new Date()]
        }
    } : {
        billDate:{
            [Op.between]:[startDate,new Date()]
        },
        paymentStatus:false
    },
    attributes = period===7 ? ["billDate","billAmt","billDate"] : ["billAmt","billDate"];
    try{
        let sales = await getPeriodicSalePurchase(sale,where,attributes);
        let purchases = await getPeriodicSalePurchase(purchase,where,attributes);
        if(period===7){
            where = {date:{[Op.between]:[startDate,new Date()]}}
            attributes = ["payment","date"]
            let outPaymentObjs = await getPeriodicSalePurchase(outPayments,where,attributes);
            let inPaymentObjs = await getPeriodicSalePurchase(inPayments,where,attributes);
            e.sender.send("get-total-sale-purchase-response",{sales,purchases,outPaymentObjs,inPaymentObjs,period});
        }
        else{
            where = {billDate:where.billDate};
            let allSales = await getPeriodicSalePurchase(sale,where,attributes);
            let allPurchases = await getPeriodicSalePurchase(purchase,where,attributes);
            e.sender.send("get-yearly-sale-purchase-response",{sales,purchases,allSales,allPurchases})
        }
    }
    catch(err){
        console.log(err)
    }
});

ipcMain.handle("get-sale-purchase-by-date",async (e,date=new Date())=>{
    let sales = (await sale.findAll({
        where:{
            billDate:{
                [Op.between]:[date-date.getHours()*60*60*1000,date]
            }
        },
        attributes:["billAmt"]
    })).map(({dataValues})=>dataValues);
    let purchases = (await purchase.findAll({
        where:{
            billDate:{
                [Op.between]:[date-date.getHours()*60*60*1000,date]
            }
        },
        attributes:["billAmt"]
    })).map(({dataValues})=>dataValues);
    return { sales,purchases }
});