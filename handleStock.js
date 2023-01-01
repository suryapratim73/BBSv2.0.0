const {BrowserWindow, ipcMain, dialog} = require("electron");
const { People, appLogger } = require("./common");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");


let stockList = [],
    windowOptions = {
        width: 800,
        height: 600
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

exports.stockList = stockList;
exports.queryStock = queryStock;