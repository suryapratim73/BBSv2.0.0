const {ipcRenderer} = require("electron");
require("dotenv").config();
const {
    APP_ENV
} = process.env;
exports.toggleDevTool = function(document){
    document.addEventListener("keyup",e=>{
        if(e.code==="F1" && APP_ENV==="DEV")
            ipcRenderer.send("openDevTool");
    });
}

exports.validateInput = function(e){
    if(e.target.id==="payment-status" && e.target.value.length>2)
        e.preventDefault();
    if(!/\d/.test(e.key)){
        if(e.target.id==="partial-payment" || e.target.dataset.type==="Number")
            e.preventDefault();
    }
}
class Supplier{
    constructor(name,id){
        this.name = name;
        this.id = id
    }
    getDetail(id,name){
        if(this.id===id || this.name===name)
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

async function init(datalist){
    let names = await ipcRenderer.invoke("get-supplier-names");
    let suppliers = [];
    names.forEach(({dataValues:{name,id}})=>{
        let option = document.createElement("option");
        option.textContent = id;
        option.value = name;
        datalist.appendChild(option);
        suppliers.push(new Supplier(name,id));
    })
    return suppliers;
}

exports.init = init;

exports.getItemNames = async function(){
    return (await ipcRenderer.invoke("get-item-names")).map(({dataValues:{name,itemNo}})=>{
        return {name,itemNo}
    });
}