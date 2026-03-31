const { dialog, BrowserWindow, app, ipcMain, Menu } = require("electron");
const { ledgerPDF } = require("./scripts/makePDF.default");
const { Op } = require("sequelize");
const path = require("path");
const fs = require("fs");
const { printOnLinuxOrMac,printOnWindows } = require("./printHandler");
const { getMainWindow } = require("./createModal");
const { getsaleConfigPolicyPath, init } = require("./template/js/common");
const { end } = require("pdfkit");
const { default: axios } = require("axios");


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
            // Can't use appLogger here as it's not defined yet in module load order
            console.error("FileHandler Error:", err.message);
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
    let [ dt,mnt] = process.presets.financialYearStartDate.split("-").map(num=>Number(num));
    strtDt.setMonth(mnt);
    strtDt.setDate(dt);
    if(strtDt.getMonth()>new Date().getMonth()){
        strtDt.setFullYear(strtDt.getFullYear()-1);
        endDt.setFullYear(endDt.getFullYear());
    }
    endDt.setMonth(strtDt.getMonth() - 1);
    endDt.setDate(31);
    endDt.setFullYear(strtDt.getFullYear()-year+1);
    strtDt.setFullYear(strtDt.getFullYear()-year);
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

exports.initCustomerList = initCustomerList;
async function initCustomerList(customer,appLogger,getFivePercentOfMemory){
    try{
        global.customerList = [];
        (await (await customer.sync()).findAll())
        .map(({dataValues})=>dataValues)
        .forEach(obj=>{
            obj._type = "customer";
            global.customerList.push(obj);
        });
        checkNLogMemoryUsage("customerList",appLogger,getFivePercentOfMemory);
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message
        })
    }
}

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

exports.openFormatForDate = openFormatForDate;
function openFormatForDate(date=Date){
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
    const { getTemplatePath } = require("./viewManager");
    mainWindow.loadFile(getTemplatePath("billLayout"));
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
                const { appLogger } = require('./common.js');
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

exports.checkForInternet = function(){
    return new Promise((res,rej)=>{
        require("dns").lookup("google.com",(err)=>{
            if(err && err.code==="ENOTFOUND")
                res(false);
            else
                res(true);
        });
    });
}

exports.getFivePercentOfMemory = function(){
    const MAX_CACHE_BYTES = process.arch==="ia32" ? 1.5 * 1024 : 2 * 1024; //1.4GB for 32 bit and 4GB for 64 bit
    const totalMem = require("os").freemem();
    let fivePercentMem = totalMem * 0.1;
    fivePercentMem = Math.floor(fivePercentMem/(1024*1024)); // in MB
    return Math.min(fivePercentMem,MAX_CACHE_BYTES);
}

function checkNLogMemoryUsage(cacheType,appLogger,getFivePercentOfMemory){
    let currentHeapUsed = process.memoryUsage().heapUsed / (1024 * 1024); // in MB
    if(currentHeapUsed > getFivePercentOfMemory()){
        global[cacheType] = undefined;
        appLogger({
            title:`Cleared ${cacheType} Cache - Excessive Memory Usage`,
            message:`Cleared ${cacheType} cache due to excessive memory usage. Current Heap Used: ${Math.round(currentHeapUsed)} MB`,
            func:"common.js - checkNLogMemoryUsage"
        });
    }
}

exports.checkNLogMemoryUsage = checkNLogMemoryUsage;

exports.getAllSales = async function(sale,year,appLogger,getFivePercentOfMemory){
    let {strtDt,endDt} = getFinYearStrtEndDt(year);
    let sales = (await (await sale.sync())
            .findAll({where:{
                    billDate:{
                        [Op.between]:[strtDt,endDt]
                    }
                },
                order:[["entryNo","DESC"]]
            })).map(({dataValues})=>dataValues);
    global.sales = year==0 && sales;
    checkNLogMemoryUsage("sales",appLogger,getFivePercentOfMemory);
    return sales;
}

exports.getPurchases = async function(purchase,appLogger,getFivePercentOfMemory){
    let {strtDt,endDt} = getFinYearStrtEndDt(0);
    let purchases = (await purchase.findAll({
        where:{
            billDate:{
                [Op.between]:[strtDt,endDt]
            }
        },
        order:[
            ["billDate","DESC"]
        ]
    })).map(({dataValues})=>dataValues);
    global.purchases = purchases;
    checkNLogMemoryUsage("purchases",appLogger,getFivePercentOfMemory);
    return purchases;
}

exports.queryStock = async function(stock,attributes,appLogger,getFivePercentOfMemory){
    try{
        if(typeof global.stocks==="undefined"){      
            global.stocks = [];
            (await (await stock.sync()).findAll())
            .map(({dataValues})=>dataValues)
            .forEach(obj=>{
                obj._type = "stock";
                global.stocks.push(new People(obj));
            });
        }
        let _stockList = global.stocks;
        checkNLogMemoryUsage("stocks",appLogger,getFivePercentOfMemory);
        if(typeof attributes==="object"){
            return _stockList.map(stockObj=>{
                let tempObj = {}
                for(let key in stockObj)
                    if(attributes.includes(key))
                        tempObj[key] = stockObj[key];
                return tempObj;
                });
        }
        else{
            return _stockList;
        }
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message
        })
        return global.stocks
    }
}

exports.getOutPayments = async function(outPayments,appLogger,getFivePercentOfMemory){
    let strtDt = getFinYearStrtEndDt(0).strtDt;
    let _outPayments;
    if(typeof global.outPayments=="undefined" || global?.outPayments.length==0)
        _outPayments = (await outPayments.findAll({
            where:{
                date:{
                    [Op.gte]:strtDt
                }
            }
        })).map(({dataValues})=>dataValues);
    global.outPayments = _outPayments;
    checkNLogMemoryUsage("outPayments",appLogger,getFivePercentOfMemory);
    return _outPayments;
}

exports.initSuppliers = async function(supplier,appLogger,getFivePercentOfMemory){
    if(typeof global.suppliers=="undefined")
        global.suppliers = [];
        (await supplier.findAll())
        .map(({dataValues})=>dataValues)
        .forEach(suppObj=>{
            suppObj._type = "supplier";
            global.suppliers.push(new People(suppObj))
        });
    let _suppliers = global.suppliers;
    let currentHeapUsed = process.memoryUsage().heapUsed / (1024 * 1024); // in MB
    if(currentHeapUsed > getFivePercentOfMemory()){
        global.suppliers = undefined;
        appLogger({
            title:"Cleared Supplier Cache - Excessive Memory Usage",
            message:`Cleared supplier cache due to excessive memory usage. Current Heap Used: ${Math.round(currentHeapUsed)} MB`,
            func:"supplierHandler.js - initSuppliers"
        })
    }
    return _suppliers;
}

// List of major Indian districts/cities with codes (expand as needed)
const cityListWithCodes = [
    { name: "Mumbai", code: "BOM", abbreviation: "MUM", commonAbbreviation:"MUM",pincode:"400001", state:"Maharashtra", stateCode:"MH",gstStateCode:"07" },
    { name: "Delhi", code: "DEL", abbreviation: "DEL", commonAbbreviation:"DEL", pincode:"110001", state:"Delhi", stateCode:"DL",gstStateCode:"07" },
    { name: "Bengaluru", code: "BLR", abbreviation: "BLR", commonAbbreviation:"BLR", pincode:"560001", state:"Karnataka", stateCode:"KA",gstStateCode:"29" },
    { name: "Hyderabad", code: "HYD", abbreviation: "HYD", commonAbbreviation:"HYD", pincode:"500001", state:"Telangana", stateCode:"TG",gstStateCode:"36" },
    { name: "Chennai", code: "MAA", abbreviation: "MAA", commonAbbreviation:"CHE", pincode:"600001", state:"Tamil Nadu", stateCode:"TN",gstStateCode:"33" },
    { name: "Kolkata", code: "CCU", abbreviation: "CCU", commonAbbreviation:"KOL", pincode:"700001", state:"West Bengal", stateCode:"WB",gstStateCode:"19" },
    { name: "Burdwan", code: "BWN", abbreviation: "BWN", commonAbbreviation:"BWN", pincode:"713101", state:"West Bengal", stateCode:"WB",gstStateCode:"19" },
    { name: "Ahmedabad", code: "AMD", abbreviation: "AMD", commonAbbreviation:"AMD", pincode:"380001", state:"Gujarat", stateCode:"GJ",gstStateCode:"24" },
    { name: "Pune", code: "PNQ", abbreviation: "PNQ", commonAbbreviation:"PNQ", pincode:"411001", state:"Maharashtra", stateCode:"MH",gstStateCode:"27" },
    { name: "Jaipur", code: "JAI", abbreviation: "JAI", commonAbbreviation:"JAI", pincode:"302001", state:"Rajasthan", stateCode:"RJ",gstStateCode:"08" },
    { name: "Lucknow", code: "LKO", abbreviation: "LKO", commonAbbreviation:"LKO", pincode:"226001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Kanpur", code: "CNP", abbreviation: "CNP", commonAbbreviation:"CNP", pincode:"208001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Nagpur", code: "NAG", abbreviation: "NAG", commonAbbreviation:"NAG", pincode:"440001", state:"Maharashtra", stateCode:"MH",gstStateCode:"27" },
    { name: "Indore", code: "IDR", abbreviation: "IDR", commonAbbreviation:"IDR", pincode:"452001", state:"Madhya Pradesh", stateCode:"MP",gstStateCode:"23" },
    { name: "Bhopal", code: "BHO", abbreviation: "BHO", commonAbbreviation:"BHO", pincode:"462001", state:"Madhya Pradesh", stateCode:"MP",gstStateCode:"23" },
    { name: "Patna", code: "PAT", abbreviation: "PAT", commonAbbreviation:"PAT", pincode:"800001", state:"Bihar", stateCode:"BR",gstStateCode:"10" },
    { name: "Vadodara", code: "BDQ", abbreviation: "BDQ", commonAbbreviation:"BDQ", pincode:"390001", state:"Gujarat", stateCode:"GJ",gstStateCode:"24" },
    { name: "Ludhiana", code: "LUH", abbreviation: "LUH", commonAbbreviation:"LUH", pincode:"141001", state:"Punjab", stateCode:"PB",gstStateCode:"03" },
    { name: "Agra", code: "AGR", abbreviation: "AGR", commonAbbreviation:"AGR", pincode:"282001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Nashik", code: "ISK", abbreviation: "ISK", commonAbbreviation:"ISK", pincode:"422001", state:"Maharashtra", stateCode:"MH",gstStateCode:"27" },
    { name: "Faridabad", code: "FDB", abbreviation: "FDB", commonAbbreviation:"FDB", pincode:"121001", state:"Haryana", stateCode:"HR",gstStateCode:"06" },
    { name: "Meerut", code: "MUT", abbreviation: "MUT", commonAbbreviation:"MUT", pincode:"250001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Rajkot", code: "RAJ", abbreviation: "RAJ", commonAbbreviation:"RAJ", pincode:"360001", state:"Gujarat", stateCode:"GJ",gstStateCode:"24" },
    { name: "Varanasi", code: "VNS", abbreviation: "VNS", commonAbbreviation:"VNS", pincode:"221001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Srinagar", code: "SXR", abbreviation: "SXR", commonAbbreviation:"SXR", pincode:"190001", state:"Jammu and Kashmir", stateCode:"JK",gstStateCode:"01" },
    { name: "Aurangabad", code: "IXU", abbreviation: "IXU", commonAbbreviation:"IXU", pincode:"431001", state:"Maharashtra", stateCode:"MH",gstStateCode:"27" },
    { name: "Dhanbad", code: "DHN", abbreviation: "DHN", commonAbbreviation:"DHN", pincode:"826001", state:"Jharkhand", stateCode:"JH",gstStateCode:"20" },
    { name: "Amritsar", code: "ATQ", abbreviation: "ATQ", commonAbbreviation:"ATQ", pincode:"143001", state:"Punjab", stateCode:"PB",gstStateCode:"03" },
    { name: "Allahabad", code: "IXD", abbreviation: "IXD", commonAbbreviation:"IXD", pincode:"211001", state:"Uttar Pradesh", stateCode:"UP",gstStateCode:"09" },
    { name: "Ranchi", code: "IXR", abbreviation: "IXR", commonAbbreviation:"IXR", pincode:"834001", state:"Jharkhand", stateCode:"JH",gstStateCode:"20" },
    { name: "Howrah", code: "HWH", abbreviation: "HWH", commonAbbreviation:"HWH", pincode:"711101", state:"West Bengal", stateCode:"WB",gstStateCode:"19"},
    { name: "Surat", code: "STV", abbreviation: "SUR", commonAbbreviation: "SUR", pincode: "395003", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Visakhapatnam", code: "VTZ", abbreviation: "VIZ", commonAbbreviation: "VIZ", pincode: "530001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Thane", code: "TNA", abbreviation: "THA", commonAbbreviation: "TNA", pincode: "400601", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Coimbatore", code: "CJB", abbreviation: "COI", commonAbbreviation: "CBE", pincode: "641001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Madurai", code: "IXM", abbreviation: "MAD", commonAbbreviation: "MDU", pincode: "625001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Jamshedpur", code: "IXW", abbreviation: "JAM", commonAbbreviation: "JSR", pincode: "831001", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Guwahati", code: "GAU", abbreviation: "GUW", commonAbbreviation: "GHY", pincode: "781001", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Chandigarh", code: "IXC", abbreviation: "CHA", commonAbbreviation: "CHG", pincode: "160017", state: "Chandigarh", stateCode: "CH",gstStateCode:"04" },
    { name: "Mysuru", code: "MYQ", abbreviation: "MYS", commonAbbreviation: "MYS", pincode: "570001", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Raipur", code: "RPR", abbreviation: "RAI", commonAbbreviation: "RPR", pincode: "492001", state: "Chhattisgarh", stateCode: "CG",gstStateCode:"22" },
    { name: "Ghaziabad", code: "GZB", abbreviation: "GZB", commonAbbreviation: "GZB", pincode: "201001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Noida", code: "NOI", abbreviation: "NOI", commonAbbreviation: "NOI", pincode: "201301", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Kochi", code: "COK", abbreviation: "COK", commonAbbreviation: "COK", pincode: "682001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Thiruvananthapuram", code: "TRV", abbreviation: "TRV", commonAbbreviation: "TVM", pincode: "695001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Kozhikode", code: "CCJ", abbreviation: "CCJ", commonAbbreviation: "CLT", pincode: "673001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Vijayawada", code: "VGA", abbreviation: "VGA", commonAbbreviation: "VJA", pincode: "520001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Guntur", code: "GNT", abbreviation: "GNT", commonAbbreviation: "GNT", pincode: "522001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Tirupati", code: "TIR", abbreviation: "TIR", commonAbbreviation: "TIR", pincode: "517501", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Warangal", code: "WGC", abbreviation: "WGC", commonAbbreviation: "WGL", pincode: "506001", state: "Telangana", stateCode: "TG",gstStateCode:"36" },
    { name: "Tiruchirappalli", code: "TRZ", abbreviation: "TRZ", commonAbbreviation: "TRY", pincode: "620001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Salem", code: "SXV", abbreviation: "SXV", commonAbbreviation: "SLM", pincode: "636001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Tiruppur", code: "TUP", abbreviation: "TUP", commonAbbreviation: "TUP", pincode: "641601", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Vellore", code: "VLR", abbreviation: "VLR", commonAbbreviation: "VLR", pincode: "632001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Bhubaneswar", code: "BBI", abbreviation: "BBI", commonAbbreviation: "BBI", pincode: "751001", state: "Odisha", stateCode: "OR",gstStateCode:"21" },
    { name: "Cuttack", code: "CTC", abbreviation: "CTC", commonAbbreviation: "CTC", pincode: "753001", state: "Odisha", stateCode: "OR",gstStateCode:"21" },
    { name: "Jodhpur", code: "JDH", abbreviation: "JDH", commonAbbreviation: "JDH", pincode: "342001", state: "Rajasthan", stateCode: "RJ",gstStateCode:"08" },
    { name: "Kota", code: "KTU", abbreviation: "KTU", commonAbbreviation: "KOT", pincode: "324001", state: "Rajasthan", stateCode: "RJ",gstStateCode:"08" },
    { name: "Udaipur", code: "UDR", abbreviation: "UDR", commonAbbreviation: "UDR", pincode: "313001", state: "Rajasthan", stateCode: "RJ",gstStateCode:"08" },
    { name: "Ajmer", code: "AJM", abbreviation: "AJM", commonAbbreviation: "AJM", pincode: "305001", state: "Rajasthan", stateCode: "RJ",gstStateCode:"08" },
    { name: "Bikaner", code: "BKB", abbreviation: "BKB", commonAbbreviation: "BKN", pincode: "334001", state: "Rajasthan", stateCode: "RJ",gstStateCode:"08" },
    { name: "Jabalpur", code: "JLR", abbreviation: "JLR", commonAbbreviation: "JBP", pincode: "482001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Gwalior", code: "GWL", abbreviation: "GWL", commonAbbreviation: "GWL", pincode: "474001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Ujjain", code: "UJN", abbreviation: "UJN", commonAbbreviation: "UJN", pincode: "456001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Dehradun", code: "DED", abbreviation: "DED", commonAbbreviation: "DDN", pincode: "248001", state: "Uttarakhand", stateCode: "UK",gstStateCode:"05" },
    { name: "Haridwar", code: "HRW", abbreviation: "HRW", commonAbbreviation: "HRW", pincode: "249401", state: "Uttarakhand", stateCode: "UK",gstStateCode:"05" },
    { name: "Roorkee", code: "RKE", abbreviation: "RKE", commonAbbreviation: "RKE", pincode: "247667", state: "Uttarakhand", stateCode: "UK",gstStateCode:"05" },
    { name: "Jammu", code: "IXJ", abbreviation: "IXJ", commonAbbreviation: "JAM", pincode: "180001", state: "Jammu and Kashmir", stateCode: "JK",gstStateCode:"01" },
    { name: "Panipat", code: "PAN", abbreviation: "PAN", commonAbbreviation: "PAN", pincode: "132103", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Ambala", code: "AMB", abbreviation: "AMB", commonAbbreviation: "AMB", pincode: "133001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Karnal", code: "KRN", abbreviation: "KRN", commonAbbreviation: "KRN", pincode: "132001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Gurugram", code: "GGN", abbreviation: "GGN", commonAbbreviation: "GGN", pincode: "122001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Jalandhar", code: "JLN", abbreviation: "JLN", commonAbbreviation: "JLN", pincode: "144001", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Patiala", code: "PTA", abbreviation: "PTA", commonAbbreviation: "PTA", pincode: "147001", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Bathinda", code: "BHT", abbreviation: "BHT", commonAbbreviation: "BTI", pincode: "151001", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Siliguri", code: "IXB", abbreviation: "IXB", commonAbbreviation: "SLG", pincode: "734001", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Durgapur", code: "RDP", abbreviation: "RDP", commonAbbreviation: "DGR", pincode: "713201", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Asansol", code: "ASN", abbreviation: "ASN", commonAbbreviation: "ASN", pincode: "713301", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Darjeeling", code: "DAR", abbreviation: "DAR", commonAbbreviation: "DAR", pincode: "734101", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Muzaffarpur", code: "MZU", abbreviation: "MZU", commonAbbreviation: "MFP", pincode: "842001", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Bhagalpur", code: "BGP", abbreviation: "BGP", commonAbbreviation: "BGP", pincode: "812001", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Gaya", code: "GAY", abbreviation: "GAY", commonAbbreviation: "GAY", pincode: "823001", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Bokaro", code: "BKR", abbreviation: "BKR", commonAbbreviation: "BKR", pincode: "827001", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Jamshedpur", code: "IXW", abbreviation: "IXW", commonAbbreviation: "JAM", pincode: "831001", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Shillong", code: "SHL", abbreviation: "SHL", commonAbbreviation: "SHL", pincode: "793001", state: "Meghalaya", stateCode: "ML",gstStateCode:"17" },
    { name: "Imphal", code: "IMF", abbreviation: "IMF", commonAbbreviation: "IMP", pincode: "795001", state: "Manipur", stateCode: "MN",gstStateCode:"14" },
    { name: "Agartala", code: "IXA", abbreviation: "IXA", commonAbbreviation: "AGT", pincode: "799001", state: "Tripura", stateCode: "TR",gstStateCode:"16" },
    { name: "Aizawl", code: "AJL", abbreviation: "AJL", commonAbbreviation: "AZL", pincode: "796001", state: "Mizoram", stateCode: "MZ",gstStateCode:"15" },
    { name: "Dibrugarh", code: "DIB", abbreviation: "DIB", commonAbbreviation: "DIB", pincode: "786001", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Silchar", code: "IXS", abbreviation: "IXS", commonAbbreviation: "SCL", pincode: "788001", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Gangtok", code: "GOK", abbreviation: "GOK", commonAbbreviation: "GTK", pincode: "737101", state: "Sikkim", stateCode: "SK",gstStateCode:"20" },
    { name: "Itanagar", code: "HGI", abbreviation: "HGI", commonAbbreviation: "ITN", pincode: "791111", state: "Arunachal Pradesh", stateCode: "AR",gstStateCode:"12" },
    { name: "Kohima", code: "KHM", abbreviation: "KHM", commonAbbreviation: "KHM", pincode: "797001", state: "Nagaland", stateCode: "NL",gstStateCode:"13" },
    { name: "Rajkot", code: "RAJ", abbreviation: "RAJ", commonAbbreviation: "RJT", pincode: "360001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Bhavnagar", code: "BHU", abbreviation: "BHU", commonAbbreviation: "BVN", pincode: "364001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Jamnagar", code: "JGA", abbreviation: "JGA", commonAbbreviation: "JAM", pincode: "361001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Gandhinagar", code: "GND", abbreviation: "GND", commonAbbreviation: "GND", pincode: "382010", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Anand", code: "AND", abbreviation: "AND", commonAbbreviation: "AND", pincode: "388001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Navi Mumbai", code: "NVI", abbreviation: "NVI", commonAbbreviation: "NMB", pincode: "400614", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Solapur", code: "SSE", abbreviation: "SSE", commonAbbreviation: "SUR", pincode: "413001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Kolhapur", code: "KOP", abbreviation: "KOP", commonAbbreviation: "KOP", pincode: "416001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Amravati", code: "AMV", abbreviation: "AMV", commonAbbreviation: "AMV", pincode: "444601", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Akola", code: "AKD", abbreviation: "AKD", commonAbbreviation: "AKO", pincode: "444001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Aligarh", code: "ALG", abbreviation: "ALG", commonAbbreviation: "ALG", pincode: "202001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Moradabad", code: "MBD", abbreviation: "MBD", commonAbbreviation: "MOR", pincode: "244001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Bareilly", code: "BRY", abbreviation: "BRY", commonAbbreviation: "BRE", pincode: "243001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Saharanpur", code: "SRE", abbreviation: "SRE", commonAbbreviation: "SRE", pincode: "247001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Gorakhpur", code: "GOP", abbreviation: "GOP", commonAbbreviation: "GKP", pincode: "273001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Mathura", code: "MTU", abbreviation: "MTU", commonAbbreviation: "MAT", pincode: "281001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Firozabad", code: "FZB", abbreviation: "FZB", commonAbbreviation: "FZB", pincode: "283203", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Jhansi", code: "JHS", abbreviation: "JHS", commonAbbreviation: "JHS", pincode: "284001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Mangalore", code: "IXE", abbreviation: "IXE", commonAbbreviation: "MNG", pincode: "575001", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Hubli", code: "HBX", abbreviation: "HBX", commonAbbreviation: "HUB", pincode: "580020", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Belgaum", code: "IXG", abbreviation: "IXG", commonAbbreviation: "BLG", pincode: "590001", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Gulbarga", code: "GBI", abbreviation: "GBI", commonAbbreviation: "GLB", pincode: "585101", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Bilaspur", code: "PAB", abbreviation: "PAB", commonAbbreviation: "BSP", pincode: "495001", state: "Chhattisgarh", stateCode: "CG",gstStateCode:"22" },
    { name: "Durg", code: "DUR", abbreviation: "DUR", commonAbbreviation: "DUR", pincode: "490001", state: "Chhattisgarh", stateCode: "CG",gstStateCode:"22" },
    { name: "Korba", code: "KOB", abbreviation: "KOB", commonAbbreviation: "KOR", pincode: "495677", state: "Chhattisgarh", stateCode: "CG",gstStateCode:"22" },
    { name: "Port Blair", code: "IXZ", abbreviation: "IXZ", commonAbbreviation: "PBL", pincode: "744101", state: "Andaman and Nicobar Islands", stateCode: "AN",gstStateCode:"35" },
    { name: "Puducherry", code: "PNY", abbreviation: "PNY", commonAbbreviation: "PDY", pincode: "605001", state: "Puducherry", stateCode: "PY",gstStateCode:"34" },
    { name: "Silvassa", code: "SLV", abbreviation: "SLV", commonAbbreviation: "SLV", pincode: "396230", state: "Dadra and Nagar Haveli and Daman and Diu", stateCode: "DD",gstStateCode:"26" },
    { name: "Daman", code: "DMN", abbreviation: "DMN", commonAbbreviation: "DMN", pincode: "396210", state: "Dadra and Nagar Haveli and Daman and Diu", stateCode: "DD",gstStateCode:"26" },
    { name: "Shimla", code: "SLV", abbreviation: "SLV", commonAbbreviation: "SML", pincode: "171001", state: "Himachal Pradesh", stateCode: "HP",gstStateCode:"02" },
    { name: "Dharamshala", code: "DHM", abbreviation: "DHM", commonAbbreviation: "DHM", pincode: "176215", state: "Himachal Pradesh", stateCode: "HP",gstStateCode:"02" },
    { name: "Manali", code: "MNL", abbreviation: "MNL", commonAbbreviation: "MNL", pincode: "175131", state: "Himachal Pradesh", stateCode: "HP",gstStateCode:"02" },
    { name: "Kullu", code: "KLU", abbreviation: "KLU", commonAbbreviation: "KLU", pincode: "175101", state: "Himachal Pradesh", stateCode: "HP",gstStateCode:"02" },
    { name: "Panaji", code: "GOI", abbreviation: "GOI", commonAbbreviation: "PNJ", pincode: "403001", state: "Goa", stateCode: "GA",gstStateCode:"30" },
    { name: "Margao", code: "MRG", abbreviation: "MRG", commonAbbreviation: "MRG", pincode: "403601", state: "Goa", stateCode: "GA",gstStateCode:"30" },
    { name: "Vasco da Gama", code: "VCG", abbreviation: "VCG", commonAbbreviation: "VSC", pincode: "403802", state: "Goa", stateCode: "GA",gstStateCode:"30" },
    { name: "Mapusa", code: "MPS", abbreviation: "MPS", commonAbbreviation: "MPS", pincode: "403507", state: "Goa", stateCode: "GA",gstStateCode:"30" },
    { name: "Thrissur", code: "TCR", abbreviation: "TCR", commonAbbreviation: "TCR", pincode: "680001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Kollam", code: "QLN", abbreviation: "QLN", commonAbbreviation: "KLM", pincode: "691001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Kannur", code: "CNN", abbreviation: "CNN", commonAbbreviation: "CNN", pincode: "670001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Alappuzha", code: "ALP", abbreviation: "ALP", commonAbbreviation: "ALP", pincode: "688001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Palakkad", code: "PKD", abbreviation: "PKD", commonAbbreviation: "PKD", pincode: "678001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Kottayam", code: "KTM", abbreviation: "KTM", commonAbbreviation: "KTM", pincode: "686001", state: "Kerala", stateCode: "KL",gstStateCode:"32" },
    { name: "Nellore", code: "NLR", abbreviation: "NLR", commonAbbreviation: "NLR", pincode: "524001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Kakinada", code: "COA", abbreviation: "COA", commonAbbreviation: "KAK", pincode: "533001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Rajahmundry", code: "RJA", abbreviation: "RJA", commonAbbreviation: "RJY", pincode: "533101", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Kurnool", code: "KRN", abbreviation: "KRN", commonAbbreviation: "KNL", pincode: "518001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Anantapur", code: "ATP", abbreviation: "ATP", commonAbbreviation: "ATP", pincode: "515001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Kadapa", code: "CDP", abbreviation: "CDP", commonAbbreviation: "CDP", pincode: "516001", state: "Andhra Pradesh", stateCode: "AP",gstStateCode:"28" },
    { name: "Nizamabad", code: "NZB", abbreviation: "NZB", commonAbbreviation: "NZB", pincode: "503001", state: "Telangana", stateCode: "TG",gstStateCode:"36" },
    { name: "Karimnagar", code: "KMR", abbreviation: "KMR", commonAbbreviation: "KMR", pincode: "505001", state: "Telangana", stateCode: "TG",gstStateCode:"36" },
    { name: "Khammam", code: "KHM", abbreviation: "KHM", commonAbbreviation: "KMM", pincode: "507001", state: "Telangana", stateCode: "TG",gstStateCode:"36" },
    { name: "Erode", code: "ERD", abbreviation: "ERD", commonAbbreviation: "ERD", pincode: "638001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Thanjavur", code: "TJV", abbreviation: "TJV", commonAbbreviation: "TJV", pincode: "613001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Tirunelveli", code: "TVL", abbreviation: "TVL", commonAbbreviation: "TVL", pincode: "627001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Dindigul", code: "DGL", abbreviation: "DGL", commonAbbreviation: "DGL", pincode: "624001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Kanchipuram", code: "KCP", abbreviation: "KCP", commonAbbreviation: "KCP", pincode: "631501", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Nagercoil", code: "NGC", abbreviation: "NGC", commonAbbreviation: "NGC", pincode: "629001", state: "Tamil Nadu", stateCode: "TN",gstStateCode:"33" },
    { name: "Rourkela", code: "ROU", abbreviation: "ROU", commonAbbreviation: "ROU", pincode: "769001", state: "Odisha", stateCode: "OR",gstStateCode:"21" },
    { name: "Sambalpur", code: "SBP", abbreviation: "SBP", commonAbbreviation: "SBP", pincode: "768001", state: "Odisha", stateCode: "OR",gstStateCode:"21" },
    { name: "Berhampur", code: "BHM", abbreviation: "BHM", commonAbbreviation: "BHM", pincode: "760001", state: "Odisha", stateCode: "OR",gstStateCode:"21" },
    { name: "Shimoga", code: "SHM", abbreviation: "SHM", commonAbbreviation: "SHM", pincode: "577201", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Davangere", code: "DVG", abbreviation: "DVG", commonAbbreviation: "DVG", pincode: "577001", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Tumkur", code: "TMK", abbreviation: "TMK", commonAbbreviation: "TMK", pincode: "572101", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Bellary", code: "BLY", abbreviation: "BLY", commonAbbreviation: "BLY", pincode: "583101", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Bijapur", code: "BJP", abbreviation: "BJP", commonAbbreviation: "BJP", pincode: "586101", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Raichur", code: "RCR", abbreviation: "RCR", commonAbbreviation: "RCR", pincode: "584101", state: "Karnataka", stateCode: "KA",gstStateCode:"29" },
    { name: "Sagar", code: "SGR", abbreviation: "SGR", commonAbbreviation: "SGR", pincode: "470002", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Satna", code: "STN", abbreviation: "STN", commonAbbreviation: "STN", pincode: "485001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Rewa", code: "REW", abbreviation: "REW", commonAbbreviation: "REW", pincode: "486001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Dewas", code: "DEW", abbreviation: "DEW", commonAbbreviation: "DEW", pincode: "455001", state: "Madhya Pradesh", stateCode: "MP",gstStateCode:"23" },
    { name: "Rohtak", code: "RHT", abbreviation: "RHT", commonAbbreviation: "RHT", pincode: "124001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Hisar", code: "HSR", abbreviation: "HSR", commonAbbreviation: "HSR", pincode: "125001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Sonipat", code: "SNP", abbreviation: "SNP", commonAbbreviation: "SNP", pincode: "131001", state: "Haryana", stateCode: "HR",gstStateCode:"06" },
    { name: "Mohali", code: "MHL", abbreviation: "MHL", commonAbbreviation: "MHL", pincode: "160055", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Pathankot", code: "IXP", abbreviation: "IXP", commonAbbreviation: "PTK", pincode: "145001", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Hoshiarpur", code: "HSP", abbreviation: "HSP", commonAbbreviation: "HSP", pincode: "146001", state: "Punjab", stateCode: "PB",gstStateCode:"03" },
    { name: "Haldia", code: "HLD", abbreviation: "HLD", commonAbbreviation: "HLD", pincode: "721602", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Kharagpur", code: "KHP", abbreviation: "KHP", commonAbbreviation: "KHP", pincode: "721301", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Raiganj", code: "RGJ", abbreviation: "RGJ", commonAbbreviation: "RGJ", pincode: "733134", state: "West Bengal", stateCode: "WB",gstStateCode:"19" },
    { name: "Purnia", code: "PRN", abbreviation: "PRN", commonAbbreviation: "PRN", pincode: "854301", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Darbhanga", code: "DBG", abbreviation: "DBG", commonAbbreviation: "DBG", pincode: "846004", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Katihar", code: "KTH", abbreviation: "KTH", commonAbbreviation: "KTH", pincode: "854105", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Begusarai", code: "BGS", abbreviation: "BGS", commonAbbreviation: "BGS", pincode: "851101", state: "Bihar", stateCode: "BR",gstStateCode:"10" },
    { name: "Deoghar", code: "DGH", abbreviation: "DGH", commonAbbreviation: "DGH", pincode: "814112", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Hazaribagh", code: "HZB", abbreviation: "HZB", commonAbbreviation: "HZB", pincode: "825301", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Giridih", code: "GRH", abbreviation: "GRH", commonAbbreviation: "GRH", pincode: "815301", state: "Jharkhand", stateCode: "JH",gstStateCode:"20" },
    { name: "Jorhat", code: "JRH", abbreviation: "JRH", commonAbbreviation: "JRH", pincode: "785001", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Tezpur", code: "TEZ", abbreviation: "TEZ", commonAbbreviation: "TEZ", pincode: "784001", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Tinsukia", code: "TSK", abbreviation: "TSK", commonAbbreviation: "TSK", pincode: "786125", state: "Assam", stateCode: "AS",gstStateCode:"18" },
    { name: "Nadiad", code: "NDI", abbreviation: "NDI", commonAbbreviation: "NDI", pincode: "387001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Morbi", code: "MRB", abbreviation: "MRB", commonAbbreviation: "MRB", pincode: "363641", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Surendranagar", code: "SRN", abbreviation: "SRN", commonAbbreviation: "SRN", pincode: "363001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Gandhidham", code: "GNH", abbreviation: "GNH", commonAbbreviation: "GNH", pincode: "370201", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Junagadh", code: "JGD", abbreviation: "JGD", commonAbbreviation: "JGD", pincode: "362001", state: "Gujarat", stateCode: "GJ",gstStateCode:"24" },
    { name: "Sangli", code: "SNG", abbreviation: "SNG", commonAbbreviation: "SNG", pincode: "416416", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Jalgaon", code: "JLG", abbreviation: "JLG", commonAbbreviation: "JLG", pincode: "425001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Ahmednagar", code: "AHN", abbreviation: "AHN", commonAbbreviation: "AHN", pincode: "414001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Latur", code: "LTR", abbreviation: "LTR", commonAbbreviation: "LTR", pincode: "413512", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Dhule", code: "DHU", abbreviation: "DHU", commonAbbreviation: "DHU", pincode: "424001", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Ichalkaranji", code: "ICH", abbreviation: "ICH", commonAbbreviation: "ICH", pincode: "416115", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Parbhani", code: "PBN", abbreviation: "PBN", commonAbbreviation: "PBN", pincode: "431401", state: "Maharashtra", stateCode: "MH",gstStateCode:"27" },
    { name: "Shahjahanpur", code: "SJP", abbreviation: "SJP", commonAbbreviation: "SJP", pincode: "242001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Rampur", code: "RPR", abbreviation: "RPR", commonAbbreviation: "RPR", pincode: "244901", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Muzaffarnagar", code: "MZN", abbreviation: "MZN", commonAbbreviation: "MZN", pincode: "251001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Etawah", code: "ETW", abbreviation: "ETW", commonAbbreviation: "ETW", pincode: "206001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Sambhal", code: "SBL", abbreviation: "SBL", commonAbbreviation: "SBL", pincode: "244302", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Orai", code: "ORI", abbreviation: "ORI", commonAbbreviation: "ORI", pincode: "285001", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" },
    { name: "Bahraich", code: "BHR", abbreviation: "BHR", commonAbbreviation: "BHR", pincode: "271801", state: "Uttar Pradesh", stateCode: "UP",gstStateCode:"09" }
];

exports.cityListWithCodes = cityListWithCodes;

exports.placeOfJurisdiction = function(biller) {
    const address = biller.address || "";

    // 1. Try city/district name or code fuzzy match (case-insensitive, word boundary)
    const addressLower = address.toLowerCase();
    for (const { name, code } of cityListWithCodes) {
        const nameLower = name.toLowerCase();
        const codeLower = code.toLowerCase();
        // Check for city name
        const nameRegex = new RegExp(nameLower);
        if (nameRegex.test(addressLower)) {
            return name;
        }
        // Check for city code
        const codeRegex = new RegExp(codeLower);
        if (codeRegex.test(addressLower)) {
            return name; // Return full name if code is found
        }
    }

    // 2. Fallback: regex extraction (old logic)
    const cityMatch = address.match(/\w+(?=\s*-\s*\d{1,6})|\w+$/);
    if (cityMatch && cityMatch[0]) {
        return cityMatch[0].trim();
    }

    // 3. Not found
    return "Howrah"; // Default fallback
}

exports.notifyCustomer = async function(window, billObj,customer,appLogger,getFivePercentOfMemory){
    let { billDate,billNo,name,customerId } = billObj;
    if(typeof global.customerList==="undefined")
        await initCustomerList(customer,appLogger,getFivePercentOfMemory);
    let custObj = global.customerList.find(cust=>cust.id===customerId);
    // if(!custObj || !custObj.email){
    //     dialog.showErrorBox("Error",`No email found for customer ${name}. Please update customer details and try again.`);
    //     return;
    // }
    billDate = openFormatForDate(new Date(billDate));
    let fileName = `./${name}_${billDate}_${billNo}.pdf`.replace(" ","\ ");
    let path2file = path.resolve(app.getPath("documents"),"./Bills/",fileName);
    console.log({biller:process.presets.biller});
    if(!fs.existsSync(path2file)) return;
    let base64File = fs.readFileSync(path2file).toString("base64");
    let updateRestURL = process.env.APP_ENV==="DEV" ? "localhost:3030" : process.env.UPDATE_REST;
    axios.post(`https://${updateRestURL}/send-bill-to-customer`,{
        to:[
            {
                email_address:{
                    address:"surya.shilpi22@gmail.com",
                    name
                }
            }
        ],
        name,
        attachment:{
            fileName:`${name}_${billDate}_${billNo}.pdf`,
            content:base64File
        },
        biller:process.presets.biller
    }).then(response=>{
        dialog.showMessageBox(window,{
            type:"info",
            title:"Success",
            message:`Bill sent successfully to ${name}.`
        })
    })
    .catch(err=>{
        dialog.showErrorBox("Error",`Failed to send bill to ${name}.\n${err.message}`)
    });
}

exports.getPDF_FileName = function(name,billDate,billNo,temp=false){
    let ext = temp==true ? "_temp" : "";
    let pdfFileName = `${name}_${billDate}_${billNo}${ext}.pdf`;
    let dirPath = path.resolve(app.getPath("documents"),"./Bills");
    if(fs.existsSync(path.resolve(dirPath,pdfFileName)))// For backward compatibility with old file naming convention
        return pdfFileName;
    let fileNameFormat = process.presets.fileNameFormat;
    if(typeof process.presets.fileNameFormat!="undefined"){// New file naming convention based on user defined format
        pdfFileName = fileNameFormat.split("_").reduce((acc,word)=>{
            if(word==="name")            
                acc = acc.replace(word,name);
            else if(word==="billDate")       
                acc = acc.replace(word,billDate);
            else if(word==="billNo")         
                acc = acc.replace(word,billNo);
            return acc;
        },fileNameFormat)+".pdf";
        if(temp)             
            pdfFileName = pdfFileName.replace(".pdf","_temp.pdf");
    }
    return pdfFileName;
}

// ============================================================
// Download State Management Functions (for Resumable Downloads)
// ============================================================

/**
 * Get path to download state file
 */
function getDownloadStatePath() {
  const appPath = process.env.APP_ENV === "DEV" 
    ? __dirname 
    : app.getPath("appData") + "/BBS";
  return path.resolve(appPath, "download-state.json");
}

/**
 * Save download state to disk
 */
function saveDownloadState(stateObj) {
  const statePath = getDownloadStatePath();
  try {
    const state = {
      fileName: stateObj.fileName,
      filePath: stateObj.filePath,
      downloadURL: stateObj.downloadURL,
      bytesDownloaded: stateObj.bytesDownloaded,
      totalBytes: stateObj.totalBytes,
      version: stateObj.version,
      status: stateObj.status, // 'downloading' | 'paused' | 'cancelled'
      timestamp: Date.now(),
      platform: process.platform
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    const { appLogger } = require('./common.js');
    appLogger({
      title: "Download State Saved",
      bytesDownloaded: state.bytesDownloaded,
      totalBytes: state.totalBytes,
      status: state.status
    });
    return true;
  } catch (err) {
    const { appLogger } = require('./common.js');
    appLogger({
      title: "Error",
      message: String(err),
      func: "saveDownloadState"
    });
    return false;
  }
}

/**
 * Load download state from disk
 */
function loadDownloadState(appLogger) {
  const statePath = getDownloadStatePath();
  try {
    if (!fs.existsSync(statePath)) return null;
    
    const data = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(data);
    
    // Auto-cleanup stale downloads (>7 days)
    const daysSincePause = (Date.now() - state.timestamp) / (1000 * 60 * 60 * 24);
    if (daysSincePause > 7) {
      appLogger({
        title: "Cleanup",
        message: "Removing stale download (>7 days old)"
      });
      clearDownloadState();
      if (fs.existsSync(state.filePath)) {
        fs.rmSync(state.filePath);
      }
      return null;
    }
    
    return state;
  } catch (err) {
    appLogger({
      title: "Error",
      message: String(err),
      func: "loadDownloadState"
    });
    return null;
  }
}

/**
 * Clear download state file
 */
function clearDownloadState() {
  const statePath = getDownloadStatePath();
  try {
    if (fs.existsSync(statePath)) {
      fs.rmSync(statePath);
      const { appLogger } = require('./common.js');
      appLogger({ message: "Download state cleared" });
    }
    return true;
  } catch (err) {
    const { appLogger } = require('./common.js');
    appLogger({
      title: "Error",
      message: String(err),
      func: "clearDownloadState"
    });
    return false;
  }
}

/**
 * Verify partial file integrity
 */
function verifyPartialFile(filePath, expectedSize) {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, reason: "file_not_found" };
    }
    
    const stats = fs.statSync(filePath);
    if (stats.size !== expectedSize) {
      return { 
        valid: false, 
        reason: "size_mismatch",
        expected: expectedSize,
        actual: stats.size
      };
    }
    
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      reason: "error", 
      error: String(err) 
    };
  }
}

// Export download state management functions
exports.saveDownloadState = saveDownloadState;
exports.loadDownloadState = loadDownloadState;
exports.clearDownloadState = clearDownloadState;
exports.verifyPartialFile = verifyPartialFile;

exports.computeFullFileHash = async function (filePath, progressCallback = null) {
  return new Promise((res,rej)=>{
    const hash = crypto.createHash("sha256");
    const stats = fs.statSync(filePath);
    const totalSize = stats.size;
    let processedSize = 0;
    
    const readStream = fs.createReadStream(filePath);
    readStream.on("data", chunk => {
      hash.update(chunk);
      processedSize += chunk.length;
      if(progressCallback) {
        progressCallback(processedSize, totalSize);
      }
    });
    readStream.on("end", () => res(hash.digest("hex")));
    readStream.on("error", err => rej(err));
  });
}

exports.verifyFileIntegrityByChunks = async function(filePath, hashInfo, appLogger, progressCallback = null) {
    let correuptedSctions = [];
    // Diagonosing corrupted sections by comparing chunk hashes
    const chunkSize = 1024 * 1024;
    let index = 0;
    const totalChunks = hashInfo.chunkHashes.length;
    const readStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    return new Promise((resolve, reject) => {
        readStream.on("data", chunk => {
            const chunkHash = crypto.createHash("sha256").update(chunk).digest("hex");
            let expectedChunkHash = hashInfo.chunkHashes[index].hash;
            if (chunkHash !== expectedChunkHash) {
            correuptedSctions.push({
                index,
                expectedHash: expectedChunkHash,
                actualHash: chunkHash,
                start: hashInfo.chunkHashes[index].start,
                end: hashInfo.chunkHashes[index].end
            });
            }
            index++;
            if(progressCallback) {
                progressCallback(index, totalChunks);
            }
        });// Collecting corrupted sections
        readStream.on("end", async () => {
            appLogger({
                title: "Corrupted Sections Detected",
                message: `Detected ${correuptedSctions.length} corrupted sections, re-downloading those sections.`,
                sections: correuptedSctions
            });
            // Save the corrupted sections info for the updater script to re-download only those parts. This requires support on the server side to handle range requests for specific sections.
            fs.writeFileSync(path.resolve(app.getPath("appData"),"./BBS/corruptedSections.json"), JSON.stringify(correuptedSctions));
            resolve(correuptedSctions);
        });
        readStream.on("error", err => {
            appLogger({
            title: "Error Reading File for Hash Verification",
            message: String(err)
            });
            reject(err);
        });
    });
}

exports.reDownloadCorruptedSections = function(corruptedSections, appLogger) {
  // This function would read the corruptedSections.json file, and for each section, make a range request to the server to re-download just that part and patch it into the existing file. This requires server support to handle such requests.
  let corruptedSectionsPath = path.resolve(app.getPath("appData"),"./BBS/corruptedSections.json");
  if(!corruptedSections){
    if (!fs.existsSync(corruptedSectionsPath)) {
    appLogger({ message: "No corrupted sections file found, nothing to re-download" });
    return;
    }
    corruptedSections = JSON.parse(fs.readFileSync(corruptedSectionsPath).toString());
  }
  // Map platform to match server API expectations
  const platformMap = { win32: 'win', darwin: 'mac', linux: 'linux' };
  const platform = platformMap[process.platform] || process.platform;
  let updateURL = process.env.UPDATE_REST + `download/update?channel=production&platform=${platform}&id=${global.userId}`;
  let updateConfPath = path.resolve(app.getPath("appData"),"./BBS/updtConf.json");
  let updateConf = JSON.parse(fs.readFileSync(updateConfPath).toString());
  return new Promise(async (resolve,reject)=>{
      for (let section of corruptedSections) {
        appLogger({ message: `Re-downloading corrupted section ${section.index}`, section });
        // Make a range request for this section and patch it into the file at the correct position. This is a complex operation that involves careful handling of file streams and ensuring data integrity.
        await axios.get(updateURL, {
          responseType: "stream",
          headers: {
            'Range': `bytes=${section.start}-${section.end}`
          }
        }).then(async resp => {
          if (resp.status === 206) {
            // Patch the downloaded chunk into the existing file at the correct position
            const writeStream = fs.createWriteStream(path.resolve(app.getPath("appData"),`BBS/${updateConf.fileName}`), {
              flags: 'r+',
              start: section.start
            });
            resp.data.pipe(writeStream);
            await new Promise((resolve, reject) => {
              writeStream.on('finish', resolve);
              writeStream.on('error', reject);
            });
          }
        }).catch(err => {
          appLogger({
            title: "Error Re-downloading Corrupted Section",
            message: String(err),
            section
          });
          // Instead of retrying on loop, we can delete the update file and start a fresh download if any section fails to re-download after a certain number of attempts. This is because multiple sections might be corrupted, and if we keep trying to patch them individually, it could lead to a never-ending loop of retries. By starting fresh, we can ensure that we get a clean copy of the update file.
          reject(err);
        });
      }
      resolve(true);
  });
  // After re-downloading, it would verify the hash again to ensure integrity before allowing installation.
}