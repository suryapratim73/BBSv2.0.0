require("dotenv").config();
const { app, BrowserWindow, Menu, globalShortcut, ipcMain, dialog, screen, MenuItem, session, nativeTheme, autoUpdater } = require('electron');
const { billNoCounter, getLastBillNo, loggerFH, getLoggerFD, User, customEncoder, customDecoder } = require("./common");
const fs = require("fs");
const path = require("path");
const readLine = require("readline");
const { createModal, getTargetWindow, getMainWindow } = require('./createModal');
const { attendances, people, stock, sale, sequelize, purchase, user, schemas } = require('./model/dbConfig');
const winManager = require("electron-window-state");
const { Op,Sequelize } = require('sequelize');
const { minStock,creditLimitDays } = require("./config/policy.json");
const dynamicSchemas = require('./model/dynamicSchemas');
const bcrypt = require("bcrypt");
const uuid = require("uuid");
const speakeasy = require("speakeasy");


const { billItemSchema } = dynamicSchemas;
let appPolicy = require("./config/appDefault.json");
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
  },
  currentUser,totpTimer,linuxThemeWatchTimer;


function updateCloseFlag(){
  closeFlag=true;
}

exports.updateCloseFlag = updateCloseFlag;

async function createWindow () {
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
  let userCount = (await user.findAll()).length;
  let fileName = "lockScreen";
  if(userCount===0){
    fileName = "mainPage";
    await user.create({
      id: uuid.v5("admin","6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
      name: "admin",
      passwd: await bcrypt.hash("admin",10),
      role: "admin"
    });
  } // First start condition
  let ses = session.fromPartition("persist:bbs_auth");
  let authCookies = await ses.cookies.get({name:"bbs_auth",url:"http://localhost"});
  if(authCookies.length>0){
    let cookieObj = authCookies[0];
    let _user = JSON.parse(cookieObj.value);
    if(_user && cookieObj.expirationDate>Date.now()){
      let { id,name,secret,role,session,sessionTime,usePasswd } = _user;
      currentUser = new User(id,name,secret,role,session,sessionTime,usePasswd);
      currentUser.login();
      fileName = "mainPage";
    }
  }
  const mainWindow = createModal(windowOptions,`./template/html/${fileName}.html`,{maxWinCount:1,label:"Main"});
  let menu=Menu.buildFromTemplate(require("./menuTemplate")(mainWindow));
  Menu.setApplicationMenu(menu);
  mainWindow.maximize();
  winState.manage(mainWindow);
  mainWindow.webContents.on("did-finish-load",async ()=>{
    if(currentUser){ // For session login
      let {id,name,role,usePasswd} = currentUser;
      mainWindow.webContents.send("logged-in-user",{id,name,role,usePasswd});
      if(!["admin","all"].includes(currentUser.role))
        imposeRestriction();
    }
    else
      mainWindow.webContents.send("use-lock");
  });
  return mainWindow;
}

exports.billDesignerWindow = mainWindow => {
  return ()=>{
    mainWindow.loadFile("./template/html/billLayout.html");
    let menu = Menu.getApplicationMenu();
    menu.append(new MenuItem({
      role:"fileMenu",
      submenu:[
        new MenuItem({
          label:"New",
          click: ()=>{
            mainWindow.webContents.send("new-template");
          }
        }),
        new MenuItem({
          label:"Open",
          click:async ()=>{
            try{
              let { canceled,filePaths } = await dialog.showOpenDialog({
                defaultPath:app.getPath("documents"),
                filters:[{name:"JSON Files",extensions:["json"]}]
              });
              if(canceled) return;
              fs.readFile(filePaths[0],(err,data)=>{
                if(err) throw err;
                mainWindow.webContents.send("set-opened-file",JSON.parse(data.toString()),filePaths[0]);
              });
            }
            catch(err){
              console.log(err);
            }
          }
        }),
        new MenuItem({
          label:"Save as",
          click: ()=>mainWindow.webContents.send("save-as")
        }),
        new MenuItem({
          label:"Save & Exit",
        })
      ],
      enabled:true,
      visible:true,
      label:"File"
    }));
    Menu.setApplicationMenu(menu);
  }
}

ipcMain.handle("get-users", async ()=>{
  return (await user.findAll({
    attributes: ["name" , "id"]
  })).map(({dataValues})=>dataValues);
});

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

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) 
    await createWindow();
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
  let appDefaultSchema = {
    "a4": { "width": 595.28, "height": 841.89 },
    "letter": { "width": 612, "height": 792 },
    "applyTheme": false,
    "file": "",
    "useDarkTheme":false
  }
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
          let schema;
          if(fileName==="policy.json")
            schema = policyJsonSchema;
          else
          if(fileName==="saleConfig.json")
            schema = saleConfigSchema;
          else
          if(fileName==="appDefault.json")
            schema = appDefaultSchema;
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
  let mainWindow = await createWindow();
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
  // Initiating theme
  if(process.platform==="linux")
    setLinuxThemeObserver();
  await initTheme();
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

exports.getCurrentLogin = function(){
  return currentUser;
}

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
  if(["all","admin","bill"].includes(currentUser.role) && mode===1)
    Menu.getApplicationMenu().items[1].submenu.items[0].click();
  else
  if(["all","admin","purchase"].includes(currentUser.role) && mode===2)
    Menu.getApplicationMenu().items[2].submenu.items[0].click();
  else
    e.sender.send("error","Insufficient permission");
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

ipcMain.handle("add-user", async (e,data)=>{
  let encryptedPaswd = await bcrypt.hash(data.passwd,10);
  let role = ["admin","all"].includes(currentUser.role) ? data.role : "bill";
  try{
    return user.findOrCreate({
      where:{
        id: uuid.v5(data.name,"6ba7b814-9dad-11d1-80b4-00c04fd430c8")
      },
      defaults:{
        id: uuid.v5(data.name,"6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        name: data.name,
        passwd: encryptedPaswd,
        role
      }
    });
  }
  catch(err){
    console.log(err);
    return err;
  }
});

ipcMain.handle("update-user",async (e,data)=>{
  let encryptedPaswd = await bcrypt.hash(data.password,10);
  let admin = (await user.findOne({
    where:{
      id: currentUser.id
    }
  })).dataValues;
  data.role = data.name==="admin" ? "admin" : data.role;
  let updateObj = {
    passwd: encryptedPaswd
  };
  if(currentUser.name==="admin")
    updateObj.role = data.role;
  if(await bcrypt.compare(data["old-password"],admin.passwd))
    return user.update(updateObj,{
      where:{
        id: data.id
      }
    });
  else
    throw new Error("Old pasword don't match.");
});

ipcMain.handle("get-file-path",(e,filterObj)=>{
  return dialog.showOpenDialog(getMainWindow(),{
    filters:[filterObj]
  });
});

ipcMain.handle("update-wallpaper",async (e,{filePath,usePasswd})=>{
  try{
    if(filePath){
      let data = fs.readFileSync(path.resolve(__dirname,"./config/policy.json"));
      data = JSON.parse(data.toString());
      data.wallpaper = filePath;
      fs.writeFileSync(path.resolve(__dirname,"./config/policy.json"),JSON.stringify(data));
    }
    currentUser.usePasswd = usePasswd;
    await createSession(Date.now() + currentUser.sessionTime - currentUser.lastLogin);
    await user.update({usePasswd},{where:{id:currentUser.id}})
  }
  catch(err){
    throw err;
  }
});

ipcMain.handle("get-user-status",async (e,id)=>{
  return (await user.findOne({
    where:{
      id
    },
    attributes: ["secret"]
  })).dataValues.secret;
});

ipcMain.handle("generate-secret",()=>{
  const qrCode = require("qrcode");
  let secret = speakeasy.generateSecret({name:"BBSv2",issuer:"codeMint.com"});
  currentUser.tempSecet = secret.base32;
  return qrCode.toDataURL(secret.otpauth_url);
});

ipcMain.handle("save-secret-for-user",()=>{
  return user.update({
    secret:currentUser.tempSecet
  },{
    where:{
      id
    }
  });
});

ipcMain.handle("remove-secret",(e,id)=>{
  return user.update({
    secret:null
  },{
    where:{
      id
    }
  })
});

async function createSession(time){
  console.log("Creating session cookie.")
  let cookie = { 
    name:"bbs_auth",
    value:JSON.stringify(currentUser),
    url:"http://localhost",
    expirationDate: Date.now() + time
  };
  let mainWin = getMainWindow();
  let ses = mainWin.webContents.session;
  await ses.cookies.remove("http://localhost","bbs_auth");
  let authCookies = await ses.cookies.get({name:"bbs_auth",url:"http://localhost"});
  if(authCookies.length===0){
    await ses.cookies.set(cookie);
    await ses.cookies.flushStore();
    return ses.cookies.get({name:"bbs_auth",url:"http://localhost"});
  }
  else
    throw new Error("Failed to create cookie");
}

ipcMain.handle("create-login-session",async (e,{expiry})=>{
  try{
    await user.update({
      session: true,
      sessionTime: Number(expiry)*1000*60*60
    },{
      where:{ id:currentUser.id }
    });
    currentUser.session = true;
    currentUser.sessionTime = Number(expiry)*1000*60*60;
    await createSession(Number(expiry)*1000*60*60);
  }
  catch(err){
    console.log(err)
    return err;
  }
});

ipcMain.handle("remove-auth-session",async ()=>{
  let ses = getMainWindow().webContents.session;
  try {
    await user.update({
      session: false
    },{
      where: { id: currentUser.id }
    });
    currentUser.session = false;
    await ses.cookies.remove("http://localhost","bbs_auth");
  }  
  catch (error) {
    console.log(error)
    return error;
  }
});

ipcMain.on("logout",async ()=>{
  try{
    let mainWin = getMainWindow();
    let ses = mainWin.webContents.session;
    let authCookies = await ses.cookies.get({name:"bbs_auth",url:"http://localhost"});
    if(authCookies.length>0)
      await ses.cookies.remove("http://localhost","bbs_auth");
    else
      console.log("Cookie don't exist");
    currentUser.logout();
    currentUser = null;
    mainWin.loadFile("./template/html/lockScreen.html");
  }
  catch(err){
    console.log(err)
  }
});

function lock_unlockHelper(page,sig){
  let mainWin = getMainWindow();
  mainWin.loadFile(`./template/html/${page}.html`);
  mainWin.webContents.on("did-finish-load",function(e){
    try {
      mainWin.webContents.removeListener("did-finish-load", arguments.callee);
    } catch (error) {
      console.log(error)
    }
    if(sig==="lock")
      mainWin.webContents.send("lock",currentUser);
  });
}

ipcMain.on("lock",()=>{
  lock_unlockHelper("lockScreen","lock");
});

ipcMain.on("unlock",()=>{
  lock_unlockHelper("mainPage","unlock");
});

ipcMain.handle("check-session-info",async ()=>{
  let ses = getMainWindow().webContents.session;
  return ses.cookies.get({name:"bbs_auth",url:"http://localhost"})
});

// Lock Screen ipcs

ipcMain.handle("unlock-app",async (e,authData)=>{
  let _user = await user.findOne({
    where:{
      name:authData.name
    }
  });
  if(!_user)
    throw new Error("No user");
  let {passwd,id,name,role,secret,session,sessionTime,usePasswd} = _user.dataValues;
  if(await bcrypt.compare(authData.passwd,passwd)){
    currentUser = new User(id,name,secret,role,session,sessionTime,usePasswd);
    if(secret){
      function writeTOTP(){
        process.stdout.cursorTo(0,4)
        process.stdout.clearLine(0);
        process.stdout.write(speakeasy.totp({
          secret:secret,
          encoding:"base32"
        })+"\n");
      }
      writeTOTP()
      clearInterval(totpTimer);
      totpTimer = setInterval(writeTOTP,1000);
      return 1;
    }
    ipcMain.emit("app-login");
    return 0;
  }
  else
    return -1;
});

ipcMain.on("load-lander-page",()=>{
  let mainPage = getMainWindow();
  mainPage.loadFile("./template/html/mainPage.html")
});

ipcMain.handle("verify-code", async (e,{code})=>{
  let res = speakeasy.totp.verify({
    secret: currentUser.secret,
    window:0,
    token: code,
    encoding:"base32"
  });
  if(res){
    clearInterval(totpTimer);
    ipcMain.emit("app-login");
    try{
      await user.update({
        lastLogin: currentUser.lastLogin
      },{
        where:{id:currentUser.id}
      })
    }
    catch(err){
      throw new Error(err)
    }
  }
  return res;
});

ipcMain.on("app-login",async ()=>{
  console.log({section: "App Login Handler"});
  currentUser.login();
  clearInterval(totpTimer);
  try{
    if(currentUser.session)
      await createSession(currentUser.sessionTime);
    await user.update({
      lastLogin: Date.now()
    },{
      where: { id: currentUser.id }
    })
  }
  catch(err){
    console.log(err);
  }
  finally{
    imposeRestriction();
  }
});

function imposeRestriction(){
  // This is how to restrict access to some user.
  function blockHelper(menuList=[]){
    menuList.forEach(({index,isEnabled})=>{
      Menu.getApplicationMenu().items[index]
      .submenu.items.forEach(item=>{item.enabled=isEnabled});
    });
  }
  
  if(currentUser.role==="bill")
    blockHelper([{index:1,isEnabled:true},{index:2,isEnabled:false}]);
  else
  if(currentUser.role==="purchase")
    blockHelper([{index:2,isEnabled:true},{index:1,isEnabled:false}]);
  else {// Case for role admin and all
    // Checking for update
    checkForUpdates();
    return Menu.getApplicationMenu().items.forEach(({submenu})=>{
      submenu.items.forEach(item=>{
        item.enabled = true;
      });
    });
  }
  blockHelper([
    {index:4,isEnabled:false},
    {index:5,isEnabled:false},
  ]);
}

// Bill designer IPCs

ipcMain.on("load-main-page",()=>{
  let mainWindow = getMainWindow();
  mainWindow.loadFile("./template/html/mainPage.html");
  let menu = Menu.getApplicationMenu();
  let fileMenuIndex = menu.items.findIndex(obj=>obj.label==="File");
  if(fileMenuIndex>=0){
    menu.items.splice(fileMenuIndex,1);
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu.items));
  }
});

ipcMain.on("save-bill-template",async (e,page,saveAs=false)=>{
  let win = BrowserWindow.fromId(e.frameId);
  try{
    let { canceled,filePath } = (page.newDoc || saveAs) ? await dialog.showSaveDialog(win,{
      message: "Save bill template",
      defaultPath:app.getPath("documents"),
      properties:["createDirectory"]
    }) : { canceled:false,filePath:page.filePath };
    if(canceled) return 0;
    if(!/.json$/.test(filePath))
      filePath += ".json";
    fs.writeFile(filePath,JSON.stringify(page),err=>{
      if(err) return dialog.showErrorBox("File save error",err.message);
      return dialog.showMessageBox(win,{
        title:"Success",
        message:"Successfully saved bill layout.",
        type:"info"
      });
    });
  }
  catch(err){
    dialog.showErrorBox("File save error",err.message)
    return -1;
  }
});

ipcMain.handle("new-template-response",async (e,page)=>{
  let win = BrowserWindow.fromId(e.frameId);
  try{
    return dialog.showMessageBox(win,{
      type:"question",
      message:"Do you like save changes for future use?",
      title:"Save?",
      detail:"Changes in document will be earesed unless you save. A new untittled document will be created.",
      buttons:["Save","Don't save"]
    });
  }
  catch(err){
    return err;
  }
});

//Company profile IPCs
ipcMain.on("company-profile-info",async (e,data)=>{
  let win = BrowserWindow.fromId(e.frameId);
  let companyObj = await (new Promise((res,rej)=>{
    fs.readFile("./config/saleConfig.json",(err,data)=>{
      if(err) return rej(err);
      res(JSON.parse(data.toString()))
    });
  }));
  companyObj = {
    ...companyObj,
    ...data
  }
  fs.writeFile("./config/saleConfig.json",JSON.stringify(companyObj),err=>{
    if(err) return dialog.showErrorBox("File save error",err.message);
    return dialog.showMessageBox(win,{
      title:"Success",
      message:"Company profile updated.",
      type:"info"
    });
  });
});

ipcMain.handle("get-company-info",()=>{
  return new Promise((res,rej)=>{
    fs.readFile("./config/saleConfig.json",(err,data)=>{
      if(err) return rej(err);
      res(JSON.parse(data.toString()))
    });
  });
});

// Context Menu
ipcMain.on("show-context-menu",(e,{mode,x,y})=>{
  let window = BrowserWindow.fromId(e.frameId);
  if(mode==="overview-table"){
    let contextMenuObj = [
      {
        "label":"View Bill",
        click:()=>{
          window.webContents.send("show-bill");
        }
      },
      {
        "label":"Add Payment",
        click:()=>{
          ipcMain.emit("toggle-theme")
        }
      },
      {
        "label":"Notify"
      },
      {
        "label":"Print"
      }
    ];
    let menu = Menu.buildFromTemplate(contextMenuObj);
    menu.popup({
      window,
      x,
      y,
      callback:()=>{
        console.log("Context menu closed");
      }
    });
  }
});

//Theme IPC
ipcMain.handle("get-theme",async e=>{
  let { applyTheme=false } = appPolicy;
  if(applyTheme) return false;
  return defaultThemeData()
});

ipcMain.handle("init-theme",initTheme);

ipcMain.on("save-theme-setting",async (e,data)=>{
  let win = BrowserWindow.fromId(e.frameId);
  appPolicy = {
    ...appPolicy,
    ...data
  };
  fs.writeFile("./config/appDefault.json",JSON.stringify(appPolicy),err=>{
    if(err) throw err;
    dialog.showMessageBox(win,{
      title:"Success",
      message:"Appearance setting saved.",
      type:"info"
    });
    if(process.platform==="linux")
      setLinuxThemeObserver();
    initTheme();
  });
});

ipcMain.on("save-theme",(e,themeObj)=>{
  let win = BrowserWindow.fromId(e.frameId);
  let path2File = path.resolve("lib/default.theme");
  try{
    let buffData = Buffer.from(Buffer.from(JSON.stringify(themeObj)).map(customEncoder));
    fs.writeFile(path2File,buffData,(err)=>{
      if(err) throw err;
      // Apply saved theme
      if("applyTheme" in appPolicy && appPolicy.applyTheme===false){
        //Apply default theme.
        dialog.showMessageBox(win,{
          title:"Theme applied",
          type: "info",
          message: "Applied default theme."
        });
        if(process.platform==="linux")
          setLinuxThemeObserver();
        initTheme();
      }
    });
  }
  catch(err){
    throw err;
  }
});

function defaultThemeData(){
  return (new Promise((res,rej)=>{
    fs.readFile("./lib/default.theme",(err,data)=>{
      if(err) rej(err);
      let dataBuff = Buffer.from(data.map(customDecoder));
      res(JSON.parse(dataBuff.toString()));
    });
  }));
}

ipcMain.handle("get-app-policy",e=>{
  return new Promise((res,rej)=>{
    fs.readFile("./config/appDefault.json",(err,data)=>{
      if(err) rej(err);
      res(JSON.parse(data.toString()))
    });
  })
});

function setLinuxThemeObserver(){
  if(!("useDarkTheme" in appPolicy)) return;
  if(appPolicy.useDarkTheme)
    linuxThemeWatchTimer = setInterval(()=>{
      nativeTheme.themeSource = "system";
      if(nativeTheme.shouldUseDarkColors)
        nativeTheme.themeSource = "dark";
      else
        nativeTheme.themeSource = "light";
    },1500);
  else
    clearInterval(linuxThemeWatchTimer);
}

async function initTheme({shouldUpdate=false}={},e={}){
  let win = "frameId" in e ? BrowserWindow?.fromId(e?.frameId) : getMainWindow();
  let dataBuff = await defaultThemeData();
  let themeObj = {
    ...appPolicy,
    ...dataBuff,
    shouldUseDarkColors:nativeTheme.shouldUseDarkColors
  }
  win.webContents.send("apply-theme",themeObj);
  if(shouldUpdate){
    BrowserWindow.getAllWindows().forEach(_win=>{
      if(_win!==win)
        _win.webContents.send("apply-theme",themeObj);
    })
  }
  return themeObj;
}

nativeTheme.addListener("updated",initTheme.bind(null,{shouldUpdate:true}));

ipcMain.handle("get-svg",(e,filePath)=>{
  return fs.readFileSync(filePath).toString();
});

// setInterval(()=>{
//   nativeTheme.themeSource = "system";
//   if(nativeTheme.shouldUseDarkColors)
//     nativeTheme.themeSource = "dark";
//   else
//     nativeTheme.themeSource = "light";
// },1500);// Remove later

// Backup manager
ipcMain.handle("app-backup",async (e,data)=>{
  let dirPath = await dialog.showSaveDialog({
    message:"A backup directory will be created to host backup files.",
    defaultPath:app.getPath("documents")
  });
  // Create backup path if not exist then perform backups
  return;
});// Not complete

// let backupDB = new Sequelize({
//   dialect:"sqlite",
//   storage:"./db/backup.db",
// })

// backupDB.authenticate()
// .then(()=>{
//   let models = Object.keys(sequelize.models);
//   let fromSchemas = Object.keys(schemas);
//   // models.forEach(async model=>{
//   //   console.log(await sequelize.model(model).findAll())
//   // });
// });

// App registration
ipcMain.handle("app-registration-info",e=>{
  let saleConfig = JSON.parse(fs.readFileSync("./config/saleConfig.json").toString());
  return saleConfig.gst;
});

ipcMain.on("app-registration",async (e,gst)=>{
  let windowOptions = {
    webPreferences:{
      nodeIntegration: false,
      preload:__dirname+"/registrationPreload.js"
    }
  }
  createModal(windowOptions,"./template/html/registration.html",{
    label:"registration-window",
    maxWinCount:1,
    cb:function(){
      this.webContents.send("call-register-link",gst);
    }
  });
});

//App update logic
async function checkForUpdates(){
  let { UPDATE_URL,UPDATE_REST } = process.env;
  let mainWin = getMainWindow();
  if(!["admin","all"].includes(currentUser.role))
  {
    return dialog.showMessageBox(mainWin,{
      title: "Unauthorized",
      message: "Only Admin and user with role 'all' can check for update."
    });
  }
  console.log("Checking for update");
  // app.getVersion();
  let {isOnline,appVersion,err} = await new Promise((res)=>{
    mainWin.webContents.send("check-for-update",UPDATE_REST,app.getVersion());
    ipcMain.on("check-for-update-response",(e,{isOnline=false,appVersion,err})=>{
      res({isOnline,appVersion,err});
    });
  });
  if(err){
    // Logic for error Handling
  }
  if(isOnline===false) 
    return dialog.showMessageBox(mainWin,{
      title: "No Connection",
      message: "Failed to connect to update server."
    });
  // Parse and santize appVersion
  if(appVersion && typeof appVersion==="string" && new RegExp(/^([0-9]+\.){2}[0-9]+$/).test(appVersion)){
    let [major,minor,bugFix] = app.getVersion().split(".");
    let [_major,_minor,_bugFix] = appVersion.split(".");
    let message;
    if(Number(_major)>Number(major))
      message = "A new version of BBS is available for download.";
    if(Number(_minor)>Number(minor))
      message = "A minor feature update is available for download.";
    if(Number(_bugFix)>Number(bugFix))
      message = "Bug fix available for download.";
    message += ` Please visit ${UPDATE_REST}/changelogs for more details.`;
    let {response} = await dialog.showMessageBox(mainWin,{
      title: "Update available for download",
      message,
      buttons: ["Later","Update"]
    });
    if(response===0) return;
    if(process.platform==="darwin"){
      UPDATE_URL += "mac/";
      
    }
    else
    if(process.platform==="win32"){
  
    }
    else
    if(process.platform==="linux"){
      console.log("update for linux")
    }
  }
}

autoUpdater.on("update-available",()=>{
  const dialogOpts = {
    type: 'info',
    buttons: ['Cancel', 'Download'],
    title: 'Application Update',
    detail: 'A new version of BBS is ready for download.'
  };

  dialog.showMessageBox(dialogOpts, (response) => {
    if (response === 0) { 
      
    }
  });
});

module.exports.checkForUpdates = checkForUpdates;