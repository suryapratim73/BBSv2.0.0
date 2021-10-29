const {BrowserWindow, ipcMain, dialog} = require("electron");
const { People } = require("./common");
const { createModal } = require("./createModal");
const {stock} = require("./model/dbConfig");


let stockList = [];

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

ipcMain.handle("get-more-info-on-selected-stock",(e,id)=>{
    if(stockList.length===0)
        queryStock();
    return stockList.find(obj=>obj.id===id);
});

exports.stockList = stockList;

// ipcMain.handle("get-more-info-on-selected-stock",async (e,selectedStock)=>{
//     return (await stock.findOne({
//         where:{
//             name:selectedStock
//         },
//         attributes: ["pInfo"]
//     })).dataValues;
// });