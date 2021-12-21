const { toggleDevTool, appendToDL, drawSpinner, _searchHandler } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

let payReceiptObj = {},
    customerList,
    langSet = [
        {value:1,word:"one" },
        {value:2,word:"two" },
        {value:3,word:"three" },
        {value:4,word:"four" },
        {value:5,word:"five" },
        {value:6,word:"six" },
        {value:7,word:"seven" },
        {value:8,word:"eight" },
        {value:9,word:"nine" },
        {value:10,word:"ten" },
        {value:11,word:"eleven" },
        {value:12,word:"twelve" }
    ],
    mode=1,
    noReturn,
    selectedCustomer;

async function initPage(){
    let spinner = drawSpinner(document);
    customerList = await appendToDL("get-customers",document.getElementById("customer-list"));
    spinner.remove(window);
}
initPage();

function initPayReceipt(e){
    let input = e.target;
    selectedCustomer = {...input.list.querySelector(`[data-name='${input.value}']`).dataset};
    payReceiptObj.id = selectedCustomer.id;
    payReceiptObj.name = input.value;
    document.getElementById("date").removeAttribute("disabled");
    document.getElementById("date").focus();
}

ipcRenderer.on("get-bill-numbers-response",(e,billNumbers)=>{
    let dl = document.getElementById("billNo-list");
    billNumbers.forEach(obj=>{
        let option = document.createElement("option");
        option.textContent = obj.billNo;
        option.value = obj.billNo;
        option.dataset.date = obj.date;
        dl.appendChild(option);
    });
    document.getElementById("billNo").removeAttribute("disabled");
    document.getElementById("billNo").focus();
})

function genPayReceipt(e){
    e.preventDefault();
    let input = e.target.querySelector("input[name='billNo']");
    let { date } = input.list.querySelector(`[value='${input.value}']`).dataset;
    date = new Date(date).toLocaleDateString("en-GB");
    payReceiptObj.billNo = input.value;
    payReceiptObj.date = date;
    ipcRenderer.send("generate-pay-receipt",payReceiptObj);
}