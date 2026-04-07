// ==================== TEMPLATE 3: MINIMALIST MODERN ====================
// Add these functions to the end of buildPage.default.js

exports.createHeader3 = function(doc,{billNo,billDate,orderRef,ewayBill,placeOfSupply,stateNcode,shipTo,shipAddr,shipGST,transportName,deliveryType:type},{name,address:_address,phones:_phones,gst:_gst},caption){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        address,
        phones,
        gst,
        email="",
        defaultFontFamily,
        margin
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { width } = doc.page;
    width -= margin;
    
    // Modern header with accent color
    doc.fillColor('#3498db')
    .fontSize(28)
    .font('Helvetica-Bold')
    .text(biller.toUpperCase(),margin,margin+10,{align:"center"})
    .fillColor('#7f8c8d')
    .fontSize(9)
    .font('Helvetica')
    .text(address,margin,doc.y,{align:"center",width:width-2*margin})
    .text(`${seriarizePhones(phones)} | ${email || gst}`,margin,doc.y,{align:"center"})
    .fillColor('#000000');
    
    doc.moveDown(0.3);
    
    // Thin accent line
    doc.strokeColor('#3498db')
    .lineWidth(2)
    .moveTo(margin,doc.y)
    .lineTo(width,doc.y)
    .stroke()
    .strokeColor('#000000')
    .lineWidth(1);
    
    doc.moveDown(0.8);
    
    // Invoice title and number
    doc.fontSize(18)
    .fillColor('#2c3e50')
    .font('Helvetica-Bold')
    .text('INVOICE',margin,doc.y,{continued:true})
    .fontSize(11)
    .fillColor('#7f8c8d')
    .text(`  #${getBillNo(billNo)}`,{continued:false,align:'left'})
    .fillColor('#000000');
    
    doc.fontSize(10).font('Helvetica');
    let leftColX = margin;
    let rightColX = width*0.6;
    let startY = doc.y;
    
    // Left side - Invoice details
    doc.moveDown(0.5)
    .font('Helvetica-Bold')
    .fillColor('#34495e')
    .text('Date:',leftColX,doc.y,{continued:true,width:80})
    .fillColor('#000000')
    .font('Helvetica')
    .text(new Date(billDate).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}))
    
    if(orderRef){
        doc.font('Helvetica-Bold')
        .fillColor('#34495e')
        .text('Ref:',leftColX,doc.y,{continued:true,width:80})
        .fillColor('#000000')
        .font('Helvetica')
        .text(orderRef);
    }
    
    if(caption){
        doc.fontSize(8)
        .fillColor('#7f8c8d')
        .text(caption,leftColX,doc.y)
        .fillColor('#000000')
        .fontSize(10);
    }
    
    // Right side - Bill to
    doc.y = startY;
    doc.moveDown(0.5)
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#7f8c8d')
    .text('BILL TO:',rightColX,doc.y)
    .fontSize(11)
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .text(name,rightColX,doc.y)
    .font('Helvetica')
    .fontSize(9)
    .text(_address,rightColX,doc.y,{width:width-rightColX-margin})
    .text(`GST: ${_gst}`,rightColX,doc.y);
    
    doc.moveDown(1);
    
    // Table header - clean and minimal
    let tableY = doc.y;
    doc.fillColor('#ecf0f1')
    .rect(margin,tableY-5,width-margin,20)
    .fill()
    .fillColor('#000000');
    
    doc.fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#2c3e50')
    .text('#',margin+5,tableY,{width:25})
    .text('DESCRIPTION',margin+35,tableY,{width:width*0.35})
    .text('HSN',width*0.35+margin+40,tableY,{width:60,align:'center'})
    .text('QTY',width*0.5+margin,tableY,{width:50,align:'center'})
    .text('RATE',width*0.6+margin,tableY,{width:70,align:'right'})
    .text('TAX',width*0.72+margin,tableY,{width:50,align:'center'})
    .text('AMOUNT',width*0.82+margin,tableY,{width:width*0.18-margin-5,align:'right'})
    .fillColor('#000000')
    .font('Helvetica');
    
    doc.moveDown();
    return tableY+20;
}

exports.createBody3 = function(doc,{name,hsn,sellUnit,rate,qty,...itemObj},slNo,factor){
    let tax;
    let { width,margins:{bottom:margin} } = doc.page;
    width -= margin;
    
    // Handle alternate property names
    if(!sellUnit) sellUnit = itemObj.unit;
    if(!qty) qty = itemObj.quantity;
    
    // Calculate tax
    if("igst" in itemObj && itemObj.igst>0)
        tax = itemObj.igst;
    else
        tax = (itemObj.cgst || 0) * 2;
    
    let amt = (qty * rate)*((100+tax)/100);
    
    // Zebra striping
    if(slNo % 2 === 0){
        doc.fillColor('#fafafa')
        .rect(margin,doc.y-2,width-margin,doc.currentLineHeight()+4)
        .fill()
        .fillColor('#000000');
    }
    
    doc.fontSize(9)
    .font('Helvetica')
    .fillColor('#000000')
    .text(slNo,margin+5,doc.y,{width:25})
    .moveUp()
    .text(name,margin+35,doc.y,{width:width*0.35});
    
    let currentY = doc.y;
    doc.y -= doc.currentLineHeight();
    
    doc.text(hsn || '',width*0.35+margin+40,doc.y,{width:60,align:'center'})
    .moveUp()
    .text(`${qty} ${sellUnit}`,width*0.5+margin,doc.y,{width:50,align:'center'})
    .moveUp()
    .text(`₹${rate}`,width*0.6+margin,doc.y,{width:70,align:'right'})
    .moveUp()
    .text(`${tax}%`,width*0.72+margin,doc.y,{width:50,align:'center'})
    .moveUp()
    .text(`₹${roundOffTo2DecimalPlace(amt)}`,width*0.82+margin,doc.y,{width:width*0.18-margin-5,align:'right'});
    
    doc.y = currentY;
    
    // Add description if exists
    if("desc" in itemObj && itemObj.desc!==""){
        doc.fontSize(8)
        .fillColor('#7f8c8d')
        .text(itemObj.desc,margin+35,doc.y,{width:width*0.35,indent:10})
        .fillColor('#000000')
        .fontSize(9);
    }
}

exports.createFooter3 = function(doc,billMeta,{gst:_gst},margin){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        gst,
        billTemplate:{
            applySeal=false,
            seal=""
        }={}
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    
    let {
        netAmt=0,
        netTax=0,
        netAmtTax=0,
        discVal=0
    } = billMeta;
    
    let { width,height } = doc.page;
    width -= margin;
    let r_o = roundOffTo2DecimalPlace(Math.round(netAmtTax)-netAmtTax);
    
    // Position at bottom
    doc.y = height-margin-120;
    let summaryY = doc.y;
    
    // Summary box with subtle background
    doc.strokeColor('#bdc3c7')
    .lineWidth(0.5)
    .rect(width*0.65,summaryY,width*0.35-margin,90)
    .stroke();
    
    let sumX = width*0.67;
    let valX = width*0.92;
    
    doc.fontSize(9)
    .font('Helvetica')
    .text('Subtotal:',sumX,summaryY+10)
    .text(`₹${roundOffTo2DecimalPlace(netAmt)}`,valX,summaryY+10,{width:width*0.33-margin-sumX,align:'right'})
    
    .text('Tax:',sumX,summaryY+25)
    .text(`₹${roundOffTo2DecimalPlace(netTax)}`,valX,summaryY+25,{width:width*0.33-margin-sumX,align:'right'})
    
    .text('Round Off:',sumX,summaryY+40)
    .text(`₹${r_o}`,valX,summaryY+40,{width:width*0.33-margin-sumX,align:'right'});
    
    // Total with accent background
    doc.fillColor('#3498db')
    .rect(width*0.65,summaryY+55,width*0.35-margin,25)
    .fill()
    .fillColor('#ffffff')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('TOTAL:',sumX,summaryY+63)
    .text(`₹${Math.round(netAmtTax)}`,valX,summaryY+63,{width:width*0.33-margin-sumX,align:'right'})
    .fillColor('#000000')
    .font('Helvetica');
    
    // Amount in words
    doc.fontSize(9)
    .fillColor('#7f8c8d')
    .text(`Amount in words: ${capitalize(getAmtToWord(netAmtTax))}`,margin,summaryY+10,{width:width*0.6});
    
    // Signature section
    doc.fontSize(8)
    .fillColor('#000000')
    .text('Authorized Signature',margin,height-margin-30)
    .font('Helvetica-Bold')
    .text(biller,margin,height-margin-15,{width:200})
    .font('Helvetica');
    
    if(applySeal && seal)
        doc.image(seal,margin,height-margin-60,{width:80});
    
    return summaryY;
}
