const { toggleDevTool, validateInput, validateInput2, removeAllElem } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

let voucher = {};

async function initPage(){
    document.getElementById("pay-date").valueAsDate = new Date();
    voucher['pay-mode'] = "cash";
}
initPage();

function createVoucher(e){
    e.preventDefault();
    for(let input of [...document.querySelectorAll("input")]){
        if(input.name==="pay-mode") continue;
        voucher[input.name] = input.value;
    }
    ipcRenderer.send("generate-voucher",voucher);
    document.querySelector("button:first-child").setAttribute("disabled","disabled");
}

function changeFeilds(e){
    removeAllElem(".deletable");
    voucher['pay-mode'] = e.target.value;
    let df = document.getElementById(`${e.target.value}-detail-template`)
    if(df)
        document.getElementById("amt-div").before(df.content.cloneNode(true));
}

ipcRenderer.on("print-done",()=>{
    ipcRenderer.send("close","Voucher-Generator");
});