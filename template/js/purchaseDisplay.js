const {purchase} = require("../../model/dbConfig");

let tbody = document.querySelector("tbody");
let billItemTables = [],purchases=[];
require("../js/common")(document);

function constructTable(rows){
    rows.forEach(row=>{
        let tr = document.createElement("tr");
        // console.log({entryNo,supplierId,supplierName,billNo,billDate,billAmt,billItemTable});
        Object.keys(row.dataValues).forEach(key=>{
            if(key!=="billItemTable" && key!=="supplierId"){
                let td = document.createElement("td");
                if(key!=="billDate")
                    td.textContent = row.dataValues[key];
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