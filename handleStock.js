const {BrowserWindow, ipcMain, dialog} = require("electron");
const { People } = require("./common");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");


let stockList = [],
    windowOptions = {
        width: 800,
        height: 600
    };

exports.updateStock = () =>{
    return ()=>{
        createModal(null,"template/html/updateStock.html",{maxWinCount:1,label:"Stock-Updater"});
    }
}

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

ipcMain.handle("get-stock-names",()=>{
    return queryStock(["name","id"]);
});

async function queryStock(attributes){
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

// ipcMain.handle("get-more-info-on-selected-stock",async (e,selectedStock)=>{
//     return (await stock.findOne({
//         where:{
//             name:selectedStock
//         },
//         attributes: ["pInfo"]
//     })).dataValues;
// });