const { ipcMain, dialog, Menu, app } = require("electron");
const { createModal, getMainWindow, getTargetWindow } = require("./createModal");
const { BrowserWindow } = require("electron/main");
const { getTemplatePath } = require("./viewManager");
const { customer, stock, freight, inPayments, sale, people, sequelize } = require("./model/dbConfig");
const { getLedgerModel, customerList, initCustomerList, getBillModel, getBillManager, appLogger, People, getBaseDir, priceInspector, captionReducer, getFinYearStrtEndDt, getFivePercentOfMemory, getAllSales, openFormatForDate, attempt } = require("./common");
const { printOnLinuxOrMac, printOnWindows, printDialog } = require("./printHandler");
const { getsaleConfigPolicyPath, getOrderPath, getProformaPath, roundOffTo2DecimalPlace, getUserPolicyPath } = require("./template/js/common");
const { loadProformas, upsertProforma, removeProforma } = require("./lib/proformaStore");
const fs = require("fs");
const path = require("path");
const { billPDF } = require("./scripts/makePDF.default");
const scheduler = require("./lib/scheduler");
const uuid = require("uuid");
const { DataTypes, Op, } = require("sequelize");
const { deserializeSchema } = require("./model/schemaLoader");

let appPath = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/") : __dirname;
let dynamicSchemaPath = path.resolve(appPath,"./model/dynamicSchemas.json");
if(!(fs.existsSync(dynamicSchemaPath))){
    fs.writeFileSync(dynamicSchemaPath,JSON.stringify({}));
    global.needsSchemaBootstrap = true;
}
const dynamicSchemaJson = fs.existsSync(dynamicSchemaPath) ? fs.readFileSync(dynamicSchemaPath, 'utf8') : null;
const { customerLedgerSchema, billItemSchema } = fs.existsSync(dynamicSchemaPath) ? deserializeSchema(dynamicSchemaJson, DataTypes) : {};

// ============================================================
//  Zen Mode — while active, every invoice carries the same
//  target bill date until its stop condition triggers or the
//  user stops it manually. State persists across restarts.
//  State shape: { targetDate, stopType, stopValue, billNos,
//                 activatedAt }  stopType: manual | bill-numbers | duration
// ============================================================
const zenModePath = path.resolve(appPath, "zenMode.json");

function loadZenStateFromDisk() {
    try {
        if (!fs.existsSync(zenModePath)) return null;
        const state = JSON.parse(fs.readFileSync(zenModePath, "utf8"));
        if (!state || !state.targetDate || !["manual", "bill-numbers", "duration"].includes(state.stopType))
            return null;
        return state;
    } catch (_) {
        return null;
    }
}

function saveZenStateToDisk() {
    try {
        if (zenState)
            fs.writeFileSync(zenModePath, JSON.stringify(zenState, null, 2));
        else if (fs.existsSync(zenModePath))
            fs.unlinkSync(zenModePath);
    } catch (err) {
        appLogger({ title: "Zen Mode", message: String(err), func: "saveZenStateToDisk" });
    }
}

let zenState = loadZenStateFromDisk();

/** Number of currently selected zen bill numbers that are already consumed. */
function zenConsumedBillNos() {
    try {
        const pool = getBillManager().getState().pool;
        return zenState.billNos.filter(no => {
            const entry = pool.find(e => Number(e.billNo) === Number(no));
            return entry && entry.isConsumed;
        }).length;
    } catch (_) {
        return 0;
    }
}

function stopZenMode(auto = false) {
    const stopped = zenState;
    zenState = null;
    saveZenStateToDisk();
    broadcastZenState();
    appLogger({
        title: "Zen Mode",
        message: auto
            ? "Zen Mode auto-stopped — stop condition met (" + (stopped?.stopType || "") + ")."
            : "Zen Mode stopped by user.",
        func: auto ? "stopZenMode - auto" : "stopZenMode - manual"
    });
    return stopped;
}

/**
 * Live zen state, or null. Lazily evaluates the stop conditions
 * (duration expiry / all selected bill numbers consumed) and
 * auto-stops when one has been met.
 */
function getZenState() {
    if (!zenState) return null;
    if (zenState.stopType === "duration" &&
        Date.now() >= zenState.activatedAt + zenState.stopValue * 3600000) {
        stopZenMode(true);
        return null;
    }
    if (zenState.stopType === "bill-numbers" &&
        zenState.billNos.length > 0 &&
        zenConsumedBillNos() === zenState.billNos.length) {
        stopZenMode(true);
        return null;
    }
    return zenState;
}

function zenStateSnapshot() {
    const state = getZenState();
    if (!state) return null;
    let progress = {};
    if (state.stopType === "bill-numbers") {
        progress.totalBills = state.billNos.length;
        progress.consumedBills = zenConsumedBillNos();
    }
    if (state.stopType === "duration") {
        progress.timeLeftMs = Math.max(0, state.activatedAt + state.stopValue * 3600000 - Date.now());
    }
    return { ...state, billNos: state.billNos.slice(), progress };
}

function broadcastZenState() {
    // Send the snapshot (with progress) — renderers display timeLeft/bill count from it.
    const snapshot = zenStateSnapshot();
    BrowserWindow.getAllWindows().forEach(win => {
        try {
            if (!win.isDestroyed()) win.webContents.send("zen-mode-update", snapshot);
        } catch (_) {}
    });
}


let closeFlag = false,
    saleWindow,
    windowOptions = {
        width: 800,
        height: 600
    };

exports.saleWindow = ()=>{
    return (target="salePage",mode="new-sale",preset={})=>{
        windowOptions.parent = undefined;
        process.presets.target = target;
        process.presets.mode = mode;
        Object.keys(preset)
        .forEach(key=>{
            process.presets[key] = preset[key];
        });
        saleWindow = createModal(windowOptions,getTemplatePath("salePage"));
        // saleWindow.webContents.openDevTools()
        saleWindow.on("unresponsive",(e)=>{
            appLogger({
                title:"Error",
                message:"Sale window unresponsive",
                func:"saleWindow - unresponsive"
            });
        });
        // saleWindow.webContents.toggleDevTools()
        saleWindow?.on("close",(e)=>{
            if(!closeFlag){
                e.preventDefault();
                saleWindow.send("get-current-step");
            } else
                closeFlag = false;
            getMainWindow().webContents.send("update-content");
        });
        // Safety net: force-close / crash → release reservation
        saleWindow?.on("destroyed", () => {
            if (saleWindow && saleWindow.id) {
                getBillManager().release("sale-" + saleWindow.id);
            }
        });
    }
}

exports.showSales = mainWindow=>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,getTemplatePath("showSale"),{maxWinCount:1,label:"Sale-Dsiplay"});
    }
}

exports.orderManager = (main,cb)=>{
    return ()=>{
        windowOptions.parent = main;
        let saleWindow = createModal(windowOptions,getTemplatePath("orderManager"),{label:"manage-order",cb});
        // saleWindow.webContents.openDevTools();
        saleWindow?.on("close",(e)=>{
            getMainWindow().webContents.send("update-content");
        });
        return saleWindow;
    }
}

exports.zenMode = (main)=>{
    return ()=>{
        let _windowOptions = { ...windowOptions }
        _windowOptions.parent = main;
        _windowOptions.width = 420;
        _windowOptions.height = 560;
        createModal(_windowOptions,getTemplatePath("zenMode"),{maxWinCount:1,label:"zen-mode"});
    };
}

// ============================================================
//  Zen Mode IPC
// ============================================================

ipcMain.on("open-zen-mode", ()=>{
    exports.zenMode(getMainWindow())();
});

ipcMain.handle("get-zen-mode-state", ()=>{
    try {
        return zenStateSnapshot();
    } catch(err) {
        console.error("Error in get-zen-mode-state:", err);
        return null;
    }
});

ipcMain.handle("get-available-bill-numbers", ()=>{
    try {
        return getBillManager().getState().pool
            .slice()
            .sort((a,b)=>a.billNo-b.billNo)
            .map(entry=>({
                billNo: entry.billNo,
                isConsumed: entry.isConsumed,
                reserved: !!entry.windowId
            }));
    } catch(err) {
        console.error("Error in get-available-bill-numbers:", err);
        return [];
    }
});

ipcMain.handle("activate-zen-mode", (e,payload)=>{
    try {
        payload = payload || {};
        const targetDate = String(payload.targetDate || "").trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || isNaN(new Date(targetDate + "T00:00:00.000Z").getTime()))
            return { ok:false, message:"Please pick a valid target date." };
        const stopType = ["manual","bill-numbers","duration"].includes(payload.stopType) ? payload.stopType : "manual";
        let stopValue = null, billNos = [];
        if(stopType==="duration"){
            stopValue = Number(payload.stopValue);
            if(!(stopValue>0))
                return { ok:false, message:"Please enter a valid duration." };
        }
        if(stopType==="bill-numbers"){
            billNos = [...new Set((payload.billNos||[]).map(n=>Math.trunc(Number(n))).filter(n=>n>0))]
                .sort((a,b)=>a-b);
            if(!billNos.length)
                return { ok:false, message:"Select at least one bill number." };
            // Already consumed bill numbers are not allowed
            const consumed = billNos.filter(no=>{
                const entry = getBillManager().getState().pool.find(e=>Number(e.billNo)===Number(no));
                return entry && entry.isConsumed;
            });
            if(consumed.length)
                return { ok:false, message:"Bill number(s) already used: " + consumed.join(", ") };
        }
        zenState = {
            targetDate,
            discVal:payload.discVal || 0,
            stopType,
            stopValue,
            billNos,
            activatedAt: (zenState && zenState.activatedAt) || Date.now() // keep original start when updating an active run
        };
        saveZenStateToDisk();
        broadcastZenState();
        appLogger({ title:"Zen Mode", message:JSON.stringify({action:"activate", ...zenState}), func:"activate-zen-mode" });
        return { ok:true, message:"Zen Mode is active.", state: zenStateSnapshot() };
    } catch(err) {
        console.error("Error in activate-zen-mode:", err);
        return { ok:false, message:String(err) };
    }
});

ipcMain.handle("stop-zen-mode", ()=>{
    stopZenMode(false);
    return { ok:true };
});

ipcMain.on("open-sale-in-order-mode",async (e,{billMeta,orderItems,customer})=>{
    exports.saleWindow()("salePage","edit-order",{
        customer,
        billMeta,
        orderItems,
        currentStep:1,
    });
});

ipcMain.handle("get-sale-bill-number",(e)=>{
    try {
        const windowId = e.sender.id;
        const sessionId = "sale-" + windowId;
        const billNo = getBillManager().allocate(sessionId);
    appLogger({
        title:"Log",
        message:JSON.stringify({billNo, windowId, sessionId}),
        func:"IPC event:get-sale-bill-number"
    });
    return billNo;
    } catch(err) {
        console.error("Error in get-sale-bill-number:", err);
        return null;
    }
});

ipcMain.on("cancel-sale-bill",(e,currentStep)=>{
    try {
        const windowId = e.sender.id;
        const sessionId = "sale-" + windowId;
        // Release the reserved bill number back to the pool.
        // BillManager tracks per-session, so out-of-order cancellations
        // are handled correctly — the right number always returns to the pool.
        if(currentStep>1 && process.presets.mode!="edit-bill")
            getBillManager().release(sessionId);
        closeFlag = true;
        BrowserWindow.getFocusedWindow().close();
        ["billMeta","orderItems","customer","target","mode","proformaId"]
        .forEach(key=>{
            if(typeof process.presets[key]!="undefined")
                delete process.presets[key];
        });
    } catch(err) {
        console.error("Error in cancel-sale-bill:", err);
    }
});

function itemAnalyzer(orderItems){
    let itemList = JSON.parse(JSON.stringify(orderItems));
    itemList = itemList.reduce((acc,itemObj)=>{
        let match = acc.find(obj=>obj.name===itemObj.name);
        if(match && match.rate===itemObj.rate)
            match.qty += itemObj.qty;
        else
            acc.push(itemObj);
        return acc;
    },[]); // Item Grouping
    return itemList;
}

async function helperFunc1({id,name,qty,sellUnit,rate,amt,cgst=0,sgst=0,igst=0,hsn,type,desc="",pHistory},billModel,custId,billDate,billNo,grpTag=false,grpId,grpName,grpDesc,billType){
    try{
        let tax = Number(igst)>0?Number(igst):Number(cgst)+Number(sgst);
        let { unitMap } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
        sellUnit = sellUnit ? sellUnit : "Kg";
        let multiplier = Object.values(unitMap.find(obj=>sellUnit in obj))[0];
        pHistory = attempt(()=>{
            return JSON.parse(pHistory);
        },[]);
        if(pHistory.length>0){
            // Removing entries older than 6 months from pHistory
            let sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            pHistory = pHistory.filter(entry => new Date(entry.date) >= sixMonthsAgo);
        }
        pHistory.push({
            date:billDate,
            billNo,
            custId,
            qty,
            unit:sellUnit,
            rate,
            tax,
        });
        let billModelObj = {
            name,
            type,
            hsn,
            quantity:qty,
            unit:sellUnit,
            rate:rate*multiplier,
            tax:tax*amt/100,
            sgst,
            cgst,
            igst,
            desc
        };
        if(grpTag){
            billModelObj.isGrouped = true;
            billModelObj.grpId = grpId;
            billModelObj.grpName = grpName;
            billModelObj.desc = grpDesc;
        }
        await billModel.create(billModelObj);
        if(!id)
            return ipcMain.emit("create-stock",null,{name,hsn});
        // Don't reduce stock for proforma bills
        if(billType !== "proforma"){
            let item = await stock.findOne({where:{id}});
            item.reduceStock = qty*multiplier;
            await item.save();
        }
        let item = await stock.findOne({ where:{ id } });
        await stock.update({
            pInfo:{
                ...item.pInfo,
                taxSlab:igst>0?igst:2*sgst
            },
            pHistory
        },{
            where:{id}
        })
        let match =  global.stocks.find(obj=>obj.id===id);
        if(!match){
            match = {};
            match.quantity = 0;
            match.specialPrice = [];
        }
        match.quantity -= qty*multiplier;
        let customerSpPrices = match.specialPrice?.filter(obj=>obj.customerId==custId)?.slice(0,5);
        match.specialPrice = match.specialPrice?.filter(obj=>obj.customerId!=custId);
        match.specialPrice = [
            ...match.specialPrice,
            ...customerSpPrices
        ]
        match.specialPrice?.push({
            customerId:custId,
            rate,
            billDate,
            billNo
        })
        return stock.update({
            specialPrice:match.specialPrice
        },{
            where:{id}
        });
    }
    catch(err){
        console.log(err)
        appLogger({
            title:"Stock updation error",
            message:String(err),
            func:"helperFunc1"
        })
    }
}

function recalculateAmounts(orderedItems){
    let {netAmt,netAmtTax,netTax} = orderedItems.reduce((acc,obj)=>{
        function processItems(obj){
            acc.netAmt += obj.rate * obj.qty;
            let taxSlab =  Number(obj.igst) > 0
                            ? Number(obj.igst)
                            : Number(obj.cgst || 0) + Number(obj.sgst || 0);
            acc.netAmtTax += roundOffTo2DecimalPlace((1+taxSlab/100)*obj.rate*obj.qty);
            acc.netTax += roundOffTo2DecimalPlace(taxSlab*obj.rate*obj.qty/100);
        }
        if(obj.type==="grp")
            obj.items.forEach(obj=>processItems(obj));
        else
            processItems(obj);
        return acc;
    },{netAmt:0,netAmtTax:0,netTax:0});

    return {netAmt,netAmtTax,netTax};
}

async function save_exit(e,{billMeta,customer:customerObj,orderItems,orderId=""},flag="regular"){
    const { cityListWithCodes } = require("./common");
    closeFlag = true;
    saleWindow = BrowserWindow.fromId(e.sender.id) || BrowserWindow.getFocusedWindow();
    if(flag==="regular" || flag==="print")
        saleWindow.close();
    if(!Object.keys(billMeta).includes("printObj"))
        billMeta.printObj = {captions:[{first:"Original Buyer's Copy"},{third:"Book Copy"}]};    
    const { name, address, phones, gst, email, id:custId } = customerObj;
    if(billMeta.target==="salePage"){
        if(billMeta.mode==="edit-bill")
            getTargetWindow("customer-portal").webContents.send("reload-tables")
        if(billMeta.mode==="edit-order"){
            manageOrder(null,billMeta,"order-billed");
            try { getTargetWindow("manage-order")?.webContents?.send("billing-complete"); } catch (_) {}
        }
        if(billMeta.mode==="new-from-proforma"){
            // A proforma converted to a real invoice — remove the quote record.
            if(process.presets.proformaId)
                manageProforma(process.presets.proformaId,"proforma-billed");
            try { getTargetWindow("manage-order")?.webContents?.send("billing-complete"); } catch (_) {}
        }
        if(["edit-order","edit-bill","new-from-proforma"].includes(billMeta.mode)){
            delete process.presets.orderItems;
            delete process.presets.customer;
            delete process.presets.billMeta;
            delete process.presets.proformaId;
        }
        Reflect.deleteProperty(process.presets,"target");
        Reflect.deleteProperty(process.presets,"mode");
    }
    let { billExpiry = 14 } = JSON.parse(fs.readFileSync(getUserPolicyPath()).toString())
    let {
        billStatus,
        deliveryType,
        transportName="",
        transportId="",
        transportAddress="",
        transportContact="",
        transportGST="",
        netDue,
        billNo,
        billDate,
        netTax = billMeta.netAmtTax - billMeta.netAmt,
        payment=[],
        netAmt,
        paymentStatus,
        billType,
        autoBill,
        orderRef,
        netAmtTax,
        scrapTDSAmt = 0
    } = billMeta;
    billMeta.netTax = netTax;
    ({netAmt, netAmtTax, netTax} = recalculateAmounts(orderItems));
    billMeta.netAmt = netAmt;
    billMeta.netAmtTax = netAmtTax;
    billMeta.netTax = netTax;
    // Zen Mode: every invoice saved while zen is active carries the target date.
    // Editing an old bill (edit-bill) keeps its original date.
    const zenAtSave = getZenState();
    if (zenAtSave && !["edit-bill"].includes(billMeta.mode)) {
        billDate = new Date(zenAtSave.targetDate + "T00:00:00.000Z");
        billMeta.billDate = billDate;
    }
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    if(billType === "proforma" && (!billMeta.printObj.captions || !billMeta.printObj.captions.length))
        billMeta.printObj = { ...billMeta.printObj, captions: [{first:"Proforma Invoice"}] };
    billMeta.printObj.captions = captionReducer(billMeta.printObj.captions);

    // Consume the reserved bill number (no-op for edit-bill, kiosk, or already-consumed)
    if (e && e.sender && e.sender.id && !["edit-order","edit-bill"].includes(billMeta.mode)) {
        const sessionId = "sale-" + e.sender.id;
        if(getBillManager().allocate(sessionId)===Number(billNo)){
            getBillManager().consume(sessionId,billNo);
        }
        else
            getBillManager().release(sessionId);
    }
    // Proforma bills are quotes, not invoices: persist them to proformas.json
    // (same convention as orders.json) instead of the sale/ledger/stock tables,
    // so they stay out of the dashboard and can be converted from Order Manager.
    if(billType === "proforma" && billMeta.mode !== "edit-bill")
        return await saveProforma(e,{billMeta,customer:customerObj,orderItems},flag);
    // return billPDF({billMeta,customer:customerObj,orderItems});// Temporary blocking
    let netPayment = Math.round(payment?.reduce((acc,obj)=>acc+obj.payment,0) ?? 0);
    if(!netDue && paymentStatus===false)
        netDue = Math.round(netAmt + netTax);
    else
        netDue = Math.round(netAmt + netTax - netPayment);
    if(deliveryType!=="hand"){
        if(transportId==="")
            transportId = uuid.v5(JSON.stringify({transportName,transportAddress,transportContact,transportGST}),"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
        await freight.findOrCreate({
            where:{id:transportId},
            defaults:{
                id:transportId,
                name:transportName,
                address:transportAddress,
                phone:transportContact,
                gst:transportGST
            }
        })
        .then(()=>{appLogger({title:"Log", message:"Transporter db updated!!", func:"save_exit"})})
        .catch(err=>appLogger({
            title:"Error",
            message:String(err),
            func:"save_exit - transporter findOrCreate"
        }));
    }
    let match = await customer.findOne({where:{id:custId}});
    // Saving new customer or updating existing customer - shipping info
    if(!match){// New customer block
        customerObj._type = "customer";
        let custObj = {
            ...customerObj,
            moreInfo:{
                email,
                shipInfos:billMeta.shipTo!=="" ? [
                    {
                        name:billMeta.shipTo,
                        shipTo:billMeta.shipTo,
                        shipAddr:billMeta.shipAddr,
                        shipPh:billMeta.shipPh,
                        shipGST:billMeta.shipGST
                    }
                ] : []
            }};
        Reflect.deleteProperty(custObj,"email");
        global.customerList.push(new People(custObj));
        await customer.findOrCreate({
            where:{
                id:custId
            },
            defaults:{
                id:custId,
                name,
                address,
                phones:JSON.stringify(phones),
                gst,
                moreInfo:{
                    email,
                    shipInfos:billMeta.shipTo!=="" ? [
                        {
                            name:billMeta.shipTo,
                            shipTo:billMeta.shipTo,
                            shipAddr:billMeta.shipAddr,
                            shipPh:billMeta.shipPh,
                            shipGST:billMeta.shipGST
                        }
                    ] : []
                }
            }
        })
        .then(()=>appLogger({title:"Log", message:"Customer db updated", func:"save_exit"}))
        .catch(err=>appLogger({
            title:"Error",
            message:String(err),
            func:"save_exit - customer findOrCreate"
        }));
    }
    else{// Existing customer block
        let shipInfos = match.moreInfo?.shipInfos ?? [];// Existing customer shipping infos
        shipInfos = shipInfos.filter(obj=>obj.shipTo!=="");// Removing empty shipping info if exist
        let _shipInfos = [];
        function getCityNameNAbbreviation(addr){
            return cityListWithCodes.find(({name,commonAbbreviation})=>new RegExp(name,"i").test(addr) || (commonAbbreviation && new RegExp(commonAbbreviation,"i").test(addr)));
        }
        function isDuplicate(shipInfo,_shipInfo){
            let cityCheckFlag = false, pincodeCheckFlag = false;
            // Check 1: Identical objects
            if(shipInfo.shipTo.toLowerCase() === _shipInfo.shipTo.toLowerCase() && shipInfo.shipAddr.toLowerCase() === _shipInfo.shipAddr.toLowerCase() && shipInfo.shipPh === _shipInfo.shipPh && shipInfo.shipGST === _shipInfo.shipGST)
                return -1;// Duplicate // Ditto same shipping info must be duplicate even if shipTo name is written in different case
            // Check 2: Kol = Kolkata type duplicate by city name and phone number
            let { name:cityName,commonAbbreviation,pincode } = getCityNameNAbbreviation(shipInfo.shipAddr) || {};
            let { name:_cityName,commonAbbreviation:_commonAbbreviation,pincode:_pincode } = getCityNameNAbbreviation(_shipInfo.shipAddr) || {};
            if(!cityName || !_cityName || !commonAbbreviation || !_commonAbbreviation || !pincode || !_pincode)
                return 0;// May be duplicate // Must have been some missing info in cityListWithCodes.json to identify city name or abbreviation from address, so skipping duplicate check for this pair of shipping infos
            if(cityName.toLowerCase() === _cityName.toLowerCase() || commonAbbreviation.toLowerCase() === _commonAbbreviation.toLowerCase())
                cityCheckFlag = true;// Duplicate // Same city name or common abbreviation but in different case must be duplicate
            if(new RegExp(cityName,"i").test(_shipInfo.shipAddr) || new RegExp(commonAbbreviation,"i").test(shipInfo.shipAddr))
                cityCheckFlag = true;// Duplicate // Kol or Kolkata must match as they represent same city but written in different way
            if(pincode && _pincode && pincode === _pincode)
                pincodeCheckFlag = true;// Duplicate // Same pincode must be duplicate
            if(cityCheckFlag && pincodeCheckFlag)
                return -1;// Duplicate
            return 0;// Not duplicate
        }
        for(let i=0;i<shipInfos.length;i++){// Filtering Kol = Kolkata type duplicate shipping infos
            if(_shipInfos.findIndex(obj=>isDuplicate(obj,shipInfos[i]))===-1)
                _shipInfos.push(shipInfos[i]);// Section need testing - To be done
        }
        shipInfos = _shipInfos;
        let shipInfoIndex = shipInfos.findIndex(obj=>obj.shipTo===billMeta.shipTo && obj.shipAddr.toLowerCase()===billMeta.shipAddr.toLowerCase() && obj.shipPh===billMeta.shipPh && obj.shipGST===billMeta.shipGST);
        if(shipInfoIndex===-1 && billMeta.shipTo!==""){// New shipping info added for existing customer only if not empty
            shipInfos.push({
                name:billMeta.shipTo,
                shipTo:billMeta.shipTo,
                shipAddr:billMeta.shipAddr,
                shipPh:billMeta.shipPh,
                shipGST:billMeta.shipGST
            });
            match.moreInfo = {  
                ...match.moreInfo,
                email,
                shipInfos
            };
        }
        match.updateMoreInfo = match.moreInfo;
        await match.save();
    }
    const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
    ];
    // Price inspection
    try{
        await Promise.all(orderItems.map(async itemObj=>{
            if(itemObj.type==="grp")
                return await Promise.all(itemObj.items.map(itemObj=>priceInspector(itemObj)))
            return priceInspector(itemObj)
        }));
    }
    catch(err){
        return dialog.showErrorBox("Price ceiling violation","Sorry you don't have enough permission to sell at above or below price ceiling decided for the item by your administrator. Please contact your administrator.")
    }
    let billModel = await getBillModel(custId,(billNo==="spot"?monthNames[new Date().getMonth()]:billNo),billDate,billItemSchema);    
    let customerLedger = await getLedgerModel(custId,customerLedgerSchema);
    let lastBalance = (await ((await customerLedger.sync()).findOne({
        attributes:["balance"],
        order:[
            ["entryNo","DESC"]
        ]
    })))?.dataValues.balance ?? 0;
    orderItems = itemAnalyzer(orderItems); // Merging same items with same rate. A cosmetic change.
    Promise.all([
        ...orderItems
        .filter(obj=>obj.type!=="service")
        .map(obj=>{
            if(obj.type==="grp"){
                let grpId = uuid.v4();
                return obj.items.map(_obj=>helperFunc1(_obj,billModel,custId,billDate,billNo,true,grpId,obj.name,obj.desc,billType));
            }
            else
                return helperFunc1(obj,billModel,custId,billDate,billNo,billType);
        }),//updating stock
        (billNo!=="spot" && customerLedger.create({
            billStatus,
            date: billDate,
            billNo,
            billAmt:Math.round(netAmtTax),
            payments:Math.round(netPayment),
            itemList:`${custId}_${billNo}_${billDate}`,
            balance: Math.round(lastBalance + netAmtTax - netPayment)
        })),
        (await sale.sync()).create({// Update Sale Table to make room for discVal
            billStatus,
            customerId:custId,
            name,
            billNo,
            billType,
            billDate,
            billAmt:netAmtTax + (scrapTDSAmt || 0),
            netAmt,
            tax:netTax,
            payment:netPayment,
            paymentStatus,
            netDue:netDue,
            billItemTable:`${custId}_${billNo}_${billDate}`,
            autoBill,
            orderRef,
            delivery:deliveryType!=="hand"?{transportName,transportAddress,transportContact,deliveryType,transportGST}:"hand",
            billformonth:monthNames[new Date().getMonth()],
            shipTo:billMeta.shipTo,
            shipAddr:billMeta.shipAddr,
            shipPh:billMeta.shipPh,
            shipGST:billMeta.shipGST,
            ewayBill:billMeta.ewayBill,
            placeOfSupply:billMeta.placeOfSupply,
            stateNcode:billMeta.stateNcode,
            moreInfo: JSON.stringify({ scrapTDSAmt: scrapTDSAmt || 0 })
        })
    ])
    .then(async ()=>{
        if(netPayment>0)
            await (await inPayments.sync())
            .create({
                id:custId,
                payment:netPayment,
                date:billDate
            });
        console.log("Added to DB!!");
        let msg = {
            type: "info",
            title: "Bill saved",
            message: "Bill added to your sale and stocks and/or ledger updated."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        // Zen Mode: re-evaluate the stop condition after this invoice saved.
        // If it just auto-stopped, tell the user so the next bills don't
        // surprise them with the current date.
        if (zenAtSave && !["edit-bill"].includes(billMeta.mode) && !getZenState())
            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),{
                type: "info",
                title: "Zen Mode ended",
                message: "Zen Mode has stopped — its stop condition was met. New invoices will use the current date again."
            });
        let concatenatedObj = {
            ...billMeta,
            orderItems,
            customer
        };
        appLogger({title:"sale", message:JSON.stringify(concatenatedObj), func:"save_exit", user:"user"});
        // if(flag!="regular"){
        //     await manageOrder(null,{billMeta,customer:customerObj,orderItems,orderId},flag);
        //     var orderWin = BrowserWindow.fromId(e.sender.id);
        //     if (orderWin) orderWin.webContents.send("billing-complete");
        // }
        // Schedule payment reminder for unpaid bills (works for kiosk + regular)
        if(paymentStatus===false){
            let evObj = {
                label:`Bill Number ${billNo} expired`,
                type: "bill-payment",
                billType: "sales-select",
                time: new Date(new Date(billDate).getTime() + billExpiry * 24 * 60 * 60 * 1000),
                tag: "Payment collection",
                color: "#0000FF",
                billObj:{
                    ...billMeta,
                    ...customerObj
                }
            }
            scheduler.addEvent(evObj);
        }
        // Burst automation: the scheduler notices a run of bill saves and
        // offers to print them (printable snapshot captured here while the
        // full bill data is in scope).
        scheduler.noteBillSaved({billMeta, customer:customerObj, orderItems}, billNo);
        // Notify main window to refresh (fallback for kiosk/null sender)
        var notifyWin = BrowserWindow.fromId(e.frameId) || getMainWindow();
        if (notifyWin) notifyWin.webContents.send("update-content");
    })
    .catch(console.log);
    if(billType!=="monthly")
        return billPDF({billMeta,customer:customerObj,orderItems});
    closeFlag = true;
    ipcMain.emit("refresh-customer-list");
    console.log({costomerObj:global.customerList.find(obj=>obj.id===custId)})
}

ipcMain.on("save-exit-sale-bill",save_exit);

ipcMain.handle("get-customers",async ()=>{
    try {
        if(typeof global.customerList === "undefined")
            await initCustomerList(customer,appLogger,getFivePercentOfMemory);
        return global.customerList;
    } catch(err) {
        console.error("Error in get-customers:", err);
        return [];
    }
});

ipcMain.on("salepage-print-doc",async (e,billObj,flag="regular")=>{
    try {
        let path2pdf = await save_exit(e,billObj,"print");
    if(!path2pdf) return;
    // return path2pdf; // Temporary blocking
    let {billMeta:{billStatus,printObj:{ printer,copies=1,paperSize,printOrientation } } } = billObj;
    if(billStatus!=="open")
        switch(process.platform){
            case "linux":
                return printOnLinuxOrMac(path2pdf,printer,copies,paperSize,printOrientation);
            case "win32":
                return printOnWindows(path2pdf,printer,copies,paperSize);
            case "darwin":
                return printOnLinuxOrMac(path2pdf,printer,copies);
            default:
                dialog.showErrorBox("Unsupported OS","Print funcationality is not supported for your OS. Try print the bill manually.");
        }
    else
        dialog.showErrorBox("Print blocked","Bill status is currently 'open', set the bill status to 'close' and try again.")
    } catch(err) {
        console.error("Error in salepage-print-doc:", err);
        dialog.showErrorBox("Print Error", "Error printing document: " + err.message);
    }
});

ipcMain.handle("get-transporter",async ()=>{
    try {
        return (await (await freight.sync()).findAll({
        where:{
            id:{
                [Op.ne]:""
            }
        },
        order:[["name","ASC"]]
    })).map(({dataValues})=>dataValues);
    } catch(err) {
        console.error("Error in get-transporter:", err);
        return [];
    }
});

ipcMain.on("get-sales",async e=>{
    try{
        let sales = typeof global.sales!=="undefined" ? global.sales : await getAllSales(sale,appLogger,getFivePercentOfMemory);
        sales = sales.filter(bill=>bill.billType!=="proforma"); // proformas live in proformas.json, not the dashboard
        e.sender.send("get-sales-response",sales);
    }
    catch(err){
        console.log(err)
    }

});

ipcMain.handle("get-sales",async e=>{
    try {
        return (await (await sale.sync()).findAll({
            where:{
                billType:{
                    [Op.ne]:"proforma" // proformas live in proformas.json, not the dashboard
                }
            },
            order:[["entryNo","DESC"]]
        })).map(({dataValues})=>dataValues);
    } catch(err) {
        console.error("Error in get-sales (handle):", err);
        return [];
    }
});

ipcMain.handle("get-ledger-balance",async (e,custId)=>{
    try {
        let customerLedger = await getLedgerModel(custId,customerLedgerSchema);
        return (await ((await customerLedger.sync()).findOne({
            attributes:["balance"],
            order:[
                ["entryNo","DESC"]
            ]
        })))?.dataValues.balance ?? 0;
    } catch(err) {
        console.error("Error in get-ledger-balance:", err);
        return 0;
    }
});

ipcMain.on("new-order",async (e,{billMeta,customer,orderItems})=>{
    const { printPDF } = require("./main");
    // Use customer name as fallback when billMeta.name is empty (e.g., from sale page)
    let name = (customer && customer.name) || "";
    let address = (customer && customer.address) || "";
    let gst = (customer && customer.gst) || "";
    let email = (customer && customer.email) || "";
    let phones = (customer && customer.phones) || [];
    let { netAmtTax, netDue, paymentStatus } = billMeta;
    let orderId = uuid.v4();
    let mode = billMeta.billType;
    let ordersFilePath = path.resolve(getBaseDir(),"orders.json");
    let data = [];
    try {
        if(fs.existsSync(ordersFilePath))
            data = JSON.parse(fs.readFileSync(ordersFilePath).toString());
        if(!Array.isArray(data)) data = [];
    } catch (_) {}
    if (!billMeta.billDate)
        billMeta.billDate = openFormatForDate(new Date());
    if(paymentStatus===false && billMeta.netPayment===0){
        billMeta.netDue = Math.round(netAmtTax);
        netDue = billMeta.netDue;
    }
    let orderObj = {
        orderId,
        status:"queued",
        paymentStatus,
        name,
        netAmtTax,
        netDue,
        billDate:billMeta.billDate,
        billMeta,
        customer,
        orderItems
    };
    if(Array.isArray(data)){
        // Dedup: remove any existing entry with the same orderId
        data = data.filter(function(o){ return o.orderId !== orderId; });
        data.push(orderObj);
    } else {
        data = [orderObj];
    }
    try{
        fs.writeFileSync(ordersFilePath,JSON.stringify(data));
    }
    catch(err){
        appLogger({
            title:"Error",
            message:err.message,
            func:"new-order — write orders.json"
        });
    }
    if(mode==="proforma"){
        billMeta.printObj = {
            captions:["Proforma Invoice"]
        };
        billMeta.billNo = "proforma_"+orderId.slice(0,orderId.length/3);
        let path2pdf = await billPDF({billMeta,customer:{name,address,email,phones,gst},orderItems});
        let resp = await dialog.showMessageBox({
            title:"Choose a action",
            message:"Do you like to print the proforma bill?",
            buttons:["Print","Save & Exit"]
        });
        if(resp.response===0){// Continue to print order
            let modal = printDialog(function(){
                this.webContents.send("hide-label");
            });
            let orderWin = modal.getParentWindow();
            function _print(e,printObj){
                billMeta.printObj = {
                    ...printObj,
                    captions:["Proforma Invoice"]
                };
                modal.close();
                orderWin.close();
                printPDF(path2pdf,billMeta.printObj);
            }
            modal.on("close",()=>ipcMain.removeListener("print-obj",_print));
            ipcMain.once("print-obj",_print);
        }
        else {
            const win = BrowserWindow.fromId(e.sender?.id) || BrowserWindow.getFocusedWindow();
            if (win) win.close();
        }
    }
    if(mode!=="proforma"){
        const win = BrowserWindow.fromId(e.sender?.id) || BrowserWindow.getFocusedWindow();
        if (win) win.close();
    }
});

async function manageOrder(e,billMeta,flag){
    let orderPath = getOrderPath();
    try{
        if(flag==="order-billed" || flag==="order-deleted"){
            let id = billMeta.orderId;
            let orderJSON = JSON.parse(fs.readFileSync(orderPath).toString());
            orderJSON = Array.isArray(orderJSON) ? orderJSON.filter(function(o){ return o.orderId !== id; }) : [];
            fs.writeFileSync(orderPath,JSON.stringify(orderJSON));
        }
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"manageOrder"
        });
    }
}

ipcMain.handle("manage-order",manageOrder);

/**
 * Persist a proforma bill to proformas.json — quotes are never written to the
 * sale/ledger/stock tables, so they never appear on the dashboard. Returns the
 * generated PDF path for the print flow.
 */
async function saveProforma(e,{billMeta,customer:customerObj,orderItems},flag="regular"){
    // A proforma is a quote — its caption must say so. The record stores the
    // reduced caption shape (same as a regular bill); on conversion the
    // printObj is dropped entirely, so the real invoice gets fresh captions.
    billMeta.printObj = billMeta.printObj || {};
    billMeta.printObj.captions = ["Proforma Invoice"];
    const { netAmt, netAmtTax, netTax } = recalculateAmounts(orderItems);
    billMeta.netAmt = netAmt;
    billMeta.netAmtTax = netAmtTax;
    billMeta.netTax = netTax;
    billMeta.netDue = Math.round(netAmtTax);
    billMeta.payment = billMeta.payment || [];
    billMeta.paymentStatus = false;
    const proformaId = billMeta.proformaId || uuid.v4();
    const entry = {
        proformaId,
        status: "pending",
        paymentStatus: false,
        name: (customerObj && customerObj.name) || billMeta.name || "",
        netAmtTax: Math.round(netAmtTax),
        netDue: Math.round(netAmtTax),
        billDate: openFormatForDate(billMeta.billDate),
        createdAt: new Date().toISOString(),
        billMeta,
        customer: customerObj,
        orderItems
    };
    let proformasPath = getProformaPath();
    let data = loadProformas(proformasPath, fs);
    data = upsertProforma(data, entry);
    try {
        fs.writeFileSync(proformasPath, JSON.stringify(data));
    } catch(err) {
        appLogger({
            title:"Error",
            message:String(err),
            func:"saveProforma — write proformas.json"
        });
    }
    appLogger({
        title:"Proforma",
        message:JSON.stringify({action:"save", proformaId, name:entry.name, netAmtTax:entry.netAmtTax}),
        func:"saveProforma"
    });
    // Order Manager (if open) should show the new quote
    try { getTargetWindow("manage-order")?.webContents?.send("refresh-orders"); } catch (_) {}
    if(flag!=="print" && process.env.APP_ENV!=="DEV")
        dialog.showMessageBox(getMainWindow(),{
            title:"Proforma saved",
            message:`Proforma saved for ${entry.name} (₹${entry.netAmtTax}).`,
            detail:"It is available under Order Manager → Proforma Bills and can be converted to a real invoice anytime."
        });
    return billPDF({billMeta,customer:customerObj,orderItems});
}

async function manageProforma(proformaId,flag){
    let proformasPath = getProformaPath();
    try{
        if(flag==="proforma-billed" || flag==="proforma-deleted"){
            let data = loadProformas(proformasPath, fs);
            data = removeProforma(data, proformaId);
            fs.writeFileSync(proformasPath, JSON.stringify(data));
        }
    }
    catch(err){
        appLogger({
            title:"Error",
            message:String(err),
            func:"manageProforma"
        });
    }
}

ipcMain.handle("manage-proforma",(e,{proformaId},flag)=>manageProforma(proformaId,flag));

ipcMain.handle("get-proforma",(e,proformaId)=>{
    try {
        let data = loadProformas(getProformaPath(), fs);
        return data.find(function(o){ return o.proformaId === proformaId; }) || null;
    } catch(err) {
        appLogger({
            title:"Error",
            message:String(err),
            func:"get-proforma"
        });
        return null;
    }
});

ipcMain.on("open-sale-from-proforma",(e,{customer,billMeta,orderItems,proformaId})=>{
    exports.saleWindow()("salePage","new-from-proforma",{
        customer,
        billMeta,
        orderItems,
        currentStep:1,
        proformaId,
    });
});

ipcMain.on("set-listener-order-manager",(e)=>{
    ipcMain.once("print-obj",(ev,printObj)=>{
        getTargetWindow("Custom-Print-Dialog").close();
        e.sender.send("printObj",printObj);
    });
});

ipcMain.handle("get-order",(e,orderId)=>{
    try {
        let orderPath = getOrderPath();
        let orders = JSON.parse(fs.readFileSync(orderPath).toString());
        let entry = (Array.isArray(orders) ? orders : []).find(function(o){ return o.orderId === orderId; });
        return entry;
    } catch(err) {
        appLogger({
            title:"Error",
            message:String(err),
            func:"get-order"
        });
        return null;
    }
});

function traverseDate(date,annualHolidays,weeklyHolidays){
    if((annualHolidays.find(dt=>dt.getDate()===date.getDate() && dt.getMonth()===date.getMonth())) || weeklyHolidays.includes(date.getDay())){
        date.setDate(date.getDate()-1);
        return traverseDate(date,annualHolidays,weeklyHolidays);
    }
    else
        return date;
}

ipcMain.handle("get-date", ()=>{
    // Zen Mode: while active, every new invoice starts with the target date
    const zen = getZenState();
    if(zen)
        return new Date(zen.targetDate + "T00:00:00.000Z");
    let date = new Date();
    let dayArray = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    let annualHolidays = (process.presets.annualHolidays?.split(",").map(dt=>dt.trim())
                        .map(dt=>{
                            let [ dd,mm,yyyy ] = dt.split("/");
                            mm--;
                            return new Date(yyyy,mm,dd)
                        }) ?? []);
    let weeklyHolidays = (process.presets.weeklyHolidays?.split(",").map(day=>day.trim())
                        .map(day=>dayArray.findIndex(entry=>entry===day)) ?? []);
    date = traverseDate(date,annualHolidays,weeklyHolidays);
    return date;
})