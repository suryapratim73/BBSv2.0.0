const {BrowserWindow, ipcMain, dialog} = require("electron");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");

exports.updateStock = mainWindow =>{
    return ()=>{
        createModal(undefined,"template/html/updateStock.html")
    }
}

exports.displayStock = mainWindow =>{
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            resizable:false,
            webPreferences: {
            nodeIntegration: true,
            devTools:true
            },
            show:false,
            parent:mainWindow,
            contextIsolation:true
        }   
        let pathToHTML = "./template/html/stockDisplay.html";
        createModal(windowOptions,pathToHTML)
    }
}

ipcMain.on("update-stock",async (e,{name,quantity,price,location})=>{
    try{
        let selectedStock = await stock.findOne({
            where:{
                name
            }
        })
        selectedStock.updateStock={quantity,price,location};
        if(await selectedStock.save()){
            BrowserWindow.getFocusedWindow().close();
            dialog.showMessageBox({
                title:"Stock update",
                message: "The selected stock has been updated successfully."            })
        }
    }
    catch(err){
        console.log(err)
    }
});

ipcMain.handle("get-stock-names",()=>{
    return stock.findAll({attributes:["name"]})
})

ipcMain.handle("get-stocks",()=>{
    return stock.findAll({attributes:["name","type","quantity","buyPrice","standardSellPrice","tax","hsn","unit"]})
})