const { ipcMain } = require("electron");
const { createModal } = require("./createModal");
const { roadChallanPDF, generateVoucher } = require("./scripts/makePDF.default");
const { outPayments } = require("./model/dbConfig");


let windowOptions = {
    width: 600,
    height: 400,
    resizable:false,
    webPreferences: {
      nodeIntegration: true,
      devTools:true
    },
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