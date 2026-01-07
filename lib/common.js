const { ipcMain, BrowserWindow } = require("electron");
const { createModal } = require("../createModal");
const { getsaleConfigPolicyPath, getAppPolicyPath } = require("../template/js/common");
const fs = require("fs");

function getBillNo(billNo){
    const { format="",abbr="",biller } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    // const { financialYearStartDate } = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
    // const { format="",abbr="mbtc",biller } = require("../config/saleConfig.json");
    let { financialYearStartDate } = process.presets;
    let mnth = parseInt(financialYearStartDate.split("-")[1],10);
    let currDate = new Date();
    let attrs = format.split(/[-/.\\_]/);
    let separators = format.split(/\w+/).filter(str=>(str!="")).reverse();
    let str_billNo = "";
    if(format!="")
        for(let i=0;i<attrs.length;i++){
            if(attrs[i]==="cabbr"){
                // Company abbrebiation
                str_billNo += abbr!=="" ? abbr : biller.match(/[A-Z]+/g).reduce((acc,str)=>acc+str,"");
            }
            else
            if(attrs[i]==="fy"){// Fix financial year output
                // Financial year
                let yr = (mnth>currDate.getMonth()? currDate.getFullYear()-1 : currDate.getFullYear())%1000;
                str_billNo += yr+"-"+(++yr);
            }
            else
            if(attrs[i]==="billNo"){
                // Bill Number
                str_billNo += billNo;
            }
            if(separators.length>0)
                str_billNo += separators.pop();
        }
    else
        str_billNo = billNo;
    return str_billNo
}

// getBillNo(process.argv[2])

async function emblemMaker(filePath,imgOpacity){
    let buffData = await new Promise((res, rej) => {
        fs.readFile(filePath, (err, buffData) => {
          if (err) rej(err);
          res(buffData);
        });
    });
    let imgDataURL = await new Promise((res) => {
    createModal(null, "lib/imageProcessor.html", {
        show: false,
        cb: function () {
            this.webContents.send("process-image", buffData, imgOpacity / 100);
        },
        label: "image-processor"
    });
    ipcMain.on("processed-image", (e, imgDataURL) => {
        BrowserWindow.fromId(e.sender.id)?.close();
        res(imgDataURL);
    });
    });
    return imgDataURL
}

exports.getBillNo = getBillNo;
exports.emblemMaker = emblemMaker;