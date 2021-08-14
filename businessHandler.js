const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { sequelize, sale, purchase } = require("./model/dbConfig");
const { supplierLedgerSchema,customerLedgerSchema } = require("./model/dynamicSchemas");
const { getLedgerModel } = require("./common");
const { Op } = require("sequelize");
const { gstRecurranceTerm,financialYearStartDate } = require("./config/policy.json");


exports.createGSTSummaryWindow = mainWindow => {
    let pathToHTML = "./template/html/gstSummaryPage.html";
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
    };
    return ()=>{
        createModal(windowOptions,pathToHTML);
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