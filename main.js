const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const { billNoCounter, getLastBillNo, loggerFH, getLoggerFD } = require("./common");
const fs = require("fs");
const path = require("path");
const readLine = require("readline");
const { createModal } = require('./createModal');
const { attendances } = require('./model/dbConfig');


let closeFlag = false;

function createWindow () {
  let windowOptions = {
    width: 1200,
    height: 650,
    minWidth:800,
    minHeight:600,
  }
  const mainWindow = createModal(windowOptions,'localhost:5000',{maxWinCount:1,label:"Main",loadFile:false,protocol:"http://"});
  let menu=Menu.buildFromTemplate(require("./menuTemplate")(mainWindow));
  Menu.setApplicationMenu(menu);
  mainWindow.maximize();
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

app.on("ready",async (e,launchInfo)=>{
  let policyJsonSchema = {
    "noReturn":120,
    "gstRecurranceTerm":1,
    "financialYearStartDate":"1/4"
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
  if(mainWindow && (!todaysAttendance || (todaysAttendance && attendees.length>0))){
    let windowOptions = {
      width: 600,
      height: 400,
      resizable:false,
      webPreferences: {
        nodeIntegration: true,
        devTools:true
      },
      show:false,
      contextIsolation:true,
      parent: mainWindow
    }
    closeFlag = false;
    let win = createModal(windowOptions,"template/html/attendaceModal.html",{maxWinCount:1,label:"Attendance-modal"});
    win.on("close",(e)=>{
      if(closeFlag==false){
        e.preventDefault();
        e.sender.send("update-attendance-close");
      }
    });
  }
});

exports.updateCloseFlag = ()=>{closeFlag=true};