require("dotenv").config();
const { BrowserWindow, app, ipcMain, dialog, ipcRenderer, shell } = require("electron");
const { createModal, getMainWindow } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const path = require("path");
const { appLogger } = require("./common");
const fs = require("fs");
const { default: axios } = require("axios");
const readLine = require("readline");

let windowOptions = {
    width: 800,
    height: 600
};
let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS") : __dirname;
let { UPDATE_REST } = process.env;

exports.versionManager = function(){
    windowOptions.parent = getMainWindow();
    createModal(windowOptions,getTemplatePath("versionManager"),{ maxWinCount:1,label:"version-manager" });//.webContents.openDevTools();
}

exports.recordDownloadedVersion = function(data){// Record and manage app versions by folders // Runs before app update
    try{
        let backupFolderPath = path.resolve(appPath,"./Backup/version_"+app.getVersion());
        fs.writeFileSync(app.getPath("appData")+"/BBS/updtConf.json",JSON.stringify(data));
        fs.mkdirSync(backupFolderPath,{ recursive:true });
        let fileList = [
            {fileName:"bbs.db",path2file:path.resolve(appPath,"./db/bbs.db")},
            {fileName:"appDefault.json",path2file:path.resolve(appPath,"./config/appDefault.json")},
            {fileName:"policy.json",path2file:path.resolve(appPath,"./config/policy.json")},
            {fileName:"saleConfig.json",path2file:path.resolve(appPath,"./config/saleConfig.json")},
            {fileName:"bbs_"+app.getVersion()+"_setup.exe",path2file:path.resolve(appPath,"./bbs_"+app.getVersion()+"_setup.exe")}
        ];
        fs.writeFileSync(path.resolve(backupFolderPath,"./fileList.json"),JSON.stringify(fileList));
        fileList.forEach(({path2file:filePath,fileName})=>{
            appLogger({
                title:"Trying to copy",
                message:JSON.stringify({
                    filePath,
                    fileName,
                    destnFolder:path.resolve(backupFolderPath,"./"+fileName)
                })
            })
            if(fs.existsSync(filePath)){
                fs.copyFileSync(filePath,path.resolve(backupFolderPath,"./"+fileName));
                if(/setup/.test(fileName))
                    fs.unlinkSync(filePath);
            }
            else
                appLogger({
                    title:"File Copy Error",
                    message:"Failed to copy since file "+fileName+" or path "+filePath+" doesn't exists.",
                    func:"recordDownloadedVersion function"
                })
        });

    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"updateCommon()"
        })
    }
}

async function versionLogReader(){
    return new Promise((res,rej)=>{
        try{
            let lines = [];
            if(!fs.existsSync(path.resolve(appPath,"./logs/versionLogs.txt")))
                return res(lines);
            let fileInterface = readLine.createInterface({
                input:fs.createReadStream(path.resolve(appPath,"./logs/versionLogs.txt")),
                output:process.stdout,
                terminal:false
            });
            fileInterface.on("line",line=>lines.push(JSON.parse(line)));
            fileInterface.on("close",()=>{
                return res(lines);
            });
        }
        catch(err){
            rej(err);
        }
    });
}

ipcMain.on("get-version-contents", async (e)=>{
    try{
        let lines = await versionLogReader();
        e.sender.send("get-version-contents-response",lines,app.getVersion());
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"get-version-contents IPC"
        })
        e.sender.send("get-version-contents-response",[],app.getVersion());
    }
});

exports.showUpdateSuccessMsg = showUpdateSuccessMsg;

async function showUpdateSuccessMsg(){// Runs after update completion
    try{
        let { data:{ changelog,releaseDate=new Date() } } = await axios.get(UPDATE_REST+"version");
        let updateConf = JSON.parse(fs.readFileSync(path.resolve(app.getPath("appData"),"./BBS/updtConf.json")).toString());
        let updtLogEntry = {
            appVersion:app.getVersion(),
            changelog,
            releaseDate,
            installDate:new Date(),
            lastInstalledVersion:updateConf.currentVersion,
            platform:process.platform,
            installerLoc:updateConf.path2file,
            fileName:updateConf.fileName
        }
        updateConf.currentVersion = app.getVersion();
        fs.writeFileSync(path.resolve(appPath,"./updtConf.json"),JSON.stringify(updateConf));
        fs.appendFileSync(path.resolve(appPath,"./logs/versionLogs.txt"),JSON.stringify(updtLogEntry)+"\n");
        // let installerFiles = fs.readdirSync(appPath,{withFileTypes:true}).filter(file=>file.isFile() && file.name.match(/bbs.+setup.exe/));
        // if(installerFiles instanceof Array && installerFiles.length>0)
        //     installerFiles.forEach(file=>{
        //         fs.unlinkSync(path.resolve(appPath,"./"+file.name));
        //     });
        dialog.showMessageBox({
            title:"Update Complete",
            message:"App has been updated, check versionManager for update details."
        });
        return;
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"showUpdateSuccessMsg function"
        })
    }
}

ipcMain.handle("get-app-path",()=>{
    return appPath;
});

ipcMain.on("btn-ctrl-backend",async (e,cmd,versionObj)=>{
    let backupFolderPath = path.resolve(appPath,"./Backup/version_"+versionObj.appVersion);
    const { updateCommon } = require("./main");
    if(!(fs.existsSync(backupFolderPath))) return;
    let installerFile = path.resolve(backupFolderPath,"./"+"bbs_"+versionObj.appVersion+"_setup.exe")
    let relPath = path.relative(installerFile,app.getPath("appData"));
    if(cmd==="restore"){
        let fileList = JSON.parse(fs.readFileSync(path.resolve(backupFolderPath,"./fileList.json")).toString());
        fileList.forEach(({fileName,path2file})=>{
            let srcFilePath = path.resolve(backupFolderPath,"./"+fileName);
            let destFolder = path.resolve(path2file,"../"); 
            if(fs.existsSync(srcFilePath) && fs.existsSync(destFolder))
                fs.copyFileSync(srcFilePath,destFolder);
        });
        if(fs.existsSync(installerFile))
            updateCommon.call({fileName:versionObj.fileName,version:versionObj.appVersion},false,relPath);
        else
            appLogger({
                title:"Installer Missing",
                message:"Installer file missing in backup folder, cannot proceed with downgrade. Path: "+installerFile,
                func:"versionManager IPC restore"
            })
    }
    else
    if(cmd==="open-folder")
        shell.openExternal(backupFolderPath);
    else
    if(cmd==="delete-version"){
        fs.rmdirSync(backupFolderPath,{ recursive:true,force:true });
        let lines = await versionLogReader();
        lines = lines.filter(obj=>obj.appVersion!==versionObj.appVersion);
        fs.unlinkSync(path.resolve(appPath,"./logs/versionLogs.txt"));
        lines.forEach(line=>{
            fs.appendFileSync(path.resolve(appPath,"./logs/versionLogs.txt"),JSON.stringify(line)+"\n");
        });
    }
});

// let data = {
//     currentVersion:app.getVersion(),
//     path2file:path.resolve(app.getPath("appData"),`./BBS/${this.fileName}`),
//     time:Date.now(),
//     updateDownloaded:true,
//     versionDownloaded:this.version,
//     installMoment:"now",
//     updateComplete:false,
//     platform:process.platform,
//     fileName:this.fileName
//   }

// Redundant code

// updateConf.currentUser = app.getVersion();
//             updateConf.updateComplete = true;
//             updateConf.currentVersion = app.getVersion();
//             fs.writeFileSync(app.getPath("appData")+"/BBS/updtConf.json",JSON.stringify(updateConf));

// dialog.showMessageBox({
//     title:"Info",
//     message:strtMsg,
//     buttons:["Ok"],
//     noLink:true,
//     icon:appIcon
//   });
//   spawn("rm -r ~/.config/BBS/*.deb",{
//     shell:true,
//     stdio:["pipe","pipe","pipe"]
//   }).stdio.every(stream=>{
//     stream.on("data",(data)=>{
//       appLogger({
//         message:data,
//         title:"STDIO"
//       })
//     });
//   })


// let strtMsg = process.argv.find(str=>str.startsWith("msg="));
// if(strtMsg && typeof strtMsg==="string")
//   mainWindow.once("focus",()=>{
//     strtMsg=strtMsg.split("=").pop();
    
//   });