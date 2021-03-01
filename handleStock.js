const {BrowserWindow} = require("electron");
const { createModal } = require("./createModal");

exports.updateStock = mainWindow =>{
    return ()=>{
        createModal(undefined,"template/html/updateStock.html")
    }
}

exports.displayStock = mainWindow =>{
    return ()=>{
        console.log("Display stock ")
    }
}