require("dotenv").config();
const { BrowserWindow, app, ipcMain, dialog, ipcRenderer, shell } = require("electron");
const { createModal, getMainWindow } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const path = require("path");
const { appLogger, attempt } = require("./common");
const fs = require("fs");
const { default: axios } = require("axios");
const readLine = require("readline");

// Helper function to get platform-specific installer filename
function getInstallerFileName(version) {
    if (process.platform === "win32") return `bbs_${version}_setup.exe`;
    if (process.platform === "linux") return `bbs_${version}_amd64.deb`;
    return null;
}

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
        let installerFileName = getInstallerFileName(app.getVersion());
        let fileList = [
            {fileName:"bbs.db",path2file:path.resolve(appPath,"./db/bbs.db")},
            {fileName:"appDefault.json",path2file:path.resolve(appPath,"./config/appDefault.json")},
            {fileName:"policy.json",path2file:path.resolve(appPath,"./config/policy.json")},
            {fileName:"saleConfig.json",path2file:path.resolve(appPath,"./config/saleConfig.json")}
        ];
        if (installerFileName) {
            fileList.push({
                fileName: installerFileName,
                path2file: path.resolve(appPath, "./" + installerFileName)
            });
        }
        fs.writeFileSync(path.resolve(backupFolderPath,"./fileList.json"),JSON.stringify(fileList));
        fileList.forEach(({path2file:filePath,fileName})=>{
            appLogger({
                title:"Trying to copy",
                message:JSON.stringify({
                    filePath,
                    fileName,
                    destnFolder:path.resolve(backupFolderPath,"./"+fileName)
                }),
                func:"recordDownloadedVersion"
            })
            if(fs.existsSync(filePath)){
                fs.copyFileSync(filePath,path.resolve(backupFolderPath,"./"+fileName));
                // Don't delete installer - preserve it for potential rollback
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
            fileInterface.on("line",line=>lines.push(attempt(()=>{return JSON.parse(line)},{})));
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
        });
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
        // dialog.showMessageBox({
        //     title:"Update Complete",
        //     message:"App has been updated, check versionManager for update details."
        // });
        return;
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"showUpdateSuccessMsg function"
        });
    }
}

ipcMain.handle("get-app-path",()=>{
    return appPath;
});

ipcMain.handle("btn-ctrl-backend",async (e,cmd,versionObj)=>{
    try {
        // Only admin roles may manage versions - restore/delete touch backups
        // and restore triggers the update installer. Read the role from the
        // live auth cookie (removed on logout, unlike the stale global.user).
        let ses = e.sender.session;
        let authCookies = await ses.cookies.get({
            name: "bbs_auth"+process.env.APP_ENV,
            url: "http://localhost",
        });
        let role = null;
        if (authCookies.length > 0 && authCookies[0].expirationDate > Date.now()/1000) {
            role = JSON.parse(authCookies[0].value).role;
        }
        if(!["admin","all"].includes(role)) {
            appLogger({
                title: "Error",
                message: "Unauthorized version-manager access blocked. Role: "+(role ?? "none"),
                func: "btn-ctrl-backend IPC"
            });
            return { success: false, error: "Unauthorized: only admin roles can manage versions." };
        }
        // Input validation
        if (!versionObj || !versionObj.appVersion || !versionObj.fileName) {
            appLogger({
                title: "Error",
                message: "Invalid version object provided",
                func: "btn-ctrl-backend IPC"
            });
            return { success: false, error: "Invalid version object" };
        }

        let backupFolderPath = path.resolve(appPath,"./Backup/version_"+versionObj.appVersion);
        
        if(!fs.existsSync(backupFolderPath)) {
            appLogger({
                title: "Error",
                message: "Backup folder not found: " + backupFolderPath,
                func: "btn-ctrl-backend IPC"
            });
            return { success: false, error: "Backup folder not found" };
        }
        
        let installerFileName = getInstallerFileName(versionObj.appVersion);
        if (!installerFileName) {
            return { success: false, error: "Unsupported platform" };
        }
        
        let installerFile = path.resolve(backupFolderPath,"./"+installerFileName);
        let relPath = path.relative(app.getPath("appData"), installerFile);
        
        if(cmd==="restore"){
            let fileListPath = path.resolve(backupFolderPath,"./fileList.json");
            const { sequelize } = require("./model/dbConfig");
            await sequelize.close();
            if (!fs.existsSync(fileListPath)) {
                appLogger({
                    title: "Error",
                    message: "File list not found in backup folder",
                    func: "btn-ctrl-backend IPC restore"
                });
                return { success: false, error: "File list not found" };
            }
            
            let fileList = JSON.parse(fs.readFileSync(fileListPath).toString());
            fileList.forEach(({fileName,path2file})=>{
                try {
                    let srcFilePath = path.resolve(backupFolderPath,"./"+fileName);
                    if(fs.existsSync(srcFilePath) && fs.existsSync(path.dirname(path2file))) {
                        fs.copyFileSync(srcFilePath, path2file);
                        appLogger({
                            title: "File Restored",
                            message: `Copied ${fileName} to ${path2file}`,
                            func: "btn-ctrl-backend IPC restore"
                        });
                    } else {
                        appLogger({
                            title: "Warning",
                            message: `Could not restore ${fileName} - source or destination missing`,
                            func: "btn-ctrl-backend IPC restore"
                        });
                    }
                } catch (err) {
                    appLogger({
                        title: "Error",
                        message: `Failed to copy ${fileName}: ${String(err)}`,
                        func: "btn-ctrl-backend IPC restore"
                    });
                }
            });
            
            if(fs.existsSync(installerFile)) {
                // Use IPC emit to call updateCommon in main.js (avoid circular dependency)
                ipcMain.emit("execute-update", null, versionObj.fileName, versionObj.appVersion, false, relPath,true);
                return { success: true, message: "Restore initiated" };
            } else {
                appLogger({
                    title:"Installer Missing",
                    message:"Installer file missing in backup folder, cannot proceed with downgrade. Path: "+installerFile,
                    func:"versionManager IPC restore"
                });
                return { success: false, error: "Installer file not found" };
            }
        }
        else if(cmd==="open-folder"){
            shell.openExternal(backupFolderPath);
            return { success: true };
        }
        else if(cmd==="delete-version"){
            fs.rmdirSync(backupFolderPath,{ recursive:true,force:true });
            let lines = await versionLogReader();
            lines = lines.filter(obj=>obj.appVersion!==versionObj.appVersion);
            
            // Write all lines at once instead of delete+append loop
            let logFilePath = path.resolve(appPath,"./logs/versionLogs.txt");
            fs.writeFileSync(
                logFilePath,
                lines.map(line => JSON.stringify(line)).join('\n') + (lines.length > 0 ? '\n' : '')
            );
            
            appLogger({
                title: "Version Deleted",
                message: `Deleted backup for version ${versionObj.appVersion}`,
                func: "btn-ctrl-backend IPC delete-version"
            });
            return { success: true };
        } else {
            return { success: false, error: "Unknown command: " + cmd };
        }
    } catch(err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "btn-ctrl-backend IPC"
        });
        return { success: false, error: err.message };
    }
});