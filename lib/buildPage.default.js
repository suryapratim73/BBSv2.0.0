const {biller,address,phones,gst} = require("../config/saleConfig.json");
const {getAmtToWord} = require("../template/js/common")


exports.createHeader = function(doc,{billNo},{name,address:_address,phones:_phones,gst:_gst},caption){
    let date = new Date();
    doc.fontSize(14)
    .text(caption,{
       align:'right'
    })
    .rect(10,22,590,750)
    .stroke()
    .fontSize(20)
    .font('Times-Bold')
    .text(`${biller}`,12,60,{
        align:'left'
    })
    .font('Times-Roman')
    .fontSize(10)
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
    .moveTo(300,22).lineTo(300,772)
    .moveTo(300,60).lineTo(600,60)
    .stroke()
    .font('Times-Bold').fontSize(14)
    .text(`Invoice No: ${billNo}`,305,37)
    .font('Times-Roman').fontSize(12)
    .text(`Date:${date.getDate()}/${date.getMonth()}/${date.getFullYear()}`,516,37)
    .text(`Bill to: ${name}`,305,90,{lineGap:8})	
    .text(`Address: ${_address}`,{lineGap:6})	
    .text(`Phone No: ${_phones[0]}`,{lineGap:8})
    // .text(`E-mail: ${email}`,{lineGap:8})	
    .text(`GST No: ${_gst}`)
    .moveTo(10,260).lineTo(600,260)
    .moveTo(30,225).lineTo(30,650)//SL No
    .text('Sl No',12,230,{width:24})
    .moveTo(220,225).lineTo(220,650)//Product Description
    .text("Product Description",35,235)
    .moveTo(255,225).lineTo(255,650)//HSN
    .text("HSN",228,235)
    .text("Quantity",257,235).fontSize(12)
    .text("Unit",305,235,{width:25})
    .moveTo(335,225).lineTo(335,650)
    .moveTo(366,225).lineTo(366,650).fontSize(12)
    .text("Unit Price",336,230,{width:30})
    .moveTo(415,225).lineTo(415,650)//Amount
    .text("Amount",375,235)
    .moveTo(455,225).lineTo(455,650)//CGST
    .text("CGST",420,235)
    .moveTo(495,225).lineTo(495,650)//SGST
    .text("SGST",460,235)
    .moveTo(535,225).lineTo(535,650)//IGST
    .text("IGST",500,235)
    .text("Total",550,235);
}

exports.createBody = function(doc,orderItem,yPos,slNo){
    let xPos = [12,35,228,257,300,340,375,420,460,500,550];
    let amt = orderItem["qty"]*orderItem["rate"];
    let netAmt = orderItem.igst>0?amt*(1+orderItem.igst):amt*(1+orderItem.sgst+orderItem.cgst);
    let rtax = orderItem.sgst*amt,ntax = orderItem.igst*amt;
    netAmt/=100;
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

exports.createFooter = function(doc,{netAmt,netTax,r_o}){
    let total = netAmt + netTax + r_o;
    doc.moveTo(10,650)
    .lineTo(600,650)//Footer line
    .font("Times-Bold")
    .text("Total in words",12,655)
    .text(`${getAmtToWord(total)}`,12,670)
    .font("Times-Roman")
    .text("Authorised Signatory",12,700)
    .text("For ",12,715,{continued:true})
    .font("Times-BoldItalic")
    .text(`${biller}`,{continued:false})
    .font("Times-Italic")
    .text("(Proprietor)",40,740)
    // .moveTo(300,650).lineTo(300,772)
    .font("Times-Roman")
    .text(`Total Before Tax:${netAmt}`,305,660)
    .text(`Total Tax Amount:${netTax}`,305,690)
    .text(`Rounded off:${r_o}`,305,720)
    .text(`Total Amount:${total}`,305,750)
    .stroke();
}