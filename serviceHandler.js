const { ipcMain, dialog, BrowserWindow } = require("electron");
const { People, appLogger } = require("./common");
// const {  } = require("./common");
const { createModal } = require("./createModal");
const { service } = require("./model/dbConfig");


let windowOptions = {
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true
        }
    },
    serviceList = []; 

exports.serviceRegistor = function (mainWindow){
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"./template/html/serviceRegistor.html",{maxWinCount:1,label:"Service-Registor"});
    }
}

async function initService(){
    try{
        (await (await service.sync()).findAll())
        .map(({dataValues})=>{
            serviceList.push(new People(dataValues));
            return dataValues;
        });
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message
        })
    }
}

ipcMain.handle("get-services",async e=>{
    if(serviceList.length===0)
        await initService();
    return serviceList;
});

ipcMain.on("add-new-service",(e,servObj)=>{
    const {
        id,
        name,
        rate,
        unit,
        hsn,
        pInfo
    } = servObj;
    service.findOrCreate({
        where:{ id },
        defaults:{
            id,
            name,
            hsn,
            type:"type" in pInfo? pInfo.type : "service",
            unit,
            standardSellPrice:rate,
            pInfo
        }
    })
    .then(([{dataValues},newEntry])=>{
        if(newEntry){
            serviceList.push(new People(dataValues));
            let msg = {
                type: "info",
                title: "Service Added",
                message: "New Service added to database."
            }
            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
            const {id=null,name=""} = dataValues;
            appLogger("new Service added to database",JSON.stringify({id,name}));
            console.log(serviceList.find(obj=>obj.id===id));
        }
        else{
            let msg = {
                type: "info",
                title: "Service Exist",
                message: "The Service seems to exist in your database."
            }
            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        }
        e.sender.send("db-process-done");
    })
    .catch(console.log);
});

ipcMain.on("update-service",async (e,servObj)=>{
    const { id } = servObj;
    service.update(servObj,{
        where:{
            id
        }
    })
    .then(()=>{
        let msg = {
            type: "info",
            title: "Update Successful",
            message: "Service information updated successfully."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        appLogger("service information updated successfully",JSON.stringify({id,name:servObj.name}));
        let serv = serviceList.find(obj=>obj.id===id);
        Object.keys(servObj)
        .forEach(key=>{
            serv[key] = servObj[key];
        });
    })
    .catch(console.log);
});