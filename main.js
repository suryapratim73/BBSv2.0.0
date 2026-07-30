global.shouldWait = true;
require("dotenv").config({path:__dirname+"/.env"});
const {
  app={},
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  dialog,
  screen,
  MenuItem,
  session,
  nativeTheme,
  crashReporter,
  powerMonitor,
  Notification,
  shell,
  nativeImage,
  protocol
} = require("electron");

// CRITICAL: Register custom protocol BEFORE any other code runs
// This must be done before app.ready and before any other initialization
protocol.registerSchemesAsPrivileged([
  {
    scheme:"bbs",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    }
  }
]);

// in the main process:, initializing remote for renderer
require('@electron/remote/main').initialize();
const {
  initBillManager,
  getBillManager,
  billNoCounter,
  getLastBillNo,
  User,
  customEncoder,
  customDecoder,
  appLogger,
  getBillModel,
  getLedgerModel,
  getBaseDir,
  print,
  openFormatForDate,
  checkForInternet,
  getFivePercentOfMemory,
  getAllSales,
  getPurchases,
  queryStock,
  checkNLogMemoryUsage,
  placeOfJurisdiction,
  notifyCustomer,
  getPDF_FileName,
  saveDownloadState,
  loadDownloadState,
  clearDownloadState,
  verifyPartialFile,
  computeFullFileHash,
  verifyFileIntegrityByChunks,
  reDownloadCorruptedSections,
  getFinYearStrtEndDt,
  generateSecureSalt,
  getDeviceSerials,
  saveSecret,
  getSecret,
  deleteSecret,
  getBillsDir
} = require("./common");
// const { getBillsDir } = require("./paths");
const { getAppPolicyPath,getsaleConfigPolicyPath,getUserPolicyPath, getOrderPath, getSchedulerPath, roundOffTo2DecimalPlace } = require("./template/js/common");
const fs = require("fs");
const path = require("path");
const readLine = require("readline");
const crypto = require("crypto");

global.needsSchemaBootstrap = false;
let {
  createModal,
  getTargetWindow,
  getMainWindow,
} = require("./createModal");
const { getTemplatePath, initializeThemeAndBanners, reapplyTheme, storeUserThemeObj, clearWeatherInterval, registerIPC: registerThemeIPC } = require("./viewManager");
let {
  attendances,
  people,
  stock,
  sale,
  sequelize,
  purchase,
  user,
  finData,
  customer,
  supplier
} = require("./model/dbConfig");
const winManager = require("electron-window-state");
const { Sequelize, UUIDV4,DataTypes, Op } = require("sequelize");
const bcrypt = require("bcrypt");
const uuid = require("uuid");
const speakeasy = require("speakeasy");
const axios = require("axios");
const { spawn } = require("child_process");
const { printOnLinuxOrMac,printOnWindows, printDialog } = require("./printHandler");
const { billPDF, ledgerPDF } = require("./scripts/makePDF.default");
const { orderManager, saleWindow } = require("./saleHandler");
const AdmZip = require("adm-zip");
const { markBillAsPaid } = require("./customerHandler");
const { recordDownloadedVersion, showUpdateSuccessMsg } = require("./versionManager");
const { getFileMonitor } = require("./fileMonitor");
const { openCatalogueCreator } = require("./catalogueHandler");


let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;

const { deserializeSchema } = require("./model/schemaLoader");
const { enable } = require("@electron/remote/main");
const { save } = require("pdfkit");
const { main } = require("./lib/execCustomTemplate");

// Load dynamicSchemas from JSON (server-delivered)
let dynamicSchemas, billItemSchema, customerLedgerSchema, supplierLedgerSchema;
try {
    let dynamicSchemaJsonPath = path.resolve(appPath,"./model/dynamicSchemas.json");
    
    if(!fs.existsSync(dynamicSchemaJsonPath)){
        throw new Error("dynamicSchemas.json not found.");
    }
    
    // Deserialize JSON schema to Sequelize objects
    const dynamicSchemaJson = fs.readFileSync(dynamicSchemaJsonPath, "utf-8");
    dynamicSchemas = deserializeSchema(dynamicSchemaJson, DataTypes);
    ({ billItemSchema, customerLedgerSchema, supplierLedgerSchema } = dynamicSchemas);
} catch (err) {
    appLogger({title:"Schema loading error", message: String(err), func:"main-init"});
    appLogger({title:"Schema Bootstrap", message:"Schema files not found. Set SCHEMA_SERVER_URL in .env or connect to internet for auto-download.", func:"main-init"});
    // Set flag to trigger bootstrap dialog
}
let closeFlag = false,
windowOptions = {
    width: 600,
    height: 400,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      devTools: true,
      contextIsolation: false,
    },
    show: false,
  },
  currentUser,
  totpTimer,
  linuxThemeWatchTimer,
  firstBoot = false,
  dbInitialized = false,
  unsavedUsers = [],jobs = [], orderStages = ["queued","ready-to-dispatch","dispatched","delivered"],
  idleLockTimer,appLocked = true,
  appIcon = nativeImage.createFromPath(path.resolve(__dirname,"./logo256.png")),
  fileMonitor = null;
const monthNames = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
  ];


function updateCloseFlag() {
  closeFlag = true;
}

exports.updateCloseFlag = updateCloseFlag;

function bootCommon(mainWindow){
  mainWindow.webContents.on("did-finish-load", async () => {
    if (currentUser) {
      // For session login
      let { id, name, role, usePasswd } = currentUser;
      mainWindow.webContents.send("logged-in-user", {
        id,
        name,
        role,
        usePasswd,
      });
    } else mainWindow.webContents.send("use-lock");
  });
  imposeRestriction();
  return mainWindow;
}

class Job{
  constructor(id,intr,args,func,time){
    this.id = id;
    this.intr = intr;
    this.args = args;
    this.func = func;
    this.time = time;
    this.status = "created";
    if(time){
      this.timer = setInterval(()=>{
        this.act(this.intr);
      },this.time)
    }
  }
  act(intr){
    if(this.intr===intr){
      this.func(...this.args,this);
    }
  }
  updateStatus(status){
    this.status = status;
    if(status==="OK")
      clearInterval(this.timer);
  }
  updateArgs(...args){
    this.args = [
      ...this.args,
      ...args
    ];
  }
}

// Handle protocol URLs from external launches (e.g., updator.bat using bbs://update-complete)
function handleProtocolUrl(url) {
  console.log("========================================");
  console.log("🔗 Protocol URL Handler Triggered!");
  console.log("URL:", url);
  console.log("========================================");
  
  if (!url || !url.startsWith('bbs://')) {
    console.log("Not a bbs:// URL, ignoring");
    return;
  }
  
  // Parse the protocol URL for actions
  if (url.includes('update-complete')) {
    console.log("Showing update complete notification");
    
    // Show notification
    const notification = new Notification({
      title: "Update Complete",
      body: "BBS has been successfully updated to the latest version!",
      icon: appIcon
    });
    notification.show();
    
    // Focus main window
    const mainWin = getMainWindow();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
    
    appLogger({
      title: "Update Notification",
      message: "Update complete notification shown via protocol URL",
      func: "handleProtocolURL"
    });
  }
  // Add more protocol URL handlers here as needed
  // e.g., bbs://open-customer/123, bbs://new-sale, etc.
}

async function createWindow() {
  // Check if schemas need to be bootstrapped
  if (global.needsSchemaBootstrap) {
    // Attempt to initialize schemas
    try {
      if(await checkForInternet()===false){
        appLogger({ title: "No internet connection", message: "Skipping schema validation.", func: "createWindow" });
        app.dialog.showErrorBox("No Internet Connection", "Schema Bootstrap requires an internet connection. Please connect to the internet and try again.");
        app.quit();
      }
      appLogger({title:"Schema Bootstrap", message:"Downloading schemas", func:"createWindow", appendToLog: false, allowConsole: true})
      let { serverSchema, serverDynamic } = await schemaDownloader();
      saveSchemaLocally(serverSchema,serverDynamic);
      appLogger({title:"Schema Bootstrap", message:"Schemas downloaded successfully. Restarting app...", func:"createWindow", appendToLog: false, allowConsole: true});
      app.relaunch();
      app.exit(0);
      return;
    } catch (err) {
      dialog.showErrorBox(
        "Schema Download Failed",
        `Failed to download schemas: ${err.message}\n\nPlease check:\n1. SCHEMA_SERVER_URL in .env\n2. Server is running and accessible\n3. Network connection`
      );
      appLogger({
        title: "Schema Download Error",
        message: String(err),
        func: "createWindow schema download"
      });
      app.quit();
      return;
    }
  }
  
  let { width, height: workAreaHeight } = screen.getPrimaryDisplay().workArea;
  let { height } = screen.getPrimaryDisplay().size;
  let winState = winManager({
    defaultWidth: width,
    defaultHeight: workAreaHeight,
    path: path.resolve("./"),
  });
  workAreaHeight -= height - workAreaHeight;
  let windowOptions = {
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    minWidth: 800,
    minHeight: 600,
    title: "BBSv"+app.getVersion()
  };
  windowOptions.resizable = true;
  windowOptions.maximizable = true;
  let fileName = "lockScreen";
  try{
    let userCount = (await user.findAll()).length;
    if (userCount === 0) {
      fileName = "mainPage";
      await user.create({
        id: uuid.v5("admin", "6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        name: "admin",
        passwd: await bcrypt.hash("admin", 10),
        role: "admin",
      });
    } // First start condition
    dbInitialized = true;
    let ses = session.fromPartition("persist:bbs_auth");
    let authCookies = await ses.cookies.get({
      name: "bbs_auth",
      url: "http://localhost",
    });
    if (authCookies.length > 0) {
      let cookieObj = authCookies[0];
      let _user = JSON.parse(cookieObj.value);
      if (_user && cookieObj.expirationDate > Date.now()/1000) {
        appLogger({
          title:"App Session Info",
          message:{
            "Time left":roundOffTo2DecimalPlace((cookieObj.expirationDate - Date.now()/1000)/(60*60))+" Hours"
          },
          func:"createWindow"
        });
        let { id, name, secret, role, session, sessionTime, usePasswd } = _user;
        currentUser = new User(
          id,
          name,
          secret,
          role,
          session,
          sessionTime,
          usePasswd
        );
        currentUser.login();
        global.user = currentUser;
        fileName = "mainPage";
        let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
        if("lockOnIdle" in policy && policy.lockOnIdle){
          clearInterval(idleLockTimer);
          idleLockTimer = setInterval(lockOnIdle.bind({idleTime:policy.idleTime}),5000);
        }
      }
    }
    firstBoot = true;
    process.appStatus = "normal";
    const mainWindow = createModal(
      windowOptions,
      getTemplatePath(fileName),
      { maxWinCount: 1, label: "Main" }
    );

    // Single instance lock
    if(process.env.APP_ENV!="DEV" && !app.requestSingleInstanceLock())
      app.quit();
    else{
      app.on("second-instance",(event, commandLine)=>{
        if(process.env.APP_ENV==="DEV") return;
        
        // Check for protocol URL in command line (e.g., from updator.bat)
        console.log("Second instance detected, commandLine:", commandLine);
        const protocolUrl = commandLine.find(arg => arg.startsWith('bbs://'));
        if (protocolUrl) {
          handleProtocolUrl(protocolUrl);
        }
        
        // Focus window
        if(mainWindow.isMinimized())
          mainWindow.restore();
        mainWindow.focus();
      });
    }

    // Removing temporary files.
    let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS") : __dirname;
    try{
      let billsDir = getBillsDir();
      if (!fs.existsSync(billsDir)) return;
      let files = fs.readdirSync(billsDir)
      files.filter(file=>/_temp/.test(file))
      .forEach(file=>{
        fs.unlinkSync(path.resolve(billsDir, file))
      })
    }
    catch(err){
      appLogger({
        title:"Error",
        message:String(err),
        func:"Deletion of Temporary Files"
      })
    }

    // Unregistering conflicting global shortcuts
    globalShortcut.unregister("CommandOrControl+Tab+Up");
    globalShortcut.unregister("CommandOrControl+F4");
    
    mainWindow.maximize();
    winState.manage(mainWindow);     
    bootCommon(mainWindow)

    // Schema validation and migration
    try{
      if(currentUser && ["all","admin"].includes(currentUser.role))
        dbInitialized = await schemaValidation_migrationHandler(mainWindow,appPath);
    }
    catch(err){
      appLogger({
        title:"Schema Validation Error",
        message:String(err),
        func:"createWindow"
      });
    }

    return mainWindow;
  }
  catch(err){
    if("name" in err && err.name==="SequelizeDatabaseError"){
      firstBoot = true;
      unsavedUsers.push({
        id: uuid.v5("admin", "6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        name: "admin",
        passwd: "admin",
        role: "admin",
      });
      let appConfig = fs.readFileSync (getAppPolicyPath())
      const mainWindow = createModal(
        windowOptions,
        getTemplatePath("firstBoot"),
        { maxWinCount: 1, label: "Main", show: true,
          cb:function(){
            let hasBackup = JSON.parse(appConfig.toString())?.hasBackup || false;
            if(!hasBackup)
              this.webContents.send("first-launch");
          }
        }
      );
      mainWindow.maximize();
      winState.manage(mainWindow);
      await sequelize.sync({
        force:true,
        alter:true
      }).catch(console.warn);
      appLogger({title:"Database", message:"Database initialized.", func:"createWindow"});
      dbInitialized = true;
      mainWindow.webContents.send("Database initialized");
      if(fs.existsSync(app.getPath("appData")+"/temp.json")){
        let pageWiseData = JSON.parse(fs.readFileSync(app.getPath("appData")+"/temp.json").toString());
        appLogger({
          title:"Restoring initial Data",
          message:"Restoring page wise data from temp.json",
          func:"createWindow",
          data:JSON.stringify(pageWiseData)
        });
      }
      if(unsavedUsers.length>0){
        appLogger({
          title:"Message",
          message:"Saving unsaved users.",
          func:"createWindow"
        });
        Promise.all(
          unsavedUsers.map(async data=>{
            console.log("Saving password",data.passwd)
            let encryptedPaswd = await bcrypt.hash(data.passwd, 10);
            let role = ["admin", "all"].includes(currentUser?.role ?? "admin") ? data.role : "bill";
            return user.findOrCreate({
              where: {
                id:data.id,
              },
              defaults: {
                id:data.id,
                name: data.name,
                passwd: encryptedPaswd,
                role,
              },
            });
          })
        )
        .then(()=>{
          unsavedUsers = [];
          appLogger({
            title:"Success",
            message:"Users saved",
            func:"createWindow"
          });
        })
        .catch(err=>{
          appLogger({
            title:"Error",
            message:String(err),
            func:"Create user error"
          });
        });
      }
      let path2TmpFile = path.resolve(app.getPath("appData"),"/temp.json");
      if(fs.existsSync(path2TmpFile)){ // If file containing initial info exists.
        let pageWiseData = JSON.parse(fs.readFileSync(path2TmpFile).toString())
        Object.keys(pageWiseData)
        .forEach(pageNo=>{
          saveInitData(pageNo,pageWiseData[pageNo]);
        });
      }
      return mainWindow;
    }
    else{
      appLogger({
        title:"Error",
        message:String(err),
        func:"Trying to login error"
      });}
  }
}

async function schemaValidation_migrationHandler(mainWindow,appPath){
  let migrateFlag = await schemaValidator();
  if(migrateFlag === true){
    if(!fs.existsSync(path.resolve(appPath,"./model/")))
      fs.mkdirSync(path.resolve(appPath,"./model"));
    mainWindow.setProgressBar(0,{mode:"normal"});
    mainWindow.webContents.send("execute-progressbar",0);
    await dbMigrator();
    return false;
  }
  else
    return true;
}

ipcMain.handle("get-users", async () => {
  if(dbInitialized)
    return (
      await user.findAll({
        attributes: ["name", "id"],
      })
    ).map(({ dataValues }) => dataValues);
  else
      return [];
});

app.setAsDefaultProtocolClient("bbs");

app.on("quit", async () => {
  clearWeatherInterval();
  try{
    if(dbInitialized)
      await sequelize.close()
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"app.on('quit')"
    })
  }
  let rawData = fs
    .readFileSync(getsaleConfigPolicyPath())
    .toString();
  let saleConfig = rawData !== "" ? JSON.parse(rawData) : {};
  saleConfig.billNo = getLastBillNo();
  fs.writeFileSync(
    getsaleConfigPolicyPath(),
    JSON.stringify(saleConfig)
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
  // app.hide()
});

app.on("activate", async () => {
  crashReporter.start({ submitURL:process.env.UPDATE_REST+"crashed" })
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});

function takeAttendance(refWindow) {
  if(!["all","admin"].includes(currentUser?.roles || "")) return;
  windowOptions.parent = refWindow;
  closeFlag = false;
  let win = createModal(windowOptions, getTemplatePath("attendaceModal"), {
    maxWinCount: 1,
    label: "Attendance-modal",
  });
  win.on("close", (e) => {
    if (closeFlag == false) {
      e.preventDefault();
      e.sender.send("update-attendance-close");
    }
  });
}

function paySalary(refWindow) {
  windowOptions.parent = refWindow;
  createModal(windowOptions, getTemplatePath("salaryPaymentModal"), {
    maxWinCount: 1,
    label: "Salary-Modal",
  });
}

app.on("ready", async () => {
  if(typeof process.presets==="undefined")
    process.presets = {};
  appLogger({title:"Log", message:"ready event", func:"app ready event"})
  let policyJsonSchema = {
    "noReturn": 120,
    "gstRecurranceTerm": 1,
    "financialYearStartDate": "01-03",
    "minStock": 10,
    "creditLimitDays": 21,
    "wallpaper": "",
    "lockOnIdle":false,
    "billExpiry": 14
  };
  let saleConfigSchema = {
    "billNo": 32,
    "biller": "",
    "address": "",
    "gst": "",
    "phones": [],
    "scriptFile": "makePDF.default",
    "lib": "buildPage.default",
    "borderRect": [10, 22, 590, 750],
    "titileFontSize": 20,
    "titleFontFamily": "Times-Bold",
    "captionFontSize": 14,
    "defaultFontFamily": "Times-Roman",
    "defaultFontSize": 10,
    "headingFontSize": 12,
    "margin": 10,
    "emblem": "",
    "unitMap": [{ "Kg": 1,unitName:"Kg" }, { "Bag": 50,unitName:"Kg" }, { "Bundle": 5,unitName:"Boxes" }, { "Piece": 1,unitName: "ps"}],
    "billTemplate": {
      "applyTemplate": false,
      "file": ""
    },
    "bankDetails": [],
    "availableBillNo":[]
  };
  let appDefaultSchema = {
    "a4": { "width": 595.28, "height": 841.89 },
    "letter": { "width": 612, "height": 792 },
    "applyTheme": false,
    "file": "",
    "useDarkTheme": false
  };
  //Initialize BBS..
  //Initialize logger file
  //Check for required files and directories
  let fileList = [];
  let readInterface = readLine.createInterface({
    input: fs.createReadStream(__dirname + "/fileList"),
    output: process.stdout,
    terminal: false,
  });
  appLogger({title:"APP_ENV", message:process.env.APP_ENV, func:"app ready event"})
  readInterface.on("line", (line) => fileList.push(JSON.parse(line)));
  readInterface.on("close",async () => {
    try {
      if(process.env.APP_ENV!=="DEV" && !fs.existsSync(app.getPath("appData")+"/BBS"))
        fs.mkdirSync(app.getPath("appData")+"/BBS",{recursive:true});
      await Promise.all(
        fileList.map(async ({ fPath, fileName, type, dir }) => {
          //check for dir
          return new Promise((res,rej)=>{
            let rootPath;
            if(process.env.APP_ENV==="DEV")
              rootPath = __dirname;
            else
              rootPath = app.getPath("appData")+"/BBS";
            if (!fs.existsSync(path.resolve(rootPath, dir)))
              fs.mkdir(path.resolve(rootPath, dir), (err) => {
                if (err) rej(err);
                appLogger({title:"Directory created",message:path.resolve(rootPath, dir),func:"app ready event"});
                res(true)
              });
            //check for files
            if (!fs.existsSync(path.resolve(rootPath, fPath))) {
              if (type === "config") {
                let schema = {};
                if (fileName === "policy.json") schema = policyJsonSchema;
                else if (fileName === "saleConfig.json") schema = saleConfigSchema;
                else if (fileName === "appDefault.json") schema = appDefaultSchema;
                fs.writeFile(path.resolve(rootPath,fPath), JSON.stringify(schema), (err) => {
                  if (err) rej(err);
                  appLogger({title:"File created",message:path.resolve(rootPath,fPath),func:"app ready event"});
                  res(true);
                });
              } // Specify condition for otherfile types for later versions
            }
            res(true);
          });
        })
      ).catch(err=>{
        appLogger({title:"Error",message:String(err),func:"Filelist check error"});
      });
      appLogger({title:"Filelist check",message:"Filelist check complete",func:"app 'ready' event"});
      fs.readFile(getsaleConfigPolicyPath(), (err, data) => {
        if (err) return console.error(err);
        const saleConfig = JSON.parse(data.toString());
        appLogger({
          title:"Log",
          message:JSON.stringify({billNo: saleConfig.billNo}),
          func:"app 'ready' event"
        })
        initBillManager(saleConfig);
      });
      global.shouldWait = false;
      // Adding tab switcher - global shortcuts
      let mainWindow = await createWindow();

      createNotifications();
      let focussedWindow = BrowserWindow.getFocusedWindow();
      globalShortcut.register("CommandOrControl+Up", () => {
        if (mainWindow) {
          let brWindows = BrowserWindow.getAllWindows();
          brWindows = brWindows.filter((win) => win !== mainWindow);
          let index = brWindows.indexOf(focussedWindow);
          index = index === -1 ? 0 : index;
          if (index === brWindows.length - 1) index = 0;
          else index++;
          focussedWindow = brWindows?.[index];
          focussedWindow?.focus();
          if(focussedWindow?.isMinimized())
            focussedWindow.restore();
        }
      });
      globalShortcut.register("CommandOrControl+Esc",()=>{
        let win = BrowserWindow.getFocusedWindow();
        if(win && win!==mainWindow)
          win.close();
      });
      globalShortcut.register("CommandOrControl+M",()=>{
        let win = BrowserWindow.getFocusedWindow();
        if(win===mainWindow) 
          win = BrowserWindow.getAllWindows().filter(win=>win.isMinimized());
        if(!(win instanceof Array) && (!(win?.isMinimized()) && win?.isMinimizable())){
          process.lastMinimizedWin = win;          
          win.minimize();
        }
        else
        if(win instanceof Array){
          win = typeof process.lastMinimizedWin!=="undefined" ? win.find(_win=>_win===process.lastMinimizedWin) : win.pop();
          win?.restore();
          process.lastMinimizedWin = undefined;
        }
      });
      if(firstBoot || !dbInitialized) return;
      // Taking attendance
      let todaysAttendance = (
        await attendances.findOne({
          where: {
            date: new Date().toDateString(),
          },
          attributes: ["attendees"],
        })
      )?.dataValues;
      let attendees = todaysAttendance?.attendees ?? [];
      if (attendees.length > 0)
        attendees = attendees.filter(({ presence }) => presence === 0);
      if (mainWindow && (!todaysAttendance || (todaysAttendance && attendees.length > 0)))
        takeAttendance(mainWindow);
      // Paying salary - need check
      if (new Date().getDate() > 1) {
        let payHistory = (
          await people.findAll({
            attributes: ["moreInfo"],
          })
        ).map(({ dataValues }) => dataValues.moreInfo);
        let thisMonthPayments = payHistory.filter((obj) => {
          const { payHistory, salary } = obj;
          let thisMonthPayment =
            payHistory?.filter(
              ({ date }) => new Date(date).getMonth() === new Date().getMonth()
            )?.[0]?.payment ?? 0;
          if (thisMonthPayment < Number(salary)) return true;
        });
        if (thisMonthPayments.length > 0) paySalary(mainWindow);
      }
      // Initiating theme
      if (process.platform === "linux") setLinuxThemeObserver();
      await initTheme();
      // Start file monitor for unprinted bills (async to avoid blocking)
      try {
        fileMonitor = getFileMonitor();
        await fileMonitor.start();
      } catch (err) {
        appLogger({
          title: "File Monitor Error",
          message: String(err),
          func: "app ready - fileMonitor start"
        });
      }
    } catch (err) {
      // console.log(err)
      appLogger({ title: "Error", message: String(err), func:"filelist read error" });
    }
  });
  // Initialize app presets
  setAppPresets();
  // App registration check
  appRegistrationHandler();


  let secret = await getSecret();

  if(!secret) {
    // Generate a new secret and save it - first launch logic
    secret = crypto.randomBytes(64).toString('hex');
    await saveSecret(secret);
  }

  encryptAndUploadS3(); // Call the function to encrypt and upload logs to S3
});

async function encryptAndUploadS3(){
  try{
    const yesterday = new Date(Date.now() - 24*60*60*1000);
    const crypto = require("crypto");
    let baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    let path2Logs = path.resolve(baseLogDir,"upload/");
    if(!fs.existsSync(path2Logs)) return; // Will try later
    const todaysDate = new Date().toISOString().split("T")[0];
    let logFiles = fs.readdirSync(path2Logs).filter(file=>!file.match(todaysDate) && file.endsWith(".txt"));
    console.log({logFiles});
    const secret = await getSecret(); // Retrieve the secret from secure storage
    const { motherboardSerial,diskSerial } = await getDeviceSerials();
    if(!motherboardSerial || !diskSerial || !process.presets.gst) return; // Skip if hardware IDs are not available
    const rootData = process.presets.gst + motherboardSerial + diskSerial; // Combine GST number and hardware IDs
    const kek = crypto.pbkdf2Sync(secret, rootData, 100000, 32, 'sha256');
    if (kek.length !== 32) throw new Error("KEK must be 256 bits!");
    let logFilesLength = logFiles.length;
    await new Promise((resolve,reject)=>{
      for(let file of logFiles){
        const iv = crypto.randomBytes(16);
        const kekcipher = crypto.createCipheriv("aes-256-gcm",kek,iv); // Wrap DEK with KEK
        const dek = crypto.randomBytes(32); // Data Encryption Key
        const encryptedDEK = Buffer.concat([kekcipher.update(dek), kekcipher.final()]);
        const authTag = kekcipher.getAuthTag();
        const wrappedDek = Buffer.concat([iv, authTag, encryptedDEK]);
        const fileName = file.split(".")[0] + ".enc";
        const encryptedFilePath = path.resolve(baseLogDir,"upload/"+fileName);// new enc file for each log file
        if(fs.existsSync(encryptedFilePath)) {
          logFilesLength--;
          fs.unlinkSync(path.resolve(path2Logs,file)); // Delete original log file
          if(logFilesLength===0) resolve(true);
          continue;// Already encrypted and uploaded - avoid re-encrypting
        }
        const writeStream = fs.createWriteStream(encryptedFilePath);
        const logIv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-gcm", dek, logIv);
        writeStream.write(Buffer.from("V1")); // Versioning
        writeStream.write(Buffer.from([wrappedDek.length]));
        writeStream.write(wrappedDek);
        writeStream.write(logIv);
        let filePath = path.resolve(path2Logs,file);
        // Encrypt file with DEK and upload to S3
        // After successful upload, delete local file
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(cipher).pipe(writeStream,{end:false});// Write stream must not end until auth tag is written
        readStream.on('error', (err) => {
          console.error("Read Stream Error:", err);
        });
        cipher.on('error', (err) => {
          console.error("GCM Cipher Error:", err);
          writeStream.end();
          reject(err);
        });
        cipher.on('end', () => {
          writeStream.write(cipher.getAuthTag());
          writeStream.end();
          logFilesLength--;
          fs.unlinkSync(filePath); // Delete original log file    
          if(logFilesLength===0) resolve(true);
        });
      }
      if(logFilesLength===0)
        resolve(true);// In case there are no log files to encrypt, resolve immediately
    });
    // Upload encrypted files to S3
    // Expected launch date: 2026-12-1. After this date, stop uploading logs to S3.
    // App will continue to encrypt logs locally, but will not upload to S3 after this date.
    // This is to avoid unnecessary S3 storage costs after the expected launch date.
    if(new Date()<new Date("2026-12-1")) return; // Stop uploading after this date
    let encryptedFiles = fs.readdirSync(path.resolve(baseLogDir,"upload/")).filter(file=>file.endsWith(".enc"));
    for(let file of encryptedFiles){
      let filePath = path.resolve(baseLogDir,"upload/"+file);
      uploadToS3(filePath,file).then((success)=>{
        if(!success) return; // upload failed — error already logged by uploadToS3
        console.log("Writing upload tracker for:", file);
        fs.writeFileSync(path.resolve(baseLogDir,"upload_tracker.txt"),JSON.stringify({lastUploaded:file,uploadedAt:new Date().toISOString()})+"\n",{flag:"a"});
      }).catch(err=>{
        appLogger({
          title: "S3 Upload Error",
          message: String(err),
          func: "encryptAndUploadS3 - uploadToS3"
        });
      });
    }
  }
  catch(err){
    appLogger({
      title: "Error",
      message: String(err),
      func: "encryptAndUploadS3"
    });
  }
}

async function uploadToS3(filePath,fileName,logType="device_log"){
  try{
    // Read the upload_tracker.txt to check if this file has already been uploaded
    let uploadTrackerPath = path.resolve(process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/"),"upload_tracker.txt");
    let rl = readLine.createInterface({
      input: fs.createReadStream(uploadTrackerPath),
      output: process.stdout,
      terminal: false
    });
    let alreadyUploaded = false;
    for await (let line of rl) {
      if(line.trim()==="") continue;
      try { line = JSON.parse(line); } catch(_) { continue; }
      if(line.lastUploaded===fileName){
        alreadyUploaded = true;
        break;
      }
    }
    rl.close();
    if(alreadyUploaded) return false; // already done — not an error, just skip
    // Read file and compute Content-MD5 BEFORE requesting signed URL.
    // The server must include Content-MD5 in the signature (required for Object Lock buckets).
    const fileBuffer = fs.readFileSync(filePath);
    const contentMD5 = crypto.createHash("md5").update(fileBuffer).digest("base64");

    // Get signed URL from server (pass contentMD5 so server can sign it)
    let serverUrl = process.env.APP_ENV==="PROD" ? process.env.UPDATE_REST : "http://192.168.0.110:3030/";// "http://localhost:3030/";// "http://192.168.0.110:3030/";
    let { signedUrl } = (await axios.post(serverUrl+"app-logs",{
      deviceId:global.deviceUUID,
      gstNumber:process.presets.gst,
      logDt: (fileName.match(/\d{4}-\d{2}-\d{2}/) || [""])[0],// log-2026-06-25.enc => 2026-06-25
      logType,
      fileName,
      contentMD5 // ← required: server must include this in the signed headers for Object Lock
    },{timeout:5000})).data;
    if(!signedUrl) throw new Error("Signed URL not received from server");
    console.log("Uploading file to S3:", fileName, "via signed URL", signedUrl);
    let resp = await axios.put(signedUrl, fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-MD5": contentMD5
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    if(resp.status===200){
      console.log("File uploaded successfully:", fileName);
      return true;
    }
    else{
      throw new Error(`Failed to upload file. Status: ${resp.status}`);
    }
  }
  catch(err){
    // Log the full S3 error response body (contains XML with actual reason)
    const s3Error = err.response?.data || err.message;
    console.error("S3 PUT failed:", s3Error);
    appLogger({
      title: "S3 Upload Error",
      message: (typeof s3Error === "string" ? s3Error : JSON.stringify(s3Error)),
      func: "uploadToS3"
    });
    return false; // explicit failure — caller must not write tracker
  }
}

async function appRegistrationHandler(silent=true){
  // Check App registration status and get regitration info and subscription status
  let gstNumber = process.presets.gst;
  let { diskSerial,motherboardSerial } = await getDeviceSerials();
  if(!diskSerial || !motherboardSerial || !gstNumber || !(await checkForInternet()))
    return;
  const secret = await getSecret(); // Returns the random string
  const rootData = gstNumber + motherboardSerial + diskSerial; // Combine GST number and hardware IDs
  const encryptionKey = crypto.pbkdf2Sync(secret, rootData, 100000, 32, 'sha256');
  const salt = generateSecureSalt(encryptionKey ,`${diskSerial}-${motherboardSerial}`);
  const deviceId = uuid.v5(`${diskSerial}-${motherboardSerial}`, salt);
  global.deviceUUID = deviceId;
  let serverUrl = process.env.APP_ENV==="PROD" ? process.env.UPDATE_REST : "http://localhost:3030/";
  if(typeof process.presets.gst === "undefined" || process.presets.gst===""){
    appLogger({
      title:"App Registration Error: Require GST Number",
      message:"GST Number missing/undefined. App update will require registration.Please define your GST number from Settings -> Company & Billing -> Company Profile -> Basic",
      func:"app ready - get registration info"
    });
  }
  axios.post(serverUrl+"silent-register",
    {
      deviceId,
      gstNumber
    },{timeout:5000})
  .then(({data})=>{
    global.userId = data.id;
    console.log({userId:data.id})
  })
  .catch(err=>{
    global.userId = null;
    let title = "App Registration Info Error";
    if(silent)
      title = "App Registration Info Exception";
    appLogger({
      title,
      message: String(err),
      func: "app ready - get registration info"
    });
  });
}

async function setAppPresets(){
  let policy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  let policy2 = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
  let policy3 = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
  if(!/^\d.-\d.$/.test(policy?.financialYearStartDate))
    policy.financialYearStartDate = "01-03";
  if("financialYearStartDate" in policy){
    process.presets.financialYearStartDate = policy?.financialYearStartDate ?? "01-03";
    process.presets.gstInterval = policy?.gstInterval ?? 1;
  }
  else{
    process.presets.gstInterval = 1;
    process.presets.financialYearStartDate = "01-03";
  }
  let dt = new Date();
  process.monthElapsed = dt.getMonth()===0 ? 11 : dt.getMonth()-1;
  BrowserWindow.getAllWindows()
  .forEach(win=>{
    win.webContents.send("refresh-data");
  });
  ["noReturn","creditLimitDays","annualHolidays","weeklyHolidays","default_gst","appPreset","placeOfJurisdiction","biller","gst","fileNameFormat","useWeatherTheme","useFuzzySearch"]
  .forEach(key=>{
    let value = policy2[key] ?? policy[key] ?? policy3[key];
    if(typeof value === "undefined" || value===null) return;
    if(key !="placeOfJurisdiction" && (key in policy2 || key in policy || key in policy3))
      process.presets[key] = /^\d+$/.test(value) ? Number(value.match(/^\d+/)[0]) : value;
    else
    if(key==="placeOfJurisdiction")
      process.presets[key] = placeOfJurisdiction(policy3);
  });
  ["useWeatherTheme","useFuzzySearch"]
  .forEach(key=>{
    // Setting default values - true values
    if(typeof process.presets[key]==="undefined")
      process.presets[key] = true;
  });
}

ipcMain.on("update-presets",setAppPresets);

function checkIfMonthPassed(lastDt=Date){
  return true;//Remove after test
  let today = new Date();
  if(!lastDt || !(lastDt instanceof Date)) return false;
  if(lastDt.getMonth()===today.getMonth() && lastDt.getFullYear()===today.getFullYear()) return false;
  if(today.getFullYear()>lastDt.getFullYear())
    return true;
  else
  if(today.getFullYear()===lastDt.getFullYear() && today.getMonth()>lastDt.getMonth())
    return true;
}

function printPDF(path2pdf,printObj,job){
  let { printer,copies=1,paperSize,printOrientation } = printObj;
  try{
    switch(process.platform){
      case "linux":
          return printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
      case "win32":
          return printOnWindows(path2pdf,printer,copies,paperSize);
      case "darwin":
          return printOnLinuxOrMac(path2pdf,printer,copies);
      default:
          dialog.showErrorBox("Unsupported OS","Print funcationality is not supported for your OS. Try print the bill manually.");
    }
    job?.updateStatus("OK");
    
    // Mark file as printed in monitor
    if (fileMonitor && fs.existsSync(path2pdf)) {
      fileMonitor.markAsPrinted(path2pdf);
    }
  }
  catch(err){
    appLogger({
      title:"Print error",
      message:String(err),
      func:"printPDF"
    })
  }
}

exports.printPDF = printPDF;

ipcMain.on("take-attendance", (e) => {
  let refWin = getTargetWindow("Employee-Page");
  takeAttendance(refWin);
  ipcMain.on("attendance-registered", () => {
    e.sender.send("attendance-registered");
  });
});

ipcMain.on("open-salary-modal", (e) => {
  let refWin = getTargetWindow("Employee-Page");
  paySalary(refWin);
  ipcMain.on("Salary-Modal", () => {
    let msg = {
      type: "info",
      title: "Salary registered",
      message: "Salary registered successfully.",
      icon:appIcon
    };
    dialog.showMessageBox(BrowserWindow.getFocusedWindow(), msg);
    e.sender.send("attendance-registered");
  });
});

exports.getCurrentLogin = function () {
  return currentUser;
};
// Lander Page IPCs

async function overviewContentDBQuery(year){
  let { minStock,creditLimitDays } = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
  if(!dbInitialized) return;
  let stocks = typeof global.stocks!="undefined" ? global.stocks : await queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
  stocks = stocks.filter(({ quantity }) => quantity <= minStock);
  let unPaidBills = await getAllSales(sale,year,appLogger,getFivePercentOfMemory);
  unPaidBills = unPaidBills.filter(({ billDate }) => {
                      let dueDt = new Date(billDate);
                      dueDt = dueDt.getTime() + creditLimitDays * 24 * 60 * 60 * 1000;
                      return dueDt <= new Date();
                    });
  return { unPaidBills, stocks };
}

ipcMain.handle("get-overview-content", async (e,year) => {
  let { unPaidBills = [], stocks = [] } = (typeof global.overViewContentResult!="undefined" && typeof global.overViewContentResult[year]!="undefined") ? global.overViewContentResult[year] : await overviewContentDBQuery(year);
  global.overViewContentResult = { ...global.overViewContentResult, [year]:{unPaidBills, stocks} };
  checkNLogMemoryUsage("overViewContentResult",appLogger,getFivePercentOfMemory);
  return { unPaidBills, stocks };
});

ipcMain.handle("get-orders",async ()=>{
  let orderPath = getOrderPath();
  let orders;
  try{
    orders = JSON.parse(fs.readFileSync(orderPath)?.toString());
    if(!Array.isArray(orders)) orders = [];
  }
  catch(_){
    orders = [];
  }
  return orders;
});

function readOrders(orderPath){
  let raw = JSON.parse(fs.readFileSync(orderPath).toString());
  return Array.isArray(raw) ? raw : [];
}

ipcMain.on("new-sale-purchase", (e, mode) => {
  if (["all", "admin", "bill"].includes(currentUser.role) && mode === 1)
    Menu.getApplicationMenu().items[1].submenu.items[0].click();
  else
  if (["all", "admin", "purchase"].includes(currentUser.role) && mode === 2)
    Menu.getApplicationMenu().items[2].submenu.items[0].click();
  else
  if(["all", "admin", "bill"].includes(currentUser.role) && mode === 3) {
    // Order viewer "+" — open sale page in proforma mode
    process.presets.useProforma = true;
    Menu.getApplicationMenu().items[1].submenu.items[0].click();
    // Clean up the flag after sale page consumes it
    setTimeout(() => { delete process.presets.useProforma; }, 2000);
  }
  else
    e.sender.send("error", "Insufficient permission");
});

ipcMain.handle("get-sale-content", async (e,allYear=false) => {
  if(!dbInitialized) return;
  let bills = typeof global.sales!="undefined" ? global.sales : await getAllSales(sale,year,appLogger,getFivePercentOfMemory);
  bills = typeof global.bills!="undefined" ? global.bills : bills.filter(bill=>(bill.billDate.getTime()>(new Date().setMonth(new Date().getMonth()-2,1))));
  let preset;
  if(typeof process.presets.appPreset.saleOverviewMain==="undefined")
    preset = "monthly1x";
  else
    preset = process.presets.appPreset.saleOverviewMain;
  global.bills = bills;
  return { bills, preset, allBills:global.sales };
});

ipcMain.on("update-preference",(e,{preset,currentMode,sec})=>{
  let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
  if(currentMode==="sale"){
    // Sale overview page preference
    if(!("appPreset" in policy))
      policy.appPreset = { saleOverviewMain:"monthly1x" };
    if(sec==="main")
      policy.appPreset.saleOverviewMain = preset;
  }
  // Updating policy
  fs.writeFile(getUserPolicyPath(),JSON.stringify(policy),(err)=>{
    if(err)
      appLogger({
        title:"Error",
        message:String(err),
        func:"IPC call 'update-preference'"
      });
    else
      e.sender.send("msg-from-backend","Preference saved");
  })
});

ipcMain.handle("get-purchase-content", async () => {
  if(!dbInitialized) return [];
  let purchases = typeof global.purchases!="undefined" ? global.purchases : await getPurchases(purchase,appLogger,getFivePercentOfMemory);
  return purchases;
});

ipcMain.handle("add-user", async (e, data) => {
  let encryptedPaswd = await bcrypt.hash(data.passwd, 10);
  let role = currentUser!==undefined && "role" in currentUser && ["admin", "all"].includes(currentUser.role) ? data.role : "bill";
  let id = uuid.v5(data.name, "6ba7b814-9dad-11d1-80b4-00c04fd430c8");
  if(!dbInitialized && !unsavedUsers.find(usr=>(usr.id===id))){
    unsavedUsers.push({
      id,
      ...data
    });
    return data;
  }
  try {
    return user.findOrCreate({
      where: {
        id,
      },
      defaults: {
        id,
        name: data.name,
        passwd: encryptedPaswd,
        role,
      },
    });
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"add-user-ipc"})
    return err;
  }
});

ipcMain.handle("update-user", async (e, data) => {
  let encryptedPaswd = await bcrypt.hash(data.password, 10);
  let admin = (
    await user.findOne({
      where: {
        id: currentUser.id,
      },
    })
  ).dataValues;
  data.role = data.name === "admin" ? "admin" : data.role;
  let updateObj = {
    passwd: encryptedPaswd,
  };
  if (currentUser.name === "admin") updateObj.role = data.role;
  if (await bcrypt.compare(data["old-password"], admin.passwd))
    return user.update(updateObj, {
      where: {
        id: data.id,
      },
    });
  else throw new Error("Old pasword don't match.");
});

ipcMain.handle("get-file-path", (e, filterObj) => {
  return dialog.showOpenDialog(getMainWindow(), {
    filters: [filterObj],
  });
});

ipcMain.handle("update-wallpaper", async (e, { filePath, usePasswd, lockOnIdle:_lockOnIdle, idleTime }) => {
  try {
    if ( filePath || typeof _lockOnIdle==="boolean" ) {
      let data = fs.readFileSync(getUserPolicyPath());
      data = JSON.parse(data.toString());
      data.wallpaper = filePath;
      data.lockOnIdle = _lockOnIdle;
      data.idleTime = idleTime;
      if(_lockOnIdle)
        idleLockTimer = setInterval(lockOnIdle.bind({idleTime:idleTime}),5000);
      else
        clearInterval(idleLockTimer);
      fs.writeFileSync(
        getUserPolicyPath(),
        JSON.stringify(data)
      );
    }
    currentUser.usePasswd = usePasswd;
    await user.update({ usePasswd }, { where: { id: currentUser.id } });
  } catch (err) {
    throw err;
  }
});

ipcMain.handle("get-user-status", async (e, id) => {
  id = id ? id : currentUser.id;
  return (
    await user.findOne({
      where: {
        id,
      },
      attributes: ["secret"],
    })
  ).dataValues.secret;
});

ipcMain.handle("generate-secret", () => {
  const qrCode = require("qrcode");
  let secret = speakeasy.generateSecret({
    name: "BBSv2",
    issuer: "codeMint.com",
  });
  currentUser.tempSecet = secret.base32;
  return qrCode.toDataURL(secret.otpauth_url);
});

ipcMain.handle("save-secret-for-user", () => {
  return user.update(
    {
      secret: currentUser.tempSecet,
    },
    {
      where: {
        id:currentUser.id,
      },
    }
  );
});

ipcMain.handle("remove-secret", () => {
  return user.update(
    {
      secret: null,
    },
    {
      where: {
        id:currentUser.id,
      },
    }
  );
});

async function createSession(time) {
  appLogger({title:"Session", message:"Creating session cookie.", func:"createSession"});
  let cookie = {
    name: "bbs_auth",
    value: JSON.stringify(currentUser),
    url: "http://localhost",
    expirationDate: (Date.now()/1000 + time),
  };
  let mainWin = getMainWindow();
  let ses = mainWin.webContents.session;
  await ses.cookies.remove("http://localhost", "bbs_auth");
  let authCookies = await ses.cookies.get({
    name: "bbs_auth",
    url: "http://localhost",
  });
  appLogger({
    title:"Creating a timeout for session expiry and logout",
    message:`Session will expire in ${time} seconds`,
    func:"createSession",
    allowConsole:true
  })
  setTimeout(async ()=>{
    // Test required - check if session is still valid
    ipcMain.emit("logout");
    // ipcMain.emit("lock");
  },time*1000);
  if (authCookies.length === 0) {
    await ses.cookies.set(cookie);
    await ses.cookies.flushStore();
    return ses.cookies.get({ name: "bbs_auth", url: "http://localhost" });
  } else throw new Error("Failed to create cookie");
}

ipcMain.handle("create-login-session", async (e, { expiry }) => {
  try {
    await user.update(
      {
        session: true,
        sessionTime: Number(expiry) * 60 * 60,
      },
      {
        where: { id: currentUser.id },
      }
    );
    currentUser.session = true;
    currentUser.sessionTime = Number(expiry) * 60 * 60;
    await createSession(Number(expiry) * 60 * 60);
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"Create-login-session-ipc"});
    return err;
  }
});

ipcMain.handle("remove-auth-session", async () => {
  let ses = getMainWindow().webContents.session;
  try {
    await user.update(
      {
        session: false,
      },
      {
        where: { id: currentUser.id },
      }
    );
    currentUser.session = false;
    await ses.cookies.remove("http://localhost", "bbs_auth");
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"Remove-auth-session-ipc"});
    return err;
  }
});

ipcMain.on("logout", async () => {
  try {
    let mainWin = getMainWindow();
    let ses = mainWin.webContents.session;
    let authCookies = await ses.cookies.get({
      name: "bbs_auth",
      url: "http://localhost",
    });
    if (authCookies.length > 0)
      await ses.cookies.remove("http://localhost", "bbs_auth");
    else appLogger({title:"Logout", message:"Cookie don't exist", func:"logout"});
    currentUser.logout();
    currentUser = null;
    mainWin.loadFile(getTemplatePath("lockScreen"));
    mainWin.webContents.once("did-finish-load", () => reapplyTheme(mainWin));
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"logout-ipc"});
  }
  finally{
    clearInterval(idleLockTimer);
  }
});

function lock_unlockHelper(page, sig) {
  appLocked = sig==="lock";
  let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());  
  if("lockOnIdle" in policy && policy.lockOnIdle){
    if(appLocked)
      clearInterval(idleLockTimer);
    else
      idleLockTimer = setInterval(lockOnIdle.bind({idleTime:policy.idleTime}),5000);
  }
  let mainWin = getMainWindow();
  let allWins = BrowserWindow.getAllWindows();
  mainWin.loadFile(getTemplatePath(page));
  mainWin.webContents.on("did-finish-load", function (e) {
    try {
      mainWin.webContents.removeListener("did-finish-load", arguments.callee);
    } catch (err) {
      appLogger({title:"Error",message:String(err),func:"lock_unlockHelper"});
    }
    if (page === "lockScreen") reapplyTheme(mainWin);
    if (sig === "lock") {
      function menuItemIterator(menu){
        if(menu instanceof MenuItem)
          menu.enabled = false;
        if(menu instanceof Array)
          menu.forEach(menu=>menuItemIterator(menu));
        if(menu instanceof MenuItem && "submenu" in menu && menu?.submenu?.items.length>0)
          menuItemIterator(menu.submenu.items);
      }
      menuItemIterator(Menu.getApplicationMenu().items);
      allWins.filter(win=>win!==mainWin).forEach(win=>win.hide());
      mainWin.webContents.send("lock", currentUser);
    }
    if (sig === "unlock"){
      imposeRestriction();
      allWins.filter(win=>win!==mainWin).forEach(win=>win.show());
    }
  });
}

ipcMain.on("lock", () => {
  lock_unlockHelper("lockScreen", "lock");
});

ipcMain.on("unlock", () => {
  lock_unlockHelper("mainPage", "unlock");
});

ipcMain.handle("check-session-info", async () => {
  let ses = getMainWindow().webContents.session;
  return ses.cookies.get({ name: "bbs_auth", url: "http://localhost" });
});

// Lock Screen ipcs
ipcMain.handle("unlock-app", async (e, authData) => {
  let _user;
  try{
    _user = await user.findOne({
      where: {
        name: authData.name,
      },
    });
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"DB error"
    });
    if(unsavedUsers.length>0){
      _user = {...unsavedUsers.find(({name})=>name===authData.name)};
      if(_user){
        let encryptedPaswd = await bcrypt.hash(_user.passwd, 10);
        _user.passwd = encryptedPaswd;
      }
    }
  }
  finally{
    if (!_user)
      throw new Error("No user");
    _user = "dataValues" in _user ? _user.dataValues : _user;
    let { passwd, id, name, role, secret, session, sessionTime, usePasswd } = _user;
    if(authData.mode==="password-recovery"){
      try{
        await user.update({
          passwd:bcrypt.hashSync(authData['new-passwd'],10)
        },{
          where:{
            name:authData.name
          }
        });
        currentUser = new User(
          id,
          name,
          secret,
          role,
          session,
          sessionTime,
          usePasswd
        );
        ipcMain.emit("app-login");
        return 0;
      }
      catch(err){
        appLogger({
          title:"Password recovery failed",
          message:String(err),
          func:"unlock-app"
        });
        dialog.showErrorBox("Password recovery failed",err.message);
        return 0;
      }
    }
    else
    if (await bcrypt.compare(authData.passwd, passwd)) {
      currentUser = new User(
        id,
        name,
        secret,
        role,
        session,
        sessionTime,
        usePasswd
      );
      // Write TOTP on console
      if (secret) {
        function writeTOTP() {
          readLine.clearLine(process.stdout,0)
          readLine.cursorTo(process.stdout,0)
          process.stdout.write(
            speakeasy.totp({
              secret: secret,
              encoding: "base32",
            })
          );
        }
        if(process.env.APP_ENV==="DEV"){
          console.log("\nTOTP Code:")
          writeTOTP();
          clearInterval(totpTimer);
          totpTimer = setInterval(writeTOTP, 1000);
        }
        return 1;
      }
      ipcMain.emit("app-login");
      return 0;
    } else return -1;
  }
});

ipcMain.on("load-lander-page", (e,{lock=true}={}) => {
  if(lock===false)
    lock_unlockHelper("mainPage","unlock")
  else{
    let mainPage = getMainWindow();
    mainPage.loadFile(getTemplatePath("mainPage"));
  }
});

ipcMain.handle("verify-code", async (e, { code }) => {
  let res = speakeasy.totp.verify({
    secret: currentUser.secret,
    window: 0,
    token: code,
    encoding: "base32",
  });
  if (res) {
    clearInterval(totpTimer);
    ipcMain.emit("app-login");
    try {
      await user.update(
        {
          lastLogin: currentUser.lastLogin,
        },
        {
          where: { id: currentUser.id },
        }
      );
    } catch (err) {
      appLogger({
        title:"Error",
        message:String(err),
        func:"verify-code"
      });
    }
  }
  return res;
});

// NEW: Check for paused downloads function
function checkForPausedDownload() {
  const state = loadDownloadState(appLogger);

  if (!state || state.status !== 'paused') return;
  
  const percentComplete = Math.round((state.bytesDownloaded / state.totalBytes) * 100);
  const sizeMB = Math.round(state.bytesDownloaded / 1024 / 1024);
  const totalMB = Math.round(state.totalBytes / 1024 / 1024);
  
  appLogger({
    title: "Paused Download Found",
    message: `Version ${state.version} at ${percentComplete}% (${sizeMB}MB / ${totalMB}MB)`,
    version: state.version,
    progress: `${percentComplete}% (${sizeMB}MB / ${totalMB}MB)`,
    func: "checkForPausedDownload"
  });
  
  const mainWin = getMainWindow();
  
  dialog.showMessageBox(mainWin, {
    type: "question",
    title: "Resume Download?",
    message: `You have a paused download for BBS v${state.version}`,
    detail: `Progress: ${percentComplete}% complete (${sizeMB}MB / ${totalMB}MB)\n\nWould you like to resume the download?`,
    buttons: ["Resume", "Cancel Download", "Later"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    icon: appIcon
  }).then(({ response }) => {
    if (response === 0) {
      // Resume
      downloadUpdate(state.version, state);
    } else if (response === 1) {
      // Cancel download
      if (fs.existsSync(state.filePath)) {
        fs.rmSync(state.filePath);
      }
      clearDownloadState();
      appLogger({ title:"Paused Download", message: "User cancelled paused download", func:"checkForPausedDownload", appendToLog: false, allowConsole: true });
    } else {
      // Later - do nothing
      appLogger({ title:"Paused Download", message: "User chose to resume download later", func:"checkForPausedDownload", appendToLog: false, allowConsole: true });
    }
  });
}

ipcMain.on("app-login", async () => {
  appLogger({ title:"App Login", message: "App Login Handler", func:"app-login" });
  currentUser.login();
  global.user = currentUser;
  clearInterval(totpTimer);
  try {
    if (currentUser.session) await createSession(currentUser.sessionTime);
    await user.update(
      {
        lastLogin: Date.now()/1000,
      },
      {
        where: { id: currentUser.id },
      }
    );
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"app-login-ipc"});
  } finally {
    imposeRestriction();
    if(["admin","all"].includes(currentUser.role))
      checkForUpdates();
    let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
    if("lockOnIdle" in policy && policy.lockOnIdle){
      clearInterval(idleLockTimer);
      idleLockTimer = setInterval(lockOnIdle.bind({idleTime:policy.idleTime}),5000);
    }
    if(["admin","all"].includes(currentUser.role)){
      dbInitialized = await schemaValidation_migrationHandler(getMainWindow(),appPath);
      // NEW: Check for paused downloads after login
      checkForPausedDownload();
    }
  }
});

function imposeRestriction() {
  // This is how to restrict access to some user.
  let mainPage = getMainWindow();
  let menu = Menu.buildFromTemplate(require("./menuTemplate")(mainPage));
  Menu.setApplicationMenu(menu);
  function blockHelper(menuList = []) {
    menuList.forEach(({ index, isEnabled }) => {
      Menu.getApplicationMenu().items[index].submenu.items.forEach((item) => {
        item.enabled = isEnabled;
      });
    });
  }
  if(!currentUser) return;

  if (currentUser.role === "bill")
    blockHelper([
      { index: 1, isEnabled: true },
      { index: 2, isEnabled: false },
    ]);
  else if (currentUser.role === "purchase")
    blockHelper([
      { index: 2, isEnabled: true },
      { index: 1, isEnabled: false },
    ]);
  else {
    // Case for role admin and all
    // Checking for update
    return Menu.getApplicationMenu().items.forEach(({ submenu }) => {
      submenu.items.forEach((item) => {
        item.enabled = true;
      });
    });
  }
  if(currentUser.role!=="admin")
    blockHelper([
      { index: 4, isEnabled: false },
      { index: 5, isEnabled: false },
    ]);
}

// Bill designer IPCs
ipcMain.on("load-main-page", () => {
  let mainWindow = getMainWindow();
  mainWindow.loadFile(getTemplatePath("mainPage"));
  // Apply weather theme & banners after main page loads
  let menu = Menu.getApplicationMenu();
  let fileMenuIndex = menu.items.findIndex((obj) => obj.label === "File");
  if (fileMenuIndex >= 0) {
    menu.items.splice(fileMenuIndex, 1);
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu.items));
  }
});

ipcMain.on("save-bill-template", async (e, page, saveAs = false) => {
  let win = BrowserWindow.fromId(e.frameId);
  try {
    let { canceled, filePath } =
      page.newDoc || saveAs
        ? await dialog.showSaveDialog(win, {
            message: "Save bill template",
            defaultPath: app.getPath("documents"),
            properties: ["createDirectory"],
          })
        : { canceled: false, filePath: page.filePath };
    if (canceled) return 0;
    if (!/.json$/.test(filePath)) filePath += ".json";
    fs.writeFile(filePath, JSON.stringify(page), (err) => {
      if (err) return dialog.showErrorBox("File save error", err.message);
      return dialog.showMessageBox(win, {
        title: "Success",
        message: "Successfully saved bill layout.",
        type: "info",
        icon:appIcon
      });
    });
  } catch (err) {
    dialog.showErrorBox("File save error", err.message);
    return -1;
  }
});

ipcMain.handle("new-template-response", async (e, page) => {
  let win = BrowserWindow.fromId(e.frameId);
  try {
    return dialog.showMessageBox(win, {
      type: "question",
      message: "Do you like save changes for future use?",
      title: "Save?",
      detail:
        "Changes in document will be earesed unless you save. A new untittled document will be created.",
      buttons: ["Save", "Don't save"],
      noLink:true,
      icon:appIcon
    });
  } catch (err) {
    return err;
  }
});

//Company profile IPCs
ipcMain.on("company-profile-info", async (e, data) => {
  let win = BrowserWindow.fromId(e.frameId);
  let companyObj = await new Promise((res, rej) => {
    fs.readFile(getsaleConfigPolicyPath(), (err, data) => {
      if (err) return rej(err);
      res(JSON.parse(data.toString()));
    });
  });
  if(typeof data.billTemplate!="undefined"){
    data.paperSize = typeof data.billTemplate.paperSize!="undefined" ? data.billTemplate.paperSize : "A4";
    data.margin = typeof data.billTemplate.margin!="undefined" ? Number(data.billTemplate.margin) : 10;
    if(typeof data.billTemplate.paperSize!="undefined")
      delete data.billTemplate.paperSize;
    if(typeof data.billTemplate.margin!="undefined")
      delete data.billTemplate.margin;
    // Validate margin
    if(data.margin<=10)
      data.margin = 10;
    else
    if(data.margin>=26)
      data.margin = 26;
  }
  companyObj = {
    ...companyObj,
    ...data,
  };
  fs.writeFile(
    getsaleConfigPolicyPath(),
    JSON.stringify(companyObj),
    (err) => {
      if(err){
        appLogger({
          title:"Error",
          message:String(err),
          func:"company-profile-info-ipc"
        });
        return dialog.showErrorBox("File save error", err.message)
      };
      setAppPresets();
      return dialog.showMessageBox(win, {
        title: "Success",
        message: "Company profile updated.",
        type: "info",
        icon:appIcon
      });
    }
  );
});

ipcMain.handle("get-company-info", () => {
  return new Promise((res, rej) => {
    fs.readFile(getsaleConfigPolicyPath(), (err, data) => {
      if (err) return rej(err);
      res(JSON.parse(data.toString()));
    });
  });
});

async function savePolicyCommon(polPath,data,e){
  let win = BrowserWindow.fromId(e.frameId);
  let policy = JSON.parse(fs.readFileSync(polPath()).toString());
  policy = {
    ...policy,
    ...data
  };
  fs.writeFileSync(polPath(),JSON.stringify(policy));
  setAppPresets();
  dialog.showMessageBox(win, {
    title: "Success",
    message: "Policy updated.",
    type: "info",
    icon:appIcon
  });
}

ipcMain.on("save-policy-settings",async (e,data)=>{
  savePolicyCommon(getAppPolicyPath,data,e);
});

ipcMain.on("save-policy",async (e,data)=>{
  savePolicyCommon(getUserPolicyPath,data,e);
});

ipcMain.on("dbl-click-resp",(e,obj,mode)=>{
  let window = BrowserWindow.fromId(e.frameId);
  // Order-dbl-resp
  if(mode===1)
    orderManager(window,function(){
      this.webContents.send("view-order",obj.orderId);
    })(); 
  else
  if(mode===2)
    openBillPDFExt(obj);
});

function openBillPDFExt(billObj,mode=1){
  if(!["billDate","billNo","name"].find(key=>key in billObj)) 
    return appLogger({
      title:"Error",
      message:"Invalid JSON format in billObj",
      func:"openBillPDFExt"
    });
  let { billDate,billNo,name } = billObj;
  billDate = openFormatForDate(new Date(billDate));
  let fileName = getPDF_FileName(name,billDate,billNo,false);
  let path2file = path.resolve(getBillsDir(),fileName);
  if(!fs.existsSync(path2file)) return;
  if(mode===2)
    return path2file;
  shell.openExternal(path2file);
}

ipcMain.handle("manage-company-bank",async (e,obj,flag)=>{
  try{
    if(flag==="a"){
      fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(obj));
      return true;
    }
    else
    if(flag==="delete" || flag==="auto-delete"){
      let compInfo = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
      if(flag==="delete"){
        let { response } = await dialog.showMessageBox({
          title:"Bank entry deletion",
          message:"Are you sure you want to delete this bank information?",
          buttons:["Yes","Cancel"],
          noLink:true,
          icon:appIcon
        });
        if(response===1)
          return false;
      }
      if("bankDetails" in compInfo && compInfo.bankDetails.length>0){
        let bankDetails = compInfo.bankDetails;
        bankDetails = bankDetails.filter(bankObj=>bankObj.bankID!=obj.bankID);
        compInfo.bankDetails = bankDetails;
        fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(compInfo));
        return true;
      }
      else
        return false;
    }
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"manage-company-bank-ipc"
    });
    return false;
  }
});

// Context Menu
ipcMain.on("show-context-menu", (e, { mode, obj, targetWin }) => {
  let window = BrowserWindow.fromId(e.frameId),errIdentifier;
  let contextMenuObj;
  try{
    if (mode === "billObj") {
      contextMenuObj = [
        {
          label: "View Bill",
          click: () => {
            errIdentifier = "View Bill";
            if(!targetWin)
              window.webContents.send("show-bill",obj);
            else
              getTargetWindow(targetWin).webContents.send("show-bill",obj);
          },
        },
        {
          label: "Open External",
          click: () => openBillPDFExt(obj)
        },
        {
          label: "Print",
          click:()=>{
            let path2file = openBillPDFExt(obj,2);
            if(!path2file)
              return appLogger({
                title:"Error: Failed to print",
                message:"File doesn't exists.",
                func:"context menu - show bill"
              });
            let modal = printDialog(function(){
              this.webContents.send("hide-label");
            });
            ipcMain.once("print-obj",(e,printObj)=>{
              modal.close();
              printPDF(path2file,printObj)
            })
          }
        },
        {
          label:"Mark as paid",
          click:markBillAsPaid.bind(obj,null,targetWin)
        },
        {
          label: "Notify Customer",
          enabled:false, // Not ready yet
          click: () => {
            errIdentifier = "Notify Customer";
            notifyCustomer(window, obj,customer,appLogger,getFivePercentOfMemory);
          },
        }// Notify customer
      ];
    }
    else
    if(mode==="orderObj"){
      let baseDir = getBaseDir(),orderPath = getOrderPath(),orders;
      orders = readOrders(orderPath);
      contextMenuObj = [
        {
          label: "View/Update Order",
          click: () => { 
            errIdentifier = "View Order";
            orderManager(window,function(){
              this.webContents.send("view-order",obj.orderId);
            })();         
          },
          // accelerator
        },
        {
          label: "Add Payment",
          click: () => {
            errIdentifier = "Add Payment";
            let modal = createModal(undefined,getTemplatePath("generalHTML"),{cb:function(){
              this.webContents.send("init-page","Add Payment",{
                template: "add-payment-template",
                data: { name: obj.name, netDue: obj.netDue, billDate: obj.billDate }
              });
            }});
            // modal.webContents.toggleDevTools();
            ipcMain.once("Add Payment-response",(e,data)=>{
              modal.close();
              errIdentifier += ">Add payment ipc";
              let orderJSON = readOrders(orderPath);
              obj = orderJSON.find(_obj=>_obj.orderId===obj.orderId);
              let billMeta = obj.billMeta;
              data.payment = Number(data.payment);
              billMeta.payment = billMeta.payment || [];
              billMeta.payment.push(data);
              billMeta.netPayment = (billMeta.netPayment || 0) + data.payment;
              if(("paymentStatus" in data && data?.paymentStatus) || data.mode==="cash"){
                billMeta.netDue = Math.round(billMeta.netAmtTax)-billMeta.netPayment>0 ? Math.round(billMeta.netAmtTax)-billMeta.netPayment : 0;
                obj.netDue = billMeta.netDue;
                if(data.mode==="cash" && obj.netDue===0){
                  obj.paymentStatus = true;
                  billMeta.paymentStatus = true;
                }
                else
                if(data.mode==="cash" && obj.netDue>0){
                  obj.paymentStatus = false;
                  billMeta.paymentStatus = false;
                }
                else
                if(data.mode!=="cash"){
                  obj.paymentStatus = data.paymentStatus;
                  billMeta.paymentStatus = data.paymentStatus;
                }
              }
              fs.writeFileSync(orderPath,JSON.stringify(orderJSON));
              window.webContents.send("update-content");
            });
          },
        },
        {
          label: "Remove order",
          click: () => {
            errIdentifier = "Remove order";
            try {
              let { orderId } = obj;
              let orderJSON = readOrders(orderPath);
              orderJSON = orderJSON.filter(o => o.orderId !== orderId);
              fs.writeFileSync(orderPath, JSON.stringify(orderJSON));
              window.webContents.send("update-content");
              dialog.showMessageBox({
                title: "Order removed",
                message: "Order removed successfully.",
                icon: appIcon
              });
            } catch(err) {
              appLogger({ title:"Error", message:String(err), func:"Remove order" });
            }
          },
        },
        {
          label: "Update order status",
          click: () => {
            errIdentifier = "Update order status";
            try {
              let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
              let orderStages = saleConfig.orderStages || [];
              if(orderStages.length > 0){
                let orderJSON = readOrders(orderPath);
                let entry = orderJSON.find(o => o.orderId === obj.orderId);
                let indexOfStage = orderStages.findIndex(stageName => stageName === entry.status);
                if(indexOfStage !== undefined && indexOfStage < orderStages.length - 1){
                  entry.status = orderStages[indexOfStage + 1];
                  fs.writeFileSync(orderPath, JSON.stringify(orderJSON));
                  window.webContents.send("update-content");
                }
              }
            } catch(err) {
              appLogger({ title:"Error", message:String(err), func:"Update order status" });
            }
          },
        },
        {
          label: "Generate bill from order",
          click: () => {
            errIdentifier = "Generate bill from order";
            // Open the order directly in the sale page for billing
            saleWindow()("salePage", "edit-order", {
              customer: obj.customer,
              billMeta: obj.billMeta,
              orderItems: obj.orderItems,
              currentStep: 1,
            });
          },
        }
      ];
    }
    else
    if(mode==="orderManagerObj"){
      let orderPath = getOrderPath();
      contextMenuObj = [
        {
          label: "View Details",
          click: () => {
            errIdentifier = "View Order Details";
            getTargetWindow(targetWin).webContents.send("view-order", obj.orderId);
          },
        },
        {
          label: "Edit Order",
          click: () => {
            errIdentifier = "Edit Order";
            saleWindow()("salePage", "edit-order", {
              customer: obj.customer,
              billMeta: obj.billMeta,
              orderItems: obj.orderItems,
              currentStep: 1,
            });
          },
        },
        {
          label: "Delete Order",
          click: () => {
            errIdentifier = "Delete Order";
            try {
              let orderJSON = readOrders(orderPath);
              orderJSON = orderJSON.filter(o => o.orderId !== obj.orderId);
              fs.writeFileSync(orderPath, JSON.stringify(orderJSON));
              window.webContents.send("refresh-orders");
            } catch(err) {
              appLogger({ title:"Error", message:String(err), func:"Delete Order (orderManager)" });
            }
          },
        },
      ];
    }
    //
    // else
    // if(mode===""){//

    // }
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"Context menu: "+errIdentifier
    });
  }
  if(!contextMenuObj) return;
  let menu = Menu.buildFromTemplate(contextMenuObj);
  menu.popup({
    window,
    callback: () => {
      console.log("Context menu closed");
    },
  });
});

// Register weather theme banner dismissal IPC
registerThemeIPC(ipcMain);

//Theme IPC
ipcMain.handle("get-theme", async (e) => {
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  let { applyTheme = false } = appPolicy;
  if (applyTheme) return false;
  return defaultThemeData();
});

ipcMain.handle("init-theme", initTheme);

ipcMain.on("save-theme-setting", async (e, data) => {
  let win = BrowserWindow.fromId(e.frameId);
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  appPolicy = {
    ...appPolicy,
    ...data,
  };
  fs.writeFile(
    getAppPolicyPath(),
    JSON.stringify(appPolicy),
    (err) => {
      if (err) throw err;
      dialog.showMessageBox(win, {
        title: "Success",
        message: "Appearance setting saved.",
        type: "info",
        icon:appIcon
      });
      if (process.platform === "linux") setLinuxThemeObserver();
      // Reload presets BEFORE initTheme so useWeatherTheme is current
      setAppPresets();
      initTheme();
    }
  );
});

ipcMain.on("general-app-settings",(e, data, kioskSetting)=>{
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  let kioskPolicy = JSON.parse(fs.readFileSync(getKioskConfigPath()).toString());
  appPolicy = {
    ...appPolicy,
    ...data,
  };
  fs.writeFileSync(getAppPolicyPath(),JSON.stringify(appPolicy,null,2));
  kioskPolicy = {
    ...kioskPolicy,
    ...kioskSetting
  };
  fs.writeFileSync(getKioskConfigPath(),JSON.stringify(kioskPolicy,null,2));
  setAppPresets();
});

ipcMain.handle("get-general-app-settings",()=>{
  let kioskConf = loadKioskConfig()
  return {
    useFuzzySearch: process.presets.useFuzzySearch,
    ...kioskConf
  };
});

ipcMain.on("save-theme", (e, themeObj) => {
  let win = BrowserWindow.fromId(e.frameId);
  let path2File = path.resolve(__dirname, "lib/default.theme");
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  try {
    let buffData = Buffer.from(
      Buffer.from(JSON.stringify(themeObj)).map(customEncoder)
    );
    fs.writeFile(path2File, buffData, (err) => {
      if (err) throw err;
      // Apply saved theme
      if ("applyTheme" in appPolicy && appPolicy.applyTheme === false) {
        //Apply default theme.
        dialog.showMessageBox(win, {
          title: "Theme applied",
          type: "info",
          message: "Applied default theme.",
          icon:appIcon
        });
        if (process.platform === "linux") setLinuxThemeObserver();
        initTheme();
      }
    });
  } catch (err) {
    throw err;
  }
});

function defaultThemeData() {
  return new Promise((res, rej) => {
    fs.readFile(__dirname + "/lib/default.theme", (err, data) => {
      if (err) rej(err);
      let dataBuff = Buffer.from(data.map(customDecoder));
      res(JSON.parse(dataBuff.toString()));
    });
  });
}

function setLinuxThemeObserver() {
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  if (!("useDarkTheme" in appPolicy)) return;
  if (appPolicy.useDarkTheme)
    linuxThemeWatchTimer = setInterval(() => {
      nativeTheme.themeSource = "system";
      if (nativeTheme.shouldUseDarkColors) nativeTheme.themeSource = "dark";
      else nativeTheme.themeSource = "light";
    }, 1500);
  else clearInterval(linuxThemeWatchTimer);
}

async function initTheme({ shouldUpdate = false } = {}, e = {}) {
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  let win =
    "frameId" in e ? BrowserWindow?.fromId(e?.frameId) : getMainWindow();
  let dataBuff = await defaultThemeData();
  let themeObj = {
    ...appPolicy,
    ...dataBuff,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  };
  await storeUserThemeObj(themeObj); // cache for weather theme revert (merged with existing cookie)
  win?.webContents.send("apply-theme", themeObj);
  if (shouldUpdate) {
    BrowserWindow.getAllWindows().forEach((_win) => {
      if (_win !== win) _win.webContents.send("apply-theme", themeObj);
    });
  }
  let mainWin = getMainWindow();
  if(await checkForInternet()===true)
    initializeThemeAndBanners(mainWin);
  return themeObj;
}

nativeTheme.addListener(
  "updated",
  initTheme.bind(null, { shouldUpdate: true })
);

ipcMain.handle("get-svg", (e, filePath) => {
  if(!fs.existsSync(filePath) || filePath=="" || typeof filePath==="undefined") return false;
  return fs.readFileSync(filePath).toString();
});

// IPC fetch user policy
ipcMain.handle("get-policy",()=>{
  let path2policy = getUserPolicyPath();
  return JSON.parse(fs.readFileSync(path2policy).toString());
});
// IPC fetch APP Policy
ipcMain.handle("get-app-policy", (e) => {
  return new Promise((res, rej) => {
    fs.readFile(getAppPolicyPath(), (err, data) => {
      if (err) rej(err);
      res(JSON.parse(data.toString()));
    });
  });
});

// App Backup Section
ipcMain.handle("app-backup", async (e, { mode,items,createZip=false }) => {
  if(items.length===0){
    dialog.showMessageBox({
      title:"Nothing picked",
      message:"Please select something to backup.",
      icon:appIcon
    });
    return false;
  }
  let { canceled,filePath } = await dialog.showSaveDialog({
    message: "Please name the directory where your backup files will be stored.",
    defaultPath: app.getPath("documents")
  });
  if(canceled)
    return true;
  try{
    if(!fs.existsSync(filePath))
      fs.mkdirSync(filePath,{recursive:true});
    items.forEach(item=>{
      let appPath;
      if(process.env.APP_ENV==="DEV")
          appPath = __dirname;
      else
          appPath = app.getPath("appData")+"/BBS";
      if(item==="db")
        fs.copyFileSync(path.resolve(appPath,"./db/bbs.db"),path.resolve(filePath,"bbs.db"))
      else
      if(item==="logs"){
        fs.copyFileSync(path.resolve(appPath,"./logs/appLogs.txt"),path.resolve(filePath,"appLogs.txt"));
      }
      else{// Config
        fs.copyFileSync(path.resolve(appPath,"./config/appDefault.json"),path.resolve(filePath,"appDefault.json"));
        fs.copyFileSync(path.resolve(appPath,"./config/policy.json"),path.resolve(filePath,"policy.json"));
        fs.copyFileSync(path.resolve(appPath,"./config/saleConfig.json"),path.resolve(filePath,"saleConfig.json"));
      }
    });
    if(createZip){
      let zip = new AdmZip();
      let resp = await new Promise((res,rej)=>{
        zip.addLocalFolderAsync(filePath,(isSuccessful,err)=>{
          if(isSuccessful)
            res(true);
          else{
            appLogger({
              title:"Create ZIP Error",
              message:String(err),
              func:"Create ZIP Error- app backup"
            })
            dialog.showErrorBox("Create ZIP Error",err);
            rej(err);
          }
        });
      });
      if(resp===true)
        resp = await zip.writeZipPromise(filePath+".zip")
      else
        return false;  
      if(mode==="local"){
        fs.rmdirSync(filePath,{recursive:true});
        return true;
      }
      else{
        // Store on clients personal cloud space/BBS Cloud.
        //Retur true if cloud push is successful.
        return true;
      }
    }
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"Backup IPC"
    });
    dialog.showErrorBox("File save error",err.message);
    return false;
  }
  // Create backup path if not exist then perform backups
  return true;
}); // Not complete - cloud sync left

// App registration
ipcMain.handle("app-registration-info", (e) => {
  let saleConfig = JSON.parse(
    fs.readFileSync(getsaleConfigPolicyPath()).toString()
  );
  return saleConfig.gst;
});

ipcMain.on("app-registration", async (e, gst) => {
  let windowOptions = {
    webPreferences: {
      nodeIntegration: false,
      preload: __dirname + "/registrationPreload.js",
    },
  };
  createModal(windowOptions, getTemplatePath("registration"), {
    label: "registration-window",
    maxWinCount: 1,
    cb: function () {
      this.webContents.send("call-register-link", gst);
    },
  });
});// Incomplete

//App update logic
exports.updateCommon = updateCommon;

// IPC handler for executing update (used by versionManager to avoid circular dependency)
ipcMain.on("execute-update", (e, fileName, version, showMsgFlag, relPath) => {
  updateCommon.call({ fileName, version, isSaved: true }, showMsgFlag, relPath);
});
async function updateCommon(showMsgFlag=true,relPath=`./BBS/${this.fileName}`){
  let data = {
    currentVersion:app.getVersion(),
    path2file:path.resolve(app.getPath("appData"),relPath),
    time:Date.now(),
    updateDownloaded:true,
    versionDownloaded:this.version,
    installMoment:"now",
    updateComplete:false,
    platform:process.platform,
    fileName:this.fileName
  }
  if(this.hashInfo) // Storing hashInfo only once when app checks for update.
    data.hashInfo = this.hashInfo;
  if(this.isSaved===false)// Saving the update data only when it's not saved previously. This is to avoid overwriting the data when user tries to install update later and then tries to install again from settings without downloading again.
    recordDownloadedVersion(data);
  if(showMsgFlag){
    let resp = await dialog.showMessageBox({
      title:"Download complete",
      message:"Update download complete, do you want to install now?",
      buttons:["Install Now","Later"],
      noLink:true,
      icon:appIcon
    });
    if(resp.response===1){
      data.installMoment = "later";
      return;
    }
  }
  ipcMain.emit("manage-schedule",null,"app-update","exp-all",false);
  appLogger({
    title:"Update Install",
    message:"Trying to install update.",
    func:"updateCommon"
  });
  let proc;
  if(data.installMoment==="now"){// Close all windows,db and listeners before update
    BrowserWindow.getAllWindows().forEach(win => win.close());
    ipcMain.eventNames().forEach(event => ipcMain.removeAllListeners(event));
    process.removeAllListeners();
    await sequelize.close();
  }
  if(data.installMoment==="now" && ["darwin","linux"].includes(process.platform)){
    appLogger({
      title:"Update Install",
      message:"Launching updator.sh.",
      cmd:`./updator.sh -u ${this.version}`,
      func:"updateCommon"
    });
    proc = spawn(`./updator.sh -u ${this.version}`,{
      cwd:__dirname,
      shell:true,
      detached:true,
      stdio:'ignore'
    });
  }
  else
  if(data.installMoment==="now" && process.platform==="win32"){
    // Pass parent PID to batch file so it can wait for app to fully exit
    proc = spawn("updator.bat",[process.pid, data.path2file],{
      shell:true,
      cwd:__dirname,
      detached:true,
      windowsHide:true,
      stdio:'ignore'
    });
  }
  if(data.installMoment==="now"){
    // Unref the process to allow parent to exit independently
    proc.unref();
    
    appLogger({
      title:"Spawned updator",
      message:`Process detached, app will quit now`,
      pid: process.pid,
      filePath:data.path2file,
      fileExists:fs.existsSync(data.path2file),
      func:"updateCommon"
    });
    
    // Quit immediately - batch file will wait for full exit
    app.quit();
  }
}

// NEW downloadUpdate function with pause/resume support + file integrity verification + file repair
function downloadUpdate(appVersion, resumeState = null, hashInfo) {
  /**
   * Date: 11/04/2026
   * Task remains:(Postponed for now - will be implemented in future updates)
   * - Check if partial files are auto detected on app start and offer resume option if valid (currently only resume from settings)
   * - Give user option to close the download progress modal when download is "paused" state.
   * - Show download progress in app notification panel as well.
   * - Create schedule to auto download with conditions like "only on wifi" or "only when idle" and test the functionality.
   * - (Least priority) Make this function more modular and reusable for other large file downloads in the app like SLM or backup restore. 
   */
  appLogger({
    title:"Download Update",
    message: resumeState ? "Resuming download" : "Starting new download",
    resumeFrom: resumeState?.bytesDownloaded || 0,
    func:"downloadUpdate"
  });
  
  let fileWriter, downloadURL, fileName, filePath, mainWin = getMainWindow();
  let abortControllerPause = typeof global.isPaused=="undefined" ? new AbortController() : global.abortControllerPause;
  let abortControllerCancel = new AbortController();
  let pauseToken = typeof global.isPaused=="undefined" ? uuid.v4() : global.pauseToken;
  let cancelToken = uuid.v4();
  let lastSavedPercent = 0;
  let bytesDownloaded = resumeState?.bytesDownloaded || 0;
  let downloadTotalBytes = resumeState?.totalBytes || null;
  let timeoutCheckInterval;
  const SAVE_STATE_INTERVAL = 5; // Save state every 5 seconds
  global.abortControllerPause = abortControllerPause;
  global.pauseToken = pauseToken;
  global.isPaused = typeof global.isPaused=="undefined" ? "false" : global.isPaused;

  if(typeof global.state!=="undefined" && global.state.status==="downloading"){
    return appLogger({
      title:"Download in progress",
      message:"A download is already in progress. Please pause or cancel the current download before starting a new one.",
      func:"downloadUpdate"
    });
  }// Block multiple download attempts - this can happen if user clicks "Download update" multiple times from settings before the first download starts (due to async nature of download start)

  // Platform-specific file setup
  if (process.platform === "linux") {
    fileName = `bbs_${appVersion}_amd64.deb`;
    filePath = path.resolve(app.getPath("appData"), `BBS/${fileName}`);
    downloadURL = process.env.UPDATE_REST + `download/update?channel=production&platform=linux&id=${global.userId}`;
  } else if (process.platform === "win32") {
    fileName = `bbs_${appVersion}_setup.exe`;
    filePath = path.resolve(app.getPath("appData"), `BBS/${fileName}`);
    downloadURL = process.env.UPDATE_REST + `download/update?channel=production&platform=win&id=${global.userId}`;
  } else if (process.platform === "darwin") {
    // Mac case
    fileName = `bbs_${appVersion}.dmg`;
    filePath = path.resolve(app.getPath("appData"), `BBS/${fileName}`);
    downloadURL = process.env.UPDATE_REST + `download/update?channel=production&platform=mac&id=${global.userId}`;
  }

  // If resuming, verify partial file
  if (resumeState) {
    const verification = verifyPartialFile(filePath, bytesDownloaded);
    if (!verification.valid) {
      appLogger({
        title: "Warning",
        message: `Partial file verification failed: ${verification.reason}`,
        action: "Starting fresh download",
        verification,
        func:"downloadUpdate"
      });
      // Clear state and start fresh
      clearDownloadState(appLogger);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }
      resumeState = null;
      bytesDownloaded = 0;
    }
  }

  // Create file writer (append mode if resuming)
  fileWriter = fs.createWriteStream(filePath, {
    flags: resumeState ? 'a' : 'w'
  });

  // PAUSE HANDLER
  ipcMain.removeHandler("pause-download");
  ipcMain.handle("pause-download", (e,isPaused) => {    
    // Don't delete file - keep for resume
    global.isPaused = isPaused;
    appLogger({
      title: "Download paused",
      message: isPaused ? "Pausing download..." : "Resuming download...",
      func:"pause-download"
    });
    if(isPaused){
      fileWriter.end(() => {
        appLogger({ title:"Download", message: "File stream closed for pause", func:"pause-download", appendToLog: false, allowConsole: true });
        abortControllerPause.abort("Paused by user");
      });
      mainWin.webContents.send("msg-from-backend","Download paused");
    }
    else{
      // Resume download
      const state = loadDownloadState(appLogger);
      if(state){
        global.state = {
          ...state,
          status: 'resuming'
        }; // Store in global to access in axios config
        global.isPaused = undefined;
        downloadUpdate(appVersion, state, hashInfo);
        mainWin.webContents.send("msg-from-backend","Resuming download...");
      }
    }
    return true;
  });

  // CANCEL HANDLER
  ipcMain.removeHandler("cancel-download");
  ipcMain.handleOnce("cancel-download", () => {
    appLogger({ title:"Download", message: "Download cancelled by user", func:"cancel-download", appendToLog: false, allowConsole: true });
    // Close stream and delete file
    fileWriter.end(() => {
      console.log({msg:"fileWriter.end callback function"});
      abortControllerCancel.abort("Cancelled by user");
      const state = loadDownloadState(appLogger);
      saveDownloadState({
        ...state,
        status:"cancelled"
      });
      global.state = {
        ...state,
        status:"cancelled"
      };
    });
    
    return true;
  });

  // Prepare axios config
  let lastProgressSentTime = Date.now();
  const axiosConfig = {
    responseType: "stream",
    onDownloadProgress(progressEvent) {
      lastProgressSentTime = Date.now();
      let total = progressEvent.total || downloadTotalBytes;
      if(typeof global.state!=="undefined" && global.state.status==="resuming"){
        total = global.state.totalBytes;
      }
      if (!downloadTotalBytes && total) {
        downloadTotalBytes = total;
      }
      let current = progressEvent.loaded;
      let totalDownloaded = bytesDownloaded + current;
      
      // Update progress bar with dual buttons
      updateProgressbar(
        mainWin,
        totalDownloaded,
        total,
        "Downloading update...",
        `${Math.round(totalDownloaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`,
        {
          usePause: true,
          useCancel: true,
          pauseToken,
          cancelToken,
          pauseBtnTextObj: {
            pause: "Pause",
            resume: "Resume"
          },
          cancelBtnText: "Cancel"
        }
      );
      // Save state periodically (every 5%)
      const currentPercent = Math.floor((totalDownloaded / total) * 100);
      if (currentPercent - lastSavedPercent >= SAVE_STATE_INTERVAL) {
        saveDownloadState({
          fileName,
          filePath,
          downloadURL,
          bytesDownloaded: totalDownloaded,
          totalBytes: total,
          version: appVersion,
          status: 'downloading'
        });
        lastSavedPercent = currentPercent;
      }
    },
    signal: AbortSignal.any([
      abortControllerPause.signal,
      abortControllerCancel.signal
    ])
  };

  // Timeout check to detect stalled downloads (no progress for 60 seconds)
  timeoutCheckInterval = setInterval(() => {
    const stalledTime = Date.now() - lastProgressSentTime;
    if (stalledTime > 60*1000) {
      clearInterval(timeoutCheckInterval);
      appLogger({
        title: "Download stalled",
        message: `No progress event received for ${stalledTime / 1000} seconds. Aborting download.`,
        func:"downloadUpdate"
      });
      mainWin.webContents.send("msg-from-backend","Download stalled. Please try again later.");
      abortControllerPause.abort("Download stalled");
    }
  },30000);

  // Add Range header if resuming
  if (resumeState && bytesDownloaded > 0) {
    axiosConfig.headers = {
      'Range': `bytes=${bytesDownloaded}-`
    };
    appLogger({
      title: "Resume Download",
      message: `Requesting bytes from ${bytesDownloaded}`,
      func:"downloadUpdate"
    });
  }

  // Start download
  axios.get(downloadURL, axiosConfig)
    .then(resp => {
      // Check if server supports resume
      if (resumeState && resp.status !== 206) {
        appLogger({
          title: "Warning",
          message: "Server doesn't support Range requests (no 206 status)",
          status: resp.status,
          action: "Download will continue but resume may not work properly",
          func:"downloadUpdate"
        });
      }

      if (resp.status === 200 || resp.status === 206) {
        appLogger({ title:"Download", message: "Response received from server", status: resp.status, func:"downloadUpdate", appendToLog: false, allowConsole: true });
      }

      resp.data.on("close",()=>{
        if(typeof global.state!=="undefined" && global.state.status==="cancelled"){
          mainWin.setProgressBar(-1);
          mainWin.webContents.send("remove-progressbar");
          mainWin.webContents.send("msg-from-backend","Download cancelled","error");
        }
      });


      return new Promise((resolve, reject) => {
        resp.data.pipe(fileWriter);
        
        fileWriter.on("error", (err) => {
          fileWriter.close();
          if(timeoutCheckInterval) clearInterval(timeoutCheckInterval);
          if(err.code==="ENOSPC"){
            appLogger({
              title: "Disk space error",
              message: "Not enough disk space to complete the download.",
              error: String(err),
              func:"downloadUpdate"
            });
            saveDownloadState({
              fileName,
              filePath,
              downloadURL,
              bytesDownloaded,
              totalBytes: downloadTotalBytes,
              version: appVersion,
              status: 'paused',
              error: 'Not enough disk space'
            });
            mainWin.webContents.send("msg-from-backend","Not enough disk space to complete the download.");
          }
          else
          if(err.code==="EACCES"){
            appLogger({
              title: "Permission error",
              message: "Insufficient permissions to complete the download.",
              error: String(err),
              func:"downloadUpdate"
            });
            clearDownloadState(appLogger);
            mainWin.webContents.send("msg-from-backend","Insufficient permissions to complete the download. Please check your permissions and try again.");
          }
          reject(err);
        });
        
        // Handle abort signals
        const abortHandler = function(){
          if(!resp.data.destroyed && fs.existsSync(filePath)){
            resp.data.unpipe(fileWriter);
            resp.data.destroy();
            let state = loadDownloadState(appLogger);
            let stats = fs.statSync(filePath);
            // Save state with current progress and paused status
            saveDownloadState({
              ...state,
              bytesDownloaded: stats.size,
              status: 'paused'
            });// Save state on abort to allow resume\
            // Reset global properties to allow future pause/resume cycles
            global.isPaused = false;
            global.pauseToken = uuid.v4();
            global.abortControllerPause = new AbortController();
            global.abortControllerCancel = new AbortController();
            global.cancelToken = uuid.v4();
          }
          if(this.name==="cancel"){
            clearDownloadState(appLogger);
            mainWin.setProgressBar(-1);
            mainWin.webContents.send("remove-progressbar");
            mainWin.webContents.send("msg-from-backend","Download cancelled","error");
          }
        }

        fileWriter.on("close", async () => {
          // This can be triggered on both pause and completion, so we check if the file is fully downloaded before resolving.
          // Cleanup abort listeners
          abortControllerCancel.signal.removeEventListener("abort", abortHandler);
          abortControllerPause.signal.removeEventListener("abort", abortHandler);
          if(timeoutCheckInterval) clearInterval(timeoutCheckInterval);
          if(!fs.existsSync(filePath)){
            appLogger({
              title: "File not found after stream closed",
              message: "The file stream was closed but the file does not exist on disk. This may indicate an issue during download or an external deletion.",
              filePath,
              func:"downloadUpdate"
            });
            return reject(new Error("File not found after stream closed"));
          }
          const stats = fs.statSync(filePath);
          if (stats.size >= downloadTotalBytes) {
            appLogger({ title:"Download", message: "File fully downloaded", func:"downloadUpdate" });
            // Check hash if info available
            if(!hashInfo){
              try {
                let confPath = path.resolve(app.getPath("appData"), "./BBS/updtConf.json");
                if(fs.existsSync(confPath))
                  hashInfo = JSON.parse(fs.readFileSync(confPath)).hashInfo || null;
              } catch(e) {
                appLogger({ title:"Warning", message: "Failed to read hashInfo from updtConf.json", error: String(e), func:"downloadUpdate" });
              }
            }
            if(hashInfo){
              mainWin.setProgressBar(2); // Indeterminate progress
              mainWin.webContents.send("notification",{
                title:"Verifying file integrity",
                message:"Computing file hash, please wait..."
              },true);
              
              let fullFileHash = await computeFullFileHash(filePath, (processed, total) => {
                const progress = processed / total;
                mainWin.setProgressBar(progress);
              });
              
              mainWin.setProgressBar(-1);
              if(fullFileHash === hashInfo.fullFileHash){
                appLogger({ title:"Integrity Check", message: "File integrity verified with SHA-256 hash", func:"downloadUpdate" });
                return resolve(true);
              }
              else{
                appLogger({
                  title: "Hash Mismatch",
                  message: "Downloaded file hash does not match expected hash,downloading the corrupted sections again.",
                  expectedHash: hashInfo.fullFileHash,
                  actualHash: fullFileHash,
                  func:"downloadUpdate"
                });
                
                mainWin.setProgressBar(2); // Indeterminate progress for chunk verification
                mainWin.webContents.send("notification",{
                  title:"Analyzing corrupted sections",
                  message:"Identifying which parts need repair..."
                },true);
                
                const corruptedSections = await verifyFileIntegrityByChunks(filePath, hashInfo, appLogger, (current, total) => {
                  const progress = current / total;
                  mainWin.setProgressBar(progress);
                });
                
                mainWin.setProgressBar(-1);
                
                // Inform user about corrupted sections and retry download for those sections
                mainWin.webContents.send("notification",{
                  title:"Download integrity issue",
                  message:`Some sections of the downloaded file are corrupted. Retrying download for those sections. Please wait...`, 
                },true);
                let successfulRepair = false;
                for(let tryCount=0; tryCount<3; tryCount++){
                  try{
                    mainWin.setProgressBar(2); // Indeterminate for re-download
                    mainWin.webContents.send("notification",{
                      title:`Repair attempt ${tryCount+1}/3`,
                      message:`Re-downloading ${corruptedSections.length} corrupted section(s)...`
                    },true);
                    
                    await reDownloadCorruptedSections(corruptedSections, appLogger);
                    
                    mainWin.webContents.send("notification",{
                      title:"Re-verifying integrity",
                      message:"Checking if repair was successful..."
                    },true);
                    
                    let fullFileHashAfterFix = await computeFullFileHash(filePath, (processed, total) => {
                      const progress = processed / total;
                      mainWin.setProgressBar(progress);
                    });
                    
                    mainWin.setProgressBar(-1);
                    if(fullFileHashAfterFix === hashInfo.fullFileHash){
                      appLogger({ title:"Repair", message: "File successfully repaired and verified", func:"downloadUpdate" });
                      successfulRepair = true;
                      return resolve(true);
                    }
                    else{
                      appLogger({ title:"Repair", message: `Hash still mismatched after repair attempt ${tryCount+1}`, func:"downloadUpdate" });
                      mainWin.setProgressBar(2);
                      corruptedSections = await verifyFileIntegrityByChunks(filePath, hashInfo, appLogger, (current, total) => {
                        const progress = current / total;
                        mainWin.setProgressBar(progress);
                      });
                      mainWin.setProgressBar(-1);
                      if(tryCount < 2) {
                        await new Promise(res=>setTimeout(res,5000)); // Wait before retry
                      }
                    }
                  }
                  catch(err){
                    appLogger({
                      title:"Problem re-downloading corrupted sections",
                      message:String(err),
                      attempt: tryCount + 1,
                      func:"Download Update - reDownloadCorruptedSections"
                    });
                    mainWin.webContents.send("notification",{
                      title:"Problem re-downloading corrupted sections",
                      message:`Attempt ${tryCount+1}: There was a problem re-downloading the corrupted sections. Retrying...`,
                    },true);
                    if(tryCount < 2) {
                      await new Promise(res=>setTimeout(res,10000)); // Wait for 10 seconds before retry
                    }
                  }
                }
                if(!successfulRepair){
                  appLogger({
                    title:"Failed to fix corrupted download",
                    message:"Failed to fix the corrupted download after multiple attempts. Please try downloading again later or contact support.",
                    func:"Download Update - reDownloadCorruptedSections"
                  });
                  mainWin.webContents.send("notification",{
                    title:"Failed to fix corrupted download",
                    message:`Failed to fix the corrupted download after multiple attempts. Please try downloading again later or contact support.`,
                  },true);
                  const error = new Error("Failed to fix corrupted download after multiple attempts");
                  error.code = "CORRUPTED_DOWNLOAD";
                  return reject(error);
                }
              }
            }
            else{
              // No hashInfo available - cannot verify integrity
              appLogger({ title: "Warning", message: "No hash info available, skipping integrity verification", func:"downloadUpdate" });
              return resolve(true);
            }
          }
          else {
            appLogger({ title:"Download", message: "File stream closed, but download not complete", downloadedBytes: stats.size, expectedBytes: downloadTotalBytes, func:"downloadUpdate" });
            // If abort was triggered, let the catch block handle it
            // Otherwise this is an unexpected incomplete download
            if (!abortControllerPause.signal.aborted && !abortControllerCancel.signal.aborted) {
              const error = new Error("Download incomplete - file size mismatch");
              error.code = "INCOMPLETE_DOWNLOAD";
              return reject(error);
            }
          }
          if(typeof global.state!=="undefined" && global.state.status==="cancelled"){
            global.state = undefined;
            clearDownloadState();
            if(fs.existsSync(filePath))
              fs.rmSync(filePath);
          }
        });

        abortControllerPause.signal.addEventListener("abort",abortHandler.bind({name:"pause"}));
        abortControllerCancel.signal.addEventListener("abort",abortHandler.bind({name:"cancel"}));
      });
    })
    .then(updateCommon.bind({ fileName, version: appVersion, hashInfo, isSaved: false }))
    .catch(async err => {
      if(timeoutCheckInterval)
        clearInterval(timeoutCheckInterval);
      if (err.message === "Paused by user") {
        // Save final state as paused
        await new Promise((res)=>setImmediate(res));
        const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (stats) {
          saveDownloadState({
            fileName,
            filePath,
            downloadURL,
            bytesDownloaded: stats.size,
            totalBytes: downloadTotalBytes || stats.size,
            version: appVersion,
            status: 'paused'
          });
        }
        mainWin.send("msg-from-backend","Download Paused","info");
      } 
      else 
      if (err.message === "Cancelled by user") {
        appLogger({ title:"Download", message: "Download cancelled, cleanup complete", func:"downloadUpdate", appendToLog: false, allowConsole: true });
        mainWin.setProgressBar(-1);
      }
      else
      if(err.code === "CORRUPTED_DOWNLOAD" || err.code === "INCOMPLETE_DOWNLOAD"){
        dialog.showErrorBox(
          err.code === "CORRUPTED_DOWNLOAD" ? "Corrupted Download" : "Incomplete Download",
          err.message
        );
        clearDownloadState();// Clear state to allow fresh download next time
        mainWin.setProgressBar(-1);
        if(fs.existsSync(filePath)){
          fs.rmSync(filePath);
        }
        let corruptedSectionsPath = path.resolve(app.getPath("appData"),"./BBS/corruptedSections.json");
        if(fs.existsSync(corruptedSectionsPath)){
          fs.rmSync(corruptedSectionsPath);
        }
      }
      else {
        // Network error or other issue - save as paused for retry
        console.error("Last Case: Download error:", err);
        appLogger({
          title: "Error",
          message: String(err),
          func: "Download-update"
        });
        
        const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (stats && stats.size > 0) {
          saveDownloadState({
            fileName,
            filePath,
            downloadURL,
            bytesDownloaded: stats.size,
            totalBytes: downloadTotalBytes || stats.size,
            version: appVersion,
            status: 'paused'
          });
          
          // dialog.showErrorBox(
          //   "Download Error",
          //   `Download interrupted: ${err.message}\n\nYou can resume the download later.`
          // );
        }
      }
      
      // mainWin.setProgressBar(-1);
    });
}


function versionChecker(version1,version2,log=true){
    let [major, minor, bugFix] = version1.split(".");
    let [_major, _minor, _bugFix] = version2.split(".");
    if(log)
      appLogger({
        title:"Version Check",
        message:`v${version1} vs v${version2}`,
        major,_major,minor,_minor,bugFix,_bugFix,
        cond1:Number(_major) === Number(major),
        cond2:Number(_minor) === Number(minor),
        cond3:Number(_bugFix) === Number(bugFix),
        func:"versionChecker"
      });
    if (Number(_major) > Number(major))
      return 1;
    else
    if (Number(_minor) > Number(minor))
      return 2;
    else
    if (Number(_bugFix) > Number(bugFix))
      return 3;
    else
    if(Number(_major) == Number(major) && Number(_minor) == Number(minor) && Number(_bugFix) == Number(bugFix))
      return 0;
}

ipcMain.on("check-for-update",()=>{
  // checkForInternet("manual");
  checkForUpdates();
});

async function checkForUpdates(flag="auto") {
  let { UPDATE_REST } = process.env;
  let mainWin = getMainWindow(),changeLogArr = [];
  if (!["admin", "all"].includes(currentUser.role)) {
    return dialog.showMessageBox(mainWin, {
      title: "Unauthorized",
      message: "Only Admin and user with role 'all' can check for update.",
      icon:appIcon
    });
  }
  appLogger({title:"Update Check", message:"Checking for update", func:"checkForUpdates", appendToLog: false, allowConsole: true});
  let isOnline = await checkForInternet();
  try{
    let updateURL = process.env.APP_ENV==="DEV" ? "http://localhost:3030/" : UPDATE_REST;
    let resp = await axios.get(updateURL+"version?channel=production&platform=win&id="+global.userId,{timeout:5000});
    if(resp.status===200){
      let data = resp.data;
      let appVersion = data.version;
      let changelog = data.changelog;
      let hashInfo = data.hashInfo;
      let videoUrl = data.videoUrl || null;
      isOnline = true;
      // Parse and santize appVersion
      if(appVersion && typeof appVersion === "string" && new RegExp(/^([0-9]+\.){2}[0-9]+$/).test(appVersion)){
        let resp = versionChecker(app.getVersion(),appVersion);
        if(!resp) 
          return;

        let message;
        if (resp===1)
          message = "A new version of BBS is available for download.";
        if (resp===2)
          message = "A minor feature update is available for download.";
        if (resp===3)
          message = "Bug fix available for download.";
        changelog.highlights?.forEach((log)=>{
          changeLogArr.push(log);
        });
        let evObj = {
          label:`Update Available`,
          type: "app-update",
          time: new Date(),
          tag: "app-update",
          version:appVersion,
          color: "#A020F0",
          changeLogArr
        }
        ipcMain.emit("manage-schedule","app-update",evObj,"exp-a",false);
        mainWin.webContents.send("check-notification");
        if(resp===0){
          if(flag!=="auto")
            return dialog.showMessageBox({
              title:"No new update",
              message: "Application is at latest release version",
              icon:appIcon
            });// App is already updated.
          else
            return;
        }
        // Build detail text from changelog
        let detailLines = [message];
        var highlights = changelog.highlights || [];
        var fullchange = changelog.fullchange || [];
        if (highlights.length) {
          detailLines.push("", "--- Highlights ---");
          highlights.forEach(function(h) {
            detailLines.push("  •  " + (typeof h === "string" ? h : (h.title || h.description || JSON.stringify(h))));
          });
        }
        if (fullchange.length) {
          detailLines.push("", "--- Full Changes ---");
          fullchange.forEach(function(c) {
            detailLines.push("  •  " + (typeof c === "string" ? c : (c.title || c.description || JSON.stringify(c))));
          });
        }
        let userChoice = await dialog.showMessageBox(mainWin, {
          type: "info",
          title: "Update Available",
          message: "BBS v" + appVersion + " is available for download",
          detail: detailLines.join("\n"),
          buttons: ["Download Now", "Later"],
          defaultId: 0,
          cancelId: 1
        });
        if (userChoice.response === 1) return ; // Later
        // If app is not already updated.
        try{
          let updtConf = fs.existsSync(app.getPath("appData")+"/BBS/updtConf.json") ? JSON.parse(fs.readFileSync(app.getPath("appData")+"/BBS/updtConf.json").toString()) : undefined;
          if(typeof updtConf!=="undefined" && updtConf?.updateDownloaded && updtConf?.versionDownloaded!==appVersion){
            return downloadUpdate(appVersion,null,hashInfo);
          }
          else
          if(typeof updtConf!=="undefined" && updtConf?.updateDownloaded && updtConf?.versionDownloaded===appVersion && fs.existsSync(updtConf?.path2file)){
            // Update already downloaded and ready for install
            appLogger({ title:"Update", message: "Update is already downloaded.", func:"checkForUpdates", appendToLog: false, allowConsole: true })
            updateCommon.call({version:appVersion,fileName:updtConf.fileName,isSaved:true});
          }
          else {
            // First-time download or updtConf missing — start fresh download
            downloadUpdate(appVersion, null, hashInfo);
          }
        }
        catch(err){
          appLogger({
            title:"Error",
            message:String(err),
            func:"Update conf read error"
          });
          downloadUpdate(appVersion,null,hashInfo);
        }
      }
    }
  }
  catch(err){
    if (err) {
      // Logic for error Handling
      if(isOnline)
        appLogger({
          title:"Error",
          message:String(err),
          func:"Check for update error",
          notify:false
        });
      if(flag!=="auto")
        return dialog.showMessageBox({
          title:"Failed to connect",
          message: "Update server is offline. Check later.",
          icon:appIcon
        });
    }
    if (isOnline === false){
      appLogger({
        title:"Error",
        message:String(err),
        func:"Check for update error",
        notify:false
      });
      return dialog.showMessageBox(mainWin, {
        title: "No Connection",
        message: "Failed to connect to update server.",
        icon:appIcon
      });
    }
  }
}

ipcMain.on("start-update",(e,appVersion)=>{
  downloadUpdate(appVersion);
});

// First Boot IPCs
ipcMain.handle("db-init-status",()=>{
  return dbInitialized;
});

async function saveInitData(pageNo,data){
  try{
    switch(pageNo){
      case 1://Conpany Info
        let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
        saleConfig = {
          ...saleConfig,
          ...data
        }
        fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(saleConfig));
        break;
      case 2:// Financial info
        let policyConfig = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
        policyConfig = {
          ...policyConfig,
          "financialYearStartDate":data.financialYearStartDate,
          "resetBillNo":data.resetBillNo
        }
        if(dbInitialized){
          await finData.findOrCreate({
            where:{
              finYear:new Date().getFullYear()-1
            },
            defaults:{
              finYear:new Date().getFullYear()-1,
              closingStock:Number(data.closingStock),
              grossCredit:Number(data.grossCredit),
              grossDebt:Number(data.grossDebt),
              advNetIncome:Number(data.advNetIncome),
              advNetExpence:Number(data.advNetExpence)
            }
          });
          return false;
        }
        fs.writeFileSync(getUserPolicyPath(),JSON.stringify(policyConfig));
        break;
      default: // Page 4
        let { filePath,'theme-pref':themePref } = data;
        let appPolicyConfig = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
        let _policyConfig = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
        _policyConfig.wallpaper = filePath;
        appPolicyConfig.useDarkTheme = themePref==="true";
        fs.writeFileSync(getAppPolicyPath(),JSON.stringify(appPolicyConfig));
        fs.writeFileSync(getUserPolicyPath(),JSON.stringify(_policyConfig));
        ipcMain.emit("first-load");
    }
    return true;
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"Save-init-data-error"
    });
    if(pageNo===4){
      let mainWin = getMainWindow();
      mainWin.webContents.send("save-settings");
    }
    else
      return false;
  }
}

ipcMain.handle("save-settings",async (e,{pageNo,data})=>{
  return saveInitData(pageNo,data);
});

ipcMain.on("write-settings",async (e,pageWiseData)=>{
  fs.writeFile(path.resolve(app.getPath("appData")+"/temp.json"),JSON.stringify(pageWiseData),(err)=>{
    if(err) return appLogger({
      title:"Error",
      message:String(err),
      func:"write-setting-ipc error"
    });
    appLogger({
      title:"Success",
      message:"Written initial data to a temporary json file",
      func:"write-settings"
    })
  });
});

ipcMain.on("first-load",async ()=>{
  try {
    let {id,name,secret,role,session,sessionTime,usePasswd} = (await user.findOrCreate({
      where:{
        name:"admin"
      },
      defaults:{
        id: uuid.v5("admin", "6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        name: "admin",
        passwd: await bcrypt.hash("admin", 10),
        role: "admin"
      }
    }))[0].dataValues;
    currentUser = new User(
      id,
      name,
      secret,
      role,
      session,
      sessionTime,
      usePasswd
    );
    await user.update(
      {
        lastLogin: currentUser.lastLogin,
      },
      {
        where: { id: currentUser.id },
      }
    );
    } catch (err) {
      appLogger({
        title:"Error",
        message:String(err),
        func:"First-boot data save error"
      });
    }
    finally{
      currentUser = new User(
        uuid.v5("admin", "6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        "admin",
        undefined,
        "admin",
        false
      );
      ipcMain.emit("app-login");
      ipcMain.emit("load-lander-page");
      bootCommon(getMainWindow());
    }
});

// MISC
ipcMain.on("openDevTool",(e)=>{
  console.log("Opening DevTool")
  e.sender.toggleDevTools();
});

ipcMain.on("close",(e,label)=>{
  if(label){
      let win = getTargetWindow(label);
      win?.close();
      if(label==="Salary-Modal")
          ipcMain.emit("Salary-Modal");
  }
  else
    BrowserWindow.fromId(e.sender.id).close();
});

ipcMain.on("print-ledger",async (e,id,period,mode)=>{
  let ledgerSchema = mode==1?supplierLedgerSchema:customerLedgerSchema;
  let ledger = await getLedgerModel(id,ledgerSchema);
  let { strtDt:startDate, endDt:endDate} = getFinYearStrtEndDt(Number(period));
  let entryArr = (await ledger.findAll({
    where:{
      date:{
        [Op.between]:[
          startDate,
          endDate
        ]
      }
    }
  })).map(({dataValues})=>dataValues);
  let prevClose = entryArr[0].balance - entryArr[0].billAmt;
  let ledgerBalance = entryArr.at(-1).balance;
  let peopleObj = (mode==1?await supplier.findOne({where:{id}}):await customer.findOne({where:{id}})).dataValues;
  let path2pdf = ledgerPDF(entryArr,peopleObj,startDate,endDate,prevClose,ledgerBalance);
  console.log("Generated PDF at path:", path2pdf);
  // ipcMain.emit("show-print-modal",path2pdf);
});

ipcMain.handle("billing-format-ipc",(e,data)=>{
  try{
    if(parseInt(data.billNo)){
      // Re-init BillManager with the new starting number.
      // The constructor persists lastIssued + fresh pool to saleConfig.json.
      getBillManager().reset(Number(data.billNo));
    }
    // Re-read config after BillManager may have written its fields
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    Reflect.deleteProperty(data,"billNo");
    saleConfig = {
      ...saleConfig,
      ...data
    };
    fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(saleConfig));
    setAppPresets();
    return true;
  }
  catch(err){
    dialog.showErrorBox("Error",String(err));
    return false;
  }
});

ipcMain.on("printObj",print);

// BBS timer codes

// Inactivity tracker
function lockOnIdle(){
  // console.log("lockOnIdle called",this.idleTime)
  let state = powerMonitor.getSystemIdleState((this?.idleTime ?? 1));
  let time = powerMonitor.getSystemIdleTime();
  if(state==="idle" && time>this.idleTime+5)
    ipcMain.emit("lock");
}

// Scheduler IPCs
ipcMain.on("call-scheduler",()=>{
  let pathToHTML = getTemplatePath("scheduler");
  let windowOptions = {
    parent:getMainWindow(),
    movable:true
  }
  createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Scheduler-Dialog",show:true});
});

ipcMain.on("manage-schedule",async (e,data,flag,showMsg=true,updateKey)=>{
  let path2scheduler = getSchedulerPath();
  if(!fs.existsSync(path2scheduler)){
    dialog.showErrorBox({
      title:"Error saving event schedule",
      message:"scheduler.json file missing"
    });
    appLogger({
      title:"Error saving event schedule",
      message:"scheduler.json file missing",
      func:"manage-schedule"
    });
    return BrowserWindow.fromId(e.sender.id).close();
  }
  try{
    let jsData = JSON.parse(fs.readFileSync(path2scheduler).toString());
    let schedules = jsData.schedules;
    if(!("expiredSchedules" in jsData))
      jsData.expiredSchedules = [];
    if(!("schedules" in jsData))
      jsData.schedules = [];
    if(flag==="a"){
      data.user = currentUser;
      data.id = uuid.v4();
      jsData.schedules.push(data);
    }
    else
    if(flag==="r")
      schedules.splice(schedules.findIndex(evObj=>evObj.id===data),1);
    else
    if(flag==="e"){
      schedules = schedules.map(evObj=>{
        if(evObj.id===data.id)
          evObj = {
          ...evObj,
          ...data
          }
        return evObj;
      });
      jsData.schedules = schedules;
    }
    else
    if(flag==="exp"){
      jsData.expiredSchedules.push(schedules.find(obj=>obj.id===data));
      schedules.splice(schedules.findIndex(evObj=>evObj.id===data),1);
    }
    else
    if(flag==="exp-a")
      jsData.expiredSchedules.push(data);
    else
    if(flag==="exp-all")
      jsData.expiredSchedules = jsData.expiredSchedules.filter(evObj=>evObj.tag!==data);
    else
    if(flag==="exp-r")
      jsData.expiredSchedules.splice(jsData.expiredSchedules.findIndex(evObj=>evObj.id===data),1);
    else
    if(flag==="exp-u"){
      let evObj = jsData.expiredSchedules.find(obj=>obj.id===data.id);
      evObj[updateKey] = data[updateKey];
      if(updateKey==="time"){
        jsData.expiredSchedules.splice(jsData.expiredSchedules.findIndex(evObj=>evObj.id===data.id),1);
        jsData.schedules.push(evObj);
      }
    }
    else
    if(flag==="exp-echo"){
      ipcMain.emit("echo-exp-event",null,jsData.expiredSchedules);
      return;
    }
    fs.writeFileSync(path2scheduler,JSON.stringify(jsData));
    createNotifications();
    if(flag==="exp-u" && updateKey==="time")
      getMainWindow().webContents.send("notification",jsData.expiredSchedules,true);
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"manage-schedule ipc"
    })
  }
  finally{
    if((flag==="a" || flag==="e") && showMsg===true){
      dialog.showMessageBox({
        title:"Event saved",
        message:"Notification and action scheduled at the event time.",
        icon:appIcon
      });
      flag==="a" && BrowserWindow.fromId(e.sender.id).close();
    }
    else
    if(flag==="r" && showMsg===true)
      dialog.showMessageBox({
        title:"Event removed",
        message:"Event removed.",
        icon:appIcon
      });
    if(showMsg===true)
      BrowserWindow.fromId(e.frameId).webContents.send("update-content");
  }
});

ipcMain.handle("get-chedules",()=>{
  let jsData = JSON.parse(fs.readFileSync(getSchedulerPath()).toString());
  if(!("schedules" in jsData)) return [];
  else return jsData.schedules;
});

exports.scheduleManager = main=>{
  return ()=>{
    windowOptions.parent = main;
    windowOptions.width = 800;
    windowOptions.height = 600;
    return createModal(windowOptions,getTemplatePath("scheduleManager"),{label:"scheduler",cb:function(){
      this.on("close",(e)=>{
        getMainWindow().webContents.send("update-content");
      });
    }});
  };
}

function sendIPCNotification(evObj,job){
  ipcMain.emit("manage-schedule",null,evObj.id,"exp",false);
  let jsData = JSON.parse(fs.readFileSync(getSchedulerPath()).toString());
  getMainWindow().webContents.send("notification",jsData.expiredSchedules,true);
  let notification = new Notification({
    title:evObj.type,
    body:evObj.title
  });
  notification.show();
  shell.beep();
  notification.on("click",()=>app.focus());
  job.updateStatus("OK");
}

function createNotifications(){
  let jsData = JSON.parse(fs.readFileSync(getSchedulerPath()).toString());
  if("schedules" in jsData){
    jsData.schedules
    .forEach(evObj=>{
      let { id,time } = evObj;
      if(Math.sign(new Date(time)-Date.now())>0){
        let timeDiff = new Date(time)-Date.now();
        // timeDiff = 1;
        if(timeDiff>2147483647) return;
        jobs.push(new Job(id,"notify",[evObj],sendIPCNotification,timeDiff));
      }
      else
        ipcMain.emit("manage-schedule",null,id,"exp",false);
    });
  }
}

ipcMain.on("get-notification",e=>{
  try{
    let path2scheduler = getSchedulerPath();
    let jsData = JSON.parse(fs.readFileSync(path2scheduler).toString());
    if(!("expiredSchedules" in jsData))
      jsData.expiredSchedules = [];
    if(jsData.expiredSchedules.find(obj=>obj==="null")==null){
      jsData.expiredSchedules = jsData.expiredSchedules.filter(obj=>obj!==null);
      fs.writeFileSync(path2scheduler,JSON.stringify(jsData));
    }
    BrowserWindow.fromId(e.frameId).webContents.send("notification",jsData.expiredSchedules);
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"get-notification ipc"
    });
    BrowserWindow.fromId(e.frameId).webContents.send("notification",[]);
  }
});

ipcMain.on("open-event",(e,evObj)=>{
  if(evObj.user.id===currentUser.id || ["admin","all"].includes(currentUser.role)){
    let mainWin = getMainWindow();
    let scheduler = this.scheduleManager(mainWin)();
    scheduler.on("ready-to-show",()=>{
      scheduler.webContents.send("open-event-scheduler",evObj);
    });
  }
});

async function schemaDownloader(){
  const { extractVersion } = require("./model/schemaLoader");
  let [ serverSchema, serverDynamic ] = await new Promise(async (res,rej)=>{
    res(Promise.all(["api/schema","api/dynamic-schema"].map(async (endpoint)=>{
      try{
        let schemaResp = await axios.get(process.env.SCHEMA_SERVER+endpoint,{
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        });
        schemaResp = JSON.parse(schemaResp.data.schema);
        if(typeof schemaResp.version!="undefined" && typeof schemaResp.version=="object")
          schemaResp.version = extractVersion(schemaResp);
        return schemaResp;//({[endpoint==="api/schema"?"serverSchema":"serverDynamic"]:schemaResp});
      }
      catch(err){
        appLogger({
          title:"Schema download failure",
          message:err,
          func:"schemaDownloader"
        });
        rej(err);
      }
    })));
  });
  return { serverSchema,serverDynamic };
}

function saveSchemaLocally(serverSchema,serverDynamic){
  let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
  // Defining path to schema files
  const currentDynamicPath = path.resolve(appPath, "./model/dynamicSchemas.json");
  const currentSchemaPath = path.resolve(appPath, "./model/schema.json");
  // Update current schemas with server schemas
  fs.writeFileSync(currentSchemaPath, JSON.stringify(serverSchema));
  fs.writeFileSync(currentDynamicPath, JSON.stringify(serverDynamic));
}

// DB Migration for non-breaking model changes only
async function schemaValidator(){
  let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
  // Defining path to schema files
  const replicaDynamicPath = path.resolve(appPath, "./model/dynamicSchemas_replica.json");
  const replicaSchemaPath = path.resolve(appPath, "./model/schema_replica.json");
  const currentDynamicPath = path.resolve(appPath, "./model/dynamicSchemas.json");
  const currentSchemaPath = path.resolve(appPath, "./model/schema.json");

  // Read and parse all schemas
  const currentDynamic = JSON.parse(fs.readFileSync(currentDynamicPath, 'utf8'));
  const currentSchema = JSON.parse(fs.readFileSync(currentSchemaPath, 'utf8'));

  // Fetch schema-hashes from server and check with local schema hashes
  const currentDynamicHash = crypto.createHash('sha256').update(JSON.stringify(currentDynamic)).digest('hex');
  const currentSchemaHash = crypto.createHash('sha256').update(JSON.stringify(currentSchema)).digest('hex');

  try {
    // Fetch latest schemas from server and update local files    
    if(await checkForInternet()===false){
      appLogger({ title: "No internet connection", message: "Skipping schema validation.", func:"schemaValidator" });
      return false;
    }
    let { serverSchema,serverDynamic } = await schemaDownloader();
    let serverSchemahash = crypto.createHash('sha256').update(JSON.stringify(serverSchema)).digest('hex');
    let serverDynamicHash = crypto.createHash('sha256').update(JSON.stringify(serverDynamic)).digest('hex');
    // If hashes match, no migration needed
    if (currentDynamicHash === serverDynamicHash && currentSchemaHash === serverSchemahash) {
      appLogger({ title: "Schema Check", message: "No schema changes detected, migration not needed.", func:"schemaValidator" });
      return false;
    } else {
      appLogger({ title: "Schema Change", message: "Schema change detected, starting migration.", func:"schemaValidator" });
      
      // Ask user confirmation for migration
      let mainWin = getMainWindow();
      let { response } = await dialog.showMessageBox(mainWin, {
        type: 'warning',
        buttons: ['Proceed', 'Cancel'],
        defaultId: 0,
        title: 'Schema Change Detected',
        message: 'Schema changes have been detected. Do you want to proceed with the migration?',
        detail: 'App will backup db before proceeding. Don\'t close the app during migration',
        icon: appIcon,
        noLink: true
      });
      if (response === 1) {
        appLogger({ title: "Migration cancelled", message: "Migration cancelled by user.", func:"schemaValidator" });
        dialog.showMessageBoxSync({
          type:"info",
          title:"Schema Validation Postponed",
          message:"Schema validation postponed. You may not be able to use some features of the application.We recommend you to download the schema at the earliest. We will remind you again on next app launch.",
          icon:appIcon,
          buttons:["OK"]
        });
        getMainWindow().webContents.send("update-content");
        return false;
      }
      // user approved migration
      // copy current schemas to replica if replica not exists
      fs.copyFileSync(currentDynamicPath, replicaDynamicPath);
      fs.copyFileSync(currentSchemaPath, replicaSchemaPath);
      // Update current schemas with server schemas
      saveSchemaLocally(serverSchema,serverDynamic);

      appLogger({ 
        title: "Proceeding with migration.",
        message: "Schema changes detected, starting migration process.",
        func: "schemaValidator"
      });
      return true; // Migration needed
    }
  } catch (err) {
    appLogger({
      title: "Schema fetch report",
      message: String(err),
      func: "schemaValidator"
    });// On error, skip migration
    return false;
  }
}

// NEW updateProgressbar function with pause and cancel support
function updateProgressbar(win, value, maxVal, text = "DB migration in progress,please wait...", text2 = "", actionButtons = { usePause: false, useCancel: false, pauseToken: null, cancelToken: null, pauseBtnText: "Pause", cancelBtnText: "Cancel"}) {
  win.setProgressBar(value / maxVal, { mode: "normal" });
  console.log({msg:"updateProgressbar function"})
  // Support both old cancelObj format and new actionButtons format for backward compatibility
  if ('useCancel' in actionButtons && !('usePause' in actionButtons) && !('pauseToken' in actionButtons)) {
    // Old format - just use it as is
    win.webContents.send("execute-progressbar", Math.round(value * 100 / maxVal), { 
      text, 
      text2, 
      cancelObj: actionButtons 
    });
  } else {
    // New format with pause and cancel support
    const buttonConfig = {
      usePause: actionButtons.usePause || false,
      useCancel: actionButtons.useCancel || false,
      pauseToken: actionButtons.pauseToken,
      cancelToken: actionButtons.cancelToken,
      pauseBtnTextObj: actionButtons.pauseBtnTextObj || { pause: "Pause", resume: "Resume" },
      cancelBtnText: actionButtons.cancelBtnText || "Cancel"
    };
    
    win.webContents.send("execute-progressbar", Math.round(value * 100 / maxVal), { 
      text, 
      text2, 
      cancelObj: buttonConfig 
    });
  }
}
// dbMigrator()
// Migration is now handled by server schema updates and Sequelize sync
async function dbMigrator(){// Work in progress, check the flow before testing
  // Defining schema paths
  let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
  const replicaDynamicPath = path.resolve(appPath, "./model/dynamicSchemas_replica.json");
  const replicaSchemaPath = path.resolve(appPath, "./model/schema_replica.json");
  const currentDynamicPath = path.resolve(appPath, "./model/dynamicSchemas.json");
  let backupDBPaths = [];

  // Read and parse latest schemas
  const replicaSchemas = fs.readFileSync(replicaSchemaPath, 'utf8');
  const replicaDynamicSchemas = fs.readFileSync(replicaDynamicPath, 'utf8');
  const currentDynamicSchemas = fs.readFileSync(currentDynamicPath, 'utf8');
  let win = getMainWindow();
  appLogger({
    title:"Taking Backup",
    message:"Starting DB backup before migration.",
    func:"dbMigrator"
  });

  delete require.cache[require.resolve("./model/dbConfig")];
  const { sequelize,schemas,...models } = require("./model/dbConfig");
  let { customerLedgerSchema,supplierLedgerSchema,billItemSchema } = deserializeSchema(currentDynamicSchemas,DataTypes,UUIDV4);
  let { customerLedgerSchema:_customerLedgerSchema,supplierLedgerSchema:_supplierLedgerSchema,billItemSchema:_billItemSchema } = deserializeSchema(replicaDynamicSchemas,DataTypes,UUIDV4);
  let { supplier,freight,people,customerSchema,stockSchema,saleSchema,purchaseSchema,outPaymentSchema,inPaymentSchema,returnRegister,serviceSchema,attendanceSchema,requirementSchema,userSchema,financialRecordSchema } = deserializeSchema(replicaSchemas,DataTypes,UUIDV4);
  updateProgressbar(win,1,2,"DB migration in progress,please wait...","Taking backups")
  try{
    // Backing up main db before migration.
    fs.copyFileSync(path.resolve(appPath,"./db/bbs.db"),path.resolve(appPath,"./db/bbs_replica.db"));
    fs.copyFileSync(path.resolve(appPath,"./db/bbs.db"),path.resolve(appPath,"./db/bbs_backup.db"));
    backupDBPaths.push(path.resolve(appPath,"./db/bbs_backup.db"));
    backupDBPaths.push(path.resolve(appPath,"./db/bbs_replica.db"));
    appLogger({title:"DB Backup", message:"db copied successfully", func:"dbMigrator"});
    updateProgressbar(win,2,2,"DB migration in progress,please wait...","db copied successfully")
    let _sequelize = new Sequelize({
      dialect:"sqlite",
      storage:path.resolve(appPath,"./db/bbs_replica.db"),
      transactionType:"IMMEDIATE",
      logging:false
    });
    let _schemasMap = {
      supplier,
      freight,
      people,
      customer:customerSchema,
      stock:stockSchema,
      sale:saleSchema,
      purchase:purchaseSchema,
      outPayments:outPaymentSchema,
      inPayments:inPaymentSchema,
      returnRegister,
      service:serviceSchema,
      attendances:attendanceSchema,
      requirement:requirementSchema,
      user:userSchema,
      financial_record:financialRecordSchema
    }
    let _models = {
      supplier:_sequelize.define("supplier",supplier,{timestamps:false}),
      freight:_sequelize.define("freight",freight,{timestamps:false}),
      people:_sequelize.define("people",people,{timestamps:false}),
      customer:_sequelize.define("customer",customerSchema,{timestamps:false}),
      stock:_sequelize.define("stock",stockSchema,{timestamps:false}),
      sale:_sequelize.define("sale",saleSchema,{timestamps:false}),
      purchase:_sequelize.define("purchase",purchaseSchema,{timestamps:false}),
      outPayments:_sequelize.define("outPayments",outPaymentSchema,{timestamps:false}),
      inPayments:_sequelize.define("inPayments",inPaymentSchema,{timestamps:false}),
      returnRegister:_sequelize.define("returnRegister",returnRegister,{timestamps:false}),
      service:_sequelize.define("service",serviceSchema,{timestamps:false}),
      attendances:_sequelize.define("attendances",attendanceSchema,{timestamps:false}),
      requirement:_sequelize.define("requirement",requirementSchema,{timestamps:false}),
      user:_sequelize.define("user",userSchema,{timestamps:false}),
      financial_record:_sequelize.define("financial_record",financialRecordSchema,{timestamps:false})
    };
    await _sequelize.sync();
    appLogger({title:"DB Migration", message:"Connected to replica db", func:"dbMigrator"});
    let tables = Object.keys(schemas);
    let cust_ids = (await _models.customer.findAll({
      attributes:["id"]
    })).map(({dataValues})=>dataValues);
    let supp_ids = (await _models.supplier.findAll({
      attributes:["id"]
    })).map(({dataValues})=>dataValues);
    let _sales = (await _models.sale.findAll({attributes:[["customerId","id"],"billNo","billDate"]})).map(({dataValues})=>dataValues);
    let _purchases = (await _models.purchase.findAll({attributes:[["supplierId","id"],"billNo","billDate"]})).map(({dataValues})=>dataValues);
    let totaltables = tables.length + cust_ids.length + supp_ids.length + _sales.length + _purchases.length + 1;
    // Resetting main db
    updateProgressbar(win,0,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
    let progress = 1;
    updateProgressbar(win,progress,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
    async function helperfunc1(id,_schema,schema,mode=2){
      try{
        if(mode===1)
          return getLedgerModel(id,schema);
        let _ledgerModel = await getLedgerModel(id,_schema,_sequelize);
        let ledgerModel = await getLedgerModel(id,schema);
        await ledgerModel.sync({
          force:true,
          alter:true
        });
        if(_ledgerModel){
          let ledger = (await (await _ledgerModel.sync()).findAll()).map?.(({dataValues})=>dataValues);
          if(!(ledger instanceof Array)) return;
          Object.keys(_schema).forEach(key=>{
            if(!(key in schema)){
              ledger.forEach(obj=>delete obj[key]);
            }
          });
          await ledgerModel.bulkCreate(ledger,{returning:true});
          return
        }
      }
      catch(err){
        console.log({err,line:2830});
        return;
      }
    }
    async function helperfunc2(id,billNo,billDate,_schema,schema,mode=2){
      try{
        if(mode===1)
          return getBillModel(id,billNo,billDate,schema);
        billDate = billDate.toISOString().split("T")[0];
        let _billModel = await getBillModel(id,billNo,billDate,_schema,_sequelize);
        await _billModel.sync();
        let _itemList = (await _billModel.findAll()).map(({dataValues})=>dataValues);
        let billModel = await getBillModel(id,billNo,billDate,schema);
        await billModel.sync({
          force:true,
          alter:true
        });
        if(!(_itemList instanceof Array)) return;
        Object.keys(_schema).forEach(key=>{
          if(!(key in schema)){
            _itemList.forEach(obj=>delete obj[key]);
          }
        });
        await (await billModel.sync()).bulkCreate(_itemList,{returning:true});
        return
      }
      catch(err){
        console.log({err,line:"helperfunc2 catch block",cond:schema===billItemSchema});
        return;
      }
    }
    appLogger({title:"DB Migration", message:"Dynamic model definition in progress", func:"dbMigrator"})
    await Promise.allSettled([
      ...[cust_ids]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          let {id} = arr[i];
          await helperfunc1(id,_customerLedgerSchema,customerLedgerSchema,1);
        }
        return
      }),
      ...[supp_ids]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          let {id} = arr[i];
          await helperfunc1(id,_supplierLedgerSchema,supplierLedgerSchema,1);
        }
        return
      }),
      ...[_sales,_purchases]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          let { id,billNo,billDate } = arr[i];
          await (await helperfunc2(id,billNo,billDate,_billItemSchema,billItemSchema,1)).sync({
            force:true,
            alter:true
          });
        }
        return;
      })
    ]);
    appLogger({title:"DB Migration", message:"Models defined", func:"dbMigrator"});
    appLogger({title:"DB Migration", message:"Applying schema changes to tables.", func:"dbMigrator"});
    await sequelize.sync({
      force:true,
      alter:true
    })
    .catch(err=>appLogger({ title:"Sequelize Sync Error", message:String(err), func:"dbMigrator" }));
    appLogger({title:"DB Migration", message:"sequelize sync done", func:"dbMigrator"});
    for (let i=0;i<tables.length;i++){
      let table = tables[i];
      if(table==="customers" || table=="customer")
        table = "customer";
      try{
        let data = (await _models[table]?.findAll())?.map(({dataValues})=>dataValues);
        if(data){
          // This block written for reverse migration compatibility, data will be lost
          // Testing needed: Working on reverse migration
          Object.keys(_schemasMap[table]).forEach(key=>{
            table = table==="customer" ? "customers" : table;
            if(!(key in schemas[table])){
              data.forEach(obj=>delete obj[key]);
            }
            table = table==="customers" ? "customer" : table;
          });
          await models[table].bulkCreate(data,{returning:true});
        }
      }
      catch(err){
        appLogger({
          title:"Error migrating table "+table,
          message:String(err),
          func:"dbMigrator"
        });
      } finally{
        updateProgressbar(win,++progress,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
      }
    }
    Promise.allSettled([
      ...[cust_ids]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          try {
            let {id} = arr[i];
            await helperfunc1(id,_customerLedgerSchema,customerLedgerSchema);
          } catch (err) {
            appLogger({
              title:"Error migrating customer ledger",
              message:String(err),
              func:"dbMigrator"
            }); 
          } finally {
            updateProgressbar(win,++progress,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
          }
        }
        return
      }),
      ...[supp_ids]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          try {
            let {id} = arr[i];
            await helperfunc1(id,_supplierLedgerSchema,supplierLedgerSchema);
          } catch (err) {
            appLogger({
              title:"Error migrating supplier ledger",
              message:String(err),
              func:"dbMigrator"
            });
          } finally {
            updateProgressbar(win,++progress,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
          }
        }
        return
      }),
      ...[_sales,_purchases]
      .map(async (arr)=>{
        for(let i=0;i<arr.length;i++){
          try {
            let { id,billNo,billDate } = arr[i];
            await helperfunc2(id,billNo,billDate,_billItemSchema,billItemSchema);
          } catch (err) {
            appLogger({
              title:"Error migrating bill items",
              message:String(err),
              func:"dbMigrator"
            });
          } finally{
            updateProgressbar(win,++progress,totaltables,"DB migration in progress,please wait...","Implementing schema changes to tables.");
          }
        }
        return;
      })
    ])
    .then(async ()=>{
      process.appStatus = "normal";
      win.setProgressBar(-1);
      
      // Backup current schema_replica.json to versioned backup folder before overwriting
      appLogger({
        title:"DB Migration Status",
        message:"Backing up old schema replicas",
        func:"dbMigrator"
      })
      
      try{
        // Create version-specific directory
        // Create schemaDir in backup folder if not exists and backup replica schemas for rollback
        let { extractVersion } = require("./model/schemaLoader");
        let schemaVersion = extractVersion(replicaSchemas);
        let schemaBackupDir = path.resolve(appPath,"./Backup/schemas/"+schemaVersion);
        if(!fs.existsSync(schemaBackupDir))
          fs.mkdirSync(schemaBackupDir,{ recursive: true });
        // Backup schema_replica.json
        fs.copyFileSync(
          replicaSchemaPath,
          path.resolve(schemaBackupDir,"schema_replica.json")
        );
        appLogger({
          title:"Schema Backup",
          message:`Backed up schema v${schemaVersion} to Backup/schemas/v${schemaVersion}/ for rollback`,
          func:"dbMigrator"
        });
        
        // Backup dynamicSchemas_replica.json if it exists (OLD schema before migration)
        let replicaDynamicPath = path.resolve(appPath,"./model/dynamicSchemas_replica.json");
        if(fs.existsSync(replicaDynamicPath)){
          fs.copyFileSync(
            replicaDynamicPath,
            path.resolve(schemaBackupDir,"dynamicSchemas_replica.json")
          );
          appLogger({
            title:"Schema Backup",
            message:`Backed up dynamicSchemas v${schemaVersion}`,
            func:"dbMigrator"
          });
        }
      }
      catch(err){
        appLogger({
          title:"Schema Backup Error",
          message:String(err),
          func:"Schema backup during migration"
        });
      }
      appLogger({
        title:"-----------DB Migration Complete------------",
        message:"Terminating all ipcs and db connections to relaunch app.",
        func:"dbMigrator"
      });
      try {
        ipcMain.eventNames().forEach(event=>{
          ipcMain.removeAllListeners(event);
        });
        //Terminate db connections
        await sequelize.close();
        await _sequelize.close();
        //Delete replica and backup db files
        appLogger({
          title:"Cleaning up",
          message:"Cleaning up backup and replica db files",
          func:"dbMigrator"
        });
        backupDBPaths.forEach(dbPath=>{
          if(fs.existsSync(dbPath))
            fs.unlinkSync(dbPath);
        });
        appLogger({
          title:"App Relaunch",
          message:"Relaunching app in 3 seconds...",
          func:"dbMigrator"
        });
        setTimeout(()=>{
          app.relaunch();
          // clean exit
          app.exit(0);
        },3000);
      } catch (error) {
        appLogger({
          title:"Error during app relaunch",
          message:String(error),
          func:"dbMigrator"
        });
      }
      //Terminate all ipc and relaunch app
    })
  }
  catch(err){
    appLogger({
      title:"Error",
      message:err || String(err),
      func:"line 2765"
    });
  }
}

ipcMain.handle("get-app-status",()=>{
  return process.appStatus;
});

ipcMain.on("set-app-status",(_,status)=>{
  process.appStatus = status;
})

ipcMain.on("log",(e,msg)=>{
  appLogger(typeof msg === 'object' && msg !== null ? msg : {title:"Log", message:msg, func:"log"});
});

ipcMain.on("new-bill",async (e,customerObj)=>{
  if (!["all", "admin", "bill"].includes(currentUser.role)) return;
  Menu.getApplicationMenu().items[1].submenu.items[0].click(); 
  process.presets = {
    ...process.presets,
    customer:customerObj,
    target:"salePage",
    currentStep:2,
    finYear:0,
    flag:"new-bill"
  };
});

ipcMain.on("edit-bill",async (e,customerId,itemList,entryNo)=>{
  if(!["all", "admin", "bill"].includes(currentUser.role)) return;
  let saleObj = (await sale.findOne({
    where:{
      entryNo
    }
  }))?.dataValues;
  let customerObj = (await customer.findOne({
    where:{
      id:customerId
    }
  }))?.dataValues;
  // Menu.getApplicationMenu().items[1].submenu.items[0].click(); 
  saleWindow()("salePage","edit-bill",{
    customer:customerObj,
    billMeta:saleObj,
    orderItems:itemList,
    currentStep:3,
  });
});

ipcMain.on("msg-from-frontend",(e,msg)=>{
  console.log({
    title:"Message from Frontend",
    message:msg
  })
})

ipcMain.handle("get-presets",()=>{
  return process.presets;
});

// ---- Weather theme state IPC (called by every renderer page on startup) ----
ipcMain.handle("get-weather-theme-state", () => {
  if (!process.presets?.useWeatherTheme) return null;
  const vm = require("./viewManager");
  const theme = vm.lastTheme;
  if (!theme) return null;
  return {
    theme,
    classList: vm.buildThemeClass(theme).split(" "),
    weatherColors: vm.getWeatherColors(theme)
  };
});

// ---- Help Viewer ----
let cachedServerHelp = null; // session cache — fetched once per launch

async function fetchServerHelp() {
    if (cachedServerHelp !== null) return cachedServerHelp;
    const serverUrl = process.env.UPDATE_REST;
    if (!serverUrl) { cachedServerHelp = ""; return ""; }
    try {
        const resp = await axios.get(`${serverUrl}api/help-content`, {
            timeout: 4000,
            params: { deviceId: global.deviceUUID, gstNumber: process.presets?.gst }
        });
        cachedServerHelp = resp.data?.content || "";
    } catch (_) {
        cachedServerHelp = ""; // server unreachable — not an error
    }
    return cachedServerHelp;
}

ipcMain.handle("get-help-content", async () => {
  const helpPath = path.resolve(__dirname, "HELP.md");
  let content = fs.readFileSync(helpPath, "utf8");
  const role = global.user?.role || "admin";

  // Merge server-served help (cloud services, pricing, BBS Connect, etc.)
  const serverContent = await fetchServerHelp();
  if (serverContent) {
      content += "\n\n---\n\n" + serverContent;
  }

  return { content, role };
});
ipcMain.on("close-help-window", (e) => {
  const win = BrowserWindow.fromId(e.frameId);
  if (win) win.close();
});

// ---- Kiosk Mode ----
const { start: kioskStart, stop: kioskStop, getStatus: kioskStatus, ENABLED: KIOSK_ENABLED } = require("./kioskServer");

/**
 * Resolves the path to the kiosk configuration file (kioskConf.json).
 * In DEV mode: relative to the project root's config/ directory.
 * In PROD mode: relative to the app's AppData/BBS/config/ directory.
 * @returns {string} Absolute path to kioskConf.json
 */
function getKioskConfigPath() {
  if (process.env.APP_ENV === "DEV") {
    return path.resolve(__dirname, "config", "kioskConf.json");
  }
  return path.resolve(app.getPath("appData"), "BBS", "config", "kioskConf.json");
}

/**
 * Loads the kiosk configuration from disk.
 * @returns {object|null} Parsed kiosk config object, or null if the file doesn't exist
 */
function loadKioskConfig() {
  const configPath = getKioskConfigPath();
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath).toString());
  }
  return null;
}

// ---- Kiosk Config IPC Handlers ----

/**
 * Generates a WiFi Setup Guide PDF using pdfkit.
 * Reads setup instructions from a text data file and renders them as a formatted PDF.
 * The PDF is saved to the user's Documents folder and the file path is returned.
 */
ipcMain.handle("generate-wifi-setup-pdf", async () => {
  const PDFDocument = require("pdfkit");
  const guidePath = path.resolve(__dirname, "template", "data", "wifiSetupGuide.txt");

  // Read the guide text from the data file
  let guideText = "";
  try {
    guideText = fs.readFileSync(guidePath, "utf8");
  } catch (err) {
    appLogger({ title: "WiFi Guide PDF", message: "Failed to read guide text: " + String(err), func: "generate-wifi-setup-pdf" });
    return { success: false, error: "Guide data file not found." };
  }

  // Determine output directory — save to Documents/BBS/
  const documentsDir = app.getPath("documents");
  const bbsDir = path.join(documentsDir, "BBS");
  if (!fs.existsSync(bbsDir)) {
    fs.mkdirSync(bbsDir, { recursive: true });
  }
  const pdfPath = path.join(bbsDir, "BBS_Kiosk_WiFi_Setup_Guide.pdf");

  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: {
          Title: "BBS Kiosk — WiFi Setup Guide",
          Author: "BBS",
          Subject: "Kiosk WiFi Configuration Instructions"
        }
      });

      const writeStream = fs.createWriteStream(pdfPath);
      doc.pipe(writeStream);

      // ---- Title Page Header ----
      doc.fontSize(22).font("Helvetica-Bold").text("BBS KIOSK — WiFi SETUP GUIDE", {
        align: "center"
      });
      doc.moveDown(0.5);

      // Decorative line
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.moveTo(doc.page.margins.left, doc.y)
         .lineTo(doc.page.margins.left + pageWidth, doc.y)
         .strokeColor("#663399")
         .lineWidth(2)
         .stroke();
      doc.moveDown(1);

      // ---- Render the guide text line by line ----
      const lines = guideText.split("\n");
      doc.fontSize(11).font("Helvetica");

      lines.forEach((line) => {
        // Check if we're near the bottom of the page — add a new page if needed
        if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
          doc.addPage();
          doc.fontSize(11).font("Helvetica");
        }

        // Render section headers (lines ending with all-caps or separator lines)
        if (/^[A-Z][A-Z \-\—]+$/.test(line.trim()) && line.trim().length > 3) {
          doc.moveDown(0.5);
          doc.fontSize(13).font("Helvetica-Bold")
             .fillColor("#663399")
             .text(line.trim(), { continued: false });
          doc.fillColor("#000");
          doc.fontSize(11).font("Helvetica");
          doc.moveDown(0.2);
        } else if (/^-{3,}$/.test(line.trim())) {
          // Separator line
          doc.moveDown(0.3);
          doc.moveTo(doc.page.margins.left, doc.y)
             .lineTo(doc.page.margins.left + pageWidth, doc.y)
             .strokeColor("#ccc")
             .lineWidth(0.5)
             .stroke();
          doc.moveDown(0.3);
        } else if (line.trim() === "") {
          // Blank line — small vertical space
          doc.moveDown(0.3);
        } else {
          // Regular text line
          doc.fontSize(10).font("Helvetica")
             .text(line, {
               continued: false,
               lineGap: 2
             });
        }
      });

      // ---- Footer on each page ----
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).font("Helvetica")
           .fillColor("#999")
           .text(
             "Generated by BBS Kiosk Setup Wizard | " + new Date().toLocaleDateString(),
             doc.page.margins.left,
             doc.page.height - doc.page.margins.bottom - 20,
             { align: "center", width: pageWidth }
           );
        doc.fillColor("#000");
      }

      doc.end();

      writeStream.on("finish", () => {
        appLogger({
          title: "WiFi Guide PDF",
          message: "PDF generated at: " + pdfPath,
          func: "generate-wifi-setup-pdf"
        });
        resolve({ success: true, path: pdfPath });
      });

      writeStream.on("error", (err) => {
        appLogger({
          title: "WiFi Guide PDF Error",
          message: String(err),
          func: "generate-wifi-setup-pdf"
        });
        resolve({ success: false, error: String(err) });
      });
    } catch (err) {
      appLogger({
        title: "WiFi Guide PDF Error",
        message: String(err),
        func: "generate-wifi-setup-pdf"
      });
      resolve({ success: false, error: String(err) });
    }
  });
});

ipcMain.handle("get-local-ip", () => {
  const os = require("os");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
});

ipcMain.handle("save-kiosk-config", (e, config) => {
  const configPath = getKioskConfigPath();
  // Ensure the config directory exists (for first-time setup in DEV mode)
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  appLogger({ title: "Kiosk Config", message: "Kiosk configuration saved.", func: "save-kiosk-config" });
  return true;
});

ipcMain.handle("check-kiosk-config", () => {
  return fs.existsSync(getKioskConfigPath());
});

// ---- Kiosk Status & Control ----

ipcMain.handle("get-kiosk-status", () => {
  if (!KIOSK_ENABLED) return { running: false, disabled: true };
  return kioskStatus();
});

ipcMain.handle("toggle-kiosk-server", async () => {
  if (!KIOSK_ENABLED) return { running: false, disabled: true };
  const status = kioskStatus();
  if (status.running) {
    await kioskStop();
  } else {
    // Check if kiosk config exists before starting
    const configPath = getKioskConfigPath();
    if (!fs.existsSync(configPath)) {
      // No config yet — open the setup wizard instead of starting
      createModal(
        { width: 560, height: 620, resizable: false, parent: getMainWindow() },
        getTemplatePath("kioskSetupWizard"),
        { label: "Kiosk-Setup" }
      );
      return kioskStatus(); // server is not running yet
    }
    const config = loadKioskConfig();
    const pin = config?.pin || process.presets?.kioskPIN || "1234";
    const port = config?.port || 3030;
    await kioskStart(port, pin, config);
  }
  return kioskStatus();
});

ipcMain.handle("get-kiosk-info", () => {
  if (!KIOSK_ENABLED) return { running: false, disabled: true };
  const status = kioskStatus();
  const config = loadKioskConfig();
  return { ...status, pin: config?.pin || process.presets?.kioskPIN || "1234" };
});

ipcMain.on("toggle-kiosk-from-modal", async (e, action) => {
  if(action === "stop") await kioskStop();
  const mainWin = getMainWindow();
  if(mainWin) mainWin.webContents.send("kiosk-status-update", kioskStatus());
});

/**
 * Opens the kiosk setup wizard window.
 * Used when no kioskConf.json exists or when the user needs to reconfigure.
 */
function openKioskSetupWizard() {
  createModal(
    { width: 560, height: 620, resizable: false, parent: getMainWindow() },
    getTemplatePath("kioskSetupWizard"),
    { label: "Kiosk-Setup" }
  );
}

/**
 * Starts the kiosk server and opens the QR code modal.
 * Loads configuration from kioskConf.json for PIN and other settings.
 */
async function startKioskWithConfig() {
  const config = loadKioskConfig();
  const pin = config?.pin || "1234";
  const port = config?.port || 3030;
  const result = await kioskStart(port, pin, config);
  if (result.success) {
    // Open the QR code modal
    createModal(
      { width: 400, height: 520, resizable: false, parent: getMainWindow() },
      getTemplatePath("kioskModal"),
      { label: "Kiosk" }
    );
    // Update status button in mainPage
    const mainWin = getMainWindow();
    if (mainWin) mainWin.webContents.send("kiosk-status-update", kioskStatus());
  } else {
    dialog.showErrorBox("Kiosk Error", result.error || "Failed to start kiosk server");
  }
}

ipcMain.on("open-kiosk", async () => {
  const status = kioskStatus();
  if (status.running) {
    // Already running — just show the QR modal
    createModal(
      { width: 400, height: 520, resizable: false, parent: getMainWindow() },
      getTemplatePath("kioskModal"),
      { label: "Kiosk" }
    );
    return;
  }
  // Check for kiosk config before starting
  if (!fs.existsSync(getKioskConfigPath())) {
    // No config yet — launch the setup wizard
    openKioskSetupWizard();
    return;
  }
  await startKioskWithConfig();
});

/**
 * IPC handler called by the setup wizard after the user completes configuration.
 * Saves the config and starts the kiosk server.
 */
ipcMain.on("start-kiosk-after-setup", async () => {
  await startKioskWithConfig();
});

// ---- Kiosk Sale Processing ----

ipcMain.on("kiosk-create-sale", async (e, saleData) => {
  // Ensure process.presets is initialized (save_exit accesses it)
  if (typeof process.presets === "undefined") process.presets = {};

  // Load kiosk configuration to determine processing mode
  const config = loadKioskConfig();
  const { customerId, customerName, items, payment = 0 } = saleData;

  if (!items || !items.length) {
    appLogger({ title: "Kiosk Sale Error", message: "No items in cart", func: "kiosk-create-sale" });
    return;
  }

  // ---- Build customer object (matches save_exit's expected shape) ----
  // The kiosk /api/customers endpoint returns limited fields; email is fetched from DB here
  let customerObj = {
    id: customerId || "",
    name: customerName || "Walk-in Customer",
    address: "",
    phones: [],
    gst: "",
    email: ""
  };

  if (customerId) {
    // Fetch full customer record from DB to get email and other details
    try {
      const custRecord = await customer.findOne({ where: { id: customerId } });
      if (custRecord) {
        customerObj = {
          id: custRecord.id,
          name: custRecord.name,
          address: custRecord.address || "",
          phones: JSON.parse(custRecord.phones || "[]"),
          gst: custRecord.gst || "",
          email: (custRecord.moreInfo || {}).email || ""
        };
      }
    } catch (err) {
      appLogger({ title: "Kiosk Sale", message: "Customer lookup failed: " + String(err), func: "kiosk-create-sale" });
    }
  } else {
    // Anonymous walk-in sale — generate a stable ID for the walk-in customer
    customerObj.id = uuid.v5("walk-in-" + Date.now(), "6ba7b814-9dad-11d1-80b4-00c04fd430c8");
  }

  // ---- Map kiosk cart items to orderItems format (matches helperFunc1's expected shape) ----
  // Each order item needs: id, name, hsn, qty, sellUnit, rate, amt, cgst, sgst, igst, type, sellId, desc, pHistory
  const orderItems = items.map((item, idx) => ({
    id: item.id || "",
    name: item.name,
    hsn: item.hsn || "",
    qty: item.qty,
    sellUnit: item.unit || "pcs",         // kiosk's "unit" maps to sale handler's "sellUnit"
    rate: item.rate,
    amt: item.qty * item.rate,
    cgst: item.sgst || 0,                 // kiosk uses sgst symmetrically for both CGST and SGST
    sgst: item.sgst || 0,
    igst: item.igst || 0,
    type: "goods",                        // default to physical goods
    sellId: "kiosk-" + Date.now() + "-" + idx,  // unique per-row identifier
    desc: "",
    pHistory: []
  }));

  // ---- Calculate bill totals ----
  const netAmt = Math.round(orderItems.reduce((sum, it) => sum + it.amt, 0));
  const netTax = Math.round(orderItems.reduce((sum, it) => {
    const taxRate = it.igst > 0 ? it.igst : (it.cgst + it.sgst);
    return sum + (it.amt * taxRate / 100);
  }, 0));
  const netAmtTax = netAmt + netTax;
  const netPayment = Math.round(payment);
  const paymentStatus = netPayment >= netAmtTax;

  // ---- Build billMeta (matching save_exit's expected shape) ----
  const kioskSessionId = "kiosk-" + Date.now();
  const billNo = getBillManager().allocate(kioskSessionId);
  const billMeta = {
    billStatus: "closed",
    deliveryType: "hand",                 // kiosk sales are always hand-delivery (walk-in)
    billNo: String(billNo),
    billDate: new Date(),
    netAmt: netAmt,
    netTax: netTax,
    netAmtTax: netAmtTax,
    netDue: netAmtTax - netPayment,
    payment: netPayment > 0 ? [{ payment: netPayment }] : [],
    paymentStatus: paymentStatus,
    billType: "regular",
    autoBill: true,
    printObj: {
      captions: [{ first: "Original Kiosk Copy" }]
    },
    shipTo: customerObj.name,
    shipAddr: customerObj.address || "",
    shipPh: Array.isArray(customerObj.phones) && customerObj.phones.length > 0 ? customerObj.phones[0] : "",
    shipGST: customerObj.gst || "",
    discVal: 0,
    netQty: orderItems.reduce((sum, it) => sum + it.qty, 0)
  };

  // Synthetic event object for ipcMain.emit — save_exit uses e.sender.id for window lookup
  // With flag="order-billed", window.close() is skipped, so a null sender ID is safe
  const syntheticEvent = { sender: { id: null } };

  try {
    if (config && config.dbMode === "auto-bill") {
      // ---- Auto-Bill Mode: Reuse the existing save_exit handler ----
      // This does full processing: stock deduction, bill creation, ledger update, PDF generation
      ipcMain.emit("save-exit-sale-bill", syntheticEvent, {
        billMeta: billMeta,
        customer: customerObj,
        orderItems: orderItems,
        orderId: ""
      }, "order-billed");

      // Consume the reserved bill number now that the sale is saved
      getBillManager().consume(kioskSessionId,billNo);

      appLogger({
        title: "Kiosk Sale",
        message: "Auto-bill sale processed: " + customerObj.name + " — " + orderItems.length + " items, ₹" + netAmtTax,
        func: "kiosk-create-sale"
      });
    } else {
      // ---- Order-Only Mode: Reuse the existing new-order handler ----
      // This saves the sale to orders.json without stock deduction or bill generation
      const orderBillMeta = {
        name: customerObj.name,
        address: customerObj.address || "",
        gst: customerObj.gst || "",
        email: customerObj.email || "",
        phones: customerObj.phones,
        orderItems: orderItems,
        netAmtTax: netAmtTax,
        netDue: netAmtTax - netPayment,
        paymentStatus: paymentStatus,
        netPayment: netPayment
      };

      ipcMain.emit("new-order", syntheticEvent, {
        billMeta: orderBillMeta,
        mode: "regular"
      });

      // Consume the reserved bill number
      getBillManager().release(kioskSessionId);

      appLogger({
        title: "Kiosk Sale",
        message: "Order-only sale queued: " + customerObj.name + " — " + orderItems.length + " items, ₹" + netAmtTax,
        func: "kiosk-create-sale"
      });
    }
  } catch (err) {
    appLogger({
      title: "Kiosk Sale Error",
      message: String(err),
      func: "kiosk-create-sale"
    });
  }

  // Broadcast updated status to the main window
  const mainWin = getMainWindow();
  if (mainWin) mainWin.webContents.send("kiosk-status-update", kioskStatus());
});
ipcMain.on("open-help", () => openHelpWindow());

function openHelpWindow(mainWindow) {
  const helpWin = createModal(
    { width: 800, height: 600 },
    getTemplatePath("helpViewer"),
    { maxWinCount: 1, label: "Help" }
  );
  return helpWin;
}

ipcMain.on("booted",async (e)=>{
  // Re-apply weather theme AFTER the renderer's applyTheme (common.js) has run
  reapplyTheme(getMainWindow());
  let stockList = await queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
  //standardSellPrice
  //pInfo : {}
  // let products = stockList.filter(obj=>(
  //     !("skipFlag" in obj.pInfo) &&
  //     (obj.standardSellPrice===0 || 
  //     !("taxSlab" in obj.pInfo))
  //   ));
  // if(products.length>0){
  //   dialog.showMessageBox({
  //     title:"Product attributes found missing",
  //     message:"Some of your item has missing attributes like GST rate. Would you like to fill them up now?",
  //     buttons:["Sure","Later"],
  //     noLink:true,
  //     icon:appIcon
  //   }).then(({response})=>{
  //     if(response===1) return;
  //     // else show popup to fill in neccessary product information.
  //     e.sender.send("product-info-fillup-modal",products);
  //   })
  // }
});

ipcMain.on("open-bills-folder",()=>{
  // Open Bills folder (__Bills in DEV mode)
  let billsDir = getBillsDir();
  if (!fs.existsSync(billsDir)) fs.mkdirSync(billsDir, { recursive: true });
  shell.openExternal(billsDir);
});

ipcMain.handle("get-place-of-jurisdiction",async (e,address)=>{
  return await placeOfJurisdiction({address});
});

// ---- Update welcome + feature tour (driven by update.md) ----

/** Parse update.md into { version, welcome, highlights, tourStops } */
function parseUpdateMD(md) {
  var result = { version: "", welcome: "", highlights: [], tourStops: [] };
  if (!md) return result;

  var section = null;
  var lines = md.split(/\r?\n/);
  var welcomeLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // Version header
    var vMatch = line.match(/^#\s*version:\s*(.+)/i);
    if (vMatch) { result.version = vMatch[1].trim(); continue; }

    // Section headers
    if (/^##\s+welcome/i.test(line)) { section = "welcome"; continue; }
    if (/^##\s+tour/i.test(line)) { section = "tour"; continue; }

    if (section === "welcome") {
      welcomeLines.push(line);
    } else if (section === "tour") {
      // Format: selector :: message
      var tMatch = line.match(/^(.+?)\s*::\s*(.+)/);
      if (tMatch) {
        result.tourStops.push({ selector: tMatch[1].trim(), msg: tMatch[2].trim() });
      }
    }
  }

  result.welcome = welcomeLines.filter(function(l) { return l !== ""; }).join("\n");
  return result;
}

ipcMain.handle("get-update-content", () => {
  try {
    var mdPath = path.resolve(__dirname, "update.md");
    if (!fs.existsSync(mdPath)) return { version: "", welcome: "", tourStops: [] };

    var md = fs.readFileSync(mdPath, "utf-8");
    var content = parseUpdateMD(md);
    if (!content.version) return { version: "", welcome: "", tourStops: [] };

    // Check if this version was already shown
    var p = path.resolve(app.getPath("appData"), "BBS", "updtConf.json");
    var conf = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p).toString()) : {};
    if (conf.updateSeenVersion === content.version)
      return { version: content.version, welcome: "", tourStops: [] }; // already seen

    return content;
  } catch (_) { return { version: "", welcome: "", tourStops: [] }; }
});

ipcMain.on("set-update-seen", () => {
  try {
    var mdPath = path.resolve(__dirname, "update.md");
    if (!fs.existsSync(mdPath)) return;
    var md = fs.readFileSync(mdPath, "utf-8");
    var content = parseUpdateMD(md);
    if (!content.version) return;

    var p = path.resolve(app.getPath("appData"), "BBS", "updtConf.json");
    var conf = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p).toString()) : {};
    conf.updateSeenVersion = content.version;
    fs.writeFileSync(p, JSON.stringify(conf, null, 2));
  } catch (_) { /* non-critical */ }
});

ipcMain.on("init-ngram-index",(e,nGramIndex)=>{
  global.nGramIndex = nGramIndex;
});

// Serve the pre-built n-gram index to renderer windows so they can skip
// the expensive trigram-calculation loop in appendToDL.
ipcMain.handle("get-ngram-index",()=> global.nGramIndex || {});