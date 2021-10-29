const PDFDocument = require('pdfkit');
const fs = require("fs")
const { lib, margin, emblem, titleFontFamily } = require("../config/saleConfig.json")
const { createHeader, createFooter, createBody } = require(`../lib/${lib}`);
const {app} = require("electron");
const path = require("path");
const { createLedgerHead, createLedgerBody, fillLedgerEntry } = require('../lib/buildPage.default');


function initBillPDF({customer:{name},billMeta:{billDate,billNo}}){
    const doc = new PDFDocument({
       margin
    });
    let pdfPath = app.getPath("documents");
    if(!fs.existsSync(pdfPath+"/Bills/"))
        fs.mkdirSync(path.join(pdfPath,"Bills"));
    pdfPath = path.join(pdfPath,"Bills");
    doc.pipe(fs.createWriteStream(path.join(pdfPath,`${name}_${billDate}_${billNo}`)));
    pdfPath = path.join(pdfPath,`${name}_${billDate}_${billNo}`);
    return {doc,pdfPath}
}

exports.billPDF = function(billObj){
    const {billMeta,customer,orderItems} = billObj
    const {doc,pdfPath} = initBillPDF(billObj);
    let j,lastJ=0,lastI=0,lastK=0;
    const {printObj:{captions}} = billMeta;
    let { height,margins:{bottom} } = doc.page;
    loop1:
    for(let i=0;i<captions.length;i++){
        j=lastJ;
        k=lastK;
        if(i>lastI){
            lastI = i;
            doc.addPage();
        }
        doc.opacity(0.6)
        .image(path.join(__dirname,`../ext/${emblem}`),250,290,{scale:0.7})
        .opacity(1)
        .font(titleFontFamily)
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
            if(initialY>height-2*bottom){
                doc.addPage();
                i--;
                lastJ = j;
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
    doc.pipe(fs.createWriteStream(path.join(path2pdf,"ledger")));
    doc.fontSize(12)
    .font(titleFontFamily);
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