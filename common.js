const { sequelize } = require("./model/dbConfig");
const { printOnLinuxOrMac,printOnWindows } = require("./printHandler");
const { dialog,ipcMain } = require("electron");
const { ledgerPDF } = require("./scripts/makePDF.default");
const { customer,supplier } = require("./model/dbConfig");
const { customerLedgerSchema,supplierLedgerSchema } = require("./model/dynamicSchemas");
const { Op } = require("sequelize");


async function getLedgerModel(id,ledgerSchema){
    let supplierLedger = `${id}Ledger`;
    supplierLedger = await (sequelize.define(supplierLedger,ledgerSchema,{
        freezeTableName: true,
        timestamps: false
    }).sync());
    return supplierLedger
}

exports.getLedgerModel = getLedgerModel;

exports.getBillModel = async function getBillModel(id,billNo,billDate,billSchema){
    let itemListTable = `${id}_${billNo}_${billDate}`;
    let billModel = await sequelize.define(itemListTable,billSchema,{
        freezeTableName: true,
        timestamps: false
    }).sync();
    return billModel
}

function print({printObj,path2pdf}){
    const {printer,copies,paperSize,printOrientation} = printObj;
    if(process.platform==="linux" || process.platform==="darwin")
        printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
    else
    if(process.platform==="win32")
        printOnWindows(path2pdf)
    else
        dialog.showErrorBox("Unsupported OS","The print function is not yet supported for your OS.")
}

function getStartDate(period){
    let startDate = new Date();
    startDate.setDate(1);
    startDate.setMonth(startDate.getMonth() - period);
    return startDate;
}

exports.getStartDate = getStartDate;

ipcMain.on("printObj",print);

ipcMain.on("print-ledger",async (e,id,period,mode)=>{
    let ledgerSchema = mode==1?supplierLedgerSchema:customerLedgerSchema;
    let ledger = await getLedgerModel(id,ledgerSchema);
    let startDate = getStartDate(period);
    let entryArr = (await ledger.findAll({
        where:{
            date:{
                [Op.between]:[startDate.toDateString(),new Date().toDateString()]
            }
        }
    })).map(({dataValues})=>({...dataValues}));
    let peopleObj = (mode==1?await supplier.findOne({where:{id}}):await customer.findOne({where:{id}})).dataValues;
    let path2pdf = ledgerPDF(entryArr,peopleObj,startDate);
    ipcMain.emit("show-print-modal",path2pdf);
});