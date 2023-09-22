const { getsaleConfigPolicyPath } = require("../template/js/common");
const fs = require("fs");

function getBillNo(billNo){
    const { format="",abbr="",biller } = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath()).toString());
    // const { format="",abbr="mbtc",biller } = require("../config/saleConfig.json");
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
            if(attrs[i]==="fy"){
                // Financial year
                let yr = (new Date()).getFullYear()%1000;
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

exports.getBillNo = getBillNo;