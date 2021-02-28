const log = text=>{
    console.log("\x1b[33m%s\x1b[0m",text)
}
const {addPurchase,showPurchase} = require("./handlePurchase");


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
                    click: showPurchase(mainWindow)
                }
            ]
        },
        {
            label:"Stock",
            submenu:[
                {
                    label:"Update Stock",
                },
                {
                    label:"View Stock"
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