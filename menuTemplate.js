const {addPurchase,showPurchase} = require("./handlePurchase");
const {updateStock,displayStock} = require("./handleStock");

module.exports = mainWindow=>{
    return [
        // {
        //     label:"BBS",
        //     role:"appMenu"
        // },
        {
            label:"Sale"
        },
        {
            label:"Purchase",
            submenu:[
                {
                    label:"Add Purchase",
                    accelerator:"Shift+Return",
                    click: addPurchase(mainWindow)
                },
                {
                    label: "Check Purchases",
                    accelerator: "F2",
                    click: showPurchase(mainWindow)
                }
            ]
        },
        {
            label:"Stock",
            submenu:[
                {
                    label: "Update Stock",
                    accelerator: "F3",
                    click: updateStock(mainWindow)
                },
                {
                    label: "View Stock",
                    accelerator: "Shift+F3",
                    click: displayStock(mainWindow)
                }
            ]
        },
        {
            label:"Supplier"
        },
        {
            label:"Customer"
        },
        {
            label:"Analytics"
        },
        {
            label:"Docs"
        },
        {
            label:"Help"
        },
        {
            label:"Dev",
            submenu:[
                {
                    label:"Open devtool",
                    accelerator:"F1",
                    click:()=>{                        
                        console.log("Open devTool")
                        BrowserWindow.getFocusedWindow().webContents.openDevTools();
                    }
                },
                {
                    label:"Refresh",
                    accelerator:"F5",
                    click:()=>{
                        mainWindow.webContents.reload()
                    }
                }
            ]
        }
    ]
}