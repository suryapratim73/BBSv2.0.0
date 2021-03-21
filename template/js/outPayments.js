const {toggleDevTool,validateInput, init} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

let forms = document.querySelectorAll("form");
let supplierNamesDatalist = document.querySelector("#supplier-name");
let billPaymentRadioBtn = document.querySelector("#bill-payment");
let supplierNameInput = document.querySelector("[list='supplier-name']");
let supplierNames = [];
let unpaidBillsTBody = document.querySelector("#display-unpaid-bills tbody");
let billAmountsDatalist = document.getElementById("bill-amounts");
let billNoDatalist = document.getElementById("bill-numbers");
let billNoInput = document.getElementById("billNo");
let amountInput = document.getElementById("amount");
let unPaidBills = [];

billPaymentRadioBtn.click();

async function modeSwitcher(e){
    forms.forEach(form=>{
        if(form.id===e.target.value)
            form.classList.remove("hide");
        else
            form.classList.add("hide");
    });
    if(e.target.value==="bill")
        supplierNames = await init(supplierNamesDatalist);
}

supplierNameInput.addEventListener("change",async function(){
    let supplier = supplierNames.find(({name})=>name===this.value);
    if(supplier){
        unPaidBills = await ipcRenderer.invoke("get-unpaid-bills",supplier);
        unPaidBills.forEach(({date,billNo,billAmt})=>{
            let option = document.createElement("option");
            option.textContent = billAmt;
            option.value = billAmt;
            billAmountsDatalist.appendChild(option);
            option = document.createElement("option");
            option.textContent = billNo;
            option.value = billNo;
            billNoDatalist.appendChild(option);
            let tr = document.createElement("tr");
            tr.innerHTML = `
                        <td>${date.toISOString().split("T")[0]}</td>
                        <td>${billNo}</td>
                        <td>${billAmt}</td>
            `;
            unpaidBillsTBody.appendChild(tr);
        })
    } else {
        this.value = "";
        alert("Please select one from the list of supplier names.");
    }
});

billNoInput.addEventListener("change",function(){
    let {billAmt,payments} = unPaidBills.find(({billNo})=>billNo==this.value);
    amountInput.value = billAmt-payments;
    this.parentNode.parentNode.querySelector("button[type='submit']").focus();
});

function formSubmitHandler(e){
    e.preventDefault();
    if(this.id==="bill"){
        let {id} = supplierNames.find(({name})=>name===this.name.value);
        let updateObj = {
            id,
            billNo:this.billNo.value,
            payment:this.amount.value,
            billAmt:unPaidBills.find(({billNo})=>billNo==this.billNo.value).billAmt
        }
        ipcRenderer.send("add-out-payment",updateObj);
    }
}

forms.forEach(form=>{
    if(!(form.classList.contains("hide")))
        form.addEventListener("submit",formSubmitHandler);
    else 
        form.removeEventListener("submit",formSubmitHandler);
})