const {ipcRenderer} = require("electron");
const {toggleDevTool,validateInput,getItemNames} = require("../js/common.js");

toggleDevTool(document);

let templateDivContainer = document.body.querySelector(".template-container");
let templateDiv = document.body.querySelector(".template");
let labelsObj = [
    {
        fieldName:"HSN No.",
        fieldType:"Number",
        code:"hsn"
    },
    {
        fieldName:"Type",
        fieldType:"Text",
        code:"type"
    },
    {
        fieldName:"Quantity",
        fieldType:"Number",
        code:"quantity"
    },
    {
        fieldName:"Unit",
        fieldType:"Text",
        code:"unit"
    },
    {
        fieldName:"Rate",
        fieldType:"Number",
        code:"buyPrice"
    },
    {
        fieldName:"CGST",
        fieldType:"Number",
        code:"cgst"
    },
    {
        fieldName:"SGST",
        fieldType:"Number",
        code:"sgst"
    },
    {
        fieldName:"IGST",
        fieldType:"Number",
        code:"igst"
    }
];

(async ()=>{
    let itemList = await getItemNames();
    let dataList = document.createElement("datalist");
    dataList.id = "item-names";
    let input = templateDiv.querySelector("input");
    input.setAttribute("list","item-names");
    input.addEventListener("change",async function(){
        let selectedStock = itemList.find(({name})=>name===this.value);
        if(selectedStock){
            selectedStock = await ipcRenderer.invoke("get-stock-detail",selectedStock.itemNo);
            templateDivContainer.querySelectorAll(".addItem-input").forEach(input=>{
                let matchedLabel = labelsObj.find(obj=>obj.code===input.id);
                if(matchedLabel?.code==="quantity") return;
                if(matchedLabel && Object.keys(selectedStock).includes(matchedLabel.code))
                    input.value = selectedStock[matchedLabel.code];
                if(matchedLabel?.fieldName==="Rate")
                    input.focus();
            })
        }
    })
    itemList.forEach((({name})=>{
        let option = document.createElement("option");
        option.value = name;
        dataList.appendChild(option);
    }));
    templateDiv.appendChild(dataList)
})()

labelsObj.forEach(label=>{
    let clonedTemplateDiv = templateDiv.cloneNode(true);
    let input = clonedTemplateDiv.querySelector("input")
    input.dataset.type = label.fieldType;
    input.setAttribute("list","");
    input.id = label.code;
    let clonedP = clonedTemplateDiv.querySelector(".row0>p");
    clonedP.textContent = label.fieldName;
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