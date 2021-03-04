const { createModal } = require("./createModal");

exports.getSuplier = mainWindow =>{
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
        let pathToHTML = "./template/html/getSupplier.html";
        createModal(windowOptions,pathToHTML);
    }
}

exports.getLedger = mainWindow =>{
    return ()=>{
        console.log("Get ledger")
    }
}

exports.addPaymentForSupplier = mainWindow=>{
    return ()=>{
        console.log("Add Payments")
    }
}