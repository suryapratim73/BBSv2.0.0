const {BrowserWindow, ipcMain, dialog, app} = require("electron");
const { People, appLogger, getFivePercentOfMemory, queryStock } = require("./common");
const { createModal } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const {stock} = require("./model/dbConfig");


let windowOptions = {
        width: 800,
        height: 600
    };

exports.displayStock = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        let pathToHTML = getTemplatePath("stockDisplay");
        createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Stock-Display"});
    }
}

exports.handleReturn = ()=>{
    return ()=>{ 
        let _windowOptions = {...windowOptions,width:400};
        let pathToHTML = getTemplatePath("goodsReturn");
        createModal(_windowOptions,pathToHTML,{maxWinCount:1,label:"Item-Return-Handler"});
    }
}

ipcMain.on("update-stock",async (e,itemObj)=>{
    let {
        id,
        name,
        hsn,
        standardSellPrice,
        type,
        pInfo
    } = itemObj
    stock.update({
        name,
        hsn,
        standardSellPrice,
        type,
        pInfo
    },{
        where:{id}
    })
    .then(()=>{
        let msg = {
            type: "info",
            title: "Stock Info Updated",
            message: "Stock information updated successfully."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        let stock = global.stocks.find(obj=>obj.id===id);
        stock.name = name;
        stock.hsn = hsn;
        stock.standardSellPrice = standardSellPrice;
        stock.type = type;
        stock.pInfo = {...pInfo};
        appLogger("stock information updated successfully",JSON.stringify({id,name}));
        e.sender.send("update-stock-response",stock);
    })
    .catch(console.log)
});

ipcMain.handle("get-stock-names",()=>{
    return queryStock(stock,["name","id"],appLogger,getFivePercentOfMemory);
});


ipcMain.handle("get-stocks",()=>{
    return queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
});

ipcMain.handle("get-more-info-on-selected-stock",async (e,id)=>{
    if(typeof global.stocks==="undefined")
        await queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
    return global.stocks.find(obj=>obj.id===id);
});

ipcMain.handle("create-stock",async (e,itemObj)=>{
    itemObj = await stock.findOrCreate({
        where:{
            name:itemObj.name,
        },
        defaults:{
            name:itemObj.name,
            hsn:itemObj.hsn,
            buyPrice:0
        }
    });
    ipcMain.emit("refresh-stocklist");
    return itemObj[0].dataValues;
});

ipcMain.on("item-pinfo",async (e,id,key,value)=>{
    let { pInfo } = (await stock.findOne({
        where:{ id }
    })).dataValues;
    await stock.update(
        {
            pInfo:{
                ...pInfo,
                [key]:value
            }
        },
        {
            where:{
                id
            }
        }
    )
});

ipcMain.on("save-stock-info",async (e,id,updateObj)=>{
    try{
        let itemObj = (await stock.findOne({
            where:{ id }
        })).dataValues;
        Object.keys(updateObj)
        .forEach(key=>{
            if(key in itemObj)
                itemObj[key] = /^\d+$/.test(updateObj[key]) ? Number(updateObj[key]) : updateObj[key];
            else
                itemObj.pInfo[key] = /^\d+$/.test(updateObj[key]) ? Number(updateObj[key]) : updateObj[key];
        });
        await stock.update(
            itemObj,
            {
                where:{
                    id
                }
            }
        );
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"save-stock-info"
        });
    }
})

ipcMain.handle("refresh-stocklist",()=>{
    global.stocks = undefined;
    return queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
});

ipcMain.on("refresh-stocklist",()=>{
    global.stocks = undefined;
    return queryStock(stock,undefined,appLogger,getFivePercentOfMemory);
});