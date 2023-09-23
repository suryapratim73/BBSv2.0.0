const { sequelize } = require("./model/dbConfig");
const { dialog, BrowserWindow, app } = require("electron");
const { ledgerPDF } = require("./scripts/makePDF.default");
const { customer } = require("./model/dbConfig");
const { Op } = require("sequelize");
const path = require("path");
const fs = require("fs");
const { printOnLinuxOrMac,printOnWindows } = require("./printHandler");

let customerList = [];


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
    setBillNo(billNo){
        this.billNo = billNo;
    }   
}

class FileHandler{
    constructor(rPath,flag){
        this.rPath = rPath;
        this.rootPath = "";
        if(process.env.APP_ENV==="DEV")
            this.rootPath = __dirname;
        else
            this.rootPath = app.getPath("appData")+"/BBS";
        try{
            if(!fs.existsSync(path.resolve(this.rootPath,this.rPath)) && flag)
                fs.mkdirSync(path.resolve(this.rootPath,this.rPath,"../"),{recursive:true});
            this.fd = fs.openSync(path.resolve(this.rootPath,this.rPath),"a+");
        }
        catch(err){
            appLogger({
                title:"Error",
                message:err.message
            });
        }
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
    if(!path2pdf && typeof JSON.parse(JSON.stringify(this))==="string")
        path2pdf = this.toString();
    if(!path2pdf) return;
    if(process.platform==="linux" || process.platform==="darwin")
        printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
    else
    if(process.platform==="win32")
        printOnWindows(path2pdf,printer,copies,paperSize)
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

// ipcMain.on("printObj",print);

exports.print = print

exports.billNoCounter = function(count){
    if(count)
        billNoGenInstance = new BillNoGenerator(count);
    else
        return billNoGenInstance.getNextBillNo();
}

exports.setBillNo = function(billNo){
    billNoGenInstance.setBillNo(billNo);
}

exports.reduceBillNo = function(){
    billNoGenInstance.reduceBillNo();
}

exports.getLastBillNo = function(){
    return billNoGenInstance.billNo;
}

exports.loggerFH = function(fileName,fPath){
    let flag;
    if(!fPath){
        fPath = `./logs/${fileName}`;
        flag = true;
    }
    else{
        fPath = `./${fileName}`;
        flag = false;
    }
    let fh = new FileHandler(fPath,flag);
    loggerFH.push({[fileName]:fh});
    return fh;
}

exports.getLoggerFD = function(...arg){
    if(loggerFH.length===0) return;
    if(arg.length===0)
        return loggerFH.map(obj=>Object.values(obj)[0]?.fd);
    else
        return loggerFH.find(obj=>Object.keys(obj)[0]===arg[0])?.[arg[0]]?.fd;
}

exports.appLogger = function(...lines){
    let appLoggerFD = loggerFH.find(obj=>(Object.keys(obj)[0]==="appLogs.txt"))?.["appLogs.txt"].fd;
    let lineToAppend = lines.reduce((str,line)=>(str+JSON.stringify(line)+"\t"),(new Date()).toLocaleString("en-GB")+"\t")+"\n";
    if(process.env.APP_ENV==="DEV")
        console.log(lines[0]);
    if(appLoggerFD)
        fs.appendFile(appLoggerFD,lineToAppend,err=>{
            if(err) throw err;
        });
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

class User{
    constructor(id,name,secret,role,session,sessionTime,usePasswd){
        this.id = id;
        this.name = name;
        this.verify = false;
        if(secret)
            this.secret = secret;
        this.role = role;
        if(session){
            this.session = session;
            this.sessionTime = sessionTime;
        }
        else
            this.session = false;
        if(usePasswd)
            this.usePasswd = usePasswd;
    }
    login(){
        this.lastLogin = Date.now();
        if(this.secret)
            this.verify = true;
    }
    logout(){
        this.lastLogout = Date.now();
        this.verify = false;
    }
}

exports.User = User;

exports.customEncoder = function(num,skip){
    skip = skip % 2;
    return (num+skip)<<1;
}

exports.customDecoder = function(num,skip){
    skip = skip % 2;
    if(skip>4)
        skip = Math.abs(8 - skip);
    return (num>>1)-skip;
}

exports.getBaseDir = function(){
    if(process.env.APP_ENV==="DEV")
        return __dirname;
    else
        return app.getPath("appData")+"/BBS";
}

exports.initCustomerList = async function(){
    try{
        (await (await customer.sync()).findAll())
        .map(({dataValues})=>dataValues)
        .forEach(obj=>{
            obj._type = "customer";
            customerList.push(new People(obj));
        });
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message
        })
    }
}

exports.customerList = customerList;