const { ipcMain, dialog, BrowserWindow } = require("electron");
const { createModal, getTargetWindow } = require("./createModal");
const { roadChallanPDF, generateVoucher, genPayReceiptPDF, genReqSlipPDF } = require("./scripts/makePDF.default");
const { outPayments, sale, requirement } = require("./model/dbConfig");
const { appLogger } = require("./common");


let windowOptions = {
    width: 600,
    height: 400,
    resizable:false,
    show:false,
    contextIsolation:true
  };

exports.genRoadChallan = mainWindow =>{
    return ()=>{
        windowOptions.parent = mainWindow;
        createModal(windowOptions,"template/html/roadChallan.html",{maxWinCount:1,label:"Road-Challan-Generator"});
    }
}

exports.genVoucher = mainWindow =>{
  return ()=>{
    windowOptions.parent = mainWindow;
    createModal(windowOptions,"template/html/generateVoucher.html",{maxWinCount:1,label:"Voucher-Generator"});
  }
}

exports.genPayReceipt = mainWindow =>{
  return ()=>{
    windowOptions.parent = mainWindow;
    createModal(windowOptions,"template/html/paymentReceipt.html",{maxWinCount:1,label:"Payment-Receipt-Generator"});
  }
}

exports.genRequirementSlip = mainWindow =>{
  return ()=>{
    windowOptions.parent = mainWindow;
    createModal(windowOptions,"template/html/genReqSlip.html",{maxWinCount:1,label:"Requirement-Slip-Generator"});
  }
}

ipcMain.on("generate-road-challan",async (e,roadChallanObj)=>{
  let path2pdf = roadChallanPDF(roadChallanObj);
  ipcMain.emit("show-print-modal",path2pdf,{pageFit:"-o fit-to-page"});
});

ipcMain.on("generate-voucher",(e,voucher)=>{
  let path2pdf = generateVoucher(voucher);
  let date = voucher["pay-date"].split("-");
  date = new Date(Number(date[0]),Number(date[1])-1,Number(date[2]));
  outPayments.create({
    payment: voucher["pay-amt"],
    date,
    moreInfo: voucher
  })
  .then(()=>{
    ipcMain.emit("show-print-modal",path2pdf,{pageFit:""});
  })
  .catch(console.log)
});

ipcMain.on("generate-pay-receipt",async (e,payReceiptObj)=>{
  let { billNo } = payReceiptObj;
  let { billAmt } = (await sale.findOne({
    where:{
      billNo
    },
    attributes: ["billAmt"]
  })).dataValues;
  payReceiptObj.billAmt = billAmt;
  let path2pdf = genPayReceiptPDF(payReceiptObj);
  ipcMain.emit("show-print-modal",path2pdf,{pageFit:""});
});

ipcMain.handle("get-requirement-number",async ()=>{
  let obj = Number((await requirement.findOne({
    order: [ ["entryNo","DESC"] ],
    attributes: [ "entryNo" ]
  }))?.dataValues.entryNo ?? 1) ;
  return obj
});

ipcMain.on("generate-request-slip",async (e,reqSlipObj)=>{
  const { header,body } = reqSlipObj;
  requirement.create({
    header,
    body,
    status: "PENDING"
  })
  .then(()=>{
    let path2pdf = genReqSlipPDF(reqSlipObj);
    if(header.print===true)
      ipcMain.emit("show-print-modal",path2pdf,{pageFit:"-o fit-to-page"});
    let msg = {
      type: "info",
      title: "Requirement queued",
      message: "Requirement await for fulfillment."
    };
    let focussedWindow = getTargetWindow("Requirement-Slip-Generator");
    dialog.showMessageBox(focussedWindow,msg);
    appLogger("sale",JSON.stringify(reqSlipObj));
    focussedWindow.close();
  })
  .catch(console.log)
});