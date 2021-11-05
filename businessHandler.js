const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { sequelize, sale, purchase, outPayments, inPayments } = require("./model/dbConfig");
const { supplierLedgerSchema,customerLedgerSchema } = require("./model/dynamicSchemas");
const { getLedgerModel } = require("./common");
const { Op } = require("sequelize");
const { gstRecurranceTerm,financialYearStartDate } = require("./config/policy.json");


let windowOptions = {
    width: 800,
    height: 600,
}

exports.createGSTSummaryWindow = mainWindow => {
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/gstSummaryPage.html",{
            maxWinCount:1,
            label:"GST-Summary"
        });
    }
}

exports.createBusinessStatPage = mainWindow => {
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/businessStat.html",{
            maxWinCount:1,
            label:"Business-Stat"
        });
    }
}

async function calcNetTax(table,startDate,endDate){
    let {tax} = (await table.findOne({
        where:{
            billDate:{
                [Op.between]:[startDate,endDate]
            }
        },
        attributes:[
            [sequelize.fn("SUM",sequelize.col("tax")),"tax"]
        ]
    })).dataValues;
    
    return tax;
}

ipcMain.on("get-all-gst-current-month",async e=>{
    let startDate = new Date(),endDate = new Date();
    let [dt,mnth] = financialYearStartDate.split("/");
    let financialYearCommissionDt = new Date();
    financialYearCommissionDt.setMonth(+mnth-1,+dt);
    let financialYearTerminationDt = new Date(financialYearCommissionDt);
    let monthlyGSTs = [];
    financialYearTerminationDt.setFullYear(financialYearCommissionDt.getFullYear()+1,financialYearCommissionDt.getMonth(),0);
    startDate.setDate(1);
    endDate.setMonth(startDate.getMonth()+1,0);
    if((endDate - startDate)/(1000*60*60*24)>31) throw new Error("Period Calculator code NOT Working!!");
    // console.log({startDate,endDate})
    let inTax = await calcNetTax(sale,startDate,endDate); 
    let outTax = await calcNetTax(purchase,startDate,endDate);
    // console.log("\x1b[31m%s\x1b[31m",{inTax,outTax,startDate:startDate.toDateString(),endDate:endDate.toDateString()})
    e.sender.send("get-all-gst-current-month-response",{outTax,inTax});
    startDate = new Date(financialYearCommissionDt.toDateString());
    for(let i=0;i<12;i++){
        endDate = new Date(startDate.toDateString());
        endDate.setMonth(startDate.getMonth()+1,0);
        inTax = await calcNetTax(sale,startDate,endDate) ?? 0; 
        outTax = await calcNetTax(purchase,startDate,endDate) ?? 0;
        // console.log("\x1b[33m%s\x1b[33m",{inTax,outTax,startDate:startDate.toDateString(),endDate:endDate.toDateString()})
        monthlyGSTs.push({inTax,outTax,month:startDate.getMonth()})        
        startDate.setMonth(endDate.getMonth()+1,1);
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
    if(period===7)
        startDate = new Date(Date.now()-(period+(new Date()).getHours()/24)*24*60*60*1000);
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
    attributes = period===7 ? ["billDate","billAmt"] : ["billAmt"];
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