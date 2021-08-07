const { BrowserWindow } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {updateStock,displayStock,handleReturn} = require("./handleStock");
const {getSuplier,getLedger,addPaymentForSupplier,checkOutPayments} = require("./supplierHandler");
const {saleWindow, showSales} = require("./saleHandler");
const { customerPortal } = require("./customerHandler");

module.exports = mainWindow=>{
    return [
        // {
        //     label:"BBS",
        //     role:"appMenu"
        // },
        {
            label:"Sale",
            submenu:[
                {
                    label:"Add Sale",
                    accelerator:"Return",
                    click:saleWindow()
                },
                {
                    label:"Show Sales",
                    accelerator:"F2",
                    click:showSales(mainWindow)
                }
            ]
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
                    accelerator: "Shift+F2",
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
                    label:"Stock Return Registor",
                    click:handleReturn()
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
                {
                    label: "Check Payments",
                    accelerator: "Shift+F5",
                    click: checkOutPayments(mainWindow)
                },
                {type:"separator"},
                {
                    label:"Help"
                }
            ]
        },
        {
            label:"Customer Portal",
            click: customerPortal(mainWindow)
        },
        {
            label:"Tools and Analytics"
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

//Work in progress on Supplier Menu. 09/03/2021