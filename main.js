global.shouldWait = true;
require("dotenv").config({path:__dirname+"/.env"});
const {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  dialog,
  screen,
  MenuItem,
  session,
  nativeTheme,
  autoUpdater,
  crashReporter,
  powerMonitor,
  Notification,
  shell
} = require("electron");
const {
  billNoCounter,
  getLastBillNo,
  loggerFH,
  getLoggerFD,
  User,
  customEncoder,
  customDecoder,
  appLogger,
  getBillModel,
  getLedgerModel,
  getBaseDir,
  print,
  openFormatForDate,
} = require("./common");
const { getAppPolicyPath,getsaleConfigPolicyPath,getUserPolicyPath, getOrderPath, getSchedulerPath,deepCompareJSON } = require("./template/js/common");
const fs = require("fs");
const path = require("path");
const readLine = require("readline");
let {
  createModal,
  getTargetWindow,
  getMainWindow,
} = require("./createModal");
const {
  attendances,
  people,
  stock,
  sale,
  sequelize,
  purchase,
  user,
  schemas,
  finData,
  customer,
  supplier
} = require("./model/dbConfig");
const winManager = require("electron-window-state");
const { Op, Sequelize, UUIDV4 } = require("sequelize");
const dynamicSchemas = require("./model/dynamicSchemas");
const bcrypt = require("bcrypt");
const uuid = require("uuid");
const speakeasy = require("speakeasy");
const axios = require("axios");
const { spawn } = require("child_process");
const { printOnLinuxOrMac,printOnWindows, printDialog } = require("./printHandler");
const { billPDF, ledgerPDF } = require("./scripts/makePDF.default");
const { orderManager } = require("./saleHandler");
const AdmZip = require("adm-zip");
const { queryStock } = require("./handleStock");

const { billItemSchema,customerLedgerSchema,supplierLedgerSchema } = dynamicSchemas;
let closeFlag = false,
  windowOptions = {
    width: 600,
    height: 400,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      devTools: true,
    },
    show: false,
    contextIsolation: true,
  },
  currentUser,
  totpTimer,
  linuxThemeWatchTimer,
  firstBoot = false,
  dbInitialized = false,
  unsavedUsers = [],jobs = [], orderStages = ["queued","ready-to-dispatch","dispatched","delivered"],
  idleLockTimer,appLocked = true;
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

async function createWindow() {
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
    title: "BBSv2.0.0",
  };
  windowOptions.resizable = true;
  windowOptions.maximizable = true;
  if (process.platform === "linux") {
    
  }
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
      if (_user && cookieObj.expirationDate > Date.now()) {
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
        autoPrintMonthlyBills();
        let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
        if("lockOnIdle" in policy && policy.lockOnIdle){
          clearInterval(idleLockTimer);
          idleLockTimer = setInterval(lockOnIdle.bind({idleTime:policy.idleTime}),5000);
        }
      }
    }
    firstBoot = true;
    // const mainWindow = createModal(
    //   windowOptions,
    //   `./template/html/firstBoot.html`,
    //   { maxWinCount: 1, label: "Main",show:true,
    //     cb:function(){
    //       this.webContents.send("first-launch");
    //     } 
    //   }
    // );
    process.appStatus = "normal";
    const mainWindow = createModal(
      windowOptions,
      `./template/html/${fileName}.html`,
      { maxWinCount: 1, label: "Main" }
    );
    let strtMsg = process.argv.find(str=>str.startsWith("msg="));
    if(strtMsg && typeof strtMsg==="string")
      mainWindow.once("focus",()=>{
        strtMsg=strtMsg.split("=").pop();
        dialog.showMessageBox({
          title:"Info",
          message:strtMsg,
          buttons:["Ok"]
        });
        spawn("rm -r ~/.config/BBS/*.deb",{
          shell:true,
          stdio:["pipe","pipe","pipe"]
        }).stdio.every(stream=>{
          stream.on("data",(data)=>{
            appLogger({
              message:data,
              title:"STDIO"
            })
          });
        })
      });
    // Removing replica DB when it served it purpose.    
    let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS") : __dirname;
    try{
      if(schemaValidator()===false && fs.existsSync(path.resolve(appPath,"./db/bbs_replica.db")))
        fs.unlinkSync(path.resolve(appPath,"./db/bbs_replica.db"));
      let files = fs.readdirSync(path.resolve(app.getPath("documents"),"./Bills/"))
      files.filter(file=>/_temp/.test(file))
      .forEach(file=>{
        fs.unlinkSync(path.resolve(app.getPath("documents"),"./Bills/"+file))
      })
    }
    catch(err){
      appLogger({
        title:"Error",
        message:String(err),
        func:"Deletion of replica db"
      })
    }
    globalShortcut.unregister("CommandOrControl+Tab+Up");
    globalShortcut.unregister("CommandOrControl+F4");
    if(process.env.APP_ENV==="DEV" && schemaValidator()===true){
      mainWindow.setProgressBar(0,{mode:"normal"});
      mainWindow.webContents.send("execute-progressbar",0);
      process.appStatus = "db-migration";
      await dbMigrator();
    }
    if(process.env.APP_ENV==="PROD"){
      try{
        if(fs.existsSync(app.getPath("appData")+"/BBS/updtConf.json")){
          let updateConf = JSON.parse((fs.readFileSync(app.getPath("appData")+"/BBS/updtConf.json")).toString());
          let resp = versionChecker(updateConf.currentVersion,updateConf.versionDownloaded);
          if(resp>0){
            appLogger({
              title:"DB Migration initiation",
              message:"Copying schema files"
            });
            [
              {ext:"./",file:"schema.js"},
              {ext:"./",file:"schema_replica.js"},
              {ext:"./",file:"dbConf.json"},
              {ext:"./model/",file:"dynamicSchemas.js"},
              {ext:"./model/",file:"dynamicSchemas_replica.js"},
              {ext:"./model/",file:"dbConfig_replica.js"}
            ]
            .forEach(({file,ext})=>{
                fs.copyFileSync(path.resolve(__dirname,ext,`./${file}`),path.resolve(appPath,"./model/"+file),"a+");
            });
            appLogger({
              title:"DB Migration status",
              message:"Copy successful and updating updtConf.json file"
            })
            updateConf.currentUser = app.getVersion();
            fs.writeFileSync(app.getPath("appData")+"/BBS/updtConf.json",JSON.stringify(updateConf));
          }
          appLogger({
            title:"DB Migration status",
            message:{
              schemaValidator:schemaValidator()
            }
          });
          if(schemaValidator()===true){
            if(!fs.existsSync(path.resolve(appPath,"./model/")))
              fs.mkdirSync(path.resolve(appPath,"./model"));
            mainWindow.setProgressBar(0,{mode:"normal"});
            mainWindow.webContents.send("execute-progressbar",0);
            await dbMigrator();
          }
        }
      }
      catch(err){
        appLogger({
          title:"Schema Validation Error",
          message:String(err)
        });
      }
    }
    mainWindow.maximize();
    winState.manage(mainWindow);
    return bootCommon(mainWindow)
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
        `./template/html/firstBoot.html`,
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
      appLogger({message:"Database initialized."});
      dbInitialized = true;
      mainWindow.webContents.send("Database initialized");
      if(fs.existsSync(app.getPath("appData")+"/temp.json")){
        let pageWiseData = JSON.parse(fs.readFileSync(app.getPath("appData")+"/temp.json").toString());
        appLogger({
          title:"Restoring initial Data",
          data:JSON.stringify(pageWiseData)
        });
      }
      if(unsavedUsers.length>0){
        appLogger({
          title:"Message",
          message:"Saving unsaved users."
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
            message:"Users saved"
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
    else
      appLogger({
        title:"Error",
        message:String(err),
        func:"Trying to login error"
      });
  }
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

// app.whenReady().then(createWindow);

app.on("quit", async () => {
  try{
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
  let fds = getLoggerFD();
  appLogger({title:"Log FDs",message:fds});
  if(fds.length>0)
    fds.forEach((fd) => {
      if(typeof fd ==="number")
        fs.close(fd, (err) => {
          if (err) appLogger({
            title:"Error",
            message:String(err),
            func:"Log FDs in app quit event"
          });
        });
    });
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
  let win = createModal(windowOptions, "./template/html/attendaceModal.html", {
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
  createModal(windowOptions, "./template/html/salaryPaymentModal.html", {
    maxWinCount: 1,
    label: "Salary-Modal",
  });
}

app.on("ready", async () => {
  console.log("ready event")
  let policyJsonSchema = {
    "noReturn": 120,
    "gstRecurranceTerm": 1,
    "financialYearStartDate": "1/4",
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
  appLogger({APP_ENV:process.env.APP_ENV})
  readInterface.on("line", (line) => fileList.push(JSON.parse(line)));
  readInterface.on("close",async () => {
    try {
      if(process.env.APP_ENV!=="DEV" && !fs.existsSync(app.getPath("appData")+"/BBS"))
        fs.mkdirSync(app.getPath("appData")+"/BBS",{recursive:true});
      loggerFH("dbLogs.txt");
      loggerFH("appLogs.txt");
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
                appLogger({title:"Directory created",message:path.resolve(rootPath, dir)});
                res(true)
              });
            //check for files
            if (!fs.existsSync(path.resolve(rootPath, fPath))) {
              if (type === "config") {
                let schema;
                if (fileName === "policy.json") schema = policyJsonSchema;
                else if (fileName === "saleConfig.json") schema = saleConfigSchema;
                else if (fileName === "appDefault.json") schema = appDefaultSchema;
                fs.writeFile(path.resolve(rootPath,fPath), JSON.stringify(schema), (err) => {
                  if (err) rej(err);
                  appLogger({title:"File created",message:path.resolve(rootPath,fPath)});
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
      fileList
      .filter(({type})=>type==="record")
      .forEach(({fileName,fPath})=>{
        loggerFH(fileName,fPath);
      });
      appLogger({message:"Filelist check complate"});
      fs.readFile(getsaleConfigPolicyPath(), (err, data) => {
        if (err) return console.error(err);
        const { billNo } = JSON.parse(data.toString());
        appLogger({
          title:"Log",
          message:JSON.stringify({billNo}),
          func:"app 'ready' event"
        })
        billNoCounter(billNo);
      });
      global.shouldWait = false;
      // Adding tab switcher
      let mainWindow = await createWindow();
      createNotifications();
      let focussedWindow = BrowserWindow.getFocusedWindow();
      globalShortcut.register("CommandOrControl+Tab+Up", () => {
        if (mainWindow) {
          let brWindows = BrowserWindow.getAllWindows();
          brWindows = brWindows.filter((win) => win !== mainWindow);
          let index = brWindows.indexOf(focussedWindow);
          index = index === -1 ? 0 : index;
          if (index === brWindows.length - 1) index = 0;
          else index++;
          focussedWindow = brWindows?.[index];
          focussedWindow?.focus();
        }
      });
      globalShortcut.register("CommandOrControl+F4",()=>{
        let win = BrowserWindow.getFocusedWindow();
        if(win && win!==mainWindow)
          win.close();
      })
      if(firstBoot) return;
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
      if (
        mainWindow &&
        (!todaysAttendance || (todaysAttendance && attendees.length > 0))
      )
        takeAttendance(mainWindow);
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
    } catch (err) {
      appLogger({ title: "Error", message: String(err), func:"filelist read error" });
    }
  });
});

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

async function autoPrintMonthlyBills(){// Lookup required
  return
  let date = new Date();
  //Below code runs on commence of every new month.
  let { rPath,rootPath } = loggerFH("appLogs.txt");
  let path2AppLogger = path.resolve(rootPath,rPath); 
  let lastLogin = await new Promise((res,rej)=>{
    let lastLogin;
    let rl = readLine.createInterface({
      input:fs.createReadStream(path2AppLogger)
    });
    rl.on("line",(line)=>{
      if(/App Login Handler/.test(line)){
        let [ day,mnth,yr ] = line.split(" ")[0].split(",")[0].split("/");
        mnth--;
        let dt = new Date(yr,mnth,day);
        if(!lastLogin || dt>lastLogin)
          lastLogin = dt;
      }
    });
    rl.on("close",()=>{
      res(lastLogin);
    });
  });
  
  if(["admin","all","bill"].includes(currentUser.role) && checkIfMonthPassed(lastLogin)){
    jobs = [];
    let month = date.getMonth();
    month = month>0?month--:11;
    let year = date.getFullYear();
    if(month===11)
      year--;
    let lastDay_lastMonth = new Date(Date.now() - (new Date()).getDate()*24*60*60*1000);
    lastDay_lastMonth = "2023-10-31"
    let sales = (await sale.findAll({
      where:{
        billType:"monthly",
        autoBill:true,
        billStatus:"open",
        billformonth:monthNames[date.getMonth()]// change attribute to month
      }
    })).map(({dataValues})=>dataValues);
    if(sales.length>0){
      // Create bill-pdf for all monthly bills and then continue to print.
      Promise.all(
        sales.map(async saleObj=>{// Creating bill-pdf for auto-print bills
          let {billDate,billNo,entryNo,customerId,delivery,tax,billAmt,autoBill} = saleObj;
          if(billNo==="spot"){// Updating billNo and billDate only if billNo==spot
            billNo = billNoCounter();
            saleObj.billNo = billNo;
            billDate = openFormatForDate(lastDay_lastMonth)
            saleObj.billDate = billDate;
          }
          let customerObj = (await customer.findOne({
            where:{
              id:customerId
            }
          })).dataValues;
          let billModel = await getBillModel(customerId,monthNames[date.getMonth()],billDate,billItemSchema);
          let orderItems = (await billModel.findAll()).map(obj=>obj.dataValues);
          
          console.log({orderItems,monthName:monthNames[date.getMonth()]})
          if(orderItems.length===0) return 
          
          saleObj.billDate = openFormatForDate(new Date(billDate));
          let billMeta = {
            ...saleObj,
            ...delivery,
            netTax:tax,
            netAmtTax:billAmt,
            printObj:{
              captions:["Original Buyer's Copy","Book Copy"]//Use preset captions from user config
            },
            billDate:saleObj.billDate,
          };//Recreate billMeta
          // billMeta is incorrect - club sales by customerId then evaluate billMeta 
          //for each customer. 
          return;
          path2pdf = await billPDF({billMeta,customer:customerObj,orderItems});
          if(autoBill===true)
            jobs.push(new Job(`print_${entryNo}`,"print",[path2pdf],printPDF));
          return sale.update({
            billStatus:"close",
            billNo,
            billDate,
          },{
            where:{
              entryNo
            }
          })
        })
      ).then(async function printQuery(){
        return;
        let resp = await dialog.showMessageBox({
          title:"Auto-print invoices",
          message:"Bills ready for auto-print. Start printing now?",
          buttons: [ "Print now","Remind me later","Don't print" ]
        });
        if(resp.response===2){
          return 
        }// Don't auto-print
        let scheduledTime = resp.response===0 ? 0 : 60*60*1000;
        if(resp.response===1)
          dialog.showMessageBox({
            title:"Auto-print postponed",
            message:"We will remind you to auto-print montly bill after an hour."
          })
        setTimeout(()=>{
          if(scheduledTime===0){
            let modal = printDialog();
            ipcMain.once("print-obj",(e,printObj)=>{
              modal.close();
              jobs.forEach(job=>{
                job.updateArgs(printObj);
                job.act("print");
              });
            });
          }
          else
            printQuery();
        },scheduledTime);
      }).catch((err)=>{
        console.log(err)
        appLogger({
          title:"Monthly-bill Print Error",
          message:String(err),
          func:"autoPrintMonthlyBills"
        })
      });
    }
  }
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
    job.updateStatus("OK");
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
    };
    dialog.showMessageBox(BrowserWindow.getFocusedWindow(), msg);
    e.sender.send("attendance-registered");
  });
});

exports.getCurrentLogin = function () {
  return currentUser;
};

// Lander Page IPCs

ipcMain.handle("get-overview-content", async () => {
  let { minStock,creditLimitDays } = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
  if(!dbInitialized) return;
  let stocks = (
    await stock.findAll({
      where: {
        quantity: {
          [Op.lte]: minStock,
        },
      },
    })
  ).map(({ dataValues }) => dataValues);
  let unPaidBills = (
    await sale.findAll({
      where: {
        [Op.and]: [
          { paymentStatus: false },
          {
            billDate: {
              [Op.lte]: new Date(
                Date.now() - creditLimitDays * 24 * 60 * 60 * 1000
              ),
            },
          },
        ],
      },
    })
  ).map(({ dataValues }) => dataValues);
  return { unPaidBills, stocks };
});

ipcMain.handle("get-orders",async ()=>{
  let orderPath = getOrderPath();
  let orders;
  try{
    orders = JSON.parse(fs.readFileSync(orderPath)?.toString());
  }
  catch(err){
    console.log(err);
    orders = [];
  }
  return orders;
});

ipcMain.on("new-sale-purchase", (e, mode) => {
  if (["all", "admin", "bill"].includes(currentUser.role) && mode === 1)
    Menu.getApplicationMenu().items[1].submenu.items[0].click();
  else 
  if (["all", "admin", "purchase"].includes(currentUser.role) && mode === 2)
    Menu.getApplicationMenu().items[2].submenu.items[0].click();
  else
  if(["all", "admin", "bill"].includes(currentUser.role) && mode>2)
    Menu.getApplicationMenu().items[1].submenu.items[mode].click();
  else 
    e.sender.send("error", "Insufficient permission");
});

ipcMain.handle("get-sale-content", async () => {
  if(!dbInitialized) return;
  let queuedBills = (
    await sale.findAll({
      where: {
        deliveryStatus: "queued",
      },
      attributes: [["billItemTable", "tableName"], "name", "billNo"],
    })
  ).map(({ dataValues }) => dataValues);
  let bills = await queuedBills.reduce(
    async (acc, { tableName, billNo, name }, index) => {
      acc = await acc;
      try {
        let billItems = (
          await (
            await sequelize.define(tableName, billItemSchema, {
              freezeTableName: true,
              timestamps: false,
            })
          ).findAll()
        ).map(({ dataValues }) => dataValues);
        acc.push({ billItems, name, billNo });
      } catch (err) {
        appLogger({title:"Error",message:String(err),func:"bill-item-table define error"});
      }
      return acc;
    },
    []
  );
  let allBills = (await sale.findAll()).map(({ dataValues }) => dataValues);
  return { bills, allBills: allBills };
});

ipcMain.handle("get-purchase-content", async () => {
  if(!dbInitialized) return;
  return (await purchase.findAll()).map(({ dataValues }) => dataValues);
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
    await createSession(
      Date.now() + currentUser.sessionTime - currentUser.lastLogin
    );
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
  appLogger({message:"Creating session cookie."});
  let cookie = {
    name: "bbs_auth",
    value: JSON.stringify(currentUser),
    url: "http://localhost",
    expirationDate: Date.now() + time,
  };
  let mainWin = getMainWindow();
  let ses = mainWin.webContents.session;
  await ses.cookies.remove("http://localhost", "bbs_auth");
  let authCookies = await ses.cookies.get({
    name: "bbs_auth",
    url: "http://localhost",
  });
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
        sessionTime: Number(expiry) * 1000 * 60 * 60,
      },
      {
        where: { id: currentUser.id },
      }
    );
    currentUser.session = true;
    currentUser.sessionTime = Number(expiry) * 1000 * 60 * 60;
    await createSession(Number(expiry) * 1000 * 60 * 60);
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
    return error;
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
    else appLogger({message:"Cookie don't exist"});
    currentUser.logout();
    currentUser = null;
    mainWin.loadFile("./template/html/lockScreen.html");
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
  mainWin.loadFile(`./template/html/${page}.html`);
  mainWin.webContents.on("did-finish-load", function (e) {
    try {
      mainWin.webContents.removeListener("did-finish-load", arguments.callee);
    } catch (err) {
      appLogger({title:"Error",message:String(err),func:"lock_unlockHelper"});
    }
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
          message:String(err)
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
    mainPage.loadFile("./template/html/mainPage.html");
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
        message:String(err)
      });
    }
  }
  return res;
});

ipcMain.on("app-login", async () => {
  appLogger({ message: "App Login Handler" });
  currentUser.login();
  global.user = currentUser;
  clearInterval(totpTimer);
  try {
    if (currentUser.session) await createSession(currentUser.sessionTime);
    await user.update(
      {
        lastLogin: Date.now(),
      },
      {
        where: { id: currentUser.id },
      }
    );
  } catch (err) {
    appLogger({title:"Error",message:String(err),func:"app-login-ipc"});
  } finally {
    imposeRestriction();
    autoPrintMonthlyBills();
    if(["admin","all"].includes(currentUser.role))
      checkForUpdates();
    let policy = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString());
    if("lockOnIdle" in policy && policy.lockOnIdle){
      clearInterval(idleLockTimer);
      idleLockTimer = setInterval(lockOnIdle.bind({idleTime:policy.idleTime}),5000);
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
  mainWindow.loadFile("./template/html/mainPage.html");
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
  companyObj = {
    ...companyObj,
    ...data,
  };
  fs.writeFile(
    getsaleConfigPolicyPath(),
    JSON.stringify(companyObj),
    (err) => {
      if (err) return dialog.showErrorBox("File save error", err.message);
      return dialog.showMessageBox(win, {
        title: "Success",
        message: "Company profile updated.",
        type: "info",
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

ipcMain.on("dbl-click-resp",(e,obj,mode)=>{
  let window = BrowserWindow.fromId(e.frameId);
  // Order-dbl-resp
  if(mode===1)
    orderManager(window,function(){
      this.webContents.send("view-order",obj,2);
    })(); 
});

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
          buttons:["Yes","Cancel"]
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
ipcMain.on("show-context-menu", (e, { mode, x, y, obj }) => {
  let window = BrowserWindow.fromId(e.frameId),errIdentifier;
  let contextMenuObj;
  try{
    if (mode === "billObj") {
      return
      contextMenuObj = [
        {
          label: "View Bill",
          click: () => {
            errIdentifier = "View Bill";
            window.webContents.send("show-bill",obj);
          },
        },
        {
          label: "Add Payment",
          click: () => {
            errIdentifier = "Add Payment";
          },
        },
        {
          label: "Notify",
        },
        {
          label: "Print",
        },
      ];
    }
    else
    if(mode==="orderObj"){
      let baseDir = getBaseDir(),orderPath = getOrderPath(),orders;
      orders = JSON.parse(fs.readFileSync(orderPath).toString());
      contextMenuObj = [
        {
          label: "View/Update Order",
          click: () => { // Not ready
            errIdentifier = "View Order";
            orderManager(window,function(){
              this.webContents.send("view-order",obj,2);
            })();         
          },
          // accelerator
        },
        {
          label: "Add Payment",
          click: () => {
            errIdentifier = "Add Payment";
            let modal = createModal(undefined,"template/html/generalHTML.html",{cb:function(){
              let html = [
                {
                  elem:"form",
                  children:[
                    {
                      elem:"div",
                      innerHTML:`
                        <div class="fr-1 flex flex-dir-col flex-center">
                          <p>Customer</p>
                          <p class="row1">${obj.name}</p>
                        </div>
                        <div class="fr-1 flex flex-dir-col flex-center">
                          <p>Due amount</p>
                          <p class="row1">${obj.netDue}</p>
                        </div>
                        <div class="fr-1 flex flex-dir-col flex-center">
                          <p>Order Date</p>
                          <p class="row1">${obj.billDate}</p>
                        </div>
                      `,
                      classList:["flex"],
                      styles:{ 
                        margin: "0 0 0.5rem 0",
                        gap: "0.5rem"
                      } 
                    },
                    {
                      elem:"h2",
                      textContent:"Enter payment details"
                    },
                    {
                      elem:"div",
                      innerHTML:`
                          <div id="payment-div" onkeypress="validateInput2(event)">
                          <div id="payment-mode">
                              <label for="payment-mode">Select payment mode:</label>
                              <select onchange="showPaymentMode(event)" name="mode">
                                  <option value="due" selected>Due</option>
                                  <option value="cash">Cash</option>
                                  <option value="check">Check</option>
                                  <option value="online">NEFT</option>
                              </select>
                          </div>
                          <div id="cash-payment" class="hide payment-detail">
                              <div>
                                  <p>Enter amount</p>
                                  <input data-type="Number" value="0" data-subtype="price" name="payment" />
                              </div>
                          </div>
                          <div id="check-payment" class="hide payment-detail">
                              <div>
                                  <p>Bank Name</p>
                                  <input type="text" name="bankName"/>
                              </div>
                              <div>
                                  <p>Bank Branch</p>
                                  <input type="text" name="bankBranch"/>
                              </div>
                              <div>
                                  <p>Account No.</p>
                                  <input type="text" data-subtype="price" name="bankACNo" data-type="Number" onkeypress="validateInput(event)"/>
                              </div>
                              <div>
                                  <p>Check No.</p>
                                  <input type="text" data-subtype="price" name="chkNo" data-type="Number" onkeypress="validateInput(event)"/>
                              </div>
                              <div>
                                  <p>Amount paid</p>
                                  <input type="text" value="0" name="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                              </div>
                              <div>
                                  <p>Mark as paid</p>
                                  <select type="text" name="paymentStatus">
                                      <option value="false">No</option>
                                      <option value="true">Yes</option>
                                  </select>
                              </div>
                          </div>
                          <div id="online-payment" class="hide payment-detail">
                              <div>
                                  <p>Bank Name</p>
                                  <input type="text" name="bankName" />
                              </div>
                              <div>
                                  <p>Transaction Ref.</p>
                                  <input type="text" name="bankTrnRef" />
                              </div>
                              <div>
                                  <p>Amount paid</p>
                                  <input type="text" value="0" name="payment" data-subtype="price" data-type="Number" onkeypress="validateInput(event)"/>
                              </div>
                              <div>
                                  <p>Mark as paid</p>
                                  <select type="text" name="paymentStatus">
                                      <option value="false">No</option>
                                      <option value="true">Yes</option>
                                  </select>
                              </div>
                          </div>
                      </div>
                      `
                    },
                    {
                      elem:"div",
                      children:[
                        { 
                          elem:"button",
                          attrs:[
                            { key:"type",value:"submit" }
                          ],
                          textContent:"Add payment"
                        },
                        {
                          elem:"button",
                          attrs:[
                            { key:"type",value:"button" },
                            { key:"onclick",value:"window.close()" }
                          ],
                          textContent:"Cancel"
                        }
                      ]
                    }
                  ],
                  attrs:[
                    { key:"onsubmit", value:"submitHandler(event)" }
                  ],
                  classList:["fr-1"]
                }
              ];
              this.webContents.send("init-page","Add Payment",html)
            }});
            modal.webContents.toggleDevTools();
            ipcMain.once("Add Payment-response",(e,data)=>{
              modal.close();
              errIdentifier += ">Add payment ipc";
              let billMeta = JSON.parse(fs.readFileSync(obj.orderId).toString());
              let orderJSON = JSON.parse(fs.readFileSync(orderPath).toString());
              obj = orderJSON.fileList.find(_obj=>_obj.orderId===obj.orderId);
              data.payment = Number(data.payment);
              billMeta.payment.push(data);
              billMeta.netPayment += data.payment;
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
              fs.writeFileSync(obj.orderId,JSON.stringify(billMeta));
              fs.writeFileSync(orderPath,JSON.stringify(orderJSON));
              window.webContents.send("update-content");
            });
          },
        },
        {
          label: "Remove order",
          click: () => {
            errIdentifier = "Remove order";
            let { orderId } = obj;
            if(fs.existsSync(path.resolve(baseDir,orderId)))
              fs.unlinkSync(path.resolve(baseDir,orderId));
            if("fileList" in orders)
              orders.fileList = orders.fileList.filter((obj)=>obj.orderId!==orderId);
            fs.writeFileSync(orderPath,JSON.stringify(orders));
            window.webContents.send("update-content");
            dialog.showMessageBox({
              title:"Order removed",
              message:"Order removed"
            });
          },
        },
        {
          label: "Update order status",
          click: () => {
            errIdentifier = "Update order status";
            let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
            if("orderStages" in saleConfig)
              orderStages = saleConfig.orderStages;
            let indexOfStage = orderStages.findIndex(stageName=>stageName===obj.status);
            if(indexOfStage!==undefined && indexOfStage<orderStages.length-1){
              obj = orders.fileList.find(orderObj=>orderObj.orderId===obj.orderId);
              obj.status = orderStages[indexOfStage+1];
              fs.writeFileSync(orderPath,JSON.stringify(orders));
              window.webContents.send("update-content");
            }
          },
        },
        {
          label:"Generate bill from order",
          click: ()=>{
            errIdentifier = "Generate bill from order";
            orderManager(window,function(){
              this.webContents.send("generate-bill",obj,5);
            })();
          }
        },
        {
          label:"Print proforma bill",
          click: async ()=>{
            errIdentifier = "Print proforma bill";
            let { orderId } = obj;
            let billMeta = JSON.parse(fs.readFileSync(orderId).toString());
            let { name="",address,gst,email,phones,orderItems } = billMeta;
            billMeta.printObj = {
              captions:["Proforma Invoice"]
            };
            billMeta.billNo = "proforma_"+orderId.slice(0,orderId.length/3);
            let path2pdf = await billPDF({billMeta,customer:{name,address,email,phones,gst},orderItems});
            let modal = printDialog(function(){
              this.webContents.send("hide-label");
            });
            ipcMain.once("print-obj",(e,printObj)=>{
              billMeta.printObj = {
                  ...printObj,
                  captions:["Proforma Invoice"]
              };
              modal.close();
              printPDF(path2pdf,billMeta.printObj);
            });
          }
        }
      ];
    }
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
    x,
    y,
    callback: () => {
      console.log("Context menu closed");
    },
  });
});

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
      });
      if (process.platform === "linux") setLinuxThemeObserver();
      initTheme();
    }
  );
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
  win?.webContents.send("apply-theme", themeObj);
  if (shouldUpdate) {
    BrowserWindow.getAllWindows().forEach((_win) => {
      if (_win !== win) _win.webContents.send("apply-theme", themeObj);
    });
  }
  return themeObj;
}

nativeTheme.addListener(
  "updated",
  initTheme.bind(null, { shouldUpdate: true })
);

ipcMain.handle("get-svg", (e, filePath) => {
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
      message:"Please select something to backup."
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
        fs.copyFileSync(path.resolve(appPath,"./logs/dbLogs.txt"),path.resolve(filePath,"dbLogs.txt"));
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
  createModal(windowOptions, "./template/html/registration.html", {
    label: "registration-window",
    maxWinCount: 1,
    cb: function () {
      this.webContents.send("call-register-link", gst);
    },
  });
});// Incomplete

//App update logic
async function updateCommon(){//This need a relook
  let data = {
    currentVersion:app.getVersion(),
    path2file:path.resolve(app.getPath("appData"),`./BBS/${this.fileName}`),
    time:Date.now(),
    updateDownloaded:true,
    versionDownloaded:this.version,
    installMoment:"now",
    updateComplete:false,
    platform:process.platform,
    fileName:this.fileName
  }
  try{
    fs.writeFileSync(app.getPath("appData")+"/BBS/updtConf.json",JSON.stringify(data));
  }
  catch(err){
    appLogger({
      title:"Error",
      message:String(err),
      func:"updateCommon()"
    })
  }
  let resp = await dialog.showMessageBox({
    title:"Download complete",
    message:"Update download complete, do you want to install now?",
    buttons:["Install Now","Later"]
  });
  if(resp.response===1){
    data.installMoment = "later";
    return;
  }
  appLogger({
    message:"Trying to install update."
  });
  if(data.installMoment==="now" && fs.existsSync(path.resolve(app.getPath("appData"),"./model/schema.js"))){
    try{
      fs.rmSync(path.resolve(app.getPath("appData"),"./model/schema_replica.js"),"a+");
      fs.rmSync(path.resolve(app.getPath("appData"),"./model/schema.js"),"a+");
    }
    catch(err){
      appLogger({
        title:"Error",
        message:String(err),
        func:"Trying to delete schema files to allow schema update after install."
      })
    }
  }
  let proc;
  if(data.installMoment==="now" && ["darwin","linux"].includes(process.platform)){
    appLogger({
      message:"Launching updator.sh.",
      cmd:`./updator.sh -u ${this.version}`
    });
    proc = spawn(`./updator.sh -u ${this.version}`,{
      cwd:__dirname,
      shell:true
    });
  }
  else
  if(data.installMoment==="now" && process.platform==="win32"){
    // Try to run a bash or some shell script to update BBS
    proc = spawn("updator.bat",[data.path2file],{
      shell:true,
      cwd:__dirname
    });
  }
  if(data.installMoment==="now"){
    setTimeout(()=>{
      app.quit()
    },2000);
    proc.on("spawn",()=>{
      appLogger({
        title:"Spawned updator",
        message:`"${path.resolve(data.path2file)}"`,
        test:fs.existsSync(data.path2file)
      });
    });
    function helperfunc1(chunk){
      appLogger({
        title:this,
        message:Buffer.from(chunk).toString()
      });
    }
    proc.stderr.on("data",helperfunc1.bind("updator.bat error"));
    proc.stdout.on("data",helperfunc1.bind("Output from updator.bat"));
  }
}

function downloadUpdate(appVersion){
  appLogger({
    message:"Downloading update"
  });
  let fileWriter, downloadURL,fileName,mainWin = getMainWindow();
  if(process.platform==="linux"){
    fileName = `bbs_${appVersion}_amd64.deb`;
    fileWriter = fs.createWriteStream(app.getPath("appData")+`/BBS/bbs_${appVersion}_amd64.deb`);
    downloadURL = process.env.UPDATE_REST+`download/linux/bbs_${appVersion}_amd64.deb`;
  }
  else
  if(process.platform==="win32"){
    fileName = `bbs_${appVersion}_setup.exe`;
    fileWriter = fs.createWriteStream(app.getPath("appData")+`/BBS/bbs_${appVersion}_setup.exe`);
    downloadURL = process.env.UPDATE_REST+`download/win/`;
  }
  else
  if(process.platform==="darwin"){
    // mac case
  }
  axios.get(downloadURL,{
    responseType:"stream",
    // onDownloadProgress(e){
    //   let total = parseFloat(e.currentTarget.responseHeaders['Content-Length'])
    //   let current = e.currentTarget.response.length;
    //   updateProgressbar(mainWin,current,total);
    // }
  })
  .then(resp=>{
    if(resp.ok) appLogger({message:"Response received from server"});
    mainWin.setProgressBar(-1);
    return new Promise((res,rej)=>{
      resp.data.pipe(fileWriter);
      fileWriter.on("error",(err)=>{
        rej(err);
        fileWriter.close();
      });
      fileWriter.on("close",()=>{
        res(true);
      });
    });
  })
  .then(updateCommon.bind({fileName,version:appVersion}))
  .catch(err=>{
    console.error("Error",err);
    appLogger({
      title:"Error",
      message:String(err),
      func:"Download-update"
    })
  });
}

function versionChecker(version1,version2,log=true){
    let [major, minor, bugFix] = version1.split(".");
    let [_major, _minor, _bugFix] = version2.split(".");
    if(log)
      appLogger({
        major,_major,minor,_minor,bugFix,_bugFix,
        cond1:Number(_major) === Number(major),
        cond2:Number(_minor) === Number(minor),
        cond3:Number(_bugFix) === Number(bugFix)
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

async function checkForUpdates(flag="auto") {
  let { UPDATE_REST } = process.env;
  let mainWin = getMainWindow();
  if (!["admin", "all"].includes(currentUser.role)) {
    return dialog.showMessageBox(mainWin, {
      title: "Unauthorized",
      message: "Only Admin and user with role 'all' can check for update.",
    });
  }
  appLogger({message:"Checking for update"});
  let { isOnline, appVersion, err, changelog } = await new Promise((res) => {
    mainWin.webContents.send("check-for-update", UPDATE_REST, app.getVersion());
    ipcMain.on(
      "check-for-update-response",
      (e, { isOnline = false, appVersion, err, changelog }) => {
        res({ isOnline, appVersion, err, changelog });
      }
    );
  });
  if (err) {
    // Logic for error Handling
    appLogger({
      title:"Error",
      message:String(err),
      func:"Check for update error"
    });
    if(flag!=="auto")
      return dialog.showMessageBox({
        title:"Failed to connect",
        message: "Update server is offline. Check later."
      });
  }
  if (isOnline === false)
    return dialog.showMessageBox(mainWin, {
      title: "No Connection",
      message: "Failed to connect to update server.",
    });
  // Parse and santize appVersion
  if (
    appVersion &&
    typeof appVersion === "string" &&
    new RegExp(/^([0-9]+\.){2}[0-9]+$/).test(appVersion)
  ) {
    let resp = versionChecker(app.getVersion(),appVersion);
    let message;
    if (resp===1)
      message = "A new version of BBS is available for download.";
    if (resp===2)
      message = "A minor feature update is available for download.";
    if (resp===3)
      message = "Bug fix available for download.";
    changelog.highlights.forEach((log,i)=>{
      message += (i+1)+") "+log + ". "
    });
    
    if(resp===0){
      if(flag!=="auto")
        return dialog.showMessageBox({
          title:"No new update",
          message: "Application is at latest release version"
        });// App is already updated.
      else
        return;
    }
    let { response } = await dialog.showMessageBox(mainWin, {
      title: "Update available for download",
      message,
      buttons: ["Download", "Cancel"],
      noLink:true
    });
    if (response === 1) return;
    // If app is not already updated.
    try{
      let updtConf = JSON.parse(fs.readFileSync(app.getPath("appData")+"/BBS/updtConf.json").toString());
      if(updtConf.updateDownloaded && updtConf.versionDownloaded!==appVersion && fs.existsSync(updtConf.path2file)){
        // Older version of app setup exist. So deleting and downloading latest.
        fs.rmSync(updtConf.path2file);
        return downloadUpdate(appVersion);
      }
      else
      if(updtConf.updateDownloaded && updtConf.versionDownloaded===appVersion && fs.existsSync(updtConf.path2file)){
        // Update already downloaded and ready for install
        appLogger({ message: "Update is already downloaded." })
        updateCommon.call({version:appVersion,fileName:updtConf.fileName});
      }
      else{
        //Downloading update as it is not downloaded
        downloadUpdate(appVersion);
      }
    }
    catch(err){
      appLogger({
        title:"Error",
        message:String(err),
        func:"Update conf read error"
      });
      downloadUpdate(appVersion);
    }
  }
}

autoUpdater.on("update-available", () => {
  appLogger({message:"Starting install"});
  dialog.showMessageBox({
    title:"Update available --auto",
    message:"Testing auto-updator on generic server."
  })
  // autoUpdater.quitAndInstall();
});

// autoUpdater.on("error",(err)=>{
//   appLogger({
//     title:"Error",
//     message:String(err)
//   })
// })

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
      message:"Written initial data to a temporary json file"
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
  let entryArr = (await ledger.findAll()).map(({dataValues})=>dataValues);
  let startDate,endDate,date = new Date();
  if(period==="0"){
    startDate = new Date(date.getFullYear(),3,1);
    endDate = date;
  }
  else
  if(period==="1"){
    startDate = new Date(date.getFullYear()-1,3,1);
    endDate = new Date(date.getFullYear(),3,1);
  }
  else{
    endDate = date;
    startDate = entryArr[0].date;
  }
  let { balance:prevClose=0 } = [...entryArr.filter(({date})=>date<startDate)].pop() ?? {};
  let { balance:ledgerBalance } = [...entryArr.filter(({date})=>date<endDate)].pop();
  entryArr.map(({dataValues})=>({...dataValues}));
  entryArr = entryArr.filter(obj=>obj.date>=startDate);
  let peopleObj = (mode==1?await supplier.findOne({where:{id}}):await customer.findOne({where:{id}})).dataValues;
  let path2pdf = ledgerPDF(entryArr,peopleObj,startDate,endDate,prevClose,ledgerBalance);
  ipcMain.emit("show-print-modal",path2pdf);
});

ipcMain.handle("billing-format-ipc",(e,data)=>{
  try{
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    if("format" in data)
      saleConfig.format = data.format;
    if(parseInt(data.billNo))
      saleConfig.billNo = Number(data.billNo);
    fs.writeFileSync(getsaleConfigPolicyPath(),JSON.stringify(saleConfig));
    billNoCounter(saleConfig.billNo);
    return true;
  }
  catch(err){
    dialog.showErrorBox("Error",String(err));
    return false;
  }
});

ipcMain.on("printObj",print);

module.exports.checkForUpdates = checkForUpdates;

// BBS timer codes

// Inactivity tracker
function lockOnIdle(){
  // console.log("lockOnIdle called")
  let state = powerMonitor.getSystemIdleState(this.idleTime);
  let time = powerMonitor.getSystemIdleTime();
  if(state==="idle" && time>this.idleTime+5)
    ipcMain.emit("lock");
}

// Scheduler IPCs
ipcMain.on("call-scheduler",()=>{
  let pathToHTML = "./template/html/scheduler.html";
  let windowOptions = {
      webPreferences: {
          nodeIntegration: true,
          devTools:true
      },
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
      content:"scheduler.json file missing"
    });
    appLogger({
      title:"Error saving event schedule",
      message:"scheduler.json file missing"
    });
    return BrowserWindow.fromId(e.sender.id).close();  
  }
  try{
    let jsData = JSON.parse(fs.readFileSync(path2scheduler).toString());
    let schedules = jsData.schedules;
    if(flag==="a"){
      data.user = currentUser;
      data.id = uuid.v4();
      if(!("schedules" in jsData))
        jsData.schedules = [ data ];
      else
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
      if(!("expiredSchedules" in jsData))
        jsData.expiredSchedules = [];
      jsData.expiredSchedules.push(schedules.find(obj=>obj.id===data));
      schedules.splice(schedules.findIndex(evObj=>evObj.id===data),1);
    }
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
        message:"Notification and action scheduled at the event time."
      });
      flag==="a" && BrowserWindow.fromId(e.sender.id).close();
    }
    else
    if(flag==="r" && showMsg===true)
      dialog.showMessageBox({
        title:"Event removed",
        message:"Event removed."
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
    return createModal(windowOptions,"./template/html/scheduleManager.html",{label:"scheduler",cb:function(){
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

// DB Migration for non-breaking model changes only
function schemaValidator(){
  let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
  let path2config = path.resolve(appPath,"./model/dbConf.json");
  if(fs.existsSync(path2config)){
    let { dbMigrated=true } = JSON.parse(fs.readFileSync(path2config)?.toString() ?? "{}");
    if(dbMigrated)
      return false;
  }
  let { schemas:_schemas } = require(path.resolve(appPath,"./model/dbConfig_replica"));
  let { schemas } = require(path.resolve(appPath,"./model/dbConfig"));
  let { customerLedgerSchema:_customerLedgerSchema,supplierLedgerSchema:_supplierLedgerSchema,billItemSchema:_billItemSchema } = require(path.resolve(appPath,"./model/dynamicSchemas_replica"));
  let { customerLedgerSchema,supplierLedgerSchema,billItemSchema } = require(path.resolve(appPath,"./model/dynamicSchemas"));
  if(schemas.length!=_schemas.length) return false;
  let schema_objs = Object.keys(schemas).map(schema=>({obj1:schemas[schema],obj2:_schemas[schema]}))
  let compareObj = [
    ...schema_objs,
    { obj1:customerLedgerSchema,obj2:_customerLedgerSchema },
    { obj1:supplierLedgerSchema,obj2:_supplierLedgerSchema },
    { obj1:billItemSchema,obj2:_billItemSchema }
  ];
  if(compareObj.find(({obj1,obj2})=>!(deepCompareJSON(obj1,obj2))))
    return true;
  else
    return false;
}

function updateProgressbar(win,value,maxVal){
  win.setProgressBar(Math.round(value/maxVal),{mode:"normal"});
  win.webContents.send("execute-progressbar",Math.round(value/maxVal)*100);
}
// dbMigrator()
async function dbMigrator(){
  let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
  let _models = require(path.resolve(appPath,"./model/dbConfig_replica"));
  let { schemas,...models } = require(path.resolve(appPath,"./model/dbConfig"));
  let { customerLedgerSchema:_customerLedgerSchema,supplierLedgerSchema:_supplierLedgerSchema,billItemSchema:_billItemSchema } = require(path.resolve(appPath,"./model/dynamicSchemas_replica"));
  let { customerLedgerSchema,supplierLedgerSchema,billItemSchema } = require(path.resolve(appPath,"./model/dynamicSchemas"));
  let win = getMainWindow();
  appLogger({
    title:"Taking Backup"
  });
  try{
    fs.copyFileSync(path.resolve(appPath,"./db/bbs.db"),path.resolve(appPath,"./db/bbs_replica.db"),"a+");
    appLogger({title:"db copied successfully"});
    let _sequelize = new Sequelize({
      dialect:"sqlite",
      storage:path.resolve(appPath,"./db/bbs_replica.db"),
      transactionType:"IMMEDIATE",
      logging:false
    });
    await _sequelize.sync();
    console.log("Connected to replica db");
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
    updateProgressbar(win,0,totaltables);
    let progress = 1;
    updateProgressbar(win,progress,totaltables);
    async function helperfunc1(id,_schema,schema,mode=2){
      try{
        if(mode===1)
          return getLedgerModel(id,schema);
        let _ledgerModel = await getLedgerModel(id,_schema,_sequelize);
        let ledgerModel = await getLedgerModel(id,schema);
        await ledgerModel.sync();
        if(_ledgerModel){
          let ledger = (await (await _ledgerModel.sync()).findAll()).map?.(({dataValues})=>dataValues);
          if(!(ledger instanceof Array)) return;
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
        await billModel.sync();
        if(!(_itemList instanceof Array)) return;
        await billModel.bulkCreate(_itemList,{returning:true});
        return
      }
      catch(err){
        console.log({err,line:2841});
        return;
      }
    }
    console.log({msg:"Dynamic model definition in pogress"})
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
          await helperfunc2(id,billNo,billDate,_billItemSchema,billItemSchema,1);
        }
        return;
      })
    ]);
    console.log({msg:"Models defined"});
    await sequelize.sync({
      force:true,
      alter:true
    })
    .catch(console.log);
    console.log({msg:"sequelize sync done"});
    for (let i=0;i<tables.length;i++){
      let table = tables[i];
      if(table==="customers" || table=="customer")
        table = "customer";
      try{
        let data = (await _models[table]?.findAll())?.map(({dataValues})=>dataValues);
        if(data)
          await models[table].bulkCreate(data,{returning:true});
      }
      catch(err){
        console.log(err);
      } finally{
        updateProgressbar(win,++progress,totaltables);
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
            console.log(err);
          } finally {
            updateProgressbar(win,++progress,totaltables);
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
            console.log(err);
          } finally {
            updateProgressbar(win,++progress,totaltables);
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
            console.log(err)
          } finally{
            updateProgressbar(win,++progress,totaltables);
          }
        }
        return;
      })
    ])
    .then(async ()=>{
      path2config = path.resolve(appPath,"./dbConf.json");
      fs.writeFileSync(path2config,JSON.stringify({dbMigrated:true}));
      process.appStatus = "normal";
      win.setProgressBar(-1);
      fs.copyFileSync(path.resolve(appPath,"./model/schema.js"),path.resolve(appPath,"./model/schema_replica.js"));
      fs.copyFileSync(path.resolve(appPath,"./model/dynamicSchemas.js"),path.resolve(appPath,"./model/dynamicSchemas_replica.js"));
      app.relaunch();
      app.exit();
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
  appLogger(msg);
});

ipcMain.on("new-bill",async (e,customerObj)=>{
  if (!["all", "admin", "bill"].includes(currentUser.role)) return;
  Menu.getApplicationMenu().items[1].submenu.items[0].click(); 
  process.presets = {
    customer:customerObj,
    target:"salePage"
  };
});

ipcMain.handle("get-presets",()=>{
  return process.presets;
});

ipcMain.on("booted",async (e)=>{
  let stockList = await queryStock();
  //standardSellPrice
  //pInfo : {}
  let products = stockList.filter(obj=>(
      !("skipFlag" in obj.pInfo) &&
      (obj.standardSellPrice===0 || 
      !("taxSlab" in obj.pInfo))
    ));
  if(products.length>0){
    dialog.showMessageBox({
      title:"Product attributes found missing",
      message:"Some of your item has missing attributes like GST rate. Would you like to fill them up now?",
      buttons:["Sure","Later"]
    }).then(({response})=>{
      if(response===1) return;
      // else show popup to fill in neccessary product information.
      e.sender.send("product-info-fillup-modal",products);
    })
  }
})