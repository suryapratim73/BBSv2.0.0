require("./common")
const { BrowserWindow, ipcMain, dialog, app } = require("electron");
const {addPurchase,showPurchase} = require("./handlePurchase");
const {displayStock,handleReturn} = require("./handleStock");
const {getSuplierPortal,checkOutPayments} = require("./supplierHandler");
const {saleWindow, showSales} = require("./saleHandler");
const { customerPortal } = require("./customerHandler");
const { createGSTSummaryWindow, createBusinessStatPage } = require("./businessHandler");
const { serviceRegistor } = require("./serviceHandler");
const { employeePortal } = require("./peopleHandler");
const { genRoadChallan, genVoucher, genPayReceipt, genRequirementSlip } = require("./exTool");
const { billDesignerWindow, getCurrentLogin, checkForUpdates } = require("./main");


function appStateComplianceEnforcement(funcName,...params){
    let currentUser = getCurrentLogin();
    if(!currentUser) return;
    funcName(...params);
}

module.exports = mainWindow=>{
    return [
        {
            label:"BBS",
            submenu: [
                {
                    label: "About BBS",
                    click: ()=>dialog.showMessageBox({
                        title:"Bigbyte Business Solution",
                        message:`We provide you a software that meet all your business needs at affordable cost. You are currently using BBS version ${app.getVersion()}`,
                        buttons:["Ok"]
                    })
                },
                {
                    label: "Check for update",
                    click: ()=>checkForUpdates()
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
                    label: "Lock",
                    click: ()=>appStateComplianceEnforcement(ipcMain.emit,"lock")
                },
                {
                    label: "Logout",
                    click: ()=>appStateComplianceEnforcement(ipcMain.emit,"logout")
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
                    accelerator:"CommandOrControl+Return",
                    click: ()=>appStateComplianceEnforcement(saleWindow())
                },
                {
                    label:"Customer Portal",
                    accelerator: "F5",
                    click: ()=>appStateComplianceEnforcement(customerPortal(mainWindow))
                }
            ]
        },// Sale menu
        {
            label:"Purchase",
            submenu:[
                {
                    label:"Add Purchase",
                    accelerator:"Shift+Return",
                    click: ()=>appStateComplianceEnforcement(addPurchase(mainWindow))
                },
                {
                    label: "Get Details",
                    accelerator: "F4",
                    click: ()=>appStateComplianceEnforcement(getSuplierPortal(mainWindow))
                }
            ]
        },// Purchase menu
        {
            label:"Tables",
            submenu:[
                {
                    label: "View Stock",
                    accelerator: "F9",
                    click: ()=>appStateComplianceEnforcement(displayStock(mainWindow))
                },
                {
                    label: "Check Payments",
                    accelerator: "F10",
                    click: ()=>appStateComplianceEnforcement(checkOutPayments(mainWindow))
                },
                {
                    label: "Check Purchases",
                    accelerator: "F11",
                    click: ()=>appStateComplianceEnforcement(showPurchase(mainWindow))
                },
                {
                    label:"Show Sales",
                    accelerator:"F12",
                    click: ()=>appStateComplianceEnforcement(showSales(mainWindow))
                }
            ]
        },// Table menu
        {
            label:"Tools and Analytics",
            submenu: [
                {
                    label: "GST Summary",
                    click: ()=>appStateComplianceEnforcement(createGSTSummaryWindow(mainWindow)),
                    accelerator: "F2"
                },
                {
                    label: "Business Statistics",
                    click: ()=>appStateComplianceEnforcement(createBusinessStatPage(mainWindow)),
                    accelerator: "F3"
                },
                {
                    label: "GST Return JSON"
                },
                {type:"separator"},
                {
                    label: "Generate Road Challan",
                    click: ()=>appStateComplianceEnforcement(genRoadChallan(mainWindow))
                },
                {
                    label: "Generate Voucher",
                    click: ()=>appStateComplianceEnforcement(genVoucher(mainWindow))
                },
                {
                    label: "Generate Payment Receipt",
                    click: ()=>appStateComplianceEnforcement(genPayReceipt(mainWindow)),
                },
                {
                    label: "Generate Requirement Slip",
                    click: ()=>appStateComplianceEnforcement(genRequirementSlip(mainWindow)),
                    accelerator: "Shift+F4" // Dev Time Shortcut
                },
                {
                    label: "Bill Layout Designer",
                    click: ()=>appStateComplianceEnforcement(billDesignerWindow(mainWindow))
                    
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
                    click: ()=>appStateComplianceEnforcement(handleReturn()),
                    accelerator: "F7"
                },
                { type: "separator" },
                {
                    label: "Employee Portal",
                    click: ()=>appStateComplianceEnforcement(employeePortal(mainWindow)),
                    accelerator: "F6"
                    // enabled: false
                },
                {
                    label: "Register Services",
                    click: ()=>appStateComplianceEnforcement(serviceRegistor(mainWindow)),
                    accelerator: "F8"
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