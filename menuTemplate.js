const { BrowserWindow } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {updateStock,displayStock} = require("./handleStock");
const {getSuplier,getLedger,addPaymentForSupplier} = require("./supplierHandler");

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
                },
                {type:"separator"},
                {
                    label: "Help"
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
                },
                {type:"separator"},
                {
                    label: "Help"
                }
            ]
        },
        {
            label:"Supplier",
            submenu: [
                {
                    label: "Get Details",
                    accelerator:"F4",
                    click: getSuplier(mainWindow)
                },
                {
                    label: "Check Ledger",
                    accelerator: "Shift+F4",
                    click: getLedger(mainWindow)
                },
                {type:"separator"},
                {
                    label: "Add Payment",
                    accelerator: "F5",
                    click: addPaymentForSupplier(mainWindow)
                },
                {type:"separator"},
                {
                    label:"Help"
                }
            ]
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
                    click:()=>{
                        // mainWindow.webContents.reload()
                    }
                }
            ]
        }
    ]
}