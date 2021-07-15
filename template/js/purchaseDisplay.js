const {purchase} = require("../../model/dbConfig");

let tbody = document.querySelector("tbody");
let billItemTables = [],purchases=[];
const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);

function constructTable(rows){
    rows.forEach(row=>{
        let tr = document.createElement("tr");
        Object.keys(row.dataValues).forEach(key=>{
            if(!["billItemTable","supplierId","tax","payment","paymentStatus"].includes(key)){
                let td = document.createElement("td");
                if(key!=="billDate" && key!=="billAmt")
                td.textContent = row.dataValues[key];
                else
                if(key==="billAmt"){
                    td.textContent = row.dataValues[key];
                    td.classList.add(row.paymentStatus?"paid":"unpaid")
                }
                else
                    td.textContent = row.dataValues[key].toLocaleDateString();
                tr.appendChild(td);
            }
        });
        tbody.appendChild(tr)
        billItemTables.push(row.dataValues.billItemTable);
    })
}

purchase.findAll().then(rows=>{
    purchases = rows;
    constructTable(rows)
})
document.querySelector("button").addEventListener("click",()=>console.log(purchases))