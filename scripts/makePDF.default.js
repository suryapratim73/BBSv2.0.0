const PDFDocument = require('pdfkit');
const fs = require("fs");
const {app, dialog} = require("electron");
const path = require("path");
const { createHeader, createBody, createFooter, createLedgerHead, createLedgerBody, fillLedgerEntry, roadChallanHeader, roadChallanFooter, roadChallanBody, voucherDoc, payReceiptDoc, genReqSlipDocHeader, genReqSlipDocFooter, genReqSlipDocBody, createHeader2, createFooter2, createBody2 } = require('../lib/buildPage.default');
const { getsaleConfigPolicyPath } = require("../template/js/common");
const { EventEmitter } = require("events");
const { emblemMaker } = require('../lib/common');

// let path2
if(process.APP_ENV==="DEV"){}

function initBillPDF({customer:{name},billMeta:{billDate,billNo},margin},template,autoFirstPage=true){
    let docOpts = {
        margin,
        autoFirstPage
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
    let pdfPath = app.getPath("documents");
    if(!fs.existsSync(pdfPath+"/Bills/"))
        fs.mkdirSync(path.join(pdfPath,"Bills"));
    pdfPath = path.join(pdfPath,"Bills");
    doc.pipe(fs.createWriteStream(path.join(pdfPath,`${name}_${billDate}_${billNo}.pdf`)));
    pdfPath = path.join(pdfPath,`${name}_${billDate}_${billNo}.pdf`);
    return {doc,pdfPath};
}

async function applyEmblem(imgWidth=100, imgOpacity=50,saleConfig,doc,x,y){
    let { emblem="",applyEmblem=false } = saleConfig.billTemplate;
    if(emblem==="")
        return;
    if(applyEmblem===false) return;
    let filePath = path.resolve(__dirname, emblem);
    if(!fs.existsSync(filePath)) return dialog.showErrorBox("File desn't exist",filePath+" path doesn't exist. Try resetting emblem.");
    let imgDataURL = await emblemMaker(filePath,imgOpacity);
    doc.image(imgDataURL, x, y,{height:imgWidth});
}

exports.billPDF = async function(billObj){
    const {billMeta,customer,orderItems} = billObj;
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { margin } = saleConfig;
    if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===true && fs.existsSync(saleConfig.billTemplate.file)){
        let { main } = require("../lib/execCustomTemplate");
        let data = fs.readFileSync(saleConfig.billTemplate.file);
        let template = JSON.parse(data.toString());
        const {doc,pdfPath} = initBillPDF(billObj,template);   
        return main(doc,pdfPath,billObj,template);
    }
    const {doc,pdfPath} = initBillPDF({...billObj,margin},null,false);
    const {printObj:{captions}={captions:["Original Buyer's Copy"]}} = billMeta;
    let topY,bottomY,factor,myEmitter = new EventEmitter();
    myEmitter.on("pageAdded",async caption=>{
        let { width,height } = doc.page;
        factor = width/20;
        createHeader2(doc,billMeta,customer,caption);
        topY = doc.y;
        bottomY = createFooter2(doc,billMeta,customer,margin);
        doc.moveTo(0,topY).lineTo(0,bottomY);
        doc.moveTo(width,topY).lineTo(width,bottomY);
        // Column partitions
        let xPos = Math.ceil(6+doc.widthOfString("S.N."));
        doc
        .moveTo(xPos,topY).lineTo(xPos,bottomY)
        .moveTo(width/2,topY).lineTo(width/2,bottomY)
        .moveTo(width/2+2*factor,topY).lineTo(width/2+2*factor,bottomY)
        .moveTo(width/2+4*factor,topY).lineTo(width/2+4*factor,bottomY)
        .moveTo(width/2+5*factor,topY).lineTo(width/2+5*factor,bottomY)
        .moveTo(width/2+7*factor,topY).lineTo(width/2+7*factor,bottomY)
        .moveTo(width/2+8*factor,topY).lineTo(width/2+8*factor,bottomY);
    });
    myEmitter.on("newPage",(caption)=>{
        doc.addPage();
        myEmitter.emit("pageAdded",caption);
        doc.stroke();
        doc.y = topY;
        let {defaultFontFamily,defaultFontSize } = saleConfig;
        doc.font(defaultFontFamily).fontSize(defaultFontSize).moveDown();
    });
    if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===false && saleConfig.billTemplate.file==="default2"){
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

exports.ledgerPDF = function(entryArr,{name,address,phones,gst},startDate,endDate,prevClose,ledgerBalance){
    let path2pdf = app.getPath("temp"),initY;
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let pageAddedEvent = new EventEmitter();
    let { margin } = saleConfig;
    const doc = new PDFDocument({margin,size:"A4",autoFirstPage:false});
    let rowObj = {};
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"ledger.pdf")));
    doc.fontSize(12)
    .font(saleConfig.titleFontFamily);
    pageAddedEvent.addListener("pageAdded",()=>{
        createLedgerHead(doc,{name,address,phones,gst,startDate,endDate},margin,prevClose,ledgerBalance);
        rowObj = {
            col1:"Sl. No.",
            col2:"Date",
            col3:"Particular",
            col4:"Debit(Dr)/Credit(Cr)",
            col5:"Balance"
        };
        createLedgerBody(doc,rowObj);
    });
    doc.addPage();
    pageAddedEvent.emit("pageAdded");
    let { height } = doc.page,newArr = [];
    for(let index = 0;index<entryArr.length;index++){
        let {date,billNo,billAmt,type,payments,balance,itemList} = entryArr[index],payParticular;
        rowObj.col1 = index+1;
        if(type==="sale"){
            rowObj.col2 = date;//
            rowObj.col3 = `Sale: Bill Number:${billNo}`;
            rowObj.col4 = `${billAmt-payments} Dr`;
        }
        else{
            try{
                let payObj = JSON.parse(`${itemList}`);
                rowObj.col2 = new Date(payObj.paymode==="cash" ? new Date() : payObj["pay-dt"])//.toLocaleDateString("en-IN");
                if(payObj.paymode=="cash")
                    payParticular = "Payment received by cash";
                else{
                    let trnsRef = payObj.paymode==="cheque" ? payObj.chkNo : payObj.bankTrnRef;
                    payParticular = `Payment received by ${payObj.paymode}: ${trnsRef}`
                }
                rowObj.col3 = payParticular;
                rowObj.col4 = payments+" Cr";
            }
            catch(err){
                console.log(err)
            }
        }
        rowObj.col5 = balance;
        newArr.push({...rowObj});
    }
    newArr = newArr.sort(({col2},{col2:_col2})=>(col2-_col2))
    newArr.forEach((rowObj,i)=>{
        rowObj.col1 = i+1;
        rowObj.col2 = rowObj.col2.toLocaleDateString("en-IN");
        createLedgerBody(doc,rowObj);
        doc.stroke();
        if(doc.y+doc.currentLineHeight()>height-2*margin){
            doc.addPage();
            pageAddedEvent.emit("pageAdded");
        }
    });
    //End PDF date,billNo,billAmt,payments,netDue
    doc.save().end();
    pageAddedEvent.removeAllListeners("pageAdded");
    return path.join(path2pdf,"ledger.pdf");
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