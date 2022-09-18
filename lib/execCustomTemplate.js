const saleConfig = require("../config/saleConfig.json");
const fs = require("fs");
const { getAmtToWord,roundOffTo2DecimalPlace,capitalize } = require("../template/js/common");
const { createModal } = require("../createModal");
const { ipcMain } = require("electron");


let  currentPageNo = 1;

exports.main = async function (doc, pdfPath, billObj, template) {
  const { billMeta, orderItems } = billObj;
  const {
    printObj: { captions },
  } = billMeta;
  // Template renderer
  let j,lastJ=0,lastI=0;
  loop1:
  for(let i=0;i<captions.length;i++){
    j=lastJ;
    if(i>lastI && orderItems.length-1){
      lastI = i;
      doc.addPage();
    }
    pageOutLine(doc, template);
    createSections(doc, template);
    await createFeilds(doc, template, billObj);
    let { thHeight,rSpacing,cols,fSize } = template.body.plan;
    let { width,height } = template.body;
    let initialY = thHeight+rSpacing+template.body.y;
    for(;j<orderItems.length;j++){
      createBody(doc,orderItems[j],initialY,j+1,template);
      let wParticularCol = cols.find(colObj=>colObj.var==="name").width * width * 0.01;
      if(doc.widthOfString(orderItems[j].name)>wParticularCol){
        let widthOfString = doc.widthOfString(orderItems[j].name);
        let factor = Math.ceil(widthOfString/wParticularCol);
        initialY += factor*fSize + rSpacing + fSize;
      }
      else
        initialY += rSpacing + fSize;
      if(initialY-template.body.y>height-rSpacing){
        doc.addPage();
        i--;
        lastJ = j;
        continue loop1;
      }
    }
  }
  doc.save().end();
  return pdfPath;
};

function pageOutLine(doc, template) {
  let { applyBorder, border, margin } = template;
  doc.lineWidth(border);
  if (applyBorder)
    doc
      .rect(
        margin,
        margin,
        doc.page.width - 2 * margin,
        doc.page.height - 2 * margin
      )
      .stroke();
}// Function draws page outline.

function createSections(doc, template) {
  let {
    head,body,footer,sections,border,
  } = template;
  [head,body,footer,...sections]
  .forEach(section=>{
    let { x, y, width, height, applyBorder, partitions } = section;
    doc.lineWidth(border);
    if (applyBorder) {
      doc.rect(x, y, width, height).stroke();
      partitions.forEach(({ direction, range, lWidth }) => {
        let x1, y1, x2, y2;
        if (direction === "col") {
          x1 = x + width * range * 0.01;
          y1 = y;
          x2 = x + width * range * 0.01;
          y2 = y + height;
        } else {
          x1 = x;
          y1 = y + height * range * 0.01;
          x2 = x + width;
          y2 = y + height * range * 0.01;
        }
        doc.lineWidth(lWidth).moveTo(x1, y1).lineTo(x2, y2).stroke();
      });
    }
    if("plan" in section && Object.keys(section.plan).length>0){ // Draw table
      let { thHeight,fSize,padding,cols } = section.plan;
      let font = getFont(template.fFamily,true,null);
      doc.font(font).fontSize(fSize);
      doc.moveTo(x,y+thHeight).lineTo(x+width,y+thHeight);// Horizontal line
      cols.forEach((col,i,self)=>{
        let { label,width:colWidth,xPos,yPos } = col;
        yPos -= thHeight/4;
        colWidth = width * colWidth * 0.01;
        if(i<self.length-1)
          doc.moveTo(xPos+colWidth,y).lineTo(xPos+colWidth,y+height);// Vertical lines
        if(label)
          doc.text(label,xPos+padding,y+yPos,{continued:false});
      });
    }
  });
}// Function draws all sections.

function searchSectionScope(x,y,template){
  let { head,body,footer,sections } = template;
  return [head,body,footer,...sections]
          .find(section=>{
            let { x:_x,width,y:_y,height } = section;
            if(x>=_x && x<=_x+width && y>=_y && y<=_y+height)
              return true;
            else
              return false;
          });
}

function getFont(fFamily,bold,italic){
  if(fFamily==="Times-Roman"){
    if(bold && !italic)
      fFamily = "Times-Bold";
    else
    if(!bold && italic)
      fFamily = "Times-Italic";
    else
    if(bold && italic)
      fFamily = "Times-BoldItalic";
  }
  else{
    if(bold && !italic)
      fFamily += "-Bold";
    else
    if(!bold && italic)
    fFamily += "-Oblique";
    else
    if(bold && italic)
      fFamily += "-BoldOblique";
  }
  return fFamily;
}

function setUnderline(doc,x,y,text){
  let height = doc.currentLineHeight();
  let width = doc.widthOfString(text);
  doc.underline(x,y,width,height);
}

async function createFeilds(doc, template, billObj) {
  await template.feilds
  .reduce(async (acc,feildObj)=>{
    let {type,x,y,fSize,fFamily,text,fWidth,bold,italic,underline,fType} = feildObj;
    if(fFamily==="Arial")// Temporary fix
      fFamily = "Times-Roman";
    if(type==="variable"){
      if(text!=="")
        text += ": "
      switch(fType){
        case "date":
          text += billObj.billMeta.billDate;
        break;
        case "biller-name":
          text += saleConfig.biller;
        break;
        case "biller-address":
          text += saleConfig.address;
        break;
        case "biller-gst":
          text += saleConfig.gst;
        break;
        case "biller-phone":
          text += saleConfig.phones.reduce((acc,num,i,self)=>{
            if(i<self.length-1)
              acc += num+"/";
            else
              acc += num;
            return acc;
          },"");
        break;
        case "biller-bank":
          text += saleConfig.bankDetails?.bank || "";
        break;
        case "biller-ac":
          text += saleConfig.bankDetails?.ac || "";
        break;
        case "biller-ac-branch":
          text += saleConfig.bankDetails?.branch || "";
        break;
        case "biller-ac-ifsc":
          text += saleConfig.bankDetails?.ifsc || "";
        break;
        case "customer-name":
          text += billObj.customer.name;
        break;
        case "customer-address":
          text += billObj.customer.address;
        break;
        case "customer-gst":
          text += billObj.customer.gst;
        break;
        case "customer-phone":
          text += billObj.customer.phones?.[1] || "";
        break;
        case "pay-mode":
        case "pay-date":
          if("payment" in billObj)
            text += fType==="pay-mode" ? billObj.payment.type : billObj.billMeta.billDate;
          else
            text += "";
        break;
        case "pay-status":
          text += billObj.billMeta.paymentStatus ? "Paid" : "Unpaid";
        break;
        case "billStatus":
          text += billObj.billMeta.billStatus;
        break;
        case "page-no":
          text += currentPageNo;
        break;
        case "net-CGST":
        case "net-SGST":
        case "net-IGST":
          let reducedTaxObj = billObj.orderItems.reduce((acc,{rate,cgst,sgst,igst,qty})=>{
            if(igst)
              acc.netIGST += roundOffTo2DecimalPlace(igst * qty * rate * 0.01);
            else{
              acc.netSGST += roundOffTo2DecimalPlace(sgst * qty * rate * 0.01);
              acc.netCGST += roundOffTo2DecimalPlace(cgst * qty * rate * 0.01);
            }
            return acc;
          },{netCGST:0,netSGST:0,netIGST:0});
          text += reducedTaxObj[fType.replace("-","")];
        break;
        case "ro":
          text += roundOffTo2DecimalPlace(Math.round(billObj.billMeta.netAmtTax) - billObj.billMeta.netAmtTax);
        break;
        case "gtotal-words":
          text += capitalize(getAmtToWord(Math.round(billObj.billMeta.netAmtTax)).trim());
        break;
        case "bill-copy":
          text += billObj.billMeta.printObj.captions[currentPageNo-1];
        break;
        case "netTax":
          text += roundOffTo2DecimalPlace(billObj.billMeta[fType]);
        break;
        default:
          if(typeof billObj.billMeta[fType]==="number")
            text += Math.round(billObj.billMeta[fType]);
          else
            text += billObj.billMeta[fType];
      }
    }
    else
    if(type==="image"){
      let { imgWidth,imgHeight,imgOpacity,imgTag,applyAspectRatio,aspectRatio } = feildObj;
      // Replace hard coded filepath value to one found after db lookup.
      let filePath = "/home/bhagawati/Code/BBSv2.0.0/ext/Bhagawati Emblem.jpg";
      let buffData = await new Promise((res,rej)=>{
        fs.readFile(filePath,(err,buffData)=>{
          if(err) rej(err);
          res(buffData);
        });
      });
      let imgDataURL = await new Promise((res)=>{
        let imgProcessorWin = createModal(null,"/home/bhagawati/Code/BBSv2.0.0/lib/imageProcessor.html",{show:false});
        imgProcessorWin.on("ready-to-show",()=>{
          imgProcessorWin.webContents.send("process-image",buffData,imgOpacity/100);
        });
        ipcMain.on("processed-image",(e,imgDataURL)=>{
          res(imgDataURL);
        });
      });
      doc.image(imgDataURL,x,y,{width:imgWidth*doc.page.width*0.01});
      return;
    }
    let { width } = searchSectionScope(x,y,template) || { width:doc.page.width };
    fFamily = getFont(fFamily,bold,italic);
    doc.font(fFamily).fontSize(fSize).text(text,x,y,{
      width:Math.ceil(fWidth*width*0.01),
      continued:false
    });
    if(underline)
      setUnderline(doc,x,y,text);
    await acc;
    return acc; 
  });
  return;
}

function createBody(doc,itemObj,initialY,j,template){
  let { plan:{fSize,padding,cols},width } = template.body;
  let { rate,cgst=0,sgst=0,igst=0,qty } = itemObj;
  doc.fontSize(fSize);
  cols.forEach(col=>{
    let { width:colWidth,xPos,var:_var } = col;
    xPos += padding;
    let txtOpt = {continued:false,width:width*colWidth*0.01};
    if(_var==="slno")
      doc.text(j,xPos,initialY,txtOpt);
    else
    if(_var==="unit")
      doc.text(itemObj.sellUnit,xPos,initialY,txtOpt);
    else
    if(_var==="amt"){
      let amt = roundOffTo2DecimalPlace(rate * qty);
      doc.text(amt,xPos,initialY,txtOpt);
    }
    else
    if(_var==="netAmt"){
      let netAmt = roundOffTo2DecimalPlace((cgst+sgst+igst) * rate * qty * 0.01);
      doc.text(netAmt,xPos,initialY,txtOpt);
    }
    else
      doc.text(itemObj[_var.toLowerCase()],xPos,initialY,txtOpt);
  });
}
