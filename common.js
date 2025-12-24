const { dialog, BrowserWindow, app, ipcMain, Menu } = require("electron");
const { ledgerPDF } = require("./scripts/makePDF.default");
const { Op } = require("sequelize");
const path = require("path");
const fs = require("fs");
const { printOnLinuxOrMac,printOnWindows } = require("./printHandler");
const { getMainWindow } = require("./createModal");
const { getsaleConfigPolicyPath } = require("./template/js/common");

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

async function getLedgerModel(id,ledgerSchema,_sequelize){
    const { sequelize } = require("./model/dbConfig");
    let supplierLedger = `${id}Ledger`;
    let inst = sequelize;
    if(_sequelize)
        inst = _sequelize;
    supplierLedger = await (inst.define(supplierLedger,ledgerSchema,{
        freezeTableName: true,
        timestamps: false,
        setterMethods:{
            updateBalance(updtVal){
                this.setDataValue("balance",this.getDataValue("balance")+updtVal);
            }
        }
    }).sync());
    return supplierLedger
}

exports.getLedgerModel = getLedgerModel;

exports.getBillModel = async function getBillModel(id,billNo,billDate,billSchema,_sequelize){
    const { sequelize } = require("./model/dbConfig");
    let itemListTable = `${id}_${billNo}_${billDate}`;
    let inst = sequelize;
    if(_sequelize)
        inst = _sequelize;
    let billModel = await inst.define(itemListTable,billSchema,{
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

function getFinYearStrtEndDt(year){
    if(!("presets" in process) || !("financialYearStartDate" in process.presets)) return;
    let strtDt = new Date(),endDt = new Date();
    strtDt.setDate(1);
    strtDt.setMonth(process.presets.financialYearStartDate.getMonth());
    if(strtDt.getMonth()>new Date().getMonth())
        strtDt.setFullYear(strtDt.getFullYear()-1)
    if(year===1){
        endDt.setDate(strtDt.getDate() - 1);
        endDt.setMonth(strtDt.getMonth() - 1);
        strtDt.setFullYear(strtDt.getFullYear()-1);
    }
    return { strtDt,endDt };
}

exports.getFinYearStrtEndDt = getFinYearStrtEndDt;

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
    let mainWin = getMainWindow();
    let msg = lines[0];
    if(typeof msg.notify==="undefined")
        msg.notify = true;
    // Error reporting notification 
    if(/error/i.test(msg.title) && msg.notify){
        let evObj = {
            tag:"Error",
            type:"Error",
            label:"Error",
            color:"#FF0000",
            time:new Date(),
            error:lineToAppend
        };
        ipcMain.emit("manage-schedule","Error",evObj,"exp-a",false);
        mainWin.webContents.send("check-notification")//notifyJobs,showToast
    }
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
        this.lastLogin = Date.now()/1000;
        if(this.secret)
            this.verify = true;
    }
    logout(){
        this.lastLogout = Date.now()/1000;
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
    const { customer } = require("./model/dbConfig");
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

exports.priceInspector = function(itemObj){
    return new Promise((res,rej)=>{
        if(!("maxPrice" in itemObj) && !("minPrice" in itemObj))
            return res(true);
        if(global.user.role==="admin")
            return res(true);
        else{
            console.log("level 3")
            if(itemObj.maxPrice==="unset" && itemObj.minPrice==="unset")
                return res(true);
            console.log("level 4")
            if(itemObj.rate>itemObj.maxPrice || itemObj.rate<itemObj.minPrice)
                return rej(false);
        }
    });
}

exports.openFormatForDate = function(date=Date){
    if(!(date instanceof Date)) return date;
    return date.toLocaleDateString("en-IN",{
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

exports.captionReducer = function(arr){
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { billTemplate:{captions={}} } = saleConfig;
    return arr.reduce((acc,obj)=>{
        let caption,key = Object.keys(obj).pop();
        if(captions.find(obj=>Object.keys(obj)[0]===key))
            caption = captions[captions.findIndex(obj=>Object.keys(obj)[0]===key)][key];
        else
            caption = obj[key];
        acc.push(caption);
        return acc;    
    },[]);
}

exports.billDesignerWindow = (mainWindow) => {
  return () => {
    mainWindow.loadFile("./template/html/billLayout.html");
    let menu = Menu.getApplicationMenu();
    menu.append(
      new MenuItem({
        role: "fileMenu",
        submenu: [
          new MenuItem({
            label: "New",
            click: () => {
              mainWindow.webContents.send("new-template");
            },
          }),
          new MenuItem({
            label: "Open",
            click: async () => {
              try {
                let { canceled, filePaths } = await dialog.showOpenDialog({
                  defaultPath: app.getPath("documents"),
                  filters: [{ name: "JSON Files", extensions: ["json"] }],
                  icon:appIcon
                });
                if (canceled) return;
                fs.readFile(filePaths[0], (err, data) => {
                  if (err) throw err;
                  mainWindow.webContents.send(
                    "set-opened-file",
                    JSON.parse(data.toString()),
                    filePaths[0]
                  );
                });
              } catch (err) {
                appLogger({title:"Error",message:String(err),func:"filepath read error"});
              }
            },
          }),
          new MenuItem({
            label: "Save as",
            click: () => mainWindow.webContents.send("save-as"),
          }),
          new MenuItem({
            label: "Save & Exit",
          }),
        ],
        enabled: true,
        visible: true,
        label: "File",
      })
    );
    Menu.setApplicationMenu(menu);
  };
};