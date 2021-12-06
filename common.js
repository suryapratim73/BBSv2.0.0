const { sequelize } = require("./model/dbConfig");
const { printOnLinuxOrMac,printOnWindows } = require("./printHandler");
const { dialog, ipcMain, BrowserWindow } = require("electron");
const { ledgerPDF } = require("./scripts/makePDF.default");
const { customer,supplier } = require("./model/dbConfig");
const { customerLedgerSchema,supplierLedgerSchema } = require("./model/dynamicSchemas");
const { Op } = require("sequelize");
const path = require("path");
const fs = require("fs");
const { getMainWindow,getTargetWindow } = require("./createModal");


ipcMain.on("openDevTool",(e)=>{
    console.log("Opening DevTool")
    e.sender.toggleDevTools();
});

ipcMain.on("close",(e,label)=>{
    let purchaseWindows = BrowserWindow.getAllWindows();
    if(purchaseWindows.length>0)
        purchaseWindows = purchaseWindows.filter(purchaseWindow=>purchaseWindow!==BrowserWindow.getFocusedWindow())
    if(label){
        let win = getTargetWindow(label);
        win?.close();
        if(label==="Salary-Modal")
            ipcMain.emit("Salary-Modal");
    }
    else{
        let mainWin = getMainWindow();
        let windows = BrowserWindow.getAllWindows();
        windows = windows.filter(win=>win!==mainWin);
        windows.pop().close();
    }
});

exports.closeAndDisplay = function(msg){
    let purchaseWindows = BrowserWindow.getAllWindows()
    let parentWindow = BrowserWindow.getFocusedWindow().getParentWindow();
    let focusedWindow = BrowserWindow.getFocusedWindow();
    purchaseWindows = purchaseWindows.filter(window=>window!==focusedWindow);
    focusedWindow.close();
    dialog.showMessageBox(parentWindow,msg)
}

class BillNoGenerator{
    constructor(initBillNo){
        if(initBillNo)
            this.billNo = initBillNo;
        else
            this.billNo = 0;
    }
    getNextBillNo(){
        this.billNo++;
        return this.billNo;
    }
    reduceBillNo(){
        this.billNo--;
    }   
}

class FileHandler{
    constructor(fPath,rPath){
        this.fPath = fPath;
        this.rPath = rPath;
        if(!fs.existsSync(path.resolve(__dirname,this.fPath,this.rPath)))
            fs.mkdir(path.resolve(__dirname,this.fPath,this.rPath),(err)=>{
                if(err)
                    throw err;
                console.log("log directory created!")
            });
        this.fd = fs.openSync(path.resolve(__dirname,this.fPath),"a+");
    }
}

let billNoGenInstance,loggerFH = [];

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

exports.billNoCounter = function(count){
    if(count)
        billNoGenInstance = new BillNoGenerator(count);
    else
        return billNoGenInstance.getNextBillNo();
}

exports.reduceBillNo = function(){
    billNoGenInstance.reduceBillNo();
}

exports.getLastBillNo = function(){
    return billNoGenInstance.billNo;
}

exports.loggerFH = function(fileName){
    let fh = new FileHandler(`./logs/${fileName}`,"../");
    loggerFH.push({[fileName]:fh});
    return fh;
}

exports.getLoggerFD = function(...arg){
    if(arg.length===0)
        return loggerFH.map(obj=>Object.values(obj)[0].fd);
    else
        return loggerFH.find(obj=>Object.keys(obj)[0]===arg[0])?.[arg[0]].fd;
}

exports.appLogger = function(...lines){
    let appLoggerFD = loggerFH.find(obj=>(Object.keys(obj)[0]==="appLogs.txt"))["appLogs.txt"].fd;
    let lineToAppend = lines.reduce((str,line)=>(str+line+"\t"),(new Date()).toLocaleString("en-GB")+"\t")+"\n";
    fs.appendFile(appLoggerFD,lineToAppend,err=>{
        if(err) throw err;
    })
}

class People{
    static iterator(args,that){
        for(let key in args)
            that[key] = args[key];
    }
    constructor(args){
        People.iterator(args,this)
    }
    append(args){
        People.iterator(args,this);
    }
}

exports.People = People;

exports.checkAuthority = async function(){
    // throw new Error("No permission"); 
    return true;
}