const { BrowserWindow } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {displayStock,handleReturn} = require("./handleStock");
const {getSuplierPortal,checkOutPayments} = require("./supplierHandler");
const {saleWindow, showSales} = require("./saleHandler");
const { customerPortal } = require("./customerHandler");
const { createGSTSummaryWindow, createBusinessStatPage } = require("./businessHandler");
const { serviceRegistor } = require("./serviceHandler");
const { employeePortal } = require("./peopleHandler");

module.exports = mainWindow=>{
    return [
        {
            label:"BBS",
            submenu: [
                {
                    label: "Settings",
                    accelerator: "Shift+F1"
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
        },// Application menu
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
        },// Sale menu
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
        },// Purchase menu
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
        },// Table menu
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
        },// Tools menu
        {
            label: "Admin",
            submenu: [
                {
                    label:"Stock Return Registor",
                    click:handleReturn(),
                    accelerator: "F7"
                },
                { type: "separator" },
                {
                    label: "Employee Portal",
                    click: employeePortal(mainWindow),
                    accelerator: "F6"
                    // enabled: false
                },
                {
                    label: "Register Services",
                    click: serviceRegistor(mainWindow),
                    accelerator: "F8"
                },
                { type: "separator" },
                {
                    label: "Lock/Unlock Admin",
                    // click: function(e){
                    //     e.menu.items.forEach(menu=>{
                    //         if(menu.enabled===false)
                    //             menu.enabled = true;
                    //     });
                    //     e.enabled = true;
                    // }
                }
            ]
        },// Admin menu
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
        }// Dev menu -- shall be removed
    ]
}

//Work in progress on Supplier Menu. 09/03/2021