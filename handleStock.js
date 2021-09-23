const {BrowserWindow, ipcMain, dialog} = require("electron");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");

exports.updateStock = mainWindow =>{
    return ()=>{
        createModal(undefined,"template/html/updateStock.html")
    }
}


exports.displayStock = mainWindow =>{
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
    };
    return ()=>{
        let pathToHTML = "./template/html/stockDisplay.html";
        createModal(windowOptions,pathToHTML)
    }
}

exports.handleReturn = ()=>{
    return ()=>{ 
        let pathToHTML = "./template/html/goodsReturn.html";
        createModal(null,pathToHTML)
    }
}

ipcMain.on("update-stock",async (e,{name,quantity,price,location,feildMap})=>{
    try{
        await stock.update({pInfo:feildMap},{
            where:{name}
        })
        let selectedStock = await stock.findOne({
            where:{
                name
            }
        });
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
});// This need a relook

ipcMain.handle("get-stock-names",async ()=>{
    return (await (await stock.sync()).findAll({attributes:["name","id"]})).map(({dataValues})=>dataValues);
});

ipcMain.handle("get-stocks",()=>{
    return stock.findAll({attributes:["name","type","quantity","buyPrice","standardSellPrice","tax","hsn","unit"]})
});

ipcMain.handle("get-more-info-on-selected-stock",async (e,id)=>{
    return (await stock.findOne({
        where:{
            id
        }
    })).dataValues;
})

// ipcMain.handle("get-more-info-on-selected-stock",async (e,selectedStock)=>{
//     return (await stock.findOne({
//         where:{
//             name:selectedStock
//         },
//         attributes: ["pInfo"]
//     })).dataValues;
// });