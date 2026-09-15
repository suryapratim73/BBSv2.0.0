const fs = require("fs");
const { getAmtToWord, roundOffTo2DecimalPlace, capitalize } = require("../template/js/common");
const { createModal, getTargetWindow } = require("../createModal");
const { ipcMain, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { getsaleConfigPolicyPath } = require("../template/js/common");
const { emblemMaker } = require("./common");
const { resolveVariable } = require("./billVariableRegistry");


let currentPageNo = 1;

async function main(doc, pdfPath, billObj, template) {
  const { billMeta, orderItems } = billObj;
  orderItems.forEach(itemObj=>{
    Object.keys(itemObj)
    .forEach(key=>{
      if(["sgst","cgst","igst","rate","qty","quantity"].includes(key) && typeof itemObj[key]==="string")
        itemObj[key] = Number(itemObj[key]);
    });
  });
  const {
    printObj: { captions=["Original Buyer's Copy"] },
  } = billMeta;
  // Template renderer
  let j, lastJ = 0, lastI = 0;
  loop1:
  for (let i = 0; i < captions.length; i++) {
    j = lastJ;
    if (i > lastI) {
      lastI = i;
      currentPageNo++;
      j = 0;
      lastJ = 0;
      doc.addPage();
    }
    pageOutLine(doc, template);
    createSections(doc, template);
    try{
      await createFeilds(doc, template, billObj);
    }
    catch(err){
      console.log(err)
    }
    let { thHeight, rSpacing, cols, fSize } = template.body.plan;
    let { width, height } = template.body;
    let initialY = thHeight + rSpacing + template.body.y;
    for (; j < orderItems.length; j++) {
      createBody(doc, orderItems[j], initialY, j + 1, template);
      let wParticularCol = cols.find(colObj => colObj.var === "name").width * width * 0.01;
      if (doc.widthOfString(orderItems[j].name) > wParticularCol) {
        let widthOfString = doc.widthOfString(orderItems[j].name);
        let factor = Math.ceil(widthOfString / wParticularCol);
        initialY += factor * fSize + rSpacing + fSize;
      }
      else
        initialY += rSpacing + fSize;
      if (initialY - template.body.y > height - rSpacing) {
        doc.addPage();
        i--;
        lastJ = j + 1;
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
    head, body, footer, sections, border,
  } = template;
  [head, body, footer, ...sections]
    .forEach(section => {
      let { x, y, width, height, applyBorder, partitions } = section;
      doc.lineWidth(border);
      if (applyBorder) {
        // Section border in the section's shape (designer + engine share the
        // shape contract; legacy templates default to plain rectangles).
        let { shape = "rectangle", cornerRadius = 8 } = section;
        if (shape === "rounded") {
          let r = Math.min(cornerRadius, width / 2, height / 2);
          doc.roundedRect(x, y, width, height, r).stroke();
        } else if (shape === "circle") {
          let r = Math.min(width, height) / 2;
          doc.circle(x + width / 2, y + height / 2, r).stroke();
        } else if (shape === "ellipse") {
          doc.ellipse(x + width / 2, y + height / 2, width / 2, height / 2).stroke();
        } else {
          doc.rect(x, y, width, height).stroke();
        }
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
      if ("plan" in section && Object.keys(section.plan).length > 0) { // Draw table
        let { thHeight, fSize, padding, cols } = section.plan;
        let font = getFont(template.fFamily, true, null);
        doc.font(font).fontSize(fSize);
        doc.moveTo(x, y + thHeight).lineTo(x + width, y + thHeight);// Horizontal line
        cols.forEach((col, i, self) => {
          let { label, width: colWidth, xPos, yPos } = col;
          yPos -= thHeight / 4;
          colWidth = width * colWidth * 0.01;
          if (i < self.length - 1)
            doc.moveTo(xPos + colWidth, y).lineTo(xPos + colWidth, y + height);// Vertical lines
          if (label)
            doc.text(label, xPos + padding, y + yPos, { continued: false });
        });
      }
    });
}// Function draws all sections.

function searchSectionScope(x, y, template) {
  let { head, body, footer, sections } = template;
  return [head, body, footer, ...sections]
    .find(section => {
      let { x: _x, width, y: _y, height } = section;
      if (x >= _x && x <= _x + width && y >= _y && y <= _y + height)
        return true;
      else
        return false;
    });
}

function getFont(fFamily, bold, italic) {
  if(!fFamily)
    fFamily = "Times-Roman";
  if (fFamily === "Times-Roman") {
    if (bold && !italic)
      fFamily = "Times-Bold";
    else
      if (!bold && italic)
        fFamily = "Times-Italic";
      else
        if (bold && italic)
          fFamily = "Times-BoldItalic";
  }
  else {
    if (bold && !italic)
      fFamily += "-Bold";
    else
      if (!bold && italic)
        fFamily += "-Oblique";
      else
        if (bold && italic)
          fFamily += "-BoldOblique";
  }
  return fFamily;
}

function setUnderline(doc, x, y, text) {
  let height = doc.currentLineHeight();
  let width = doc.widthOfString(text);
  doc.underline(x, y, width, height);
}

async function createFeilds(doc, template, billObj) {
  const saleConfig = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
  // Legacy popped banks from a reversed copy — keep the order, drop the
  // side effect on the freshly parsed config.
  let banks = [...(saleConfig.bankDetails ?? [])].reverse();
  // NOTE: legacy called reduce() without an initial value, which silently
  // skipped template.feilds[0] (the callback starts at index 1). The initial
  // value fixes that — every feild renders now.
  await template.feilds
    .reduce(async (acc, feildObj) => {
      let { type, x, y, fSize, fFamily, text, fWidth, bold, italic, underline, fType } = feildObj;
      doc.font(fFamily).fontSize(fSize);
      if (fFamily === "Arial")// Temporary fix
        fFamily = "Times-Roman";
      if (type === "variable") {
        if (text !== "")
          text += ": "
        if (fType === "biller-bank") {
          // Multi-line bank block pops one bank per feild (legacy quirk:
          // the separator line is moved to but never stroked).
          let info = banks.pop();
          doc.moveDown()
          .text(`Bank Details: ${info.bank}`,{continue:false})
          .text(`Bank Details: ${info.branch}`,{continue:false})
          .text(`Account No: ${info.accNo}`,{continue:false})
          .text(`IFSC ${info.ifsc}`,{continue:false});
          if(banks.length>1)
              doc.moveTo(x,doc.y)
                .lineTo((x+fWidth,doc.y));
        }
        else {
          // Registry lookup with the generic billMeta fallback (zero-code
          // extension for new billMeta keys); keeps legacy switch parity.
          const value = resolveVariable(fType, billObj, saleConfig, {
            pageNo: currentPageNo,
            captionIndex: currentPageNo - 1,
          });
          text += Array.isArray(value) ? value.join("\n") : value;
        }
      }
      else
        if (type === "image" && saleConfig.billTemplate.applyEmblem===true) {
          try {
            let { imgWidth, imgHeight, imgOpacity, imgTag } = feildObj;
            let { billTemplate:{emblem=""} } = saleConfig;
            if(emblem==="")
              return dialog.showErrorBox("Emblem not set","Please set your emblem from setting");
            let filePath = path.resolve(__dirname, emblem);
            let imgDataURL = await emblemMaker(filePath,imgOpacity,imgHeight,imgWidth)
            doc.image(imgDataURL, x, y, { width: imgWidth * doc.page.width * 0.01 });
            return
          }
          catch (err) {
            console.log(err);
            return
          }
        }
      let { width } = searchSectionScope(x, y, template) || { width: doc.page.width };
      fFamily = getFont(fFamily, bold, italic);
      doc.text(text, x, y, {
        width: Math.ceil(fWidth * width * 0.01),
        continued: false
      });
      if (underline && fType!=="biller-bank")
        setUnderline(doc, x, y, text);
      await acc;
      return acc;
    }, Promise.resolve());
  return;
}

function createBody(doc, itemObj, initialY, j, template) {
  let { plan: { fSize, padding, cols }, width } = template.body;
  let { rate, cgst = 0, sgst = 0, igst = 0, qty } = itemObj;
  if(!qty)
    qty = itemObj.quantity;
  doc.fontSize(fSize);
  cols.forEach(col => {
    let { width: colWidth, xPos, var: _var } = col;
    xPos += padding;
    let txtOpt = { continued: false, width: width * colWidth * 0.01 };
    if (_var === "slno")
      doc.text(j, xPos, initialY, txtOpt);
    else
    if (_var === "unit")
      doc.text(itemObj.sellUnit, xPos, initialY, txtOpt);
    else
    if (_var === "amt") {
      let amt = roundOffTo2DecimalPlace(rate * qty);
      doc.text(amt, xPos, initialY, txtOpt);
    }
    else
    if (_var === "netAmt") {
      let netAmt = roundOffTo2DecimalPlace((cgst + sgst + igst) * rate * qty * 0.01);
      doc.text(netAmt, xPos, initialY, txtOpt);
    }
    else
    if (_var === "gst") {
      // D2 GST column (buildPage.default.js createBody2): the item's tax %.
      let gst = igst > 0 ? igst : cgst * 2;
      doc.text(gst, xPos, initialY, txtOpt);
    }
    else
    if (["CGST", "SGST", "IGST"].includes(_var)) {
      let taxComp = itemObj[_var.toLowerCase()] ?? 0;
      doc.text(roundOffTo2DecimalPlace(taxComp * rate * qty * 0.01), xPos, initialY, txtOpt);
    }
    else
      doc.text(itemObj[_var.toLowerCase()], xPos, initialY, txtOpt);
  });
}

// Exported for unit tests (FakeDoc); main is the production entry point.
module.exports = {
  main,
  pageOutLine,
  createSections,
  createFeilds,
  createBody,
  getFont,
  searchSectionScope,
};
