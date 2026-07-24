require("./common")
const { BrowserWindow, ipcMain, dialog, app } = require("electron");
const { addPurchase,showPurchase } = require("./handlePurchase");
const { displayStock,handleReturn } = require("./handleStock");
const { getSuplierPortal,checkOutPayments } = require("./supplierHandler");
const { saleWindow, showSales, orderRegister, orderManager } = require("./saleHandler");
const { customerPortal } = require("./customerHandler");
const { createGSTSummaryWindow, createBusinessStatPage } = require("./businessHandler");
const { serviceRegistor } = require("./serviceHandler");
const { employeePortal } = require("./peopleHandler");
const { genRoadChallan, genVoucher, genPayReceipt, genRequirementSlip } = require("./exTool");
const { versionManager } = require("./versionManager");
const { billDesignerWindow } = require("./common");
const { logViewer } = require("./logHandler");
const { openCatalogueCreator } = require("./catalogueHandler");

function appStateComplianceEnforcement(funcName,...params){
    if(!global.user) return;
    let key = params.pop();
    if(process.appStatus==="block-non-sp-key" && key==="block-non-sp-key") return
    if(["lock","logout"].includes(key))
        return ipcMain.emit(key);
    funcName(...params);
}

module.exports = mainWindow=>{
    let menu = [
        {// Application menu
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
                    click: ()=>{
                        ipcMain.emit("check-for-update");
                    },
                    accelerator: "CommandOrControl+Shift+U"
                },
                {
                    label: "Help",
                    click: ()=>ipcMain.emit("open-help")
                },
                { type: "separator" },
                {
                    label: "Lock",
                    click: ()=>appStateComplianceEnforcement(ipcMain.emit,"lock"),
                    accelerator:"CommandOrControl+L"
                },
                {
                    label: "Logout",
                    click: ()=>appStateComplianceEnforcement(ipcMain.emit,"logout"),
                    accelerator:"CommandOrControl+Shift+L"
                },
                { type: "separator" },
                { 
                    label:"Verson Manager",
                    click: ()=>appStateComplianceEnforcement(versionManager),
                    accelerator:"Shift+F2"
                },
                { role: "quit" }
            ]
        },
        {// Sale menu
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
                },
                // Kiosk disabled for v2.22 — sale flow + orderManager need rework
                // {type:"separator"},
                // {
                //     label: "Start Kiosk Mode",
                //     click: ()=>ipcMain.emit("open-kiosk")
                // },
                {
                    label: "View Orders",
                    click:()=>appStateComplianceEnforcement(orderManager(mainWindow)),
                    accelerator:"Shift+F5"
                },
                {
                    label: "Add item to \"Open\" Bills",
                    click:()=>{}
                }
            ]
        },
        {// Purchase menu
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
        },
        {// Table menu
            label:"Tables",
            submenu:[
                {
                    label: "View Stock",
                    // accelerator: "Shift+T+S",
                    click: ()=>appStateComplianceEnforcement(displayStock(mainWindow),"block-non-sp-key")
                },
                {
                    label: "Check Payments",
                    // accelerator: "Shift+T+P",
                    click: ()=>appStateComplianceEnforcement(checkOutPayments(mainWindow),"block-non-sp-key")
                },
                {
                    label: "Check Purchases",
                    // accelerator: "T+P",
                    click: ()=>appStateComplianceEnforcement(showPurchase(mainWindow),"block-non-sp-key")
                },
                {
                    label:"Show Sales",
                    // accelerator:"T+S",
                    click: ()=>appStateComplianceEnforcement(showSales(mainWindow),"block-non-sp-key")
                },
                {type:"separator"},
                {
                    label: "Catalogue Creator",
                    click: ()=>appStateComplianceEnforcement(openCatalogueCreator(mainWindow))
                }
            ]
        },
        {// Tools menu
            label:"Tools and Analytics",
            submenu: [
                {
                    label: "GST Summary",
                    click: ()=>appStateComplianceEnforcement(createGSTSummaryWindow(mainWindow))
                },
                {
                    label: "Business Statistics",
                    click: ()=>appStateComplianceEnforcement(createBusinessStatPage(mainWindow)),
                    accelerator:"F7"
                },
                {
                    label: "View Logs",
                    click: ()=>appStateComplianceEnforcement(logViewer(mainWindow))
                },
                // {
                //     label: "GST Return JSON"
                // },
                {type:"separator"},
                // {
                //     label: "Generate Road Challan",
                //     click: ()=>appStateComplianceEnforcement(genRoadChallan(mainWindow))
                // },
                // {
                //     label: "Generate Voucher",
                //     click: ()=>appStateComplianceEnforcement(genVoucher(mainWindow))
                // },
                // {
                //     label: "Generate Payment Receipt",
                //     click: ()=>appStateComplianceEnforcement(genPayReceipt(mainWindow)),
                // },
                // {
                //     label: "Generate Requirement Slip",
                //     click: ()=>appStateComplianceEnforcement(genRequirementSlip(mainWindow))
                // },
                // {
                //     label: "Bill Layout Designer",
                //     click: ()=>appStateComplianceEnforcement(billDesignerWindow(mainWindow)),
                //     accelerator:"CommandOrControl+B"
                    
                // },
                {
                    label: "Scheduler",
                    click: ()=>{
                        const { scheduleManager } = require("./main");
                        appStateComplianceEnforcement(scheduleManager(mainWindow))
                    },
                    accelerator: "F6"
                },
                // {type:"separator"},
                // {
                //     label: "BBS Remote"
                // }
            ]
        },
        {// Admin menu
            label: "Admin",
            submenu: [
                // {
                //     label:"Stock Return Registor",
                //     click: ()=>appStateComplianceEnforcement(handleReturn())
                // },
                // { type: "separator" },
                {
                    label: "Employee Portal",
                    click: ()=>appStateComplianceEnforcement(employeePortal(mainWindow))
                    // enabled: false
                },
                {
                    label: "Register Services",
                    click: ()=>appStateComplianceEnforcement(serviceRegistor(mainWindow))
                }
            ]
        }
    ];
    if(process.env.APP_ENV==="DEV")
        menu.push(
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
                            mainWindow.webContents.reload()
                        }
                    }
                ]
                // enabled:false,// process.env.APP_ENV=="DEV",
            })
    return menu;
}

//Work in progress on Supplier Menu. 09/03/2021