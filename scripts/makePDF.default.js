const PDFDocument = require('pdfkit');
const fs = require("fs");
const {app, dialog} = require("electron");
const path = require("path");
const { createHeader, createBody, createFooter, createLedgerHead, createLedgerBody, fillLedgerEntry, roadChallanHeader, roadChallanFooter, roadChallanBody, voucherDoc, payReceiptDoc, genReqSlipDocHeader, genReqSlipDocFooter, genReqSlipDocBody, createHeader2, createFooter2, createBody2 } = require('../lib/buildPage.default');
const { getsaleConfigPolicyPath, capitalize } = require("../template/js/common");
const { EventEmitter } = require("events");
const { emblemMaker } = require('../lib/common');

// let path2
if(process.APP_ENV==="DEV"){}

function initBillPDF({customer:{name},billMeta:{billDate,billNo},margin},template,autoFirstPage=true,temp,paperSize){
    const { getPDF_FileName, openFormatForDate,getBillsDir } = require('../common');
    let docOpts = {
        margin,
        compress: true,
        // userPassword: null,
        ownerPassword: "1234", // Will use cryptography for it later
        permissions: {
        printing: "highResolution",
        modifying: false,
        copying: true,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
        },
        autoFirstPage,
        size: paperSize || "A4",
    }
    if(template){
        let { size,applyMargin,margin } = template;
        if(applyMargin)
            docOpts.margin = margin
        else
            docOpts.margin = 0;
        docOpts.size = size;
    }
    const doc = new PDFDocument(docOpts);
    let pdfPath = getBillsDir();
    if(!fs.existsSync(pdfPath))
        fs.mkdirSync(pdfPath, { recursive: true });
    let pdfFileName = getPDF_FileName(name,billDate,billNo,temp);
    doc.pipe(fs.createWriteStream(path.join(pdfPath,pdfFileName)));
    pdfPath = path.join(pdfPath,pdfFileName);
    return {doc,pdfPath};
}

async function applyEmblem(imgWidth=100, imgOpacity=50,saleConfig,doc,x,y){
    let { emblem="",applyEmblem=false } = (saleConfig.billTemplate ?? {});
    if(emblem==="")
        return;
    if(applyEmblem===false) return;
    let filePath = path.resolve(__dirname, emblem);
    if(!fs.existsSync(filePath)) return dialog.showErrorBox("File desn't exist",filePath+" path doesn't exist. Try resetting emblem.");
    let imgDataURL = await emblemMaker(filePath,imgOpacity);
    doc.image(imgDataURL, x, y,{height:imgWidth});
}

exports.billPDF = async function(billObj,temp=false){
    const { openFormatForDate } = require('../common');
    const {billMeta,customer,orderItems} = billObj;
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { margin, paperSize } = saleConfig;
    if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===true && fs.existsSync(saleConfig.billTemplate.file)){
        let { main } = require("../lib/execCustomTemplate");
        let data = fs.readFileSync(saleConfig.billTemplate.file);
        let template = JSON.parse(data.toString());
        const {doc,pdfPath} = initBillPDF(billObj,template,true,temp,paperSize);
        return main(doc,pdfPath,billObj,template);
    }
    const {doc,pdfPath} = initBillPDF({...billObj,margin},null,false,temp,paperSize);
    const {printObj:{captions}={captions:["Original Buyer's Copy"]}} = billMeta;
    let topY,bottomY,factor,myEmitter = new EventEmitter();
    myEmitter.on("pageAdded",async caption=>{
        let { width } = doc.page;
        factor = (width-margin)/20;
        if(billMeta.billDate instanceof Date)
            billMeta.billDate = openFormatForDate(billMeta.billDate);
        createHeader2(doc,billMeta,customer,caption);
        topY = doc.y;
        bottomY = createFooter2(doc,billMeta,customer,margin);
        doc.moveTo(margin,topY).lineTo(margin,bottomY);
        doc.moveTo((width-margin),topY).lineTo((width-margin),bottomY);
        // Column partitions
        let xPos = Math.ceil(margin+6+doc.widthOfString("S.N."));
        doc
        .moveTo(xPos,topY).lineTo(xPos,bottomY)
        .moveTo((width-margin)/2,topY).lineTo((width-margin)/2,bottomY)
        .moveTo((width-margin)/2+2*factor,topY).lineTo((width-margin)/2+2*factor,bottomY)
        .moveTo((width-margin)/2+4*factor,topY).lineTo((width-margin)/2+4*factor,bottomY)
        .moveTo((width-margin)/2+5*factor,topY).lineTo((width-margin)/2+5*factor,bottomY)
        .moveTo((width-margin)/2+7*factor,topY).lineTo((width-margin)/2+7*factor,bottomY)
        .moveTo((width-margin)/2+8*factor,topY).lineTo((width-margin)/2+8*factor,bottomY);
    });
    myEmitter.on("newPage",(caption)=>{
        doc.addPage();
        myEmitter.emit("pageAdded",caption);
        doc.stroke();
        doc.y = topY;
        let {defaultFontFamily,defaultFontSize } = saleConfig;
        doc.font(defaultFontFamily).fontSize(defaultFontSize).moveDown();
    });
    if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===false && saleConfig.billTemplate.file==="default2"){// For Krishna Da
        // Default 2 template
        for(let x=0;x<captions.length;x++){
            let caption = captions[x];
            myEmitter.emit("newPage",caption);
            let { width } = doc.page;
            await applyEmblem(100,30,saleConfig,doc,width/2,topY+20);
            for(let i=0;i<orderItems.length;i++){
                let itemObj = orderItems[i];
                createBody2(doc,itemObj,i+1,factor);
                if(doc.y+2*doc.currentLineHeight()>=bottomY){
                    myEmitter.emit("newPage",caption);
                    await applyEmblem(100,30,saleConfig,doc,width/2,topY+20);
                }
            }
        }
        doc.save().end();
        return pdfPath;
    }
    // Default 1 template
    doc.addPage();
    let j,lastJ=0,lastI=0;
    loop1:
    for(let i=0;i<captions.length;i++){
        j=lastJ;
        if(i>lastI){
            lastI = i;
            j = 0;
            lastJ = 0;
            doc.addPage();
        }
        await applyEmblem(75,75,0.5,saleConfig,doc,)
        doc.opacity(1)
        .font(saleConfig.titleFontFamily)
        .text(captions[i],{
            align:'right'
        })
        createHeader(doc,billMeta,customer);
        createFooter(doc,billMeta,customer);
        let initialY = 265;
        for(;j<orderItems.length;j++){
            createBody(doc,orderItems[j],initialY,j+1)
            doc.moveDown();
            initialY = doc.y;
            if(initialY>640 - 2*doc.currentLineHeight() && j<orderItems.length-1){
                doc.addPage();
                i--;
                lastJ = j+1;
                continue loop1;
            }
        }
    }
    doc.save().end();
    return pdfPath;
}

/**
 * Process a sale or purchase entry into ledger row format
 */
function processSalePurchaseEntry(entry) {
    const { date, billNo, billAmt, type, payments } = entry;
    const amount = billAmt - payments;
    const debitCredit = type === "sale" ? "Dr" : "Cr";
    
    return {
        date: date,
        particular: `${capitalize(type)}: Bill Number:${billNo}`,
        amount: `${amount} ${debitCredit}`
    };
}

/**
 * Process a payment entry into ledger row format
 */
function processPaymentEntry(entry) {
    try {
        const { itemList, payments } = entry;
        const payObj = JSON.parse(`${itemList}`);
        const payDate = new Date(payObj.paymode === "cash" ? new Date() : payObj["pay-dt"]);
        
        let particular;
        if (payObj.paymode === "cash") {
            particular = "Payment received by cash";
        } else {
            const trnsRef = payObj.paymode === "cheque" ? payObj.chkNo : payObj.bankTrnRef;
            particular = `Payment received by ${payObj.paymode}: ${trnsRef}`;
        }
        
        return {
            date: payDate,
            particular: particular,
            amount: `${payments} Cr`
        };
    } catch (err) {
        console.error("Error processing payment entry:", err);
        return null;
    }
}

/**
 * Process an outgoing payment entry into ledger row format
 */
function processOutPaymentEntry(entry) {
    try {
        const { itemList, payments } = entry;
        const payObj = JSON.parse(`${itemList}`);
        const payDate = new Date(payObj.payDate);
        
        const particular = payObj.ref === "cash" 
            ? "Payment made by cash" 
            : `Payment reference: ${payObj.ref}`;
        
        return {
            date: payDate,
            particular: particular,
            amount: `${payments} Dr`
        };
    } catch (err) {
        console.error("Error processing out-payment entry:", err);
        return null;
    }
}

/**
 * Convert ledger entries to row format
 */
function prepareEntryRows(entryArr) {
    const rows = [];
    
    for (const entry of entryArr) {
        const { type, balance } = entry;
        let processedEntry = null;
        
        if (["sale", "purchase"].includes(type)) {
            processedEntry = processSalePurchaseEntry(entry);
        } else if (type === "payment") {
            processedEntry = processPaymentEntry(entry);
        } else if (type === "out-payment") {
            processedEntry = processOutPaymentEntry(entry);
        }
        
        if (processedEntry) {
            rows.push({
                date: processedEntry.date,
                particular: processedEntry.particular,
                amount: processedEntry.amount,
                balance: balance
            });
        }
    }
    
    // Sort by date
    return rows.sort((a, b) => a.date - b.date);
}

/**
 * Generate a PDF document for ledger entries
 */
exports.ledgerPDF = function(entryArr, {name, address, phones, gst}, startDate, endDate, prevClose, ledgerBalance) {
    let pdfPath = app.getPath("documents");
    const saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const { margin } = saleConfig;
    const pageAddedEvent = new EventEmitter();
    const { openFormatForDate } = require('../common');


    if (!fs.existsSync(pdfPath + "/Ledger/")) {
        fs.mkdirSync(pdfPath + "/Ledger/");
    }
    pdfPath = pdfPath + "/Ledger/";

    // Initialize PDF document
    const doc = new PDFDocument({
        margin,
        size: "A4",
        autoFirstPage: false
    });
    startDate = openFormatForDate(new Date(startDate));
    endDate = openFormatForDate(new Date(endDate));
    const pdfFilePath = path.join(pdfPath, `${name}_${startDate}_to_${endDate}_ledger.pdf`);
    doc.pipe(fs.createWriteStream(pdfFilePath));
    doc.fontSize(12).font(saleConfig.titleFontFamily);
    
    // Setup page header event
    pageAddedEvent.addListener("pageAdded", () => {
        createLedgerHead(doc, {name, address, phones, gst, startDate, endDate}, margin, prevClose, ledgerBalance);
        
        const headerRow = {
            col1: "Sl. No.",
            col2: "Date",
            col3: "Particular",
            col4: "Debit(Dr)/Credit(Cr)",
            col5: "Balance"
        };
        createLedgerBody(doc, headerRow);
    });
    
    // Add first page
    doc.addPage();
    pageAddedEvent.emit("pageAdded");
    
    const { height } = doc.page;
    const sortedRows = prepareEntryRows(entryArr);
    
    // Render each entry row
    sortedRows.forEach((row, index) => {
        const rowData = {
            col1: index + 1,
            col2: row.date.toLocaleDateString("en-IN"),
            col3: row.particular,
            col4: row.amount,
            col5: row.balance
        };
        
        createLedgerBody(doc, rowData);
        doc.stroke();
        
        // Add new page if needed
        if (doc.y + doc.currentLineHeight() > height - 2 * margin) {
            doc.addPage();
            pageAddedEvent.emit("pageAdded");
        }
    });
    
    // Finalize PDF
    doc.save().end();
    pageAddedEvent.removeAllListeners("pageAdded");
    
    return pdfFilePath;
}

exports.roadChallanPDF = function(roadChallanObj){
    const doc = new PDFDocument({margin,size:"A4"});
    let path2pdf = app.getPath("temp"),pageNo = 1;
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"road-challan")));
    const { header,body } = roadChallanObj;
    function initPage(){
        let { y:headerEndY,xArr,colWidths } = roadChallanHeader(header,doc,Object.keys(body[0]));
        xArr = xArr.reverse();
        colWidths = colWidths.reverse()
        let { y:footerStartY } = roadChallanFooter(doc,body,headerEndY,xArr,pageNo);
        doc.y = headerEndY + 8;
        return {xArr,colWidths,footerStartY}
    }
    const {xArr,colWidths,footerStartY} = initPage();
    body.forEach((obj,i)=>{
        obj = {
            "Sl No": i+1,
            ...obj,
            "Amount": Number(obj.Rate) * Number(obj.Quantity)
        }
        let { y } = roadChallanBody(doc,obj,xArr,colWidths);
        if(y>=footerStartY-16){
            doc.addPage();
            pageNo++;
            initPage();
        }
    });
    doc
    .stroke()
    .save()
    .end();
    return path.join(path2pdf,"road-challan");
}

function makeKey(str){
    return str.split(" ").reduce((acc,str)=>(acc+str),"")
}

exports.generateVoucher = function(voucherObj){
    const doc = new PDFDocument({margin,size:"A7"});
    let path2pdf = app.getPath("documents");
    if(!fs.existsSync(path2pdf+"/Vouchers/"))
        fs.mkdirSync(path.join(path2pdf,"Vouchers"));
    path2pdf = path.join(path2pdf,"Vouchers");
    const { name,'pay-date':payDate } =voucherObj;
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"voucher_"+makeKey(name)+"_"+payDate)));
    voucherDoc(doc,voucherObj);
    doc
    .stroke()
    .save()
    .end();
    return path.join(path2pdf,`voucher_${makeKey(name)}_${payDate}`);
}

exports.genPayReceiptPDF = function(payReceiptObj){
    const doc = new PDFDocument({margin,size:"A7"});
    let path2pdf = app.getPath("temp");
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"payReceipt")));
    payReceiptDoc(doc,payReceiptObj);
    doc
    .stroke()
    .save()
    .end();
    return path.join(path2pdf,"payReceipt");
}

exports.genReqSlipPDF = function(reqSlipObj){
    const {header,body} = reqSlipObj;
    const doc = new PDFDocument({margin,size:"A4"});
    const { height } = doc.page;
    let path2pdf = app.getPath("temp");
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"reqSlip")));
    function initPage(){
        let { headEndY,xArr,colNames,colWidths } = genReqSlipDocHeader(doc,header,Object.keys(body[0]));
        doc.stroke()
        genReqSlipDocFooter(doc);
        doc.stroke()
        return {headEndY,xArr,colNames,colWidths};
    }
    let {xArr,headEndY,colNames,colWidths} = initPage();
    doc.y = headEndY;
    body.forEach((obj,i)=>{
        genReqSlipDocBody(doc,obj,xArr,colNames,i+1,colWidths);
        if(doc.y>0.85*height-margin){
            doc.addPage();
            doc.y = initPage().headEndY;
        }
    });
    doc
    .stroke()
    .save()
    .end();
    return path.join(path2pdf,"reqSlip");
}