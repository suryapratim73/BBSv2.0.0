const { BrowserWindow } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {updateStock,displayStock,handleReturn} = require("./handleStock");
const {getSuplierPortal,checkOutPayments} = require("./supplierHandler");
const {saleWindow, showSales} = require("./saleHandler");
const { customerPortal } = require("./customerHandler");
const { createGSTSummaryWindow, createBusinessStatPage } = require("./businessHandler");
const { serviceRegistor } = require("./serviceHandler");

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
                    label:"Customer Portal",
                    accelerator: "F5",
                    click: customerPortal(mainWindow)
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
                    label: "Get Details",
                    accelerator: "F4",
                    click: getSuplierPortal(mainWindow)
                }
            ]
        },
        {
            label:"Tables",
            submenu:[
                {
                    label: "View Stock",
                    accelerator: "F9",
                    click: displayStock(mainWindow)
                },
                {
                    label: "Check Payments",
                    accelerator: "F10",
                    click: checkOutPayments(mainWindow)
                },
                {
                    label: "Check Purchases",
                    accelerator: "F11",
                    click: showPurchase(mainWindow)
                },
                {
                    label:"Show Sales",
                    accelerator:"F12",
                    click:showSales(mainWindow)
                }
            ]
        },
        {
            label:"Tools and Analytics",
            submenu: [
                {
                    label: "GST Summary",
                    click: createGSTSummaryWindow(mainWindow),
                    accelerator: "F2"
                },
                {
                    label: "Business Statistics",
                    click: createBusinessStatPage(mainWindow),
                    accelerator: "F3"
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
                    accelerator: "Shift+F6",
                    click: updateStock(mainWindow),
                    enabled: false
                },
                {
                    label:"Stock Return Registor",
                    click:handleReturn(),
                    accelerator: "F6"
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
                {
                    label: "Register Services",
                    click: serviceRegistor(mainWindow),
                    accelerator: "F8"
                },
                { 
                    label: "Settings",
                    accelerator: "Shift+F1"
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