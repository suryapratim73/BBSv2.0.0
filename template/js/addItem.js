const {ipcRenderer} = require("electron");
require("../js/common")(document)
let labels = ["HSN No.","Type","Quantity","Unit","Rate","CGST","SGST","IGST"];
let templateDivContainer = document.body.querySelector(".template-container");
let templateDiv = document.body.querySelector(".template");
labels.forEach(label=>{
    let clonedTemplateDiv = templateDiv.cloneNode(true);
    let clonedP = clonedTemplateDiv.querySelector(".row0>p");
    clonedP.textContent = label;
    templateDivContainer.appendChild(clonedTemplateDiv);
});
document.body.querySelector("button").addEventListener("click",()=>{
    let itemParticular = {};
    [...templateDivContainer.children].forEach(template=>{
        let inputValue = template.querySelector("input").value ?? "None";
        let p = template.querySelector("p");
        itemParticular[p.textContent] = inputValue;
    })
    ipcRenderer.send("add-item",itemParticular);
})