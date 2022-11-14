const { ipcRenderer } = require("electron");
const { toggleDevTool, applyTheme } = require("../js/common");


let printers = [],
    printerDatalist = document.getElementById("printer-names"),
    selectedPrinter,pdfPath;

toggleDevTool(document);


function resetInput(event){
    event.target.value = ""
}

(
    async function(){
        const resp = await ipcRenderer.invoke("get-printers");
        const {stdout,os="win32"} = resp;
        if(["linux","mac"].includes(os)){
            printers = stdout.split("\n")
                                    .map(text=>{
                                        if(text!=="")
                                            return text.split(".")[0]
                                    })
                                    .map(text=>{
                                        if(!text) return;
                                        let obj = {};
                                        let matches = [...text.match(/(?=\b )\W[\w-]+(?<! )/g)]
                                        obj.printerName = matches[0].trim();
                                        obj.status = matches[2];
                                        return obj;
                                    })
                                    .filter(obj=>obj!==undefined)
        }
        else{
            printers = resp.map(obj=>{
                let {description,displayName,isDefault,name,status} = obj;
                return {
                    printerName: displayName,
                    status
                }
            });
        }
        printers.forEach(({printerName,status},i)=>{
            let option = document.createElement("option");
            if(i===0)
                selectedPrinter = printerName;
            option.value = printerName;
            option.textContent = status;
            printerDatalist.appendChild(option);
        });
        document.querySelector("#printer-list").value = selectedPrinter;
    }
)();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function printcmd(e){
    let printObj = {};
    e.preventDefault();
    let captions = [];
    [...e.srcElement].forEach(elem=>{
        if(elem.type==="checkbox" && !elem.checked) return;
        if(elem.checked)
            captions.push(elem.value);
    });
    printObj.printer = e.target["printer-list"].value;
    printObj.copies = e.target["no-of-copies"].value;
    printObj.paperSize = e.target["paper-size"].value;
    printObj.printOrientation = e.target["print-orientation"].value;
    if(captions.length===0)
        return alert("Check at least 1 box.");
    printObj.captions = captions;
    ipcRenderer.send("forward-printObj",printObj,pdfPath);
}

document.querySelector('[data-name="print-cancel-btn"]').addEventListener("click",()=>{
    ipcRenderer.send("close","Custom-Print-Dialog");
});

ipcRenderer.on("hide-label",(e,path2pdf)=>{
    pdfPath = path2pdf;
    document.querySelector("fieldset:first-child").classList.add("hide");
})