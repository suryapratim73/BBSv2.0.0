const { BrowserWindow } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {updateStock,displayStock,handleReturn} = require("./handleStock");
const {getSuplierPortal,checkOutPayments} = require("./supplierHandler");
const {saleWindow, showSales} = require("./saleHandler");
const { customerPortal } = require("./customerHandler");
const { createGSTSummaryWindow, createBusinessStatPage } = require("./businessHandler");

module.exports = mainWindow=>{
    return [
        {
            label:"BBS",
            submenu: [
                {
                    label: "Settings"
                },
                {
                    label: "Backup and Restore"
                },
                {
                    label: "Help",
                    submenu: [
                        {
                            label: "BBS Manual"
                        },
                        {
                            label: "Open BBS Official Website"
                        }
                    ]
                },
                { type: "separator" },
                {
                    label: "About"
                },
                {
                    label: "Check for update"
                },
                { type: "separator" },
                {
                    label: "Lock"
                },
                {
                    label: "Logout"
                },
                { type: "separator" },
                { role: "quit" }
            ]
        },
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
                }
            ]
        },
        {
            label:"Stock",
            submenu:[
                {
                    label: "View Stock",
                    accelerator: "Shift+F3",
                    click: displayStock(mainWindow)
                },
                {
                    label:"Stock Return Registor",
                    click:handleReturn()
                }
            ]
        },
        {
            label:"Supplier",
            submenu: [
                {
                    label: "Get Details",
                    accelerator:"F4",
                    click: getSuplierPortal(mainWindow)
                },
                // {
                //     label: "Check Ledger",
                //     accelerator: "Shift+F4",
                //     click: getLedger(mainWindow)
                // },
                {type:"separator"},
                // {
                //     label: "Add Payment",
                //     accelerator: "F5",
                //     click: addPaymentForSupplier(mainWindow)
                // },
                {
                    label: "Check Payments",
                    accelerator: "Shift+F5",
                    click: checkOutPayments(mainWindow)
                }
            ]
        },
        {
            label:"Customer Portal",
            click: customerPortal(mainWindow)
        },
        {
            label:"Tools and Analytics",
            submenu: [
                {
                    label: "GST Summary",
                    click: createGSTSummaryWindow(mainWindow)
                },
                {
                    label: "Business Statistics",
                    click: createBusinessStatPage(mainWindow)
                },
                {
                    label: "GST Return JSON"
                },
                {type:"separator"},
                {
                    label: "Generate Road Challan"
                },
                {
                    label: "Generate Voucher"
                },
                {
                    label: "Generate Payment Receipt"
                },
                {type:"separator"},
                {
                    label: "BBS Remote"
                }
            ]
        },
        {
            label: "Admin",
            submenu: [
                {
                    label: "Update Stock",
                    accelerator: "F3",
                    click: updateStock(mainWindow),
                    enabled: false
                },
                { type: "separator" },
                {
                    label: "Register New Employee",
                    enabled: false
                },
                {
                    label: "Employee Portal",
                    enabled: false
                },
                { type: "separator" },
                {
                    label: "Lock/Unlock Admin",
                    click: function(e){
                        e.menu.items.forEach(menu=>{
                            if(menu.enabled===false)
                                menu.enabled = true;
                            else
                                menu.enabled = false;
                        });
                        e.enabled = true;
                    }
                }
            ]
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