const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);

let root = document.getElementById("root"),updatedValues = [];
ipcRenderer.on("update-data-obj",(e,dataObj)=>{
    for(let i=0;i<root.children.length;i++){
        root.children[i].remove();
        i--;
    }
    let parsableData;
    if(dataObj.type==="supplier"){
        try{
            parsableData = JSON.parse(dataObj.value);
        }
        catch(err){
            console.log("Some error");
            parsableData = undefined;
        }
        let form = document.createElement("form");
        let labelDiv = document.createElement("div");
        let label = document.createElement("label");
        labelDiv.appendChild(label);
        label.textContent = dataObj.field;
        let inputDiv = document.createElement("div");
        if(parsableData){
            parsableData.forEach(data=>{
                let input = document.createElement("input");
                input.value = data;
                inputDiv.appendChild(input);
            })
        } else {
            let input = document.createElement("input");
            input.value = dataObj.value;
            inputDiv.appendChild(input);
        }
        let btnDiv = document.createElement("div");
        let btn = document.createElement("button");
        btn.textContent = "Done";
        btn.type = "submit";
        btnDiv.appendChild(btn);
        form.appendChild(labelDiv);
        form.appendChild(inputDiv);
        form.appendChild(btnDiv);
        form.addEventListener("submit",e=>{
            e.preventDefault();
            [...inputDiv.children].forEach(input=>updatedValues.push(input.value));
            dataObj.value = JSON.stringify(updatedValues);
            ipcRenderer.send("update-data-obj-complete",dataObj);
        })
        root.appendChild(form);
    }//Work from here.
})