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
    headingFontSize} = require("../config/saleConfig.json");
const path = require("path");
const {getAmtToWord,roundOffTo2DecimalPlace} = require("../template/js/common");


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
    let xPos = [12,35,228,257,300,340,375,420,460,500,550];
    let amt = orderItem["qty"]*orderItem["rate"];
    let netAmt = roundOffTo2DecimalPlace(orderItem.igst>0?amt*(1+orderItem.igst/100):amt*(1+(orderItem.sgst+orderItem.cgst)/100));
    let rtax = (orderItem.sgst*amt)/100,ntax = (orderItem.igst*amt)/100;
    doc.fontSize(14)
    xPos.forEach((xPos,i)=>{
        switch(i){
            case 0:
                return doc.text(slNo,xPos,yPos,{align:"left"});
            case 1:
                return doc.text(orderItem.name,xPos,yPos,{align:"left"});
            case 2:
                return doc.text(orderItem.hsn,xPos,yPos);
            case 3:
                return doc.text(orderItem.qty,xPos,yPos);
            case 4:
                return doc.text(orderItem.unit,xPos,yPos);
            case 5:
                return doc.text(orderItem.rate,xPos,yPos);
            case 6:
                return doc.text(amt,xPos,yPos);
            case 7:
                return doc.text(rtax,xPos,yPos);
            case 8:
                return doc.text(rtax,xPos,yPos);
            case 9:
                return doc.text(ntax,xPos,yPos);
            case 10:
                return doc.text(netAmt,xPos,yPos);
        }
    })
}

exports.createFooter = function(doc,{netAmt,netTax,r_o,delivery:{type,transporterName:name="N/A",transporterAddress:address="N/A",transporterContact:phone="N/A",transporterCharge:charge=0}}){ 
    doc.moveTo(10,650)
    .lineTo(600,650)
    .moveTo(300,650)
    .lineTo(300,772)//Footer line
    //Company Signature + stamp
    .font(titleFontFamily)
    .text("Total in words",12,655)
    .text(`${getAmtToWord(netAmt)}`,12,670)
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
    .text(roundOffTo2DecimalPlace(netAmt-netTax),405,660)

    .text("Delivery charge:",305,682.5)
    .text(charge,405,682.5)

    .text("Total Tax:",305,705)
    .text(netTax,405,705)

    .text(`Rounded off:`,305,727.5)
    .text(r_o,405,727.5)

    .text(`Total with Tax:`,305,750)
    .text(netAmt + r_o + Number(charge),405,750)
    //Paid Emblem space
    .moveTo(460,650)
    .lineTo(460,772)
    .font("Times-Italic")
    .fontSize(10)
    .text("(Payment status)",460,750,{width:90,align:"center"})
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