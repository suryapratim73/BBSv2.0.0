const {
    biller,
    address,
    phones,
    gst,
    borderRect,
    defaultFontFamile,
    defaultFontSize,
    captionFontSize,
    titileFontSize,
    titleFontFamily,
    headingFontSize } = require("../config/saleConfig.json");
const {getAmtToWord,roundOffTo2DecimalPlace} = require("../template/js/common");
const { unitMap } = require("../config/saleConfig.json");


exports.createHeader = function(doc,{billNo},{name,address:_address,phones:_phones,gst:_gst}){
    let date = new Date();
    doc.fontSize(captionFontSize)
    .font(titleFontFamily)
    .rect(...borderRect)
    .fontSize(titileFontSize)
    .text(`${biller}`,12,60,{
        align:'left'
    })
    .font(defaultFontFamile)
    .fontSize(defaultFontSize)
    .text(`Address: ${address}`,12,100,{
        lineGap:6,
        width:290
    })
    .text(`Contact number: ${phones[0]}`)
    .text(`GST number: ${gst}`)
    // .text(`Bank Details:`)
    // .text(`${accountNo}`)
    // .text(` ${ifsc}`);
    .moveTo(10,225)
    .lineTo(600,225)
    .moveTo(300,22).lineTo(300,630)
    .moveTo(300,60).lineTo(600,60)
    .font('Times-Bold')
    .fontSize(headingFontSize)
    .text(`Invoice No: ${billNo}`,305,37)
    .font(defaultFontFamile)
    // .fontSize(headingFontSize)
    .text(`Date:${date.getDate()}/${date.getMonth()}/${date.getFullYear()}`,516,37)
    .text(`Bill to: ${name}`,305,90,{lineGap:8})	
    .text(`Address: ${_address}`,{lineGap:6})	
    .text(`Phone No: ${_phones[0]}`,{lineGap:8})
    // .text(`E-mail: ${email}`,{lineGap:8})	
    .text(`GST No: ${_gst}`)
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
    let xPos = [35,226,265,300,337,375,420,460,500,550];
    let multiplier = Object.values(unitMap.find(obj=>orderItem.sellUnit in obj))[0];
    doc.fontSize(14)
    doc.text(slNo,12,yPos,{align:"left"});
    let amt=0,tax=0;
    ["name","hsn","qty","sellUnit","rate","amt","sgst","cgst","igst","netAmt"].forEach((key,i)=>{
        if(["name","hsn","qty","sellUnit"].includes(key))
            doc.text(orderItem[key],xPos[i],yPos,{align:"left"});
        else
        if(key==="rate"){
            amt = Number(orderItem[key])*multiplier;
            doc.text(amt,xPos[i],yPos,{align:"left"});
        }
        else
        if(key==="amt"){
            amt *= orderItem.qty;
            doc.text(amt,xPos[i],yPos,{align:"left"});
        }
        else
        if(["sgst","cgst","igst"].includes(key)){
            if(key in orderItem){
                tax += (Number(orderItem[key])/100);
                doc.text(roundOffTo2DecimalPlace(amt*(Number(orderItem[key])/100)),xPos[i],yPos,{align:"left"});
            }
            else
                doc.text(0,xPos[i],yPos,{align:"left"});
        }
        else{
            amt = roundOffTo2DecimalPlace(amt*(1 + tax));
            doc.text(amt,xPos[i],yPos,{align:"left"});
        }

    });
}

exports.createFooter = function(doc,billMeta){
    let {
        netAmt,
        netTax,
        netAmtTax,
        transportCharge="",
        transportName:name="",
        transportContact:phone="",
        coolieCharge="",
        discVal,
        deliveryType:type
    } = billMeta; 
    let deliveryCharge = Number(transportCharge) + Number(coolieCharge);
    let r_o = roundOffTo2DecimalPlace(Math.round(netAmtTax)-netAmtTax);
    let discAmt = discVal>0?netAmt*(100/(100-discVal) - 1):0;
    doc.moveTo(10,650)
    .lineTo(600,650)
    .moveTo(300,650)
    .lineTo(300,772)//Footer line
    //Company Signature + stamp
    .font(titleFontFamily)
    .text("Total in words",12,655)
    .text(`${getAmtToWord(netAmtTax + deliveryCharge)}`,12,670)
    .font(defaultFontFamile)
    .text("Authorised Signatory",12,700)
    .text("For ",12,715,{continued:true})
    .font("Times-BoldItalic")
    .text(`${biller}`,{continued:false})
    .font("Times-Italic")
    .text("(Proprietor)",40,750)
    //Totals
    .font(defaultFontFamile)
    .text(`Total before Tax:`,305,660)
    .text(roundOffTo2DecimalPlace(netAmt*100/(100-discVal)),405,660)

    .text(`Total discount:`,305,675)
    .text(roundOffTo2DecimalPlace(discAmt),405,675)

    .text("Delivery charge:",305,690)
    .text(deliveryCharge,405,690)

    .text("Total Tax:",305,705)
    .text(roundOffTo2DecimalPlace(netTax),405,705)

    .text(`Rounded off:`,305,720)
    .text(r_o,405,720)

    .text(`Total with Tax:`,305,735)
    .text(Math.round(netAmtTax),405,735)

    .text(`Grand Total:`,305,750)
    .text(Math.round(netAmtTax) + deliveryCharge,405,750)
    //Paid Emblem space
    .moveTo(460,650)
    .lineTo(460,772)
    .font("Times-Italic")
    .fontSize(10)
    .text("(Receiver's signature)",460,750,{width:90,align:"center"})
    .font(defaultFontFamile)
    .fontSize(defaultFontSize)
    .moveTo(10,630)
    .lineTo(600,630)
    .text(`Delivery mode:`,15,635,{continued:true})
    .font(titleFontFamily)
    .text(type,{continued:true})
    .font(defaultFontFamile)
    .text(", Transporter:",{continued:true})
    .font(titleFontFamily)
    .text(name,{continued:true})
    .font(defaultFontFamile)
    .text(", Transporter Contact:",{continued:true})
    .font(titleFontFamily)
    .text(phone,{continued:false})
    .stroke();
}

exports.createLedgerHead = function(doc,{name,address,phones,gst,startDate}){
    let xPos = 15,yPos = 28,width=200;
    const {width:_width,height,margins:{left,bottom}} = doc.page;
    doc.text("Name:",xPos,yPos,{continued:true,width})
    .text(name,{continued:false});

    doc.text("Address: ",xPos,Math.round(doc.y)+1,{continued:true,width})
    .text(address,{continued:false});

    doc.text("Contact Info: ",xPos,Math.round(doc.y)+1,{continued:true,width})
    .text(`${JSON.parse(phones).map((num,index)=>{
        if(index>=2) return;
        if(index<JSON.parse(phones).length-1 && index<2)
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