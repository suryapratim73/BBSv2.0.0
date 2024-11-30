const {getAmtToWord,roundOffTo2DecimalPlace, capitalize} = require("../template/js/common");
const fs = require("fs");
// const path = require("path");
const { getsaleConfigPolicyPath } = require("../template/js/common");
const { getBillNo } = require("./common");


exports.createHeader = function(doc,{billNo,orderRef,billDate,shipTo,shipAddr,shipPh,shipGST,transportName,transportContact,transportGST,deliveryType:type},{name,address:_address,phones:_phones,gst:_gst}){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        address,
        phones,
        gst,
        borderRect,
        defaultFontFamily,
        defaultFontSize,
        captionFontSize,
        titileFontSize,
        titleFontFamily,
        headingFontSize,
        bankDetails,
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let date = new Date(billDate);
    if(typeof _phones==="string")
        _phones = JSON.parse(_phones);
    doc.fontSize(captionFontSize)
    .font(titleFontFamily)
    .rect(...borderRect)
    .fontSize(titileFontSize)
    .text(`${biller}`,12,50,{
        align:'left',
        continued:false
    })
    .font(defaultFontFamily)
    .fontSize(defaultFontSize)
    .text(`Address: ${address}`,12, doc.y,{
        // lineGap:6,
        width:290
    })
    .text(`Contact number: ${phones[0]}`)
    .text(`GST number: ${gst}`);
    doc.moveTo(doc.page.margins.left,doc.y)
    .lineTo((doc.page.width-2*doc.page.margins.left)/2+defaultFontSize/2,doc.y);

    if(bankDetails.length>0)
        bankDetails.forEach((info,i,self)=>{
            doc.moveDown()
                .text(`Bank Details: ${info.bank}`,{continue:false})
                .text(`Bank Details: ${info.branch}`,{continue:false})
                .text(`Account No: ${info.accNo}`,{continue:false})
                .text(`IFSC ${info.ifsc}`,{continue:false});
            if(i<self.length-1)
                doc.moveTo(doc.page.margins.left,doc.y)
                    .lineTo((doc.page.width-2*doc.page.margins.left)/2+defaultFontSize/2,doc.y);
        });

    doc.moveTo(10,225)
    .lineTo(600,225)
    .moveTo(300,22).lineTo(300,630)
    .moveTo(300,60).lineTo(600,60)
    .font('Times-Bold')
    .fontSize(headingFontSize)
    .text(`Invoice No: ${getBillNo(billNo)}`,305,37)
    .font(defaultFontFamily)
    // .fontSize(headingFontSize)
    .text(`Date:${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}`,516,37)
    .text(`Bill to: ${name}`,305,65)	
    .text(`Address: ${_address}`)	
    .text(`Phone No: ${_phones[0]}`)
    // .text(`E-mail: ${email}`,{lineGap:8})	
    .text(`GST No: ${_gst}`)
    .moveTo(300,doc.y)
    .lineTo(600,doc.y);
    doc.y += 6;
    [
        {key:"Consignee: ",value: shipTo},
        {key:"Consignee address: ",value: shipAddr},
        {key:"Consignee contact: ",value: shipPh},
        {key:"Consignee GST: ",value: shipGST},
        {key:"Order Ref: ", value: orderRef}
    ].forEach(helperFunc1);
    // Delivery Information
    if(type!=="hand")
        [
            {key:"Transporter: ",value: transportName},
        ]
        .forEach(helperFunc1);
    function helperFunc1({key,value}){
        if(value)
            doc
            .font(defaultFontFamily)
            .text(key,{continued:true})
            .font(titleFontFamily)
            .text(value,{continued:false});
    }
    // Delivery Information section ends
    doc
    .moveTo(10,260).lineTo(600,260)
    .moveTo(30,225).lineTo(30,630)//SL No
    .text('Sl No',12,230,{width:24})
    .moveTo(220,225).lineTo(220,630)//Product Description
    .text("Product Description",35,235)
    .moveTo(255,225).lineTo(255,630)//HSN
    .text("HSN",228,235)
    .text("Quantity",257,235).fontSize(12)
    .text("Unit",305,235,{width:25})
    .moveTo(335,225).lineTo(335,630)
    .moveTo(366,225).lineTo(366,630)
    .fontSize(12)
    .text("Unit Price",336,230,{width:30})
    .moveTo(415,225).lineTo(415,630)//Amount
    .text("Amount",375,235)
    .moveTo(455,225).lineTo(455,630)//CGST
    .text("CGST",420,235)
    .moveTo(495,225).lineTo(495,630)//SGST
    .text("SGST",460,235)
    .moveTo(535,225).lineTo(535,630)//IGST
    .text("IGST",500,235)
    .text("Total",550,235)
    .stroke();
}

exports.createBody = function(doc,orderItem,yPos,slNo){
    const { unitMap,defaultFontSize,defaultFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let xPos = [35,226,265,300,337,375,420,460,500,550];
    let lineBreakMultiple = 1;
    let multiplier = Object.values(unitMap.find(obj=>(orderItem?.sellUnit ?? orderItem.unit) in obj))[0];
    if(orderItem.type==="service")
        multiplier = 1;
    doc.fontSize(defaultFontSize)
        .font(defaultFontFamily)
        .text(slNo,12,yPos,{align:"left"});
    let amt=0,tax=0;
    ["name","hsn","qty","sellUnit","rate","amt","sgst","cgst","igst","netAmt","desc"].forEach((key,i,self)=>{
        let fWidth = (i<self.length-1 ? xPos[i+1]-xPos[i] : 600-xPos[i])-2;
        if(["name","hsn","qty","sellUnit"].includes(key)){
            if(key==="qty" && !("qty" in orderItem))
                key="quantity";
            if(key==="sellUnit" && !("sellUnit" in orderItem))
                key="unit";
            doc.text(orderItem[key],xPos[i],yPos,{align:"left",width:fWidth});
            if(doc.widthOfString(orderItem[key])>=fWidth)
                lineBreakMultiple = Math.ceil(doc.widthOfString(orderItem[key])/fWidth);
        }
        else
        if(key==="rate"){
            amt = Number(orderItem[key])*multiplier;
            doc.text(amt,xPos[i],yPos,{align:"left",width:fWidth});
        }
        else
        if(key==="amt"){
            let key = "qty";
            if(!("qty" in orderItem))
                key = "quantity";
            amt *= orderItem[key];
            doc.text(roundOffTo2DecimalPlace(amt),xPos[i],yPos,{align:"left",width:fWidth});
        }
        else
        if(["sgst","cgst","igst"].includes(key)){
            if(key in orderItem){
                tax += (Number(orderItem[key])/100);
                doc.text(roundOffTo2DecimalPlace(amt*(Number(orderItem[key])/100)),xPos[i],yPos,{align:"left",width:fWidth})
                .font("Times-Italic").fontSize(8)
                .text(`(${orderItem[key]}%)`,xPos[i],yPos+doc.currentLineHeight(),{align:"left",width:fWidth})
                .font(defaultFontFamily).fontSize(defaultFontSize);
            }
            else
                doc.text(0,xPos[i],yPos,{align:"left",width:fWidth});
        }
        else
        if(key==="desc" && "desc" in orderItem && orderItem.desc!==""){
            doc.x = xPos[0]+5;
            doc.y = yPos + (doc.currentLineHeight()*lineBreakMultiple);
            doc.text(orderItem.desc,{align:"left",width:xPos[1]-xPos[0]-10,indent:10});
            lineBreakMultiple = Math.ceil(doc.widthOfString(orderItem.desc)/(xPos[1]-xPos[0]-10)) +1;
        }
        else
        if(key==="netAmt"){
            amt = roundOffTo2DecimalPlace(amt*(1 + tax));
            doc.text(amt,xPos[i],yPos,{align:"left",width:fWidth});
        }
    });
    doc.y = yPos + (doc.currentLineHeight()*lineBreakMultiple);
}

exports.createFooter = function(doc,billMeta,{gst:_gst}){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        defaultFontFamily,
        titleFontFamily,
        defaultFontSize,
        titileFontSize,
        gst,
        billTemplate:{
            applySeal=false,
            seal=""
        }
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let {
        netAmt,
        netTax,
        netAmtTax,
        netQty,
        discVal,
    } = billMeta; 
    // let deliveryCharge = Number(transportCharge);
    let r_o = roundOffTo2DecimalPlace(Math.round(netAmtTax)-netAmtTax);
    let discAmt = discVal>0?netAmt*(100/(100-discVal) - 1):0;
    doc.moveTo(10,650)
    .lineTo(600,650)
    .moveTo(300,650)
    .lineTo(300,772)//Footer line
    //Company Signature + stamp
    .font(titleFontFamily)
    .text("Total in words",12,655)
    .text(`${capitalize(getAmtToWord(netAmtTax))}`,12,670)
    doc.font(defaultFontFamily)
    .text("Authorised Signatory",12,700)
    .text("For ",12,715,{continued:true})
    let y = doc.y;
    let { width } = doc.page;
    doc.moveUp(2);
    //Seal code
    if(applySeal)
        doc.image(seal,12,doc.y,{width:width/4});
    doc.y = y;
    doc.font("Times-BoldItalic")
    .text(`${biller}`,{continued:false})
    .font("Times-Italic")
    .text("(Proprietor)",40,750,{continued:false})
    //Totals
    .font(defaultFontFamily)
    //[660,675,690,705,720,735,750]
    //[305,405]
    .text("`Total quantity`:",305,660)
    .text(roundOffTo2DecimalPlace(netQty)+` Kg`,405,660)
    .text(`Total before Tax:`,305,675)
    .text(roundOffTo2DecimalPlace(netAmt*100/(100-discVal)),405,675)

    .text(`Total discount:`,305,690)
    .text(roundOffTo2DecimalPlace(discAmt),405,690)

    .text("Total Tax:",305,705)
    .text(roundOffTo2DecimalPlace(netTax),405,705)

    .text(`Rounded off:`,305,720)
    .text(r_o,405,720)

    .text(`Grand Total:`,305,735).font(titleFontFamily).fontSize(titileFontSize)
    .text(Math.round(netAmtTax),405,735).font(defaultFontFamily).fontSize(defaultFontSize)
    //Paid Emblem space
    .moveTo(460,650)
    .lineTo(460,772)
    .font("Times-Italic")
    .fontSize(10)
    .text("(Receiver's signature)",460,750,{width:90,align:"center"})
    .font(defaultFontFamily)
    .fontSize(defaultFontSize)
    .moveTo(10,630)
    .lineTo(600,630);
    [415,455,495,535]
    .forEach(xPos=>{
        doc
        .moveTo(xPos,630)
        .lineTo(xPos,650);
    });
    if(!_gst && netTax>0)
        return doc.stroke();
    if(doc.widthOfString(netTax/2)>30)
        doc.fontSize(defaultFontSize-2)
    if(Number(gst.match(/\d\d/)?.[0])===Number(_gst.match(/\d\d/)?.[0])){
        doc.text(roundOffTo2DecimalPlace(netTax/2),425,635,{width:30})
        doc.text(roundOffTo2DecimalPlace(netTax/2),465,635,{width:30})
    }
    else
        doc.text(roundOffTo2DecimalPlace(netTax),505,635,{width:30})
    doc.stroke();
}

function seriarizePhones(phones){
    phones = typeof phones==="string" ? JSON.parse(phones) : phones;
    return phones.reduce((acc,phone,i,self)=>{
        if(i===self.length-1)
            acc+=phone;
        else
            acc+=phone+", ";
        return acc;
    },"");
}

exports.createLedgerHead = function(doc,{name,address,phones,gst,startDate,endDate},margin,prevClose,ledgerBalance){
    let { biller,address:_address,phones:_phones,gst:_gst } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const {width:_width} = doc.page;
    let xPos = 15,initY;
    doc.fontSize(20)
    doc.text(biller,0,doc.y,{align:"center"})
    doc.fontSize(10)
    doc.font("Times-Italic")
    doc.text(_address,0,doc.y,{align:"center"})
    doc.text(seriarizePhones(_phones),0,doc.y,{align:"center"})
    doc.text(_gst,0,doc.y,{align:"center"})
    doc.font("Times-Roman")
    
    initY = doc.y;
    doc.moveTo(doc.x,doc.y)
    doc.lineTo(_width,doc.y)
    doc.moveDown(1)

    doc.x = xPos;
    doc.fontSize(14)

    phones = JSON.parse(phones)
    if(!(phones instanceof Array))
        phones = [phones];
    
    doc.text("Name:",{continued:true})
    .text(name,{continued:false,width:_width/2});

    doc.text("Address: ",{continued:true})
    .text(address,{continued:false,width:_width/2});
    
    doc.text("Contact Info: ",{continued:true})
    .text(`${seriarizePhones(phones)}`,{continued:false,width:_width/2})

    doc.text("GST No: ",{continued:true})
    .text(gst,{continued:false,width:_width/2})
    
    doc.moveUp(3)
    let str = "Statement Period: ",str1 = startDate.toDateString() + " to " + endDate.toDateString();
    doc
    .text(str,_width/2+margin,doc.y,{continued:false})
    .moveUp()
    .text(str1,_width/2+doc.widthOfString(str)+margin,doc.y,{width:_width/2-(doc.widthOfString(str)+margin),continued:false});
    
    doc.text("Opening Balance: Rs."+prevClose,_width/2+margin,doc.y,{width:_width/2})
    doc.text("Ledger Balance:   Rs."+ledgerBalance,_width/2+margin,doc.y,{width:_width/2})

    doc.moveDown()
    doc.moveTo(0,doc.y)
    doc.lineTo(_width,doc.y)

    doc.moveTo(_width/2,doc.y).lineTo(_width/2,initY)
    .moveTo(0,doc.y).lineTo(0,initY)
    .moveTo(_width,doc.y).lineTo(_width,initY)
    .moveTo(0,doc.y);

    doc.moveDown();
    doc.moveTo(0,doc.y)
    doc.lineTo(_width,doc.y)
}

exports.createLedgerBody = function(doc,rowObj){
    const {width,height,margins:{left,bottom}} = doc.page;
    let factor = width/8,xPos = 0,colWidth;
    doc.fontSize(12);
    let yPos = doc.y,maxy=doc.y,xPosArr = [];
    Object.keys(rowObj)
    .forEach((col,i)=>{
        if(col==="col1")
            xPos = 5;
        else
        if(col!=="col4")
            xPos += factor
        else
            xPos += 3*factor;
        if(col==="col5")
            xPos += 0.5*factor;
        if(col!=="col3")
            colWidth = col!=="col4" ? factor : 1.5*factor;
        else
            colWidth = 3*colWidth;
        doc.text(rowObj[col],xPos+5,yPos,{continued:false,align:"left",width:colWidth});
        xPosArr.push({xPos,colWidth});
        if(doc.y>maxy)
            maxy = doc.y;
        doc.y = yPos;
    }); 
    xPosArr.forEach(({xPos,colWidth})=>{
        doc.moveTo(xPos+colWidth,maxy).lineTo(xPos+colWidth,yPos);
    });
    doc.moveTo(0,maxy).lineTo(width,maxy).moveDown();
}

exports.roadChallanHeader = function(header,doc,colNames){
    const {
        biller,
        address,
        phones,
        gst,
        defaultFontFamily,
        titleFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const margin = doc.options.margin;
    const { width } = doc.page;
    doc
    .fontSize(24)
    .font(titleFontFamily)
    .text("Delivery Challan",0,8,{align:"center",continued:false})
    let y = doc.y+16;
    let initY = y;
    doc.y += 2*margin;
    [biller,address,phones,gst]
    .forEach((key,i)=>{
        if(i>0)
            doc
            .font(defaultFontFamily)
            .fontSize(14);
        doc.text(key,margin*2,doc.y,{continued:false,width:width/2-2*margin});
    });
    doc.x = 2*margin;
    y += 8;
    doc.fontSize(14);
    let xArr = [];
    header.forEach((obj,i)=>{
        let key = Object.keys(obj)[0];
        doc
        .font(titleFontFamily)
        .text(key+": ",width/2+margin,y,{continued:false,width:width/4})
        .font(defaultFontFamily)
        .text(obj[key],width*0.75,y,{continued:false,width:width/4,align:"right",columns:2,columnGap:margin})
        .x = 2*margin;
        y += doc.heightOfString(key) + 8;
        if([key+":",obj[key]].some(text=>doc.widthOfString(text)>=width/4))
            y += doc.heightOfString(key);
    });
    doc
    .rect(margin,initY,width-margin*2,y-initY)
    .moveTo(width/2+2,initY)
    .lineTo(width/2+2,y);
    y = doc.y + 16;
    doc
    .moveTo(margin,y)
    .lineTo(width-margin,y)
    colNames = [
        "Sl No",
        ...colNames,
        "Amount"
    ];
    let x = width-margin,colWidths = [];
    for(let i=colNames.length-1;i>=0;i--){
        let colName = colNames[i];
        x -= doc.widthOfString(colName) + 24;
        xArr.push(x+4);
        switch(i){
            case 0:
                doc.text(colName,2*margin,y+8,{continued:false})
                doc
                .moveTo(2*margin+doc.widthOfString(colName)+8,y)
                .lineTo(2*margin+doc.widthOfString(colName)+8,y+doc.heightOfString(colName)+16)
                xArr[xArr.length-1] = 2*margin+4;  
                colWidths.push(margin+doc.widthOfString(colName)+8);
            break;
            case 1:
                let x1 = 2*margin+doc.widthOfString("Sl No")+8;
                let widthOf2ndCol = x - x1;
                let strtPos = x1 + (widthOf2ndCol + doc.widthOfString(colName)/2)/2;
                doc.text(colName,strtPos,y+8,{continued:false});
                xArr[xArr.length-1] = x1 + 4;
                colWidths.push(widthOf2ndCol)
            break;
            default:
                doc.text(colName,x+12,y+8,{continue:false})
                .moveTo(x,y)
                .lineTo(x,y+doc.heightOfString(colName)+16)
                colWidths.push(doc.widthOfString(colName)+24)
        }
    }
    doc
    .moveTo(margin,y)
    .lineTo(margin,y+16+doc.heightOfString("Sl No"))
    .lineTo(width-margin,y+16+doc.heightOfString("Sl No"))
    .lineTo(width-margin,y)
    // .stroke();
    y += 16+doc.heightOfString("Sl No");
    return {doc,y,xArr,colWidths};
}

exports.roadChallanFooter = function(doc,body,headerY,xArr,pageNo){
    const {
        defaultFontFamily,
        titleFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let total = body.reduce((acc,obj)=>{
        let {Rate,Quantity} = obj;
        acc += Number(Rate) * Number(Quantity);
        return acc;
    },0);
    const margin = doc.options.margin;
    const { width,height } = doc.page;
    doc.y = 0.85 * height;
    let y = 0.85*height+8;
    doc
    .fontSize(14)
    .font(titleFontFamily)
    .text("Total taxable amount:",margin*2,y,{continued:false})
    .font(defaultFontFamily)
    .text(total+" (",width/2+8,y,{continued:true})
    .font("Times-Italic")
    .text(capitalize(getAmtToWord(total).trim())+")",{continued:false,width:width/2-margin*5})
    .font(defaultFontFamily)
    .rect(margin,0.85*height,width-margin*2,doc.heightOfString(total+"("+capitalize(getAmtToWord(total).trim())+")")+8);
    y += doc.heightOfString(total+" ("+capitalize(getAmtToWord(total).trim())+")");
    doc
    .text("Receiver's Signature",margin*2,y+16,{continued:false})
    .text("For Consignor",width-margin*2-doc.widthOfString("For Consignor"),y+16)
    .rect(margin,y+8,width-margin*2,height-y-32-margin)
    xArr.forEach((xPos,i)=>{
        if(i==0)
            xPos-=margin;
        doc
        .moveTo(xPos-4,headerY)
        .lineTo(xPos-4,0.85*height)
    });
    doc
    .moveTo(width-margin,headerY)
    .lineTo(width-margin,0.85*height)
    .stroke()
    .text(`Page No. ${pageNo}`,0,height-margin-16,{align:"center",continued:false});
    return {doc,y:0.85*height};
}

exports.roadChallanBody = function(doc,obj,xArr,colWidths){
    let y = doc.y,maxY=0;
    Object.values(obj)
    .forEach((colVal,i)=>{
        doc.text(colVal,xArr[i],y,{continued:false,width:colWidths[i]-8});
        if(doc.widthOfString(colVal)>colWidths[i]-8 && doc.heightOfString(colVal)>maxY)
            maxY = doc.y+doc.heightOfString(colVal);
    })
    if(maxY>0)
        y = maxY;
    doc.y = y+doc.heightOfString("a");
    y += doc.heightOfString("a")
    return {y};
}

function voucherHelper(key,value,x,y){
    if(!x)
        x = this.x;
    if(!y)
        y = this.y;
    this
    .text(key,x,y,{continued:true})
    .text(value,x,y,{continued:false,underline:true})
    return this;
}

exports.voucherDoc = function(doc,voucherObj){
    const {
        defaultFontFamily,
        defaultFontSize,
        titileFontSize,
        titleFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const margin = doc.options.margin;
    const { height } = doc.page;
    doc
    .font(titleFontFamily)
    .fontSize(titileFontSize)
    .text("Payment Voucher",{continued:false,align:"center"});
    doc
    .font(defaultFontFamily)
    .fontSize(defaultFontSize)
    doc.__proto__.voucherHelper = voucherHelper;
    doc.voucherHelper("Pay to: ",voucherObj.name);
    let initY = doc.y + 8;
    Reflect.deleteProperty(voucherObj,"id");
    Reflect.deleteProperty(voucherObj,"name");
    doc
    .voucherHelper("Payment mode: ",voucherObj["pay-mode"],doc.x,initY)
    .voucherHelper("Payment amount in word: ",getAmtToWord(voucherObj["pay-amt"]))
    .voucherHelper("Payment amount: ",voucherObj["pay-amt"])
    if(voucherObj["pay-mode"]!=="cash")
        doc
        .voucherHelper("Bank Name",voucherObj["bank-name"])
        .voucherHelper("Bank A/C Number: ",voucherObj["bank-ac-no"])
    if(voucherObj["pay-mode"]==="cheque")
        doc.voucherHelper("Cheque Number: ",voucherObj["cheque-no"])
    doc
    .voucherHelper("Payment Date: ",voucherObj["pay-date"])
    .text("Payor Signature",margin,height-4*margin,{continued:false})
}

exports.payReceiptDoc = function(doc,payReceiptObj){
    const {
        biller,
        address,
        phones,
        titileFontSize,
        titleFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const margin = doc.options.margin;
    const { height } = doc.page;
    const { name,billAmt,billNo,date } = payReceiptObj;
    doc
    .font(titleFontFamily)
    .fontSize(titileFontSize)
    .text("Payment Acknowledgement",{continued:false,align:"center"})
    .fontSize(14)
    .text(biller,{continued:false,align:"center"})
    .fontSize(12)
    .text(address,{continued:false,align:"center"})
    .text(phones,{continued:false,align:"center"})
    .fontSize(14)
    .text("Received with thanks from ",doc.x,doc.y+2*margin,{continued:true})
    .text(name,{continued:true,underline:true})
    .text(" the sum of Rs.",{continued:true,underline:false})
    .text(billAmt,{continued:true,underline:true})
    .text(" in words ",{continued:true,underline:false})
    .text(getAmtToWord(billAmt),{continued:true,underline:true})
    .text(" ruppees for the Bill number ",{continued:true,underline:false})
    .text(billNo,{continued:true,underline:true})
    .text(" on ",{continued:true,underline:false})
    .text(date+".",{continued:false,underline:true})
    .text("Receiver Signature",margin,height-4*margin,{continued:false})
}

exports.genReqSlipDocHeader = function(doc,header,colNames){
    const {
        biller,
        address,
        phones,
        gst,
        titileFontSize,
        titleFontFamily } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    const margin = doc.options.margin;
    const { width,height } = doc.page;
    const { name,reqNo,date } = header;
    doc
    .font(titleFontFamily)
    .fontSize(titileFontSize)
    .text("Requirement Order",{continued:false,align:"center"})
    .text(biller,{continued:false,align:"center"})
    .fontSize(14)
    .text(address,{continued:false,align:"center"})
    .text("GST: "+gst,{continued:false,align:"center"})
    .text("Phones: "+phones,{continued:false,align:"center"});
    let headStrtX = doc.x,headStrtY = doc.y;
    doc
    .fontSize(12)
    .text("To ",headStrtX+margin,headStrtY+margin,{continued:true,align:"left"})
    .text(name,{continued:false})
    .text("Request No. ",width/2+margin,headStrtY+margin,{continued:true})
    .text(reqNo,{continued:false})
    .text("Date: ",{continued:true})
    .text(date,{continued:false});
    Object.keys(header)
    .forEach(key=>{
        if(["name","reqNo","date"].includes(key)) return;
        doc
        .text(key+" ",{continued:true})
        .text(header[key],{continued:false})
    });
    doc
    .rect(headStrtX,headStrtY,width-2*margin,doc.y+margin-headStrtY)
    .moveTo(width/2,headStrtY)
    .lineTo(width/2,doc.y+margin);
    let colWidths = [],xArr = [];
    colNames.push("Sl No");
    let x = width,y = doc.y + 2*margin;
    ["rowId","stockId"].forEach(key=>{
        colNames.splice(colNames.findIndex(_key=>_key===key),1);
    });
    colNames.reverse()
    .map(colName=>capitalize(colName))
    .forEach(colName=>{
        x -= doc.widthOfString(colName) + 24;
        xArr.push(x+4);
        if(colName!=="Stock Name" && colName!=="Sl No"){
            doc
            .text(colName,x+12,y+8,{continue:false})
            .moveTo(x,y)
            .lineTo(x,0.85*height)
            colWidths.push(doc.widthOfString(colName)+24)
        }
        else
        if(colName==="Stock Name"){
            let x1 = 2*margin+doc.widthOfString("Sl No")+8;
            let widthOf2ndCol = x - x1;
            let strtPos = x1 + (widthOf2ndCol + doc.widthOfString(colName)/2)/2;
            doc
            .text(colName,strtPos,y+8,{continued:false})
            xArr[xArr.length-1] = x1 + 4;
            colWidths.push(widthOf2ndCol)
        }
        else{
            doc
            .text(colName,2*margin,y+8,{continued:false})
            .moveTo(2*margin+doc.widthOfString(colName)+8,y)
            .lineTo(2*margin+doc.widthOfString(colName)+8,0.85*height)
            xArr[xArr.length-1] = 2*margin+4;  
            colWidths.push(margin+doc.widthOfString(colName)+8);
        }
    });
    doc
    .moveTo(margin,y)
    .rect(margin,y,width-2*margin,doc.y+8-y)
    .moveTo(width-margin,doc.y+8)
    .lineTo(width-margin,0.85*height)
    .lineTo(margin,0.85*height)
    .lineTo(margin,doc.y+8)
    return {headEndY:doc.y+8,xArr,colNames,colWidths};
}

exports.genReqSlipDocFooter = function(doc){
    const margin = doc.options.margin;
    const { width,height } = doc.page;
    let y = 0.85*height+8;
    doc
    .moveTo(margin,y)
    .text("Signature",width-6*margin-doc.widthOfString("Signature"),y+8,{continued:false})
    .rect(margin,y,width-2*margin,height-margin-y);
}

exports.genReqSlipDocBody = function(doc,obj,xArr,colNames,slNo,colWidths){
    let y = doc.y+8;
    colNames.forEach((colName,i)=>{
        if(colName!=="Sl No")
            doc.text(obj[colName],xArr[i],y,{continued:false,width:colWidths[i]-8});
        else
            doc.text(slNo,xArr[i],y,{continued:false});
    });
}
// Krishna Da Bill Layout
exports.createHeader2 = function(doc,{billNo,billDate,orderRef,shipTo,shipAddr,shipPh,shipGST,transportName,transportContact,transportGST,deliveryType:type},{name,address:_address,phones:_phones,gst:_gst},caption){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        address,
        phones,
        gst,
        email="",
        defaultFontFamily,
        defaultFontSize,
        titileFontSize,
        margin
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let { width } = doc.page;
    width -= margin;
    let initY = doc.y,maxY=0;

    // Biller Section
    doc.font(defaultFontFamily)
    doc.moveTo(margin,doc.y).lineTo(width,doc.y);
    doc.moveDown();
    doc.fontSize(defaultFontSize);
    doc.text("GSTIN : "+gst,margin+5,doc.y).moveUp();
    doc.text(caption,width-2*margin-doc.widthOfString(caption),doc.y);
    doc.x = margin;
    doc.text("GST INVOICE",{align:"center",underline:true});
    doc.text("|| SHREE HARI ||",{align:"center"});
    doc.fontSize(titileFontSize).text("M/s. "+biller,{align:"center"});
    doc.fontSize(defaultFontSize).text(address,{align:"center"});
    doc.text("Contact : "+seriarizePhones(phones),{align:"center"});
    doc.text("E-mail : "+email,{align:"center"});
    let newY = doc.y;
    doc.moveTo(margin,initY).lineTo(margin,newY).lineTo(width,newY).lineTo(width,initY);
    doc.y = newY;
    initY = newY;

    // Invoice Meta Section
    doc.moveDown().text("Invoice No.: "+getBillNo(billNo),margin,doc.y,{width:width/2})
    .text("Invoice Date :"+billDate,margin,doc.y,{width:width/2})
    .text("Place of supply : Kolkata",margin,doc.y,{width:width/2});
    doc.y = initY;
    doc.moveDown().text("Transport : "+(transportName ?? ""),width/2+margin,doc.y,{width:width/2})
    .text("G.R.No.:"+orderRef,width/2+margin,doc.y,{width:width/2})
    .text("G.R.Date:",width/2+margin,doc.y,{width:width/2})
    .text("Eway bill no :",width/2+margin,doc.y,{width:width/2}).moveDown();
    newY = doc.y;
    doc.moveTo(margin,initY).lineTo(margin,newY).lineTo(width,newY).lineTo(width,initY);
    doc.moveTo(width/2,initY).lineTo(width/2,newY);
    doc.y = newY;
    initY = newY;
    
    // Customer Section
    doc.moveDown()
    .text("Billed to:",margin,doc.y,{underline:true})
    .text("Name: "+name,margin,doc.y,{width:width/2})
    .text("Address: "+_address,margin,doc.y,{width:width/2})
    // .text("Phones: "+seriarizePhones(_phones),10,doc.y,{width:width/2-20})
    .text("GST: "+_gst,margin,doc.y,{width:width/2});
    maxY = doc.y;
    doc.y = newY;
    doc.moveDown()
    .text("Shipped to:",width/2+margin,doc.y,{underline:true})
    .text("Name: "+shipTo,width/2+margin,doc.y,{width:width/2})
    .text("Address: "+shipAddr,width/2+margin,doc.y,{width:width/2})
    // .text("Phone: "+shipPh,width/2+10,doc.y,{width:width/2-20})
    .text("GST: "+shipGST,width/2+margin,doc.y,{width:width/2});
    if(doc.y<maxY){
        doc.y = maxY;
        doc.moveDown();
    }
    doc.moveTo(width,newY).lineTo(width,doc.y).lineTo(margin,doc.y).lineTo(margin,newY)
    .moveTo(width/2,newY).lineTo(width/2,doc.y);

    // Columns section
    initY = doc.y;
    factor = width/(2*margin);
    doc.moveDown(2)
    newY = doc.y;
    let xPos = Math.ceil(margin+doc.widthOfString("S.N."))+margin;
    doc.moveUp()
    .text("S.N.",margin+5,doc.y)
    .moveTo(xPos,initY).lineTo(xPos,newY)
    .moveUp().text("Product Description",xPos+5,doc.y)
    .moveTo(width/2,initY).lineTo(width/2,newY)
    .moveUp().text("HSN/SA C",width/2,doc.y,{width:2*factor,align:"center"})
    .moveTo(width/2+2*factor,initY).lineTo(width/2+2*factor,newY)
    .moveUp().text("QUANTITY",width/2+2*factor,doc.y,{width:2*factor,align:"center"})
    .moveTo(width/2+4*factor,initY).lineTo(width/2+4*factor,newY)
    .moveUp().text("UNIT",width/2+4*factor,doc.y,{width:factor,align:"center"})
    .moveTo(width/2+5*factor,initY).lineTo(width/2+5*factor,newY)
    .moveUp().text("PRICE/UNIT",width/2+5*factor,doc.y,{width:2*factor,align:"center"})
    .moveTo(width/2+7*factor,initY).lineTo(width/2+7*factor,newY)
    .moveUp().text("GST",width/2+7*factor,doc.y,{width:factor,align:"center"})
    .moveTo(width/2+8*factor,initY).lineTo(width/2+8*factor,newY)
    .moveUp().text("AMOUNT",width/2+8*factor,doc.y,{width:2*factor,align:"center"})
    .moveTo(width,initY).lineTo(width,newY).lineTo(margin,newY).lineTo(margin,initY)
}

exports.createBody2 = function(doc,{name,hsn,sellUnit,rate,qty,...itemObj},slNo,factor){
    let tax;
    let { width,margins:{bottom:margin} } = doc.page;
    if(!sellUnit)
        sellUnit = itemObj.unit;
    if(!qty)
        qty = itemObj.quantity;
    width -= margin;
    if("igst" in itemObj && itemObj.igst>0)
        tax = itemObj.igst;
    else
        tax = itemObj.cgst *2;
    let amt = (qty * rate)*((100+tax)/100);
    doc.text(slNo,margin+5,doc.y)
    .moveUp().text(name,44,doc.y,{width:width/2-2*margin});
    
    if("desc" in itemObj && itemObj.desc!==""){
        // doc.x = xPos[0]+5;
        // doc.y = yPos + (doc.currentLineHeight()*lineBreakMultiple);
        doc.text(itemObj.desc,44,doc.y,{width:width/2-2*margin,indent:10});
        // lineBreakMultiple = Math.ceil(doc.widthOfString(orderItem.desc)/(xPos[1]-xPos[0]-10)) +1;
    }
    doc
    .moveUp().text(hsn,width/2,doc.y,{width:factor*2,align:"center"})
    .moveUp().text(qty,width/2+2*factor,doc.y,{width:factor*2,align:"center"})
    .moveUp().text(sellUnit,width/2+4*factor,doc.y,{width:factor,align:"center"})
    .moveUp().text(rate,width/2+5*factor,doc.y,{width:factor*2,align:"center"})
    .moveUp().text(tax,width/2+7*factor,doc.y,{width:factor,align:"center"})
    .moveUp().text(roundOffTo2DecimalPlace(amt),width/2+8*factor,doc.y,{width:factor*2,align:"center"})
}

exports.createFooter2 = function(doc,billMeta,{gst:_gst},margin){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        defaultFontFamily,
        titleFontFamily,
        defaultFontSize,
        gst,
        bankDetails,
        pan="",
        universalTaxSlab="18%",
        billTemplate:{
            applySeal=false,
            seal=""
        }
    } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let {
        netAmt,
        netTax,
        netAmtTax,
        netQty,
        discVal=0,
        payment=0
    } = billMeta;
    let { width,height } = doc.page;
    width -= margin;
    let r_o = roundOffTo2DecimalPlace(Math.round(netAmtTax)-netAmtTax);
    doc.y = height-margin;
    let initY = doc.y;
    doc.x = margin;
    doc.moveUp()
    doc.text("IFSC:"+bankDetails[0].ifsc+",BANK&BRANCH:"+bankDetails[0].bank+","+bankDetails[0].branch,doc.x,doc.y);
    doc.moveUp(2)
    doc.fontSize(defaultFontSize+2).text("BANK DETAIL:"+bankDetails[0].accNo);
    doc.moveUp(2).fontSize(defaultFontSize);
    doc.moveTo(doc.x,doc.y).lineTo(width/2-10,doc.y).dash(2,{space:5}).moveUp().undash();
    doc.x = margin;
    let txt = "We Assure that this invoice shows the actual Price of the goods described and that all particulars are true and correct";
    doc.moveUp(2)
    .text(txt,doc.x,doc.y,{width:width/2-20})
    .moveUp(4)
    .fontSize(defaultFontSize+2)
    .text("DECLARATION ",doc.x,doc.y,{underline:true});
    doc.moveUp(2).moveTo(margin,doc.y).lineTo(width/2,doc.y).lineTo(width/2,initY).lineTo(margin,initY).lineTo(margin,doc.y);
    doc.x = margin;
    doc.moveTo(width/2,doc.y).lineTo(width,doc.y).lineTo(width,initY).lineTo(width/2,initY);
    doc.moveTo(width/2,doc.y+(initY-doc.y)/3).lineTo(width,doc.y+(initY-doc.y)/3);
    initY = doc.y;
    doc.moveDown().text("Company's PAN : "+pan,width/2+margin,doc.y,{width:width/3});
    doc.moveUp().text("E. &O.E",(width-2*margin-doc.widthOfString("E. &O.E")),doc.y,{align:"right"})
    doc.moveDown(2).text("For M/s "+biller,width/2+2*margin,doc.y,{align:"center",width:width/2-2*margin})
    let y = doc.y;
    doc.moveUp(5);
    //Seal code
    if(applySeal)
        doc.image(seal,5*width/8,doc.y,{width:width/4});
    doc.y = y;
    doc
    .moveDown().text("Authorised signatory",3*width/4,doc.y)
    doc.y = initY;
    doc.x = margin;
    doc.moveUp().font(titleFontFamily).fontSize(defaultFontSize+2).text("Rs. "+capitalize(getAmtToWord(netAmtTax),true),doc.x,doc.y,{width:0.6*width-2*margin})
    .font(defaultFontFamily).fontSize(defaultFontSize).moveUp(2);
    let taxObj = {};
    if(Number(gst.match(/\d\d/)?.[0])===Number(_gst.match(/\d\d/)?.[0]) || !_gst){
        taxObj.SGST = netTax/2;
        taxObj.CGST = netTax/2;
    }
    else
        taxObj.IGST = netTax;
    let factor = 0.6*width/5;
    doc.moveUp(2).text("GST "+universalTaxSlab,margin,doc.y);
    doc.moveUp().text(netAmt,margin+factor,doc.y);
    if("IGST" in taxObj)
        doc.moveUp().text(netTax,margin+2*factor,doc.y);
    else{
        doc.moveUp().text(netTax/2,margin+2*factor,doc.y);
        doc.moveUp().text(netTax/2,margin+3*factor,doc.y);
        doc.moveUp().text(netTax,margin+4*factor,doc.y);
    }
    doc.moveUp(4);
    doc.text("TAX RATE%",margin,doc.y,{width:factor})
    .moveUp().text("TAXABLE VALUE",margin+factor,doc.y,{width:factor})
    if("IGST" in taxObj)
        doc.moveUp(2).text("IGST",margin+2*factor,doc.y,{width:factor});
    else{
        doc.moveUp(2).text("SGST",margin+2*factor,doc.y,{width:factor});
        doc.moveUp().text("CGST",margin+3*factor,doc.y,{width:factor});
        doc.moveUp().text("TOTAL GST",margin+4*factor,doc.y,{width:factor});
    }
    doc.moveDown().moveTo(margin,doc.y).lineTo(0.6*width,doc.y);
    doc.moveUp(3).moveTo(margin,initY).lineTo(margin,doc.y).lineTo(0.6*width,doc.y).lineTo(0.6*width,initY);
    let cnst = 0.75*width,newY = doc.y,lineWidth = 0.25*width-3;
    doc.moveDown()
    .fontSize(defaultFontSize)
    .text("SUB TOTAL(Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(netAmt+discVal,cnst,doc.y,{align:"right",width:lineWidth})

    .text("LESS DISCOUNT(Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(discVal,cnst,doc.y,{align:"right",width:lineWidth})

    .text("TOTAL(Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(netAmt,cnst,doc.y,{align:"right",width:lineWidth})

    .text("ADD GST(Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(netTax,cnst,doc.y,{align:"right",width:lineWidth})

    .text("CR/DR(-/+ Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(payment,cnst,doc.y,{align:"right",width:lineWidth})

    .text("ROUND OFF(Rs.):",0.6*width+margin,doc.y)
    .moveUp().text(r_o,cnst,doc.y,{align:"right",width:lineWidth})

    .font(titleFontFamily).fontSize(defaultFontSize+2)
    .text("GRAND TOTAL",0.6*width+margin,doc.y)
    .moveUp().text(Math.round(netAmtTax),cnst,doc.y,{align:"right",width:lineWidth});
    doc.y = newY;
    doc.moveTo(width/2,doc.y).lineTo(width,doc.y).lineTo(width,initY);
    return newY;
}