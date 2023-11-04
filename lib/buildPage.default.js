const {getAmtToWord,roundOffTo2DecimalPlace, capitalize} = require("../template/js/common");
const fs = require("fs");
// const path = require("path");
const { getsaleConfigPolicyPath } = require("../template/js/common");
const { getBillNo } = require("./common");


exports.createHeader = function(doc,{billNo,billDate},{name,address:_address,phones:_phones,gst:_gst}){
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
        shipping={} } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
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
        lineGap:6,
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
    .text(`Bill to: ${name}`,305,65,{lineGap:8})	
    .text(`Address: ${_address}`,{lineGap:6})	
    .text(`Phone No: ${_phones[0]}`,{lineGap:8})
    // .text(`E-mail: ${email}`,{lineGap:8})	
    .text(`GST No: ${_gst}`)
    .moveDown()
    .moveTo(300,doc.y)
    .lineTo(600,doc.y)
    .moveDown()
    .text("Ship to:");
    if(Object.keys(shipping).length>0)
        doc.text(shipping.name)
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

exports.createFooter = function(doc,billMeta){
    const { getsaleConfigPolicyPath } = require("../template/js/common");
    const {
        biller,
        defaultFontFamily,
        titleFontFamily,
        defaultFontSize } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    let {
        netAmt,
        netTax,
        netAmtTax,
        netQty,
        // transportCharge="",
        transportName:name="",
        transportContact:phone="",
        discVal,
        deliveryType:type
    } = billMeta; 
    console.log({netAmt,netQty,discVal})
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
    .font(defaultFontFamily)
    .text("Authorised Signatory",12,700)
    .text("For ",12,715,{continued:true})
    .font("Times-BoldItalic")
    .text(`${biller}`,{continued:false})
    .font("Times-Italic")
    .text("(Proprietor)",40,750,{continued:false})
    //Totals
    .font(defaultFontFamily)
    .text("Total quantity:",305,660)
    .text(roundOffTo2DecimalPlace(netQty)+` Kg`,405,660)
    .text(`Total before Tax:`,305,675)
    .text(roundOffTo2DecimalPlace(netAmt*100/(100-discVal)),405,675)

    .text(`Total discount:`,305,690)
    .text(roundOffTo2DecimalPlace(discAmt),405,690)

    // .text("Delivery charge:",305,690)
    // .text(deliveryCharge,405,690)

    .text("Total Tax:",305,705)
    .text(roundOffTo2DecimalPlace(netTax),405,705)

    .text(`Rounded off:`,305,720)
    .text(r_o,405,720)

    .text(`Total with Tax:`,305,735)
    .text(Math.round(netAmtTax),405,735)

    .text(`Grand Total:`,305,750)
    .text(Math.round(netAmtTax),405,750)
    //Paid Emblem space
    .moveTo(460,650)
    .lineTo(460,772)
    .font("Times-Italic")
    .fontSize(10)
    .text("(Receiver's signature)",460,750,{width:90,align:"center"})
    .font(defaultFontFamily)
    .fontSize(defaultFontSize)
    .moveTo(10,630)
    .lineTo(600,630)
    .text(`Delivery mode:`,15,635,{continued:true})
    .font(titleFontFamily)
    .text(type,{continued:name ? true : false})
    .font(defaultFontFamily);
    if(name)
        doc
        .text(", Transporter:",{continued:true})
        .font(titleFontFamily)
        .text(name,{continued:true})
    if(phone)
        doc
        .font(defaultFontFamily)
        .text(", Transporter Contact:",{continued:true})
        .font(titleFontFamily)
        .text(phone,{continued:false});
    doc.stroke();
}

exports.createLedgerHead = function(doc,{name,address,phones,gst,startDate}){
    let xPos = 15,yPos = 28,width=200;
    const {width:_width,height,margins:{left,bottom}} = doc.page;
    doc.text("Name:",xPos,yPos,{continued:true,width})
    .text(name,{continued:false});

    doc.text("Address: ",xPos,Math.round(doc.y)+1,{continued:true,width})
    .text(address,{continued:false});
    
    doc.text("Contact Info: ",xPos,Math.round(doc.y)+1,{continued:true,width})
    .text(`${phones.map((num,index)=>{
        if(index>=2) return;
        if(index<phones.length-1 && index<2)
            return num+", "
        else
            return num;
    })}`,{continued:false})

    doc.text("GST No: ",xPos,Math.round(doc.y)+1,{continued:true,width})
    .text(gst,{continued:false})

    //Header Box
    doc.rect(10,22,_width-2*left,doc.y-22);
    doc.rect(10,Math.round(doc.y)+5,_width-2*left,height-2*bottom-Math.round(doc.y))
    doc.rect(10,Math.round(doc.y)+5,_width-2*left,24);
    let _y = doc.y,_x = doc.x;
    doc.text("Statement Period:",_width/2,yPos,{continued:true,align:"left"})    
    .text(startDate.toDateString() + " to " + (new Date()).toDateString(),{continued:false})
    .stroke();
    return {_x,_y};
}

exports.createLedgerBody = function(doc,_x,_y){
    const {width:_width,height,margins:{left,bottom}} = doc.page;
    doc.x = _x;
    doc.y = _y+10;
    doc.moveTo(40,Math.round(doc.y)-5)
    .lineTo(40,height-2*bottom+5)
    .text("Sl no",doc.x,doc.y,{continued:true});
    let lastWordLength = doc.widthOfString("Sl no");
    let factor = (_width-2*left-40)/5;
    Array.from(["Date","Bill No","Bill Amount","Payments","Total"]).forEach(function(col,index){
        if(index>0){
            doc.moveTo(index*factor+40,_y+5)
            .lineTo(index*factor+40,height-2*bottom+5)
            .text(col,(2*index+1)*(factor/2)+40-doc.widthOfString(col)/2,_y+10);
            lastWordLength = doc.widthOfString(col);
        }
        else{
            doc.text(col,factor/2+40-lastWordLength-doc.widthOfString(col),doc.y);
            lastWordLength = doc.widthOfString(col)
        }
    });
    doc.stroke();
    return {factor}
}

exports.fillLedgerEntry = function(doc,index,{date,billNo,billAmt,payments,balance},y,factor){
    billAmt = !billAmt?"-":Math.round(billAmt);
    billNo = !billNo?"-":billNo;
    doc.text(index+1,15,y)
        .text(date.toLocaleDateString("en-GB"),factor/2+40-doc.widthOfString(date.toDateString())/2,y)
        .text(billNo,3*factor/2+40,y)
        .text(billAmt,5*factor/2+40-doc.widthOfString(String(billAmt))/2,y)
        .text(payments,7*factor/2+40-doc.widthOfString(String(payments))/2,y)
        .text(balance,9*factor/2+40-doc.widthOfString(String(balance))/2,y)
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