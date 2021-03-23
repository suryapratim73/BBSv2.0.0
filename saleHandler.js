const {createModal} = require("./createModal");


exports.saleWindow = ()=>{
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
            contextIsolation:true
        }   
        let pathToHTML = "./template/html/salePage.html";
        createModal(windowOptions,pathToHTML);
    }
}

exports.showSales = mainWindow=>{
    return ()=>{
        console.log("Show Sales");
    }
}