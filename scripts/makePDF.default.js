const os = require("os");
const PDFDocument = require('pdfkit');
const fs = require("fs")
const { biller, address,gst,phones,lib } = require("../config/saleConfig.json")
const { createHeader, createFooter, createBody } = require(`../lib/${lib}`);
const {app} = require("electron");
const path = require("path");


function initPDF(margin,{customer:{name},billMeta:{billDate,billNo}}){
    const doc = new PDFDocument({
       margin
    });
    let username = os.userInfo()["username"];
    let pdfPath = app.getPath("documents");
    if(!fs.existsSync(pdfPath+"/Bills/"))
        fs.mkdirSync(path.join(pdfPath,"Bills"));
    pdfPath = path.join(pdfPath,"Bills");
    doc.pipe(fs.createWriteStream(path.join(pdfPath,`${name}_${billDate}_${billNo}`)));
    return doc
}

exports.billPDF = function(billObj,margin=10,captions=["Original Buyer's Copy"]){
    const {billMeta,customer,orderItems} = billObj
    const doc = initPDF(margin,billObj);
    let j=0;
    let count = 1;
    loop1:
    for(let i=0;i<captions.length;i++){
        createHeader(doc,billMeta,customer,captions[i]);
        createFooter(doc,billMeta);
        let initialY = 265;
        loop2:
        for(;j<orderItems.length;j++){
            createBody(doc,orderItems[j],initialY,j+1)
            if(doc.widthOfString(orderItems[j].name)>185)
                initialY+=28;
            else
                initialY+=14;
            if(initialY>635){
                doc.addPage();
                continue loop1;
            }
        }
    }
    doc.save()
    doc.end();
 }