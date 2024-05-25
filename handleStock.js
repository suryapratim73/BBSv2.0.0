const {BrowserWindow, ipcMain, dialog} = require("electron");
const { People, appLogger } = require("./common");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");


let stockList = [],
    windowOptions = {
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true
        }
    };

exports.displayStock = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        let pathToHTML = "./template/html/stockDisplay.html";
        createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Stock-Display"});
    }
}

exports.handleReturn = ()=>{
    return ()=>{ 
        let _windowOptions = {...windowOptions,width:400};
        let pathToHTML = "./template/html/goodsReturn.html";
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
        let stock = stockList.find(obj=>obj.id===id);
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
    return queryStock(["name","id"]);
});

async function queryStock(attributes){
    try{
        if(stockList.length===0)      
            (await (await stock.sync()).findAll())
            .map(({dataValues})=>dataValues)
            .forEach(obj=>{
                obj._type = "stock";
                stockList.push(new People(obj));
            });
        if(typeof attributes==="object"){
            return stockList.map(stockObj=>{
                let tempObj = {}
                for(let key in stockObj)
                    if(attributes.includes(key))
                        tempObj[key] = stockObj[key];
                return tempObj;
            })
        }
        else{
            return stockList
        }
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message
        })
        return stockList
    }
}

ipcMain.handle("get-stocks",()=>{
    return queryStock();
});

ipcMain.handle("get-more-info-on-selected-stock",async (e,id)=>{
    if(stockList.length===0)
        await queryStock();
    return stockList.find(obj=>obj.id===id);
});

ipcMain.handle("create-stock",async (e,itemObj)=>{
    let tax = 1 + ("igst" in itemObj ? itemObj.igst : itemObj.sgst + itemObj.cgst)/100;
    let buyPrice = Math.round(itemObj.rate/tax);
    if(!buyPrice)
        buyPrice = 0;
    itemObj = await stock.create({
        name:itemObj.name,
        hsn:itemObj.hsn,
        buyPrice
    });
    stockList.push(new People(itemObj.dataValues));
    return itemObj.dataValues;
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
    stockList = [];
    return queryStock();
});

ipcMain.on("refresh-stocklist",()=>{
    stockList = [];
    return queryStock();
});

exports.stockList = stockList;
exports.queryStock = queryStock;