const { app, BrowserWindow, Menu, globalShortcut, ipcMain, dialog, screen } = require('electron');
const { billNoCounter, getLastBillNo, loggerFH, getLoggerFD } = require("./common");
const fs = require("fs");
const path = require("path");
const readLine = require("readline");
const { createModal, getTargetWindow, getMainWindow } = require('./createModal');
const { attendances, people, stock, sale, sequelize, purchase } = require('./model/dbConfig');
const winManager = require("electron-window-state");
const { Op } = require('sequelize');
const { minStock,creditLimitDays } = require("./config/policy.json");
const { addPurchase } = require("./handlePurchase");
const { saleWindow } = require("./saleHandler");
const { billItemSchema } = require('./model/dynamicSchemas');


let closeFlag = false,
  windowOptions = {
    width: 600,
    height: 400,
    resizable:false,
    webPreferences: {
      nodeIntegration: true,
      devTools:true
    },
    show:false,
    contextIsolation:true
  };


function updateCloseFlag(){
  closeFlag=true;
}

exports.updateCloseFlag = updateCloseFlag;

function createWindow () {
  let {width,height:workAreaHeight} = screen.getPrimaryDisplay().workArea;
  let {height} = screen.getPrimaryDisplay().size;
  let winState = winManager({
    defaultWidth: width,
    defaultHeight:workAreaHeight,
    path:path.resolve("./")
  });
  workAreaHeight -= (height - workAreaHeight);
  let windowOptions = {
    width: winState.width,
    height: winState.height,
    x:winState.x,
    y:winState.y,
    minWidth:800,
    minHeight:600,
    title:"BBSv2.0.0"
  };
  if(process.platform==="linux"){
    windowOptions.resizable = true;
    windowOptions.maximizable = true;
  }
  const mainWindow = createModal(windowOptions,'./template/html/mainPage.html',{maxWinCount:1,label:"Main"});
  let menu=Menu.buildFromTemplate(require("./menuTemplate")(mainWindow));
  Menu.setApplicationMenu(menu);
  mainWindow.maximize();
  winState.manage(mainWindow);
  return mainWindow;
}

// app.whenReady().then(createWindow);

app.on("quit",()=>{
  let rawData = fs.readFileSync(__dirname+"/config/saleConfig.json").toString();
  let saleConfig=rawData!==""?JSON.parse(rawData):{};
  saleConfig.billNo = getLastBillNo();
  fs.writeFileSync(__dirname+"/config/saleConfig.json",JSON.stringify(saleConfig));
  let fds = getLoggerFD();
  fds.forEach(fd=>{
    fs.close(fd,err=>{
      if(err) throw err;
    });
  });
  globalShortcut.unregister("CommandOrControl+N");
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit();
  // app.hide()
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) 
    createWindow();
});

function takeAttendance(refWindow){
  windowOptions.parent = refWindow;
  closeFlag = false;
  let win = createModal(windowOptions,"template/html/attendaceModal.html",{maxWinCount:1,label:"Attendance-modal"});
  win.on("close",(e)=>{
    if(closeFlag==false){
      e.preventDefault();
      e.sender.send("update-attendance-close");
    }
  });
}

function paySalary(refWindow){
  windowOptions.parent = refWindow;
  createModal(windowOptions,"template/html/salaryPaymentModal.html",{maxWinCount:1,label:"Salary-Modal"});
}

app.on("ready",async ()=>{
  let policyJsonSchema = {
    "noReturn":120,
    "gstRecurranceTerm":1,
    "financialYearStartDate":"1/4",
    "minStock":10,
    "creditLimitDays":21
  };
  let saleConfigSchema = {
    "billNo": 31,
    "biller": "Usha HardWare Store",
    "address": "70, N.S. Road, Kolkata-700001, West Bengal, India",
    "gst": "12ad",
    "phones": ["9143133196", "9038825247"],
    "scriptFile": "makePDF.default",
    "lib": "buildPage.default",
    "borderRect": [10, 22, 590, 750],
    "titileFontSize": 20,
    "titleFontFamily": "Times-Bold",
    "captionFontSize": 14,
    "defaultFontFamile": "Times-Roman",
    "defaultFontSize": 10,
    "headingFontSize": 12,
    "margin": 10,
    "emblem": "Bhagawati Emblem.jpg"
  };
  //Initialize BBS
  fs.readFile(__dirname+"/config/saleConfig.json",(err,data)=>{
    if(err)
      return console.error(err);
    const {billNo} = JSON.parse(data);
    billNoCounter(billNo);
  });
  //Initialize logger file
  loggerFH("dbLogs.txt");
  loggerFH("appLogs.txt");
  //Check for required files and directories
  let fileList = [];
  let readInterface = readLine.createInterface({
    input:fs.createReadStream("fileList"),
    output:process.stdout,
    terminal:false
  });
  readInterface.on("line",line=>fileList.push(JSON.parse(line)));
  readInterface.on("close",()=>{
    fileList.forEach(({fPath,fileName,type,dir})=>{
      //check for dir
      if(!fs.existsSync(path.resolve(__dirname,dir)))
        fs.mkdir(path.resolve(__dirname,dir),(err)=>{
          if(err) throw err;
          console.log("Directory created")
        });
      //check for files
      if(!fs.existsSync(path.resolve(fPath))){
        if(type==="config"){
          let schema = fileName==="policy.json"?policyJsonSchema:saleConfigSchema;
          fs.writeFile(path.resolve(fPath),JSON.stringify(schema),(err)=>{
            if(err) throw err;
          });
        }
        else
        if(type==="db")
          fs.writeFile(path.resolve(fPath),undefined,{flag:"a"},(err)=>{
            if(err) throw err;
          });
      }
    });
  });
  // Adding tab switcher
  let mainWindow = createWindow();
  let focussedWindow = BrowserWindow.getFocusedWindow()
  globalShortcut.register("CommandOrControl+Tab+Up",()=>{
    if(mainWindow){
      let brWindows = BrowserWindow.getAllWindows();
      brWindows = brWindows.filter(win=>win!==mainWindow);
      let index = brWindows.indexOf(focussedWindow);
      index = index===-1?0:index;
      if(index===brWindows.length-1)
        index = 0;
      else
        index++;
      focussedWindow = brWindows?.[index];
      focussedWindow?.focus();
    }
  });
  // Taking attendance
  let todaysAttendance = (await attendances.findOne({
    where:{
      date:new Date().toDateString()
    },
    attributes:["attendees"]
  }))?.dataValues;
  let attendees = todaysAttendance?.attendees ?? [];
  if(attendees.length>0)
    attendees = attendees.filter(({presence})=>presence===0);
  if(mainWindow && (!todaysAttendance || (todaysAttendance && attendees.length>0)))
    takeAttendance(mainWindow);
  if(new Date().getDate()>1){
    let payHistory = (await people.findAll({
      attributes: ["moreInfo"]
    }))
    .map(({dataValues})=>dataValues.moreInfo)
    let thisMonthPayments = payHistory.filter((obj)=>{
      const {payHistory,salary} = obj;
      let thisMonthPayment = payHistory?.filter(({date})=>(new Date(date).getMonth()===new Date().getMonth()))?.[0]?.payment ?? 0;
      if(thisMonthPayment<Number(salary))
        return true;
    });
    if(thisMonthPayments.length>0)
      paySalary(mainWindow);
  }
});

ipcMain.on("take-attendance",e=>{
  let refWin = getTargetWindow("Employee-Page")
  takeAttendance(refWin);
  ipcMain.on("attendance-registered",()=>{
    e.sender.send("attendance-registered")
  })
});

ipcMain.on("open-salary-modal",e=>{
  let refWin = getTargetWindow("Employee-Page");
  paySalary(refWin);
  ipcMain.on("Salary-Modal",()=>{
    let msg = {
      type: "info",
      title: "Salary registered",
      message: "Salary registered successfully."
    }
    dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
    e.sender.send("attendance-registered");
  });
});

// Lander Page IPCs

ipcMain.handle("get-overview-content",async ()=>{
  let stocks = (await stock.findAll({
    where:{
      quantity: {
        [Op.lte]: minStock
      }
    }
  })).map(({dataValues})=>dataValues);
  let unPaidBills = (await sale.findAll({
    where:{
      [Op.and]:[
        {paymentStatus:false},
        {
          billDate: {
            [Op.lte]:new Date(Date.now()-creditLimitDays*24*60*60*1000)
          }
        }
      ]
    }
  })).map(({dataValues})=>dataValues);
  return {unPaidBills,stocks};
});

ipcMain.on("new-sale-purchase",(e,mode)=>{
  let mainWin = getMainWindow();
  if(mode===1)
    saleWindow(mainWin)();
  else
    addPurchase(mainWin)();
});

ipcMain.handle("get-sale-content",async ()=>{
  let queuedBills = (await sale.findAll({
    where:{
      deliveryStatus:"queued"
    },
    attributes:[["billItemTable","tableName"],"name","billNo"]
  })).map(({dataValues})=>dataValues);
  let bills = await queuedBills.reduce(async (acc,{tableName,billNo,name},index)=>{
    acc = await acc;
    try{
      let billItems = (await (await sequelize.define(tableName,billItemSchema,{
        freezeTableName: true,
        timestamps: false
      })).findAll()).map(({dataValues})=>dataValues);
      acc.push({billItems,name,billNo});
    }
    catch(err){
      console.log(err);
    }
    return acc;
  },[]);
  let allBills = (await sale.findAll()).map(({dataValues})=>dataValues);
  return {bills,allBills: allBills};
});

ipcMain.handle("get-purchase-content",async ()=>{
  return (await purchase.findAll()).map(({dataValues})=>dataValues);
});