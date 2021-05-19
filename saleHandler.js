const { ipcMain } = require("electron");
const {createModal} = require("./createModal");
const fs = require("fs");
const { BrowserWindow } = require("electron/main");

let closeFlag = false;

function cancelBill(){
    let rawData = fs.readFileSync(__dirname+"/config/saleConfig.json").toString();
    let saleConfig=rawData!==""?JSON.parse(rawData):{};
    saleConfig.billNo--;
    fs.writeFileSync(__dirname+"/config/saleConfig.json",JSON.stringify(saleConfig));
}

exports.saleWindow = ()=>{
    return ()=>{
        let windowOptions = {
            width: 1020,
            height: 600,
            resizable:false,
            webPreferences: {
            nodeIntegration: true,
            devTools:true
            },
            show:false,
            contextIsolation:true
        }   
        let pathToHTML = "./template/html/salePage.html";
        let saleWindow = createModal(windowOptions,pathToHTML);
        saleWindow.on("close",(e)=>{
            if(!closeFlag){
                e.preventDefault();
                e.sender.send("get-current-step");
            } else
                closeFlag = false;
        })
    }
}

exports.showSales = mainWindow=>{
    return ()=>{
        console.log("Show Sales");
    }
}

ipcMain.handle("get-sale-bill-number",()=>{
    let rawData = fs.readFileSync(__dirname+"/config/saleConfig.json").toString();
    let saleConfig=rawData!==""?JSON.parse(rawData):{};
    saleConfig.billNo = saleConfig.billNo?saleConfig.billNo+1:1;
    fs.writeFileSync(__dirname+"/config/saleConfig.json",JSON.stringify(saleConfig));
    return saleConfig.billNo;
});

ipcMain.on("cancel-sale-bill",(e,currentStep)=>{
    if(currentStep>1)
        cancelBill();
    closeFlag = true;
    BrowserWindow.getFocusedWindow().close();
});

ipcMain.on("save-exit-sale-bill",(e,{billMeta,customer,orderItems,payment})=>{
    console.log({billMeta,customer,orderItems,payment});
    cancelBill();
    closeFlag = true;
    BrowserWindow.getFocusedWindow().close();//Work in progress//DB works
});