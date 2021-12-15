const {ipcRenderer} = require("electron");
const uuid = require("uuid");
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

exports.validateInput = function validateInput(e){
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

exports.validateInput2 = function(e){
    validateInput(e)
    if(e.defaultPrevented) return;
    if(e.target.dataset.subtype==="price" && !/\d/.test(e.key)) e.preventDefault();
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

function applyFilter(tbody,selection="*"){
    [...tbody.children].forEach(tr=>tr.classList.remove("hide")); 
    let slNo = 1;
    if(selection!=="*")
        [...tbody.children].forEach(tr=>{
            let billDate = new Date(tr.dataset.date);
            let currentDate = new Date(Date.now() - selection*30*24*60*60*1000);
            currentDate.setDate(1);
            if(billDate>=currentDate){
                tr.classList.remove("hide");
                tr.querySelector("p").textContent = slNo++;
            }
            else
                tr.classList.add("hide");
        });
    else
        [...tbody.children].forEach(tr=>tr.querySelector("p").textContent=slNo++);
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

exports.drawBarGraph = function drawBarGraph(optionObj){
    let offsetBottom = 20;
    let { canvas,
        ctx,
        i=0,
        ht=150,
        width=20,
        offsetLeft=10,
        offsetTop=5,
        direction=-1,
        text,
        period=12,
        fontSize=16,
        style = {fillStyle:"blue",strokeStyle:"black"} } = optionObj;
    if(!canvas){
        canvas = document.createElement("canvas");
        canvas.width = 250;
        canvas.height = 125;
    }
    if(!ctx)
        ctx = canvas.getContext("2d");
    ctx.fillStyle = style.fillStyle;
    ctx.strokeStyle = style.strokeStyle;
    let x = (canvas.width/period)*(i+1) - offsetLeft;
    if(i===0){
        ctx.beginPath();
        ctx.moveTo(0,0)
        ctx.lineTo(0,canvas.height - offsetBottom)
        ctx.lineTo(canvas.width,canvas.height - offsetBottom);
        ctx.stroke();
    }
    ctx.fillText(text,x,canvas.height - offsetTop,fontSize);
    ctx.beginPath();
    ctx.moveTo(x,canvas.height - offsetBottom);
    if(ht>0 && ht-offsetTop-offsetBottom>0)
        ht = direction*(ht-offsetTop-offsetBottom);
    ht = ht>0?-ht:ht;
    ctx.fillRect(x,canvas.height-offsetBottom,width,ht);
    ctx.stroke();
    ctx.fill();
    return canvas;
}

class Spinner{
    constructor(width,height,document){
        this.width = width;
        this.height = height;
        this.document = document;
        this.modal = document.createElement("div");
        this.modal.classList.add("spinner-div");
        this.modal.classList.add("modal");
        this.canvas = this.document.createElement("canvas");
        this.canvas.width = 150;
        this.canvas.height = 150;
        this.ctx = this.canvas.getContext("2d");
        this.modal.appendChild(this.canvas);
        this.cover = document.createElement("div");
        this.cover.classList.add("cover");
        this.document.body.appendChild(this.cover);
        this.document.body.appendChild(this.modal);
        this.initMultiplier = 0.5;
    }
    drawCircle(multiplier){
        const {width,height} = this.canvas;
        for(let i=1;i<8;i++){
            this.ctx.beginPath();
            this.ctx.fillStyle = `hsla(0,0%,0%,${1-i*0.1})`;
            let x = (width/2)+40*Math.cos(multiplier+(((Math.PI)/7)*i));
            let y = (height/2)-40*Math.sin(multiplier+(((Math.PI)/7)*i));
            this.ctx.arc(x,y,10-i,0,2*Math.PI,false);
            this.ctx.fill();
        }
    }
    drawSpinner([window]){
        const {width,height} = this.canvas;
        this.ctx.clearRect(0,0,width,height);
        this.initMultiplier -= 0.1;
        this.drawCircle(this.initMultiplier);
        window.requestAnimationFrame(this.drawSpinner.bind(this,[window]))
    }
    remove(window){
        this.modal.classList.add("fade");
        window.setTimeout(()=>{
            this.modal.remove();
            this.cover.remove();
        },400);
    }
}

exports.drawSpinner = function(document){
    let spinner = new Spinner(150,150,document);
    spinner.drawSpinner([window])
    return spinner;
}

exports.renderPieChart = function(canvas,startAngle=0,endAngle,fillStyle,strokeStyle){
    if(!canvas){
        canvas = document.createElement("canvas");
        canvas.width = 150;
        canvas.height = 150;
    }
    ctx = canvas.getContext("2d");
    let {height,width} = canvas;
    ctx.beginPath();
    ctx.fillStyle = !fillStyle ? `hsl(${endAngle*57.29},100%,70%)` : fillStyle;
    ctx.strokeStyle = !strokeStyle ? `white` : strokeStyle;
    ctx.lineTo(width/2,height/2);
    ctx.closePath();
    ctx.arc(width/2,height/2,width/2-8,startAngle,endAngle,false);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    return {canvas,fillStyle:ctx.fillStyle};
}

exports.removeAllElem = function(selector){
    // console.log([...document.querySelectorAll(selector)]);
    [...document.querySelectorAll(selector)].forEach(node=>node.remove());
}

exports.closeToast = function (e){
    e.target.parentNode.remove();
}

function toastNotification(msg,customClasses,...elems){
    let div = document.createElement("div");
    div.innerHTML = `
        <p>${msg}</p>
        <button type="button" onclick="closeToast(event)">x</button>
    `;
    if(elems.length>0)
        elems.forEach(elem=>div.appendChild(elem));
    div.className = "toast-div";
    if(customClasses && typeof customClasses==="object")
        customClasses.forEach(className=>div.classList.add(className));
    return div;
}

exports.showToastNotification = function(msg,className,container,adjX=8){
    let toast = toastNotification(msg,className);
    let { height } = toast.getBoundingClientRect();
    [...document.querySelectorAll(".toast-div")].forEach(toast=>{
        toast.style.top = `${toast.getBoundingClientRect().y + height + adjX}px`;
    });
    document.getElementById(container).appendChild(toast);
    let toastTimers = [];
    [...document.querySelectorAll(".toast-div")].forEach((toast,index,self)=>{
        if(index>4)
            for(let i=0;i<4;i++){
                clearTimeout(toastTimers[i]);
                toastTimers = toastTimers.filter((_,index)=>index!==i);
                self[i].remove();
            }
        toastTimers.push(setTimeout(()=>{
            toast.style.transform = "translateX(-100%)";
            toast.classList.add("fade")
            setTimeout(()=>{
                toast?.remove();
            },300);
        },2000 + 200*index));
    })
}

const cmdMap = [
    {
        text: [">","greater than"],
        value: "greater"
    },
    {
        text: ["<","less than"],
        value: "lesser"
    },
    {
        text: ["between"],
        value: "between"
    }
];

function showOrHideScrollSym(){
    let tbody = document.querySelector(".body.row").parentNode;
    if(tbody.clientHeight>=tbody.scrollHeight)
        tbody.querySelector(".scroll-sym-div")?.classList.add("hide");
    else
        tbody.querySelector(".scroll-sym-div")?.classList.remove("hide");
}

exports.showOrHideScrollSym = showOrHideScrollSym;

function initSearchHandler(e){
    let searchText = e.target.value;
    let bodyRows = [...document.querySelectorAll(".body.row")];
    bodyRows.forEach(row=>row.classList.add("hide"));
    if(searchText.length===0){
        bodyRows.forEach((row,i)=>{
            row.classList.remove("hide");
            row.querySelector("p").textContent = i+1;
        });
        showOrHideScrollSym();
    }
    return {searchText,bodyRows}
}

exports.initSearchHandler = initSearchHandler;

exports.searchHandler = function(e,arr){
    let {searchText} = initSearchHandler(e);
    let matches = [],cmd,searchBy = {feild:"name",dataFeild:"name"};
    let startDate,endDate;
    searchText.split(" ").forEach(word=>{
        if(word.length===0) return;
        if(!/\d+/.test(word) && !/[/]/g.test(word)){
            cmd = cmdMap.filter(({text})=>{
                if(text.filter(prob=>{
                    if(prob.match(word,"i")?.length>0)
                        return true;
                    else
                        return false;
                }).length>0)
                    return true;
                else
                    return false;
            })[0]?.value ?? cmd;
            arr.forEach(obj=>{
                let key = Object.keys(obj).filter(key=>["name","supplierName"].includes(key))?.[0];
                if(!key) return;
                if((new RegExp(`${obj[key]}`,"i")).test(word)){
                    matches.push(obj);
                    if(key==="supplierName"){
                        searchBy.feild = "supplierName";
                        searchBy.dataFeild = "supplier-name";
                    }
                }
            });
        }
        else
        if(/\d+/.test(word) && !/[/]/g.test(word)){
            let _matches = arr.filter(({billNo})=>Number(word)===billNo);
            searchBy = {feild:"billNo",dataFeild:"bill-no"};;
            if(_matches.length>0)
                _matches.forEach(match=>matches.push(match));
        }
        else
        if(/[/]/g.test(word)){
            let [date,month,year] = word.split(/[/]/g);
            searchBy = {feild:"billDate",dataFeild:"bill-date"};
            if(!date || !month || !year) return;
            let searchDate = new Date(year,+month-1,date),_matches;
            if(cmd!=="between" || !cmd)
                _matches = !cmd?arr.filter(({billDate})=>{
                    if(searchDate.toLocaleDateString()===billDate.toLocaleDateString())
                        return true;
                }):arr.filter(({billDate})=>{
                    if(cmd==="greater" && billDate>searchDate)
                        return true;
                    else
                    if(cmd==="lesser" && billDate<=searchDate)
                        return true;
                });
            else
            if(cmd && cmd==="between"){
                if(!startDate)
                    startDate = searchDate;
                else
                    endDate = searchDate;
                if(startDate && endDate){
                    _matches = arr.filter(({billDate})=>{
                        if(billDate>startDate && billDate<=endDate)
                            return true;
                        else
                            return false;
                    })
                }
            }
            if(_matches?.length>0)
                _matches.forEach(match=>matches.push(match));
        }
    });
    matches.length>0 && matches.forEach(match=>{
        let slNo = 1;
        [...document.querySelectorAll(`[data-${searchBy.dataFeild}="${match[searchBy.feild]}"]`)]
            .forEach(row=>{
                row.classList.remove("hide");
                row.querySelector("p").textContent = slNo++;
            });
        showOrHideScrollSym();
    })
}

exports.scrollSymSet = function(elem){
    let scrollSymDiv = document.createElement("div"),mousedownTimer;
    scrollSymDiv.className = "scroll-sym-common scroll-sym-div";
    elem.appendChild(scrollSymDiv);
    scrollSymDiv.addEventListener("mousedown",e=>{
        mousedownTimer = setInterval(()=>{
            elem.scrollBy(0,10)
        },100);
    });
    scrollSymDiv.addEventListener("mouseup",()=>clearInterval(mousedownTimer));        
    let scrollTopSymDiv = document.createElement("div");
    scrollTopSymDiv.className = "scroll-sym-common scroll-top-sym hide";
    elem.appendChild(scrollTopSymDiv);
    scrollTopSymDiv.addEventListener("click",()=>{
        elem.scrollTo(0,0);
        clearInterval(mousedownTimer)
    });
    elem.addEventListener("scroll",function(e){
        if(this.scrollTop == Math.abs(this.clientHeight-this.scrollHeight)){
            this.querySelector(".scroll-sym-div")?.classList.add("hide");
            this.querySelector(".scroll-top-sym")?.classList.remove("hide");
        }
        else{
            this.querySelector(".scroll-sym-div")?.classList.remove("hide");
            this.querySelector(".scroll-top-sym")?.classList.add("hide");
        }
    });
    return mousedownTimer;
}

exports.retractHandler = function retractHandler(retractableDiv,mode="height",val1=0,val2){
    if(!val2)
        val2 = mode==="height" ? retractableDiv.scrollHeight : 0;
    if(retractableDiv.dataset.collapsed==="false"){
        requestAnimationFrame(()=>{
            retractableDiv.style[mode] = val2 + "px";
            requestAnimationFrame(()=>{
                retractableDiv.style[mode] = val1 + "px";
            })
        });
        retractableDiv.dataset.collapsed = "true";
    }
    else{
        retractableDiv.style[mode] = val2 + "px";
        retractableDiv.dataset.collapsed = "false";
    }
    
}

exports.drawLineGraph = function(total,objs,selector,lineColor,fillColor,{lOffset=4,rOffset=16,tOffset=16,bOffset=32}={}){
    let canvas =  document.querySelector(selector);
    canvas.width = canvas.parentNode.clientWidth;
    canvas.height = 200;
    let ctx =  canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.moveTo(0,8);
    ctx.lineTo(0,canvas.height-16);
    ctx.lineTo(canvas.width-8,canvas.height-16);
    ctx.stroke();
    let reducedObjs = objs.reduce((acc,obj)=>{
        if(typeof obj.date==="string"){
            let [yr,mnt,dt] = obj.date.split("-").map(num=>Number(num));
            mnt--;
            obj.date = new Date(yr,mnt,dt);
        }
        let date = obj.date.toLocaleDateString("en-GB");
        if(!acc[date])
            acc[date] = {amt: obj.amt};
        else
            acc[date].amt += obj.amt;
        return acc;
    },{});
    let redObjsLen = Object.keys(reducedObjs).length;
    Object.keys(reducedObjs).forEach((date,i)=>{
        let xPos = lOffset + (canvas.width-rOffset) * (i/redObjsLen);
        let yPos = tOffset + (canvas.height-bOffset) * (1 - reducedObjs[date].amt/total);
        if(i===0)
            ctx.beginPath();
        else{
            ctx.lineWidth = 1;
            ctx.strokeStyle = lineColor;
            ctx.lineTo(xPos,yPos);
            ctx.stroke();
        }
        ctx.moveTo(xPos,yPos);
        ctx.lineWidth = 0;
        ctx.arc(xPos,yPos,2,0,2*Math.PI,true);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.closePath();
        reducedObjs[date].xPos = xPos;
        reducedObjs[date].yPos = yPos;
    });
    ctx.save();
    return {canvas,ctx,reducedObjs};
}

exports.createModal = function(id,makeRetractable=false){
    let modal = document.createElement("div");
    modal.className = "modal";
    let cover = document.createElement("div");
    cover.className = "cover";
    document.body.appendChild(modal);        
    document.body.appendChild(cover);
    removeAllElem(`#${id}`);
    modal.id = id;
    if(makeRetractable){
        modal.dataset.collapsed = "false";
        modal.classList.add("appear")
        retractHandler(modal,"width",modal.scrollWidth);
        setTimeout(()=>{
            modal.classList.remove("appear");
        },400);
    }
    return modal;
}

exports.closeModal = function(){
    let modal = document.querySelector(".modal");
    if("collapsed" in {...modal.dataset}){
        setTimeout(()=>{
            removeAllElem(".cover,.modal");    
        },305);
        modal.dataset.collapsed = "false";
        retractHandler(modal,"width",0,modal.scrollWidth);
        let {bodyRow,initPage} = typeof getBodyRow==="function" ? getBodyRow() : {};
        if(bodyRow && "stockUpdated" in {...bodyRow.dataset} && bodyRow.dataset.stockUpdated)
            initPage?.();
    }
    else
        removeAllElem(".cover,.modal");
}

exports.dataModal = function([reducedObjs,key="Amt"],e){
    let { x,y } = e;
    let { left,top } = this.getBoundingClientRect();
    let clientX = x-left;
    let clientY = y;
    let date = Object.keys(reducedObjs).filter(date=>{
        const { xPos,yPos } = reducedObjs[date];
        if(Math.abs(xPos-clientX)<=20 && Math.abs(yPos-(clientY-top))<=20)
            return date;
    });
    removeAllElem(".data-modal");
    if(date.length>0){
        let dataModal = document.getElementById("data-modal-template").content.cloneNode("true").querySelector("div");
        this.parentNode.appendChild(dataModal);
        dataModal.querySelector("p").textContent = `Date: ${date[0]}, ${key}: ${reducedObjs[date[0]].amt}`;
        if(clientX+8+dataModal.clientWidth<this.width)
            dataModal.style.left = clientX+8+"px";
        else
            dataModal.style.left = clientX - dataModal.clientWidth + "px";
        if(clientY<(this.parentNode.getBoundingClientRect().bottom*0.5))
            dataModal.style.top = clientY+"px";
        else
            dataModal.style.top = clientY - this.getBoundingClientRect().top*0.3 + "px";
        clearTimeout(timer);
        timer = setTimeout(()=>{
            dataModal.remove();
        },2000);
        dataModal.addEventListener("mousemove",function(){
            this.removeEventListener("mousemove",arguments.callee);
            this.remove();
        });
    }
}

exports.deleteRowCommon = function(bodyRow,itemList,key="uid"){
    if(!bodyRow)
        bodyRow = document.querySelector(".body.row:last-child");
    let uid = bodyRow.dataset[key];
    itemList = itemList.filter(obj=>obj[key]!==uid);
    bodyRow.remove();
    [...document.querySelectorAll(".body.row>div:first-child>p")]
    .forEach((p,index)=>{
        let bodyRow = p.parentNode.parentNode;
        p.textContent = index + 1;
        let itemObj = itemList.find(obj=>obj[key]===bodyRow.dataset[key]);
        bodyRow.dataset[key] = uuid.v5((index+1).toString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
        if(itemObj && key in itemObj)
            itemObj[key] = bodyRow.dataset[key];
    });
    return itemList;
}

exports.capitalize = function capitalize(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
}

exports.makeKey = function(key){
    key = key.split(" ").reduce((acc,word,index)=>{
        if(index>0)
            acc += capitalize(word);
        else
            acc = word.toLowerCase();
        return acc;
    },"");
    return key;
}

exports.appendToDL = async function (eventName,datalist){
    let list = await ipcRenderer.invoke(eventName);
    list.forEach(obj=>{
        let option = document.createElement("option");
        for(let key in obj){
            if(key==="name")
                option.value = obj[key];
            option.dataset[key] = typeof obj[key]!=="object" ? obj[key] : JSON.stringify(obj[key]);
        }
        datalist.appendChild(option)
    });
    document.body.appendChild(datalist);
    return list;
}