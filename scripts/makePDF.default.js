const PDFDocument = require('pdfkit');
const fs = require("fs");
const {app} = require("electron");
const path = require("path");
const { createHeader, createBody, createFooter, createLedgerHead, createLedgerBody, fillLedgerEntry, roadChallanHeader, roadChallanFooter, roadChallanBody, voucherDoc, payReceiptDoc, genReqSlipDocHeader, genReqSlipDocFooter, genReqSlipDocBody } = require('../lib/buildPage.default');
const { getsaleConfigPolicyPath } = require("../template/js/common");

// let path2
if(process.APP_ENV==="DEV"){}

function initBillPDF({customer:{name},billMeta:{billDate,billNo},margin},template){
    let docOpts = {
        margin
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

exports.billPDF = async function(billObj){
    const {billMeta,customer,orderItems} = billObj;
    console.log(customer)
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { margin, emblem } = saleConfig;
    if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===true && fs.existsSync(saleConfig.billTemplate.file)){
        let { main } = require("../lib/execCustomTemplate");
        let data = fs.readFileSync(saleConfig.billTemplate.file);
        let template = JSON.parse(data.toString());
        const {doc,pdfPath} = initBillPDF(billObj,template);   
        return main(doc,pdfPath,billObj,template);
    }
    const {doc,pdfPath} = initBillPDF({...billObj,margin});
    let j,lastJ=0,lastI=0;
    const {printObj:{captions}={captions:["Original Buyer's Copy"]}} = billMeta;
    loop1:
    for(let i=0;i<captions.length;i++){
        j=lastJ;
        if(i>lastI){
            lastI = i;
            j = 0;
            lastJ = 0;
            doc.addPage();
        }
        if(emblem!=="")
            doc.opacity(0.6)
            .image(path.join(__dirname,`../ext/${emblem}`),250,290,{scale:0.7});
        doc.opacity(1)
        .font(saleConfig.titleFontFamily)
        .text(captions[i],{
            align:'right'
        })
        createHeader(doc,billMeta,customer);
        createFooter(doc,billMeta);
        let initialY = 265;
        for(;j<orderItems.length;j++){
            createBody(doc,orderItems[j],initialY,j+1)
            if(doc.widthOfString(orderItems[j].name)>185)
                initialY+=40;
            else
                initialY+=20;
            if(initialY>650 - 2*doc.currentLineHeight()){
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

exports.ledgerPDF = function(entryArr,{name,address,phones,gst},startDate){
    const doc = new PDFDocument({margin});
    let path2pdf = app.getPath("temp"),initY;
    let saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"ledger")));
    doc.fontSize(12)
    .font(saleConfig.titleFontFamily);
    let {_x,_y} = createLedgerHead(doc,{name,address,phones,gst,startDate})
    initY=_y;
    let {factor} = createLedgerBody(doc,_x,_y);
    _y+=32;
    let { height,margins:{bottom} } = doc.page;
    for(let index = 0;index<entryArr.length;index++){
        fillLedgerEntry(doc,index,entryArr[index],_y,factor)
        _y+=20;
        if(_y>=height-2*bottom){
            doc.addPage();
            _y = initY;
            _y = createLedgerHead(doc,{name,address,phones,gst,startDate})._y;
            createLedgerBody(doc,_x,_y);
            _y+=32;
        }
    }
    //End PDF date,billNo,billAmt,payments,netDue
    doc.stroke()
    .save().end();
    return path.join(path2pdf,"ledger");
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