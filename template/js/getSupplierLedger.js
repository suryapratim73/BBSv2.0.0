const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput} = require("../js/common.js");
toggleDevTool(document);


let form = document.querySelector("form");
let datalist = document.querySelector("datalist");
let suppliers = [];

class Supplier{
    constructor(name,gst){
        this.name = name;
        this.gst = gst
    }
    getDetail(gst,name){
        if(this.gst===gst || this.name===name)
            return this;
    }
    setDetail(data){
        Object.keys(data).forEach(key=>{
            this[key] = data[key];
        });
    }
    getAllData(){
        return this;
    }
}

async function init(){
    let names = await ipcRenderer.invoke("get-supplier-names");
    names.forEach(({dataValues:{name,gst}})=>{
        let option = document.createElement("option");
        option.textContent = gst;
        option.value = name;
        datalist.appendChild(option);
        suppliers.push(new Supplier(name,gst));
    })
}
init();

//Work from here...