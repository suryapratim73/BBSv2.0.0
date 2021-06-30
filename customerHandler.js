const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { customer } = require("./model/dbConfig");

exports.customerPortal = mainWindow =>{
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
        let pathToHTML = "./template/html/customerPortal.html";
        createModal(windowOptions,pathToHTML);
    }
}

ipcMain.on("get-customer",async e=>{
    let customerObj = (await (await customer.sync()).findAll()).map(({dataValues})=>dataValues);
    e.sender.send("customer-list",customerObj)
})