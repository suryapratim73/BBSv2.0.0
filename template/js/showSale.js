const {toggleDevTool,drawSpinner,searchHandler} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

const header = document.querySelector("header"),salesArr = [];
let spinner = drawSpinner(document);

header.addEventListener("click",function(e){
    const filterOptions = this.querySelector("#filter-options"),
        bodyRows = [...document.querySelectorAll(".body.row")],
        dots = [...document.querySelectorAll(".dot")];
    if(e.target.dataset.cmd==="toggle-filter-option")
        filterOptions.classList.toggle("hide");
    else
    if(["paid","unpaid","open","close"].includes(e.target.dataset.cmd)){
        bodyRows.forEach(bodyRow=>{
            let {paymentStatus,billStatus} = bodyRow.dataset;
            paymentStatus = paymentStatus===true?"paid":"unpaid";
            bodyRow.classList.remove("hide");
            if(![paymentStatus,billStatus].includes(e.target.dataset.cmd))
                bodyRow.classList.add("hide");
        });
    }
    else
    if(e.target.dataset.cmd==="all")
        bodyRows.forEach(row=>row.classList.remove("hide"));
    if(["paid","unpaid","open","close","all"].includes(e.target.dataset.cmd)){
        dots.forEach(dot=>{
            dot.classList.remove("select");
            dot.classList.add("deselect");
        });
        if(e.target.classList.contains("option")){
            e.target.querySelector(".dot").classList.add("select");
            e.target.querySelector(".dot").classList.add("deselect");
        }
        else{
            e.target.parentNode.querySelector(".dot").classList.add("select");
            e.target.parentNode.querySelector(".dot").classList.remove("deselect");
        }
    }
});

document.body.addEventListener("click",function(e){
    if(e.target!==document.querySelector("body > header > button")) 
        document.querySelector("#filter-options").classList.add("hide");
});

ipcRenderer.send("get-sales");

ipcRenderer.on("get-sales-response",(e,sales)=>{
    sales.forEach((saleObj,i)=>{
        let bodyDiv = document.createElement("div");
        bodyDiv.className = "row body";
        [...document.querySelectorAll(".row")].pop().after(bodyDiv);
        const {
            billDate,
            billNo,
            billAmt,
            tax,
            billItemTable,
            billStatus,
            name,
            customerId,
            paymentStatus
        } = saleObj;
        salesArr.push(saleObj);
        bodyDiv.dataset.billStatus = billStatus;
        bodyDiv.dataset.billNo = billNo;
        bodyDiv.dataset.billDate = billDate;
        bodyDiv.dataset.customerId = customerId;
        bodyDiv.dataset.name = name;
        bodyDiv.dataset.paymentStatus = paymentStatus;
        Object.keys({i,billDate,billNo,billAmt,tax}).forEach((key,index)=>{
            let p = document.createElement("p");
            p.textContent = key in saleObj?(key !=="billDate"?saleObj[key]:saleObj[key].toLocaleDateString("en-GB")):i+1;
            p.className = `col col${index+1}`;
            bodyDiv.appendChild(p);
        })
        bodyDiv.dataset.itemTable = billItemTable;
    });
    spinner.remove(window);
})