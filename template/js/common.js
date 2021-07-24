const {ipcRenderer} = require("electron");
require("dotenv").config();
const {
    APP_ENV
} = process.env;
exports.toggleDevTool = function(document){
    document.addEventListener("keyup",e=>{
        if(e.code==="F1" && APP_ENV==="DEV")
            ipcRenderer.send("openDevTool");
        else if(e.code==="Escape")
            ipcRenderer.send("close");
    });
}

exports.validateInput = function(e){
    if(e.target.id==="payment-status" && e.target.value.length>2)
        return e.preventDefault();
    if(e.target.dataset.subtype==="price" && !/\d/.test(e.key)) 
        return e.preventDefault();
    if(!/[\d+ ]/.test(e.key)){
        if(
            e.target.id==="partial-payment" || 
            e.target.dataset.type==="Number" ||
            e.target.id==="amount"
            )//conditions..
            return e.preventDefault();
    }
    return 1;
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

function number2Word(num){
    switch(num){
        case 1:
            return "one";
        case 2:
            return "two";
        case 3:
            return "three";
        case 4:
            return "four";
        case 5:
            return "five";
        case 6:
            return "six";
        case 7:
            return "seven";
        case 8:
            return "eight";
        case 9:
            return "nine";
        case 10:
            return "ten";
        case 11:
            return "eleven";
        case 12:
            return "twelve";
        case 13:
            return "thirteen";
        case 14:
            return "fourteen";
        case 15:
            return "fifteen";
        case 16:
            return "sixteen";
        case 17:
            return "seventeen";
        case 18:
            return "eighteen";
        case 19:
            return "nineteen";
        case 20:
            return "twenty";
        case 30:
            return "thirty";
        case 40:
            return "forty";
        case 50:
            return "fifty";
        case 60:
            return "sixty";
        case 70:
            return "seventy";
        case 80:
            return "eighty";
        case 90:
            return "ninety";
        default:
            return "";
    }
}

exports.getAmtToWord = function (amt){
    amt = typeof amt!=="number"? Number(amt):amt;
    let lakh = Math.floor(amt/100000);
    let thousand = Math.floor((amt - lakh*100000)/1000);
    let hundred = Math.floor((amt - lakh*100000 - thousand*1000)/100);
    let ten = Math.floor((amt - lakh*100000 - thousand*1000 - hundred*100)/10)*10;
    let one = 0
    if(ten>1)
        one = Math.floor(amt - lakh*100000 - thousand*1000 - hundred*100 - ten);
    else
        ten = Math.floor(amt - lakh*100000 - thousand*1000 - hundred*100);
    lakh = lakh>0?`${number2Word(lakh)} lakh`:"";
    thousand = thousand>0?`${number2Word(thousand)} thousand`:"";
    hundred = hundred>0?`${number2Word(hundred)} hundred`:"";
    ten = number2Word(ten);
    one = number2Word(one);
    let word = lakh + " " + thousand + " " + hundred + " and " + ten + " " + one + " only.";
    word = word.substr(1,1).toUpperCase() + word.substring(2,word.length);
    return word;
}//need more testing.

exports.applyFilter = function (tbody,selection="*"){
    [...tbody.children].forEach(tr=>tr.classList.remove("hide")); 
    if(selection!=="*")
        [...tbody.children].forEach(tr=>{
            let billDate = new Date(tr.children[1].textContent);
            let currentDate = new Date();
            if(Math.ceil((currentDate-billDate)/(1000*60*60*24))>selection)
                tr.classList.add("hide")
        });
};

exports.filterSelector = function(e){
    if(e.target===this) return;
    [...this.children].forEach(a=>a.classList.remove("selection"));
    selection = e.target.dataset.time!=="*"?Number(e.target.dataset.time):"*";
    e.target.classList.add("selection");
    this.classList.add("hide");
    applyFilter(tbody,selection);
}

exports.roundOffTo2DecimalPlace = function(num){
    return Math.round(num*100)/100
}

exports.printModal = function printModal(customId=""){
    let modal = document.createElement("div");    
    modal.classList.add("modal");
    let cover = document.createElement("div");    
    cover.classList.add("cover");
    modal.id = customId;
    modal.innerHTML = `
            <form onsubmit="handlePrint(event)">
                <div>
                    <label for="ledger-period">Please select the period of ledger.</label>
                    <select id="ledger-period" name="ledger-period">
                        <option value="0">1 month</option>
                        <option value="2">3 month</option>
                        <option value="5">6 month</option>
                        <option value="11">1 year</option>
                    </select>
                </div>
                <div>
                    <button type="submit">Print</button>
                    <button type="button" data-name="cancel">Cancel</button>
                </div>
            </form>
    `;
    document.body.appendChild(cover);
    document.body.appendChild(modal);
    document.querySelector('[data-name="cancel"]').addEventListener("click",function closeModal(){
        document.body.removeChild(cover);        
        document.body.removeChild(modal);
        this.removeEventListener("click",closeModal);        
    })
}