const {toggleDevTool,validateInput, init} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

let forms = document.querySelectorAll("form");
let supplierNamesDatalist = document.querySelector("#supplier-name");
let billPaymentRadioBtn = document.querySelector("#bill-payment");
let supplierNameInput = document.querySelector("[list='supplier-name']");
let supplierNames = [];

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
        console.loh(await ipcRenderer.invoke("get-unpaid-bills",supplier))
    } else {
        this.value = "";
        alert("Please select one from the list of supplier names.");
    }
})