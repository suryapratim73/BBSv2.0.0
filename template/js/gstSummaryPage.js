const { ipcRenderer } = require("electron");
const { toggleDevTool,roundOffTo2DecimalPlace,drawBarGraph,drawSpinner, applyTheme, removeAllElem } = require("../js/common");


toggleDevTool(document);

const monthObj = ["Jan","Feb","Mar","Apr","May","June","July","Aug","Sep","Oct","Nov","Dec"];

ipcRenderer.send("get-all-gst-current-month");

let fullYear = (new Date()).getFullYear();

document.querySelector("#gst-summary-div > div:nth-child(2) > h3").textContent += " " + fullYear + "-" + (Number(String(fullYear).substr(2,2))+1);
document.querySelector("#inGST-graph-div > h3").textContent += " " + fullYear + "-" + (Number(String(fullYear).substr(2,2))+1);;
document.querySelector("#outGST-graph-div > h3").textContent += " " + fullYear + "-" + (Number(String(fullYear).substr(2,2))+1);;

let spinner = drawSpinner(document);

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

ipcRenderer.on("get-all-gst-current-month-response",(e,{inTax,outTax})=>{
    document.getElementById("net-gst").textContent = roundOffTo2DecimalPlace(inTax - outTax);
    document.getElementById("inward-gst").textContent = roundOffTo2DecimalPlace(inTax);
    document.getElementById("outward-gst").textContent = roundOffTo2DecimalPlace(outTax);
});

ipcRenderer.on("monthly-gst",(e,monthlyGSTs)=>{
    const gstHistogram = document.getElementById("gst-histogram");
    // const gstHistogram = document.createElement("canvas");
    const ctx = gstHistogram.getContext("2d");
    ctx.clearRect(0,0,gstHistogram.width,gstHistogram.height);
    let netGST = monthlyGSTs.reduce((acc,{inTax,outTax})=>{
        acc.netGST += (inTax - outTax)>0?roundOffTo2DecimalPlace(inTax - outTax):0;
        acc.netInGST += roundOffTo2DecimalPlace(inTax);
        acc.netOutGST += roundOffTo2DecimalPlace(outTax);
        return acc;
    },{netGST:0,netInGST:0,netOutGST:0});
    let inGSTHistogram,outGSTHistogram;
    monthlyGSTs.forEach(({inTax,outTax,month},i)=>{
        month = monthObj[month];
        let ht = (inTax-outTax)>0?Math.round((roundOffTo2DecimalPlace(inTax-outTax)/netGST.netGST)*gstHistogram.height):0;
        let optionObj = { 
            canvas:gstHistogram,
            ctx,
            i,
            ht,
            width:undefined,
            offsetLeft:20,
            offsetTop:undefined,
            direction:undefined,
            text:month };
        drawBarGraph(optionObj);
        ht = Math.abs(Math.round((roundOffTo2DecimalPlace(inTax)/netGST.netInGST)*gstHistogram.height));
        // console.log({inGSTHistogram,outGSTHistogram})

        // inGSTHistogram?.getContext("2d").clearRect(0,0,inGSTHistogram?.width,inGSTHistogram?.height)
        // outGSTHistogram?.getContext("2d").clearRect(0,0,outGSTHistogram?.width,outGSTHistogram?.height)
        optionObj.canvas = !inGSTHistogram?null:inGSTHistogram;
        optionObj.ctx = null;
        optionObj.ht = ht;
        optionObj.width = 10;
        optionObj.offsetTop = 0;
        optionObj.direction = -1;
        optionObj.style = {fillStyle:"green"}
        inGSTHistogram = drawBarGraph(optionObj);
        ht = Math.abs(Math.round((roundOffTo2DecimalPlace(outTax)/netGST.netOutGST)*gstHistogram.height));
        optionObj.canvas = !outGSTHistogram?null:outGSTHistogram;
        optionObj.style.fillStyle = "orangered";
        optionObj.ht = ht;
        outGSTHistogram = drawBarGraph(optionObj);
    });
    document.getElementById("inGST-graph-div").appendChild(inGSTHistogram);
    document.getElementById("outGST-graph-div").appendChild(outGSTHistogram);
    spinner.remove(window);
});

ipcRenderer.on("refresh-data",()=>{
    removeAllElem("#inGST-graph-div>canvas,#outGST-graph-div>canvas");
    ipcRenderer.send("get-all-gst-current-month");
})