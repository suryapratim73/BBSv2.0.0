const PDFDocument = require('pdfkit');
const fs = require("fs")
const { lib, margin, emblem, titleFontFamily } = require("../config/saleConfig.json")
const { createHeader, createFooter, createBody } = require(`../lib/${lib}`);
const {app} = require("electron");
const path = require("path");


function initPDF({customer:{name},billMeta:{billDate,billNo}}){
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
    const {doc,pdfPath} = initPDF(billObj);
    let j,lastJ=0,lastI=0,k,lastK=0;
    console.log(billObj)
    const {printObj:{captions},returnOrder} = billMeta;
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
            if(initialY>615){
                doc.addPage();
                i--;
                lastJ = j;
                continue loop1;
            }
        }
        if(returnOrder.length>0){
            initialY+=20;
            doc
            .font("Times-BoldItalic")
            .text("Return Orders",10,initialY)
            .font(titleFontFamily);
            initialY+=20;
            for(;k<returnOrder.length;k++){
                createBody(doc,orderItems[k],initialY,k+1)
                if(doc.widthOfString(returnOrder[k].name)>185)
                    initialY+=40;
                else
                    initialY+=20;
                if(initialY>615){
                    doc.addPage();
                    i--;
                    lastK = k;
                    continue loop1;
                }
            }
        }
    }
    doc.save().end();
    return pdfPath;
 }