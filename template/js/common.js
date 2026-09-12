let {ipcRenderer,app} = require("electron");
const uuid = require("uuid");
const path = require("path");
const { type } = require("os");
require("dotenv").config();


const {
    APP_ENV
} = process.env;

let n,presets;

/** Safely execute fn, returning fallback if it throws. */
exports.attempt = function(fn, fallback) {
    try { return fn(); } catch (err) {
        if(typeof fallback === "function")
            return fallback(err);
        return fallback;
    }
};

exports.toggleDevTool = function(document){
    document.addEventListener("keyup",e=>{
        if(e.code==="F1")
            ipcRenderer.send("openDevTool");
        // if(e.code==="F1" && APP_ENV==="DEV")
        //     ipcRenderer.send("openDevTool");
        // else if(e.code==="Escape")
        //     ipcRenderer.send("close");
    });
}

exports.validateInput = function validateInput(e){
    if(e.target.id==="payment-status" && e.target.value.length>2)
        return e.preventDefault();
    if(e.target.dataset.subtype==="price" && !/[\d.]/.test(e.key)) 
        return e.preventDefault();
    if(!/[\d+ .]/.test(e.key)){
        if(
            (e.target.id==="partial-payment" || 
            e.target.dataset.type==="Number" ||
            e.target.id==="amount") &&
            e.target.dataset.subtype!="price"
            )//conditions..
            return e.preventDefault();
    }
    return 1;
}

exports.validateInput2 = function(e){
    validateInput(e)
    if(e.defaultPrevented) return;
    if(e.target.dataset.subtype==="price" && !/[\d.]/.test(e.key)) e.preventDefault();
    if(Number(e.target.hasAttribute("max") && e.target.value)>Number(e.target.max)) e.preventDefault();
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
            if(num>0)
                return number2Word(Math.floor(num/10)*10)+" "+number2Word(Math.round(((num/10)-Math.floor(num/10))*10));
            else
                return "";
    }
}

exports.getAmtToWord = function (amt){
    amt = Math.round(typeof amt!=="number"? Number(amt):amt);
    let lakh = Math.floor(amt/100000);
    let thousand = Math.floor((amt - lakh*100000)/1000);
    let hundred = Math.floor((amt - lakh*100000 - thousand*1000)/100);
    let ten = amt - lakh*100000 - thousand*1000 - hundred*100;
    if(ten>19)
        ten = Math.floor(ten/10)*10;
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
    // Build higher parts, then tens/ones with "and" only if there's a higher part
    var hi = [lakh, thousand, hundred].filter(function(s) { return s !== ""; });
    var lo = [ten, one].filter(function(s) { return s !== ""; });
    var word = hi.join(" ");
    if (hi.length > 0 && lo.length > 0) word += " and ";
    word += lo.join(" ") + " only.";
    return word.trim().replace(/\s+/g, " ");
}

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
    // Number.EPSILON compensates for IEEE 754 floating-point error.
    // Without it: 1.005 * 100 = 100.49999999999999 → Math.round = 100 → 1.00 (wrong)
    // Indian rounding: < 50 paise → 0, ≥ 50 paise → next integer
    num = Number(num);
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

exports.printModal = function printModal(customId=""){
    let modal = createModal(customId);
    modal.appendChild(document.getElementById("ledger-modal-content-template").content.cloneNode(true).querySelector("form"));
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
        return true;
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
    // ctx.closePath();
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
    if(customClasses){
        if(typeof customClasses==="object")
            customClasses.forEach(className=>div.classList.add(className));
        else
            div.className = "toast-div " + customClasses; 
    }
    return div;
}

exports.showToastNotification = function(msg,className,container,adjX=8,adjRight){
    let toast = toastNotification(msg,className);
    if(adjRight)
        toast.style.setProperty("--adj-right",adjRight);
    try{
        toast.classList.add("hide");
        document.getElementById(container).appendChild(toast);
    }
    catch(e){
        document.body.appendChild(toast);
    }
    finally{
        let { height } = toast.getBoundingClientRect();
        [...document.querySelectorAll(".toast-div")].forEach(toast=>{
            toast.style.top = `${toast.getBoundingClientRect().y + height + adjX}px`;
        });
        toast.classList.remove("hide");
        let { width } = toast.getBoundingClientRect();
        if(typeof className==="object" && className?.includes("move-left"))
            toast.style.right = `${-width+adjX}px`;
        else
            toast.style.left = `${-width+adjX}px`;
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
        });
    }
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
        if(["paid","unpaid"].includes(word.toLowerCase())){
            searchBy = {
                feild:"paymentStatus",
                dataFeild:"payment-status"
            };
            arr.forEach(obj=>{
                if(obj.paymentStatus===(word==="paid"?true:false))
                    matches.push(obj)
            });
        }
        else
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

exports._searchHandler = function(e){
    let text = e.target.value;
    let startDate,endDate;
    if(e.target.name==="name" && mode===1){
        selectedCustomer = customerObjs.find(({name})=>text===name);
        if(!selectedCustomer) return;
        e.target.setAttribute("disabled","disabled")
        dateFeild?.removeAttribute("disabled");
        dateFeild?.focus();
    }// Set selected customer
    else
    if(e.target.name==="name" && mode===2){
        selectedSupplier = supplierObjs.find(({name})=>text===name);
        if(!selectedSupplier) return;
        e.target.setAttribute("disabled","disabled")
        suppDateFeild?.removeAttribute("disabled");
        suppDateFeild?.focus();
    }
    else
    if(e.target.name==="date"){
        let textMatch = text.match(/(\d+.+\d)|(\d+.months?|\d+.weeks?|\d+.days?)/g)?.[0] ?? null;
        if(!textMatch){
            let replaceWord = [];
            text.split(/\b/g).forEach(_word=>{
                let match = langSet.find(({word})=>word===_word);
                if(match)
                    replaceWord.push({word:_word,replaceValue:match.value})
            });//Text to value conversion
            replaceWord.forEach(({word,replaceValue})=>{
                text = text.replace(word,replaceValue);
            });
            textMatch = text.match(/(\d+.+\d)|(\d+.months?|\d+.weeks?|\d+.days?)/g)?.[0] ?? null;            
            if(!textMatch)
                return document.getElementById("billNo").setAttribute("disabled","disabled");
            else
                text = textMatch;
        }
        else
            text = textMatch;
        // New condition starts
        if(/\//g.test(text)){
            let textArr = text.match(/[tobewnad\- ]+/gi) ? text.split(/[tobewnad\- ]+/gi):text;
            if(textArr?.length===2){
                [startDate,endDate] = textArr;
                const [stDay,stMnth,stYear=(new Date()).getFullYear()] = startDate.split("/");
                const [endDay,endMnth,endYear=(new Date()).getFullYear()] = endDate.split("/");
                startDate = new Date(stYear,+stMnth-1,stDay);
                endDate = new Date(endYear,+endMnth-1,endDay);
            }
            else{
                const [stDay=null,stMnth=null,stYear=(new Date()).getFullYear()] = textArr.split("/") ?? [];
                startDate = new Date(stYear,+stMnth-1,stDay);
                endDate = new Date();
            }
        }// dd/mm/yyyy pattern filter
        else{
            if(/months?/.test(text) && /\d+/.test(text)){
                let noMonths = Number(text.match(/\d+/)[0]);
                endDate = new Date();
                startDate = new Date(Date.now() - noMonths*30*24*60*60*1000);
                startDate.setDate(1);
            }
            else
            if(/weeks?/.test(text) && /\d+/.test(text)){
                let noDays = Number(text.match(/\d+/)[0])*7;
                endDate = new Date();
                startDate = new Date(Date.now() - noDays*24*60*60*1000);
            }
            else
            if(/days?/.test(text) && /\d+/.test(text)){
                let noDays = Number(text.match(/\d+/)[0]);
                endDate = new Date();
                startDate = new Date(Date.now() - noDays*24*60*60*1000);
            }
        }// 'X' month/week pattern filter
        let diff = Math.ceil((Math.abs(endDate - startDate))/(1000*60*60*24));
        if(!startDate || !endDate || startDate>endDate || !diff) return document.getElementById("billNo").setAttribute("disabled","disabled");
        if(noReturn){
            if(diff>noReturn){
                if(mode===1)
                    document.getElementById("billNo").setAttribute("disabled","disabled");
                // return alert("Return not possible");
            }
        }
        // console.log({diff,startDate,endDate});
        if(mode===1)
            ipcRenderer.send("get-bill-numbers",selectedCustomer.id,startDate,endDate);
        else
            ipcRenderer.send("get-supp-bill-numbers",selectedSupplier.id,startDate,endDate);
    }// set and find bill numbers in specified date range
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

exports.retractHandler = function retractHandler(retractableDiv,mode="height",val1=0,val2,unit="px"){
    if(!val2)
        val2 = mode==="height" ? retractableDiv.scrollHeight : 0;
    if(retractableDiv.dataset.collapsed==="false"){
        requestAnimationFrame(()=>{
            retractableDiv.style[mode] = val2 + unit;
            requestAnimationFrame(()=>{
                retractableDiv.style[mode] = val1 + unit;
            })
        });
        retractableDiv.dataset.collapsed = "true";
    }
    else{
        retractableDiv.style[mode] = val2 + unit;
        retractableDiv.dataset.collapsed = "false";
    }
    
}

// Helper: convert any CSS color (named, hex, rgb) to rgba with custom alpha
function _colorToRgba(color, alpha) {
    // Use a scratch canvas to normalize the color — handles "red", "#ff0000", "rgb(…)", etc.
    const cache = _colorToRgba._cache || (_colorToRgba._cache = {});
    const key = color;
    if (!cache[key]) {
        const c = document.createElement("canvas").getContext("2d");
        c.fillStyle = color;
        cache[key] = c.fillStyle; // normalized to "rgb(r,g,b)" or "rgba(r,g,b,a)"
    }
    const base = cache[key];
    if (base.startsWith("rgba")) {
        return base.replace(/[\d.]+\)$/, alpha + ")");
    }
    return base.replace("rgb(", "rgba(").replace(")", ", " + alpha + ")");
}

// drawLineGraph — single-series (backward-compatible) or multi-series line chart
//
//   Single series (original signature, still works):
//     drawLineGraph(total, objs, selector, lineColor, fillColor, opts, axisColor, bgColor)
//       objs = [{date, amt}, …]
//
//   Multi-series (new):
//     drawLineGraph(total, seriesArray, selector, …opts…)
//       seriesArray = [{data: [{date, amt}, …], lineColor, fillColor, label?}, …]
//       Detection: objs[0].data is an array → multi-series mode.
//       When multi-series, the positional lineColor/fillColor are ignored (each series
//       carries its own).  The returned object gains .allReduced and .seriesResults;
//       .reducedObjs still points to the first series' reduced data for backward compat.
//
//   New options (all opt-in, defaults keep existing behaviour):
//     shadow      — draw a soft fading gradient fill below each line (default: true)
//     height      — canvas height in px (default: 200)
//     pointRadius — dot radius (default: 3)
//
exports.drawLineGraph = function (total, objs, selector, lineColor, fillColor, {
    lOffset = 4, rOffset = 16, tOffset = 16, bOffset = 32, mode = 1,
    yLegend = "", yLegColor = "Black", yLegOffset = 0.75, yLegFont = "12px Arial",
    xLegend = "", xLegColor = "Black", xLegOffset = 10, xLegFont = "12px Arial",
    shadow = true,
    height = 200,
    pointRadius = 3,
} = {}, axisColor = "black", bgColor = "white") {

    // --------------- detect multi-series mode ---------------
    const isMultiSeries = Array.isArray(objs) && objs.length > 0
        && objs[0] && Array.isArray(objs[0].data);

    /** @type {Array<{data: Array, lineColor: string, fillColor: string, label?: string}>} */
    const seriesList = isMultiSeries
        ? objs
        : [{ data: objs, lineColor, fillColor }];

    // --------------- canvas setup ---------------
    const canvas = document.querySelector(selector);
    if (!canvas) return { canvas: null, ctx: null, reducedObjs: {}, allReduced: [], seriesResults: [] };

    canvas.width = Math.round(0.95 * canvas.parentNode.clientWidth);
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --------------- axes ---------------
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = axisColor;
    ctx.lineCap = "round";
    ctx.moveTo(lOffset, tOffset);
    ctx.lineTo(lOffset, canvas.height - bOffset);
    ctx.lineTo(canvas.width - rOffset, canvas.height - bOffset);
    ctx.stroke();

    // --------------- data reduction (date-grouped sum per series) ---------------
    const reduceData = function (data) {
        const acc = {};
        data.forEach(function (obj) {
            let d = obj.date;
            if (typeof d === "string") {
                if(/T/.test(d)){
                    d = d.split("T")[0];
                }
                const parts = d.split("-").map(Number);
                d = new Date(parts[0], parts[1] - 1, parts[2]);
            }
            let label = mode === 1 ? d.toLocaleDateString("en-GB") : d;
            if (mode === 2)
                label = label.toLocaleDateString("en-GB", { dateStyle: "long" }).split(" ")[1];
            else if (mode === 3)
                label = label.toLocaleDateString("en-GB", { dateStyle: "long" }).split(" ")[2];
            acc[label] = (acc[label] || 0) + obj.amt;
        });
        return acc; // { dateLabel → totalAmt }
    };
    const allReduced = seriesList.map(function (s) { return reduceData(s.data); });
    // global maximum across ALL series so Y-axis is consistent
    let highestNum = 0;
    allReduced.forEach(function (red) {
        Object.keys(red).forEach(function (k) {
            if (red[k] > highestNum) highestNum = red[k];
        });
    });
    if (highestNum === 0) highestNum = 1;

    // unified X-axis: collect every date label that appears in ANY series, in order
    const labelSet = new Set();
    allReduced.forEach(function (red) { Object.keys(red).forEach(function (k) { labelSet.add(k); }); });
    const labels = Array.from(labelSet);
    const labelCount = labels.length;

    // positioning helpers
    const getX = function (i) {
        return lOffset + (canvas.width - rOffset - lOffset) * (i / Math.max(labelCount - 1, 1));
    };
    const getY = function (amt) {
        const y = tOffset + (canvas.height - bOffset - tOffset) * (1 - amt / highestNum);
        return Math.max(tOffset, y); // clamp to top margin
    };

    // --------------- draw each series ---------------
    const seriesResults = seriesList.map(function (series, si) {
        const reduced = allReduced[si];
        const sLineColor = series.lineColor;
        const sFillColor = series.fillColor;

        // build ordered points (only labels present in this series)
        const points = [];
        labels.forEach(function (label, i) {
            if (reduced[label] !== undefined) {
                const x = getX(i);
                const y = getY(reduced[label]);
                points.push({ x: x, y: y, amt: reduced[label], label: label });
                reduced[label].xPos = x;
                reduced[label].yPos = y;
            }
        });

        if (points.length === 0) return { reduced: reduced, points: [] };

        // ----- soft fading shadow below the line -----
        if (shadow) {
            // Anchor the gradient to the line's own peak so the shadow is always
            // visible regardless of where the data sits vertically on the chart.
            const peakY = points.reduce(function (minY, p) { return p.y < minY ? p.y : minY; }, Infinity);
            const grad = ctx.createLinearGradient(0, peakY, 0, canvas.height - bOffset);
            grad.addColorStop(0, _colorToRgba(sFillColor, 0.45));
            grad.addColorStop(0.5, _colorToRgba(sFillColor, 0.10));
            grad.addColorStop(1, _colorToRgba(sFillColor, 0.0));

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            // close shape down to the x-axis
            ctx.lineTo(points[points.length - 1].x, canvas.height - bOffset);
            ctx.lineTo(points[0].x, canvas.height - bOffset);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // ----- the line -----
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = sLineColor;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();

        // ----- the dots -----
        points.forEach(function (p) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, pointRadius, 0, 2 * Math.PI);
            ctx.fillStyle = sFillColor;
            ctx.fill();
            // thin white ring for contrast against the line / other dots
            ctx.lineWidth = 1;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
        });

        return { reduced: reduced, points: points };
    });

    // --------------- axis legends ---------------
    if (yLegend !== "") {
        ctx.save();
        ctx.translate(0, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = yLegColor;
        ctx.font = yLegFont;
        ctx.textAlign = "center";
        ctx.fillText(yLegend, 0, yLegOffset * lOffset);
        ctx.restore();
    }
    if (xLegend !== "") {
        ctx.fillStyle = xLegColor;
        ctx.font = xLegFont;
        ctx.textAlign = "center";
        ctx.fillText(xLegend, canvas.width / 2, canvas.height - bOffset + xLegOffset);
    }

    // --------------- auto series legend (top-right) ---------------
    const labeledSeries = seriesList.filter(function (s) { return s.label; });
    if (labeledSeries.length > 1) {
        let legX = canvas.width - rOffset - 6;
        let legY = tOffset + 14;
        ctx.font = "11px Arial";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        labeledSeries.forEach(function (s) {
            const tw = ctx.measureText(s.label).width;
            // color dot
            ctx.beginPath();
            ctx.arc(legX - tw - 12, legY, 4, 0, 2 * Math.PI);
            ctx.fillStyle = s.fillColor;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
            // label
            ctx.fillStyle = "#333";
            ctx.fillText(s.label, legX, legY);
            legY += 18;
        });
    }

    return {
        canvas: canvas,
        ctx: ctx,
        reducedObjs: allReduced[0],          // backward-compatible (first series)
        allReduced: allReduced,               // NEW — one reduced map per series
        seriesResults: seriesResults,         // NEW — {reduced, points} per series
    };
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
        let dataModal = document.getElementById("data-modal-template").content.cloneNode(true).querySelector("div");
        this.parentNode.appendChild(dataModal);
        dataModal.querySelector("p").textContent = `Date: ${date[0]}, ${key}: ${reducedObjs[date[0]].amt}`;
        let { right:canvRight,left:canvLeft } = this.getBoundingClientRect();
        let { right:dataRight,left:dataLeft } = dataModal.getBoundingClientRect();
        // clientX+8+dataModal.clientWidth<this.width
        if(dataRight<canvRight && dataLeft<canvLeft){
            console.log("case 1")
            dataModal.style.left = clientX+8+"px";
        }
        else
        if(dataRight>canvRight && dataLeft<canvLeft){
            console.log("case 2")
            dataModal.style.left = clientX - dataModal.clientWidth/2 + "px";
        }
        else{
            console.log("case 3")
            dataModal.style.left = 0 + "px"
        }
        if(clientY<(this.parentNode.getBoundingClientRect().bottom*0.5))
            dataModal.style.top = clientY+"px";
        else
            dataModal.style.top = clientY - this.getBoundingClientRect().top*0.3 + "px";
        
        typeof timer!=="undefined" && clearTimeout(timer);
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
    if(!bodyRow && bodyRow instanceof HTMLElement)
        bodyRow = bodyRow.closest(".body.row");
    if(!bodyRow) return;
    let uid = bodyRow.dataset[key];
    itemList = itemList.filter(obj=>obj[key]!==uid);
    bodyRow.remove();
    [...document.querySelectorAll(".body.row>div:first-child>p")]
    .forEach((p,index)=>{
        let bodyRow = p.closest(".body.row");
        p.textContent = index + 1;
        let itemObj = itemList.find(obj=>obj[key]===bodyRow.dataset[key]);
        bodyRow.dataset[key] = uuid.v5((index+1).toString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
        if(itemObj && key in itemObj)
            itemObj[key] = bodyRow.dataset[key];
    });
    return itemList;
}

exports.capitalize = function capitalize(str,camelcase=false){
    if(!camelcase)
        return str.charAt(0).toUpperCase() + str.slice(1);
    else
        return str.split(" ").reduce((acc,str)=>{
            acc+=str.charAt(0).toUpperCase()+str.slice(1)+" ";
            return acc;
        },"")
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

exports.appendToDL = async function (eventName,datalist,appendToBody,paths,textFormat,_list){
    if (appendToBody === void 0) appendToBody = true;
    if (textFormat === void 0) textFormat = [];
    var tableName = this.tableName;
    var alreadyIndexed = tableName && ngramIndex[tableName];
    // Use cached data if available (avoids IPC round-trip on re-init)
    var list;
    if (eventName && eventName !== "") {
        if (tableName && dataCache[tableName]) {
            list = dataCache[tableName];
        } else {
            list = await ipcRenderer.invoke(eventName);
            if (tableName) dataCache[tableName] = list;
        }
    } else {
        list = _list;
    }
    if(paths)
        list = paths.reduce(function(acc,path){
            acc = list[path];
            return acc;
        },[]);

    // Keyword extraction for stock table (only on first index)
    var keywords = [];
    if(tableName === "stock" && !alreadyIndexed){
        var arrLen = list.length;
        if(arrLen>0){
            keywords = Array.from(new Set(list.reduce(function(acc,obj){
                acc.push(obj.name.split(" "));
                return acc;
            },[]).flat())).map(function(word){
                var occurances = list.reduce(function(acc,obj){
                    if(obj.name.split(" ").includes(word))
                        acc++;
                    return acc;
                },0);
                return {word:word,occurances:occurances};
            }).sort(function(a,b){return b.occurances-a.occurances;});
            var highestOccurance = keywords[0].occurances;
            keywords = keywords.map(function(_a){
                var word = _a.word, occurances = _a.occurances;
                var weight = highestOccurance/occurances;
                if(weight<15)
                    return {word:word,occurances:occurances};
            }).filter(Boolean).map(function(_b){return _b.word;});
        }
    }
    list?.forEach(function(obj){
        var option = document.createElement("option");
        for(var key in obj){
            if(key==="name" || key==="superkey"){
                option.value = obj["superkey"] || obj[key]; // Set value to superkey if exists, else set to name
                var value = option.value;
                // if(tableName==="stock"){
                //     var words = value.split(" ");
                //     value = words.reduce(function(acc,word){
                //         if(keywords.includes(word))
                //             return acc;
                //         else
                //             return acc + word + " ";
                //     },"");
                // }
                // Skip n_gram when index was pre-built (injected via setNGramIndex
                // from the main process). The keyword extraction above is also
                // guarded by alreadyIndexed for the same reason.
                if (!alreadyIndexed) n_gram(value,tableName,option);
                if(textFormat.length>0)
                    option.textContent = textFormat.reduce(function(acc,key){
                        acc += "name" + ": " +obj.name + " ";// Hardcoded name in case superkey as key comes before name in textFormat array, can be changed as per requirement
                        return acc;
                    },"");
                if(key==="superkey")
                    break; //
            }
            else
            if(["address","phone","email","gst",].includes(key) && !alreadyIndexed)
                n_gram(obj[key],tableName,option);
            option.dataset[key] = typeof obj[key]!=="object" ? obj[key] : JSON.stringify(obj[key]);
        }
        datalist.appendChild(option);
    });
    if(!document.querySelector("#" + datalist.id) && appendToBody)
        document.body.appendChild(datalist);
    // Build/cache the option snapshot and lookup for fuzzy search
    if (tableName) cacheDatalistState(datalist, tableName);
    return list;
}

exports.showDeleteBTN = function(e){
    let target = e.target;
    let bodyRow;
    if(["INPUT","P"].includes(target.nodeName))
        bodyRow = target.closest(".body.row");
    else
    if(target.nodeName==="DIV" && target.classList.contains("col"))
        bodyRow = target.closest(".body.row");
    if(bodyRow){
        setBodyRowOpts(bodyRow,timer)
        bodyRow.addEventListener("mouseleave",mouseoutHandler.bind(bodyRow));        
    }
}

function mouseoutHandler(e){
    this.querySelector(".body-row-options")?.remove();
    this.removeEventListener("mouseout",arguments.callee);
}

exports.errorFormatter = function(err){
    return err.message.match(/(?<=Error:).+/g).pop().trim();
}

exports.throttle = function(cb,delay=1000){
    let shouldWait = false;
    let waitingArgs;
    function throttleFunc(){
        if(!waitingArgs)
            shouldWait = false;
        else{
            cb(...waitingArgs);
            waitingArgs = null;
            setTimeout(throttleFunc,delay);
        }
    }
    return (...args)=>{
        if(shouldWait){
            waitingArgs = args;
            return;
        }

        cb(...args);
        shouldWait = true;
        setTimeout(throttleFunc,delay);
    }
}

exports.drawTimer = function drawTimer(ctx,width,self,time=30){
    let sub = time - (new Date() / 1000) % time;
    ctx.clearRect(0,0,width,width);
    ctx.fillStyle = "white";
    ctx.arc(width/2,width/2,width/2,0,2*Math.PI);
    ctx.fill();
    ctx.save();
    ctx.fillStyle = "blue";
    ctx.beginPath();
    ctx.moveTo(width/2,width/2);
    ctx.arc(width/2,width/2,width/2,1.5*Math.PI,((2 * (1-sub/30) + 1.5) * Math.PI),false);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    requestAnimationFrame(self.bind(null,ctx,width,self,time))
}

exports.applyTheme = async function(e,theme){
    let themeObj = {
        applyTheme:false,
        applyBackgroundImage:false,
        primary: "#663399",
        secondary: "#FFFFFF",
        shadow: "#808080",
        text: "#000000",
        darkPrimary:"#bdb76b",
        darkSecondary:"#1F1B24",
        darkShadow:"#556b2f",
        darkText:"#556b2f",
        file:""
    };
    theme = theme || themeObj;
    let { shouldUseDarkColors=false,useDarkTheme=false,darkPrimary,darkSecondary="#94A3B8",darkShadow,darkText,applyBackgroundImage,file,primary,secondary="#FFFFFF",shadow,text,applyGradient } = theme;
    if(shouldUseDarkColors && useDarkTheme){
        this.documentElement.style.setProperty("--theme-primary",darkPrimary);
        this.documentElement.style.setProperty("--theme-secondary",darkSecondary);
        this.documentElement.style.setProperty("--theme-text-color",darkText);
        this.documentElement.style.setProperty("--theme-shadow-color",darkShadow);
    }
    else{
        this.documentElement.style.setProperty("--theme-primary",primary);
        this.documentElement.style.setProperty("--theme-secondary",secondary);
        this.documentElement.style.setProperty("--theme-text-color",text);
        this.documentElement.style.setProperty("--theme-shadow-color",shadow);
    }
    if(!applyBackgroundImage){
        // Remove Background image
        this.body.style.backgroundImage = "unset";
        return;
    }
    if(file.endsWith("svg")){
        let svg = await ipcRenderer.invoke("get-svg",file);
        if(!svg) return;
        svg = new DOMParser().parseFromString(svg,'text/html').body;
        function traverseChild(node){
            node.removeAttribute("fill");
            if([...node.children].length>0)
                [...node.children]
                .forEach(child=>{
                    child.removeAttribute("fill");
                    if([...child.children].length>0)
                        traverseChild(child)
                });
        }
        traverseChild(svg.querySelector("svg"));
        svg.querySelector("svg").style.fill = `${shouldUseDarkColors ? darkPrimary : primary}`;
        svg = Buffer.from(svg.innerHTML).toString("base64");
        let gradient = "";
        if(applyGradient)
            gradient = `linear-gradient(180deg,var(--theme-secondary) 80%,transparent),`;
        this.body.style
        .backgroundImage = `${gradient} url('data:image/svg+xml;base64,${svg}')`;
    }
    else{
        let path2bng = file;
        if(process.platform==="win32")
            path2bng = path.resolve(__dirname,file).replace(/[\\]/g,'/');
        this.body.style.backgroundImage = `url(${path2bng})`;
    }
}

exports.chooseFile = async function (e,filterObj = {name: 'Images',extensions:['jpg', 'png', 'gif','svg']}){
    let input = e.target.previousSibling.previousSibling;
    let selectionObj = await ipcRenderer.invoke("get-file-path",filterObj);
    if(!selectionObj.canceled)
        input.value = selectionObj.filePaths[0];
}

function policyPathCommmon(relPath,_path){
    let policyPath = __dirname; 
    if(!app)
        app = require("@electron/remote").app;
    if(process.env.APP_ENV==="DEV"){
        policyPath = __dirname;
        policyPath = path.resolve(policyPath,relPath,_path);
    }
    else
        policyPath = path.resolve(app.getPath("appData")+"/BBS",_path);
    // dialog.showMessageBox({
    //     title:"Path to JSON",
    //     message:policyPath
    // })
    return policyPath;
}

exports.getAppPolicyPath = function(relPath="../../"){
    return policyPathCommmon(relPath,"./config/appDefault.json");
};

exports.getUserPolicyPath = function(relPath="../../"){
    return policyPathCommmon(relPath,"./config/policy.json");
};

exports.getsaleConfigPolicyPath = function(relPath="../../"){
    return policyPathCommmon(relPath,"./config/saleConfig.json");
};

exports.getOrderPath = function(relPath="../../"){
    return policyPathCommmon(relPath,"./orders.json");
};

exports.getSchedulerPath = function(relPath="../../"){
    return policyPathCommmon(relPath,"./scheduler.json");
};

exports.noDataPlaceholder = function(host){
    let div = document.createElement("div");
    div.classList.add("no-data");
    div.innerHTML = `
        <h2>NO DATA <i class="fa-regular fa-folder-open"></i></h2>
    `;
    host.appendChild(div);
}

exports.selectionHandler = async function(e,_currentStep){// Work needed here
    if(e.target.dataset.name==="name" && _currentStep===3)
        currentStep = _currentStep;
    if(e.target.dataset.name==="billType"){// Step 2
        // Proforma mode — generate proforma bill number
        if(e.target.value === "proforma") {
            document.querySelector('[data-name="billNo"]').value = "proforma_" + Date.now();
            [...document.querySelectorAll("form input[name='bill-status']")].forEach(function(input) {
                if(input.id === "bill-status-open") input.checked = true;
                input.setAttribute("disabled", true);
            });
            return;
        }
        // Scrap mode uses regular bill number — skip toggle
        if(e.target.value === "scrap") {
            // Ensure regular bill-number is visible, monthly hidden
            var rows = document.querySelectorAll("form .row1.bill-number");
            if(rows.length >= 2) {
                rows[0].classList.remove("hide");
                [...rows[0].querySelectorAll("input")].forEach(function(inp) { inp.removeAttribute("disabled"); });
                rows[1].classList.add("hide");
                [...rows[1].querySelectorAll("input")].forEach(function(inp) { inp.setAttribute("disabled", true); });
            }
            // Enable bill status radios
            [...document.querySelectorAll("form input[name='bill-status']")].forEach(function(input) {
                input.removeAttribute("disabled");
            });
            return;
        }
        [...document.querySelectorAll("form .row1.bill-number")]
        .forEach(row=>{
            if(row.classList.contains("hide")){// && row.contains(row.querySelector(".radio-btn-div")) && e.target.value==="monthly")
                row.classList.remove("hide");
                [...row.querySelectorAll("input")]
                .forEach(input=>{
                    input.removeAttribute("disabled");
                });
            }
            else{
                row.classList.add("hide");
                [...row.querySelectorAll("input")]
                .forEach(input=>{
                    input.setAttribute("disabled",true)
                });
            }
        });
        [...document.querySelectorAll("form input[name='bill-status']")]
        .forEach(input=>{
            if(e.target.value==="monthly"){
                if(input.id==="bill-status-open")
                    input.checked = true;
                input.setAttribute("disabled",true);
            }
            else
                input.removeAttribute("disabled");
        });
    }
    let match = {...e.target.list?.querySelector(`[value='${e.target.value.replace(/"/g,'\\"').replace(/'/g,"\\'")}']`)?.dataset};
    // if(!match || Object.keys(match).length==0) return;
    if(typeof presets==="undefined")
        presets = await ipcRenderer.invoke("get-presets");
    let defaultGST = presets?.default_gst ?? 0;
    if(e.target.dataset.name==="name" && currentStep===3){
        selectedItem = match;
        bodyRow = e.target.closest(".body.row");
        if(!bodyRow.classList.contains("body") && !bodyRow.classList.contains("row"))
            return;
        if(bodyRow.querySelector(`[data-name="qty"]`).value.length>0 && Number(bodyRow.querySelector(`[data-name="qty"]`).value)!==0)
            return;
        selectedItem.pInfo = JSON.parse(selectedItem?.pInfo || "{}");
        for(let key in match){
            if(["sgst","cgst","igst"].includes(key) && typeof igstFlag!=="undefined"){
                // if(!("taxSlab" in selectedItem.pInfo)) continue;
                if(igstFlag){
                    bodyRow.querySelector(`input[data-name="igst"]`).value = Number(selectedItem?.pInfo?.taxSlab ?? defaultGST);
                    bodyRow.querySelector(`input[data-name="sgst"]`).value = "";
                    bodyRow.querySelector(`input[data-name="cgst"]`).value = "";
                }
                else{
                    bodyRow.querySelector(`input[data-name="igst"]`).value = "";
                    bodyRow.querySelector(`input[data-name="sgst"]`).value = Number(selectedItem?.pInfo?.taxSlab ?? defaultGST)/2;
                    bodyRow.querySelector(`input[data-name="cgst"]`).value = Number(selectedItem?.pInfo?.taxSlab ?? defaultGST)/2;
                }
                continue;
            }
            let input = bodyRow.querySelector(`input[data-name="${key}"]`);
            if(input && key!=="unit" && key!=="standardSellPrice")
                input.value = match[key];
            else
            if(key==="unit" && selectedItem.type!=="service")
                input.value = "Kg";
            else
            if(key==="unit" && selectedItem.type==="service")
                input.value = selectedItem.unit;
            else
            if(key==="standardSellPrice"){
                input.value = roundOffTo2DecimalPlace(selectedItem.standardSellPrice);
                if(selectedItem.specialPrice!==""){
                    let list;
                    try{
                        list = JSON.parse(selectedItem?.specialPrice ?? "[]")
                                    .filter(obj=>obj.customerId===customer.id)
                                    .map(obj=>({...obj,name:obj.rate}));
                    }
                    catch(err){
                        list = [];
                    }
                    if(list.length>0){
                        let dl = document.createElement("datalist");
                        dl.id = "rate-list";
                        removeAllElem("#rate-list")
                        appendToDL("",dl,true,null,[],list)
                    }
                }
            }
            bodyRow.dataset[key] = typeof match[key] === "object" ? JSON.stringify(match[key]) : match[key];
        }
        if(match && Object.keys(match).length>2)
            bodyRow.querySelector(`[data-name="qty"]`)?.focus();
        match.sellId = bodyRow.dataset.sellId;
        match.type = (typeof match.type==="undefined" || match.type==='null') ? "goods" : match.type;
        orderItems = orderItems.filter(obj=>obj.sellId!==match.sellId);
        orderItems.push(match);
        if(selectedItem.id!==match.id)
            selectedItem = match;
        if(_currentStep===3)
            currentStep = 2;
    }
    else
    if(e.target.dataset.name==="name" && currentStep===1){// Done.
        let {address,phones="[]",gst,moreInfo="{}"} = (match ?? {});
        customer = {address,phones,gst,moreInfo,...match};
        customer.moreInfo = JSON.parse(customer.moreInfo);
        let dl = document.createElement("datalist");
        document.body.appendChild(dl)
        dl.id = "customer-phones";
        let phone = JSON.parse(phones);
        document.querySelector("[data-name='address']").value = address ?? "";
        document.querySelector("[data-name='phones']").value = phone?.[0] ?? "";
        document.querySelector("[data-name='gst']").value = gst ?? "";
        document.querySelector("[data-name='email']").value = JSON.parse(moreInfo)?.email ?? "";
        if(phone instanceof Array)
            phone.forEach(ph=>{
                let option = document.createElement("option");
                option.value = ph;
                option.textContent = ph;
                dl.appendChild(option)
            });
        let shipInfos = customer.moreInfo.shipInfos ?? []; // Always an array, if shipInfos is not present in moreInfo, it will be initialized as an empty array
        shipInfos = [
            ...shipInfos,
            // Adding the default shipping info from customer info to shipInfos array to show in datalist options along with other shipping infos if present in moreInfo - Test Successful - ✅
            {
                shipTo: customer.name,
                shipAddr: customer.address,
                shipPh: JSON.parse(customer.phones || "[]")?.[0] ?? "",
                shipGST: customer.gst
            }
        ]
        shipInfos = shipInfos.map((info,index,arr)=>{
            if(info.shipTo===customer.name && info.shipAddr===customer.address && info.shipPh===JSON.parse(customer.phones || "[]")?.[0] && info.shipGST===customer.gst)// Default option for customer info - Test Successful - ✅
                return {...info,superkey:customer.name+"_default"};
            if(arr.findIndex(i=>i.name===info.name && i!==info)!==-1)// i!==info object reference check to avoid same name check with itself in shipInfos array
                return {...info,superkey:info.name+"_"+(index+1)};// Renaming superkey if duplicate names are found in shipInfos array to avoid datalist option value duplication which results in option merge in datalist - people can have same company name for different shipping addresses
            return {...info,superkey:info.name};
        });
        appendToDL("",shipInfoDatalist,true,null,[],shipInfos);// Test Successful - ✅
    }
    else
    if(e.target.dataset.name==="transportName"){// Done
        let {address,phone,charge} = match;
        document.querySelector("[data-name='transportAddress']").value = address!==undefined?address:"";
        document.querySelector("[data-name='transportContact']").value = phone!==undefined?phone:"";
    }
}

exports.addRow = function(e){
    let clonedBodyRow = document.getElementById("body-row-template").content.cloneNode(true);
    document.getElementById("add-item").before(clonedBodyRow);
    [...document.querySelectorAll(".body.row>div:first-child>p")].forEach((p,index)=>{
        p.textContent = index+1;
    });
    e.target.scrollIntoView();
    e.target.parentNode.previousSibling.previousSibling.querySelector("input").focus();
    bodyRow = e.target.parentNode.previousSibling.previousSibling;
    selectedItem = {};
    bodyRow.dataset.sellId = uuid.v5(bodyRow.querySelector("p").textContent,"6ba7b814-9dad-11d1-80b4-00c04fd430c8");
    if(typeof igstFlag!=="boolean") return;
    if(igstFlag){
        bodyRow.querySelector(`[data-name="sgst"]`).setAttribute("disabled",true);
        bodyRow.querySelector(`[data-name="cgst"]`).setAttribute("disabled",true);
        bodyRow.querySelector(`[data-name="igst"]`).removeAttribute("disabled");
        bodyRow.querySelector(`[data-name="sgst"]`).textContent = "";
        bodyRow.querySelector(`[data-name="cgst"]`).textContent = "";
    }
    else{
        bodyRow.querySelector(`[data-name="igst"]`).setAttribute("disabled",true);
        bodyRow.querySelector(`[data-name="cgst"]`).removeAttribute("disabled");
        bodyRow.querySelector(`[data-name="sgst"]`).removeAttribute("disabled");
        bodyRow.querySelector(`[data-name="igst"]`).textContent = "";
    }
    setBodyRowOpts(bodyRow,timer);
}

function computeAllAmounts(){
    [...document.querySelectorAll(".body.row")].forEach(row=>{
        let quantity = Number(row.querySelector('[data-name="qty"]').value);
        let rate = Number(row.querySelector('[data-name="standardSellPrice"]').value);
        let unit = row.querySelector(`[data-name="unit"]`).value;
        let cgst = Number(row.querySelector('[data-name="cgst"]').value) ?? 0;
        let sgst = Number(row.querySelector('[data-name="sgst"]').value) ?? 0;
        let igst = Number(row.querySelector('[data-name="igst"]').value) ?? 0;
        let sellId = row.dataset.sellId;
        let itemObj = orderItems.find(obj=>obj.sellId===sellId);
        if(itemObj){
            itemObj.qty = quantity;
            itemObj.rate = rate;
            itemObj.cgst = cgst;
            itemObj.sgst = sgst;
            itemObj.igst = igst;
            itemObj.unit = unit;
            itemObj.sellUnit = unit;
        }
        let itemProperties = [
            "buyPrice",
            "cgst",
            "hsn",
            "id",
            "igst",
            "lastSellPrice",
            "name",
            "pHistory",
            "pInfo",
            "pScore",
            "qty",
            "quantity",
            "rate",
            "sellId",
            "sellUnit",
            "sgst",
            "specialPrice",
            "standardSellPrice",
            "tax",
            "type",
            "unit"
        ];
        if(Object.keys(itemObj || {}).length!==itemProperties.length){
            // If the itemObj missing any property then we fill in with default values and push the updated itemObj to orderItems array. This is to ensure that the orderItems array always has complete item objects with all necessary properties.
            itemProperties.reduce((acc,key)=>{
                try{
                    acc[key] = itemObj?.[key] ?? (key==="qty" ? 0 : key==="rate" ? 0 : key==="sellUnit" ? unit : "Kg");
                    if(key==="sellId")
                        acc[key] = sellId;
                    if(key==="name")
                        acc[key] = row.querySelector('[data-name="name"]').value;
                    if(key==="standardSellPrice")
                        acc[key] = rate || (itemObj?.standardSellPrice ?? 0);
                    if(key==="cgst")
                        acc[key] = cgst || (process.presets?.default_gst ?? 0);
                    if(key==="sgst")
                        acc[key] = sgst || (process.presets?.default_gst ?? 0)/2;
                    if(key==="igst")
                        acc[key] = igst || (process.presets?.default_gst ?? 0)/2;
                    if(key==="unit")
                        acc[key] = unit || "Kg";
                    if(key==="pInfo"){
                        acc[key] = itemObj?.pInfo || {};
                    }
                    if(key==="pHistory"){
                        acc[key] = JSON.parse(itemObj?.pHistory || "[]");
                    }
                    if(key==="pScore")
                        acc[key] = JSON.parse(itemObj?.pScore || "[]"); 
                    if(key==="specialPrice")
                        acc[key] = JSON.parse(itemObj?.specialPrice || "[]");
                    if(key==="quantity")
                        acc[key] = itemObj?.quantity ?? 0;
                    if(key==="buyPrice")
                        acc[key] = itemObj?.buyPrice ?? 0;
                    if(key==="lastSellPrice")
                        acc[key] = itemObj?.lastSellPrice ?? 0;
                    if(key==="hsn")
                        acc[key] = itemObj?.hsn ?? "";
                    if(key==="tax")
                        acc[key] = itemObj?.tax ?? process.presets?.default_gst ?? 0;
                    if(key==="type")
                        acc[key] = itemObj?.type ?? "goods";
                    if(key==="id")
                        acc[key] = itemObj?.id ?? "";
                }
                catch(err){
                    console.log(err,key)
                }
                return acc;
            },{});
        }
        row.querySelector(".amt").textContent = roundOffTo2DecimalPlace(quantity * rate);
        row.querySelector(".amt-with-tax").textContent = roundOffTo2DecimalPlace(quantity * rate * (1 + (cgst + sgst + igst)/100));
    });
    let reducedOrder = exports.reduceOrder();
    billMeta.netQty = reducedOrder.netQty;
    billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
    billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
    billMeta.netTax = roundOffTo2DecimalPlace(
        billMeta.netAmtTax - billMeta.netAmt,
    );
    // Update Display Section
    [...document.querySelectorAll("#display-section .highlight")]
    .forEach(p=>{
        p.textContent = billMeta[p.dataset.name];
    });
}

exports.calculateAmounts = computeAllAmounts;

exports.updateBillValue = function(e){
    if(e.target.dataset.name!=="payment") return;
    //Update summary and billMeta
    let paymentModeDiv = e.target.parentNode.parentNode;
    let payObj = {
        payment:Number(e.target.value)
    };
    if(paymentModeDiv.id==="cash-payment"){
        payObj.type = "cash";
        let deliveryCharge = "deliveryType" in billMeta && billMeta.deliveryType==="hand"?0:Number(billMeta?.transportCharge ?? 0);
        if(Math.round(billMeta.netAmtTax + deliveryCharge)<=payObj.payment || Math.round(billMeta.netAmtTax + deliveryCharge)<=payObj.payment + billMeta.netPayment)
            billMeta.paymentStatus = true;
        else
            billMeta.paymentStatus = false;
    }
    else if(paymentModeDiv.id==="check-payment"){
        payObj.type = "check";
        payObj.bankName = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.bankBranch = paymentModeDiv.querySelector("[data-name='bankBranch']").value;
        payObj.bankACNo = paymentModeDiv.querySelector("[data-name='bankACNo']").value;
        payObj.chkNo = paymentModeDiv.querySelector("[data-name='chkNo']").value;
        billMeta.paymentStatus = paymentModeDiv.querySelector(`[data-name="paymentStatus"]`).value==="true";
    }
    else{
        payObj.type = "online";
        payObj.bankName = paymentModeDiv.querySelector("[data-name='bankName']").value;
        payObj.bankTrnRef = paymentModeDiv.querySelector("[data-name='bankTrnRef']").value;
        billMeta.paymentStatus = paymentModeDiv.querySelector(`[data-name="paymentStatus"]`).value==="true";
    }
    let updateFlag = false;
    if(payment.length>0)
        for(let i=0;i<payment.length;i++)
            if(payment[i].type===payObj.type){
                payment[i] = payObj;
                updateFlag = true;
                break;
            }
    if(!updateFlag)
        payment.push(payObj);
    billMeta.payment = payment;
    if(!["regular","order"].includes(billMeta.billType))
        billMeta.paymentStatus = false;
    if(billMeta.paymentStatus)
        showToastNotification("Bill marked as paid",["animation-common","move-left","blue-toast-box"],"page-4",32);
    else
        showToastNotification("Bill marked as unpaid",["animation-common","move-left","red-toast-box"],"page-4",32);
    if(typeof reassignSummaryDivFeilds==="function")
            reassignSummaryDivFeilds();
}

exports.showPaymentMode = function(e){
    [...document.getElementsByClassName("payment-detail")].forEach(div=>{
        if(div.id===(e?.target || e).value+"-payment")
            div.classList.remove("hide");
        else
            div.classList.add("hide");
    })
}

exports.reassignSummaryDivFeilds = function(){
    let netPayment = "payment" in billMeta ? billMeta.payment.reduce?.((acc,payObj)=>acc + payObj.payment,0):0;
    let deliveryCharge = billMeta.deliveryType==="hand"?0:Number(billMeta.transportCharge);
    document.querySelector("[data-name='paymentAmt']").textContent = netPayment;
    if(Math.sign(deliveryCharge + billMeta.netAmtTax - netPayment)<=0){
        document.querySelector("[data-name='dueAmt']").textContent = 0;
        billMeta.netDue = 0;
        document.querySelector("[data-name='return']").textContent = roundOffTo2DecimalPlace(netPayment - (Math.round(billMeta.netAmtTax) + deliveryCharge));
    }
    else{
        document.querySelector("[data-name='dueAmt']").textContent = roundOffTo2DecimalPlace(deliveryCharge + Math.round(billMeta.netAmtTax) - netPayment);
        billMeta.netDue = roundOffTo2DecimalPlace(deliveryCharge + Math.round(billMeta.netAmtTax) - netPayment);
        document.querySelector("[data-name='return']").textContent = 0;
    }
}

exports.applyDiscount = function(e){
    let discVal = Number(e.target.value);
    document.getElementById("discount-feild")?.remove();
    billMeta.discVal = 0;
    let netAmt = reduceOrder().netAmt;
    billMeta.discVal = discVal;
    if(discVal>0){
        let div = document.createElement("div");
        div.innerHTML = `
            <p>Discount</p>
            <p data-name="discVal" class="highlight">${roundOffTo2DecimalPlace(netAmt - reduceOrder().netAmt)}</p>
        `;
        div.id = "discount-feild";
        document.getElementById("netAmtTaxDel-div").before(div);
    }
    let reducedOrder = reduceOrder();
    billMeta.netAmt = reducedOrder.netAmt;
    billMeta.netAmtTax = reducedOrder.netAmtTax;
    billMeta.netTax = billMeta.netAmtTax - billMeta.netAmt;
    if(typeof page4Init==="function")
        page4Init();
}

exports.reduceOrder = function(){
    // console.clear()
    return orderItems.reduce((acc,obj,i,self)=>{
        let sellId = obj.sellId;
        let tax = ["sgst","cgst","igst"].reduce((acc,key)=>{
            if(key in obj)
                return acc + obj[key];
            return acc;
        },0);
        if(!("discVal" in billMeta))
            billMeta.discVal = 0;
        if(obj.sellUnit==="")
            obj.sellUnit = document.querySelector(`.body.row[data-sell-id="${sellId}"]`).querySelector('[data-name="unit"]').value;
        if(obj.qty===0)
            obj.qty = Number(document.querySelector(`.body.row[data-sell-id="${sellId}"]`).querySelector('[data-name="qty"]').value);
        let res = unitMap.find(uObj=>obj.sellUnit in uObj);
        if(!res){
            return acc;
        }
        let multiplier = 1;
        if(obj.type!=="service")
            multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
        else
        if(obj.type==="service" && obj.unit===Object.keys(res)[0])
            multiplier = 1;
        else
        if(obj.type==="service" && obj.unit!==Object.keys(res)[0])
            multiplier = typeof res==="object" ? Object.values(res)[0] : 1;
        if(obj.type!=="service" && ["Bag","Kg"].includes(obj.sellUnit))
            acc.netQty += obj.qty * multiplier;
        acc.netAmt += roundOffTo2DecimalPlace(obj.rate * obj.qty * (100-billMeta.discVal)/100) ?? 0;
        acc.netAmtTax += roundOffTo2DecimalPlace((obj.rate * obj.qty * (100-billMeta.discVal)/100) * (1 + tax/100)) ?? 0;
        return acc;
    },{
        netQty:0,
        netAmt:0,
        netAmtTax:0
    });
}

exports.clickOrFocusinHandler = function(e){
    if(e.target.dataset.cmd==="delete-row" && e.type==="focusin")
        return deleteRow(e);
    if(e.target.dataset.cmd==="desc-btn" && (e.type==="focusin"  || e.type==="click"))
        return bodyRow.querySelector(".desc-div").classList.remove("hide");
    bodyRow = e.target.parentNode.parentNode;
    if(bodyRow.classList.contains("desc-div"))
        bodyRow = bodyRow.parentNode;
    if(!bodyRow.classList.contains("body") && !bodyRow.classList.contains("row"))
        return;
    if(orderItems.some(obj=>obj.sellId===bodyRow.dataset.sellId))
        selectedItem = orderItems.find(obj=>obj.sellId===bodyRow.dataset.sellId); 
    removeAllElem(".body-row-options");
    if(bodyRow.className==="body row"){
        setBodyRowOpts(bodyRow,timer);
    }
}

function setBodyRowOpts(bodyRow,timer){
    removeAllElem(".body-row-options");
    bodyRow.appendChild(document.getElementById("body-row-options-template").content.cloneNode(true));
    if(document.querySelector(".body-row-options"))
        document.querySelector(".body-row-options").dataset.sellId = bodyRow.dataset.sellId;    
    clearTimeout(timer);
    timer = setTimeout(()=>document.querySelector(".body-row-options")?.remove(),5000);
}

exports.appendToHost = function(selector,host=HTMLElement,contentType="form"){
    let child = document.querySelector(selector).content.cloneNode(true).querySelector(contentType);
    if(host instanceof HTMLElement)
        host.appendChild(child);
    else
        document.querySelector(host).appendChild(child);
    return child;
}

exports.bodyRow = function({obj, index, cols, key}){
    let div = document.createElement("div");
    div.dataset.obj = JSON.stringify(obj);
    div.dataset.identifier = key;
    div.className = "body row";
    cols.forEach(col => {
        let p = document.createElement("p");
        p.className = "col eq-space";
        p.textContent = formatCellValue(col, obj[col], index);
        div.appendChild(p);
    });
    return div;
}

function formatCellValue(col, val, index){
    // slNo / serial number
    if(col === "slNo" && (val == null || val === ""))
        return index + 1;

    // Date columns — format Date objects or date-like strings
    if(/date/i.test(col)){
        if(val instanceof Date)
            return openFormatForDate(val);
        if(typeof val === "string" && val){
            // ISO ("2026-07-29"), slash ("07/29/2026"), dash ("29-07-2026")
            if(/^\d{4}-\d{2}-\d{2}|^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(val.trim())){
                let d = new Date(val);
                if(!isNaN(d.getTime())) return openFormatForDate(d);
            }
            return val; // non-date string, pass through
        }
        return val ?? "";
    }

    // Numeric values — round to whole numbers (amounts, quantities)
    if(typeof val === "number")
        return Math.round(val);

    // Payment status — boolean → human-readable
    if(col === "paymentStatus")
        return val === true ? "Paid" : "Unpaid";

    // Order status — fallback to "queued"
    if(col === "status")
        return val || "queued";

    // Generic fallback
    return val != null ? String(val) : (index + 1);
}

exports.openFormatForDate = openFormatForDate;
function openFormatForDate(date=Date){
    if(!(date instanceof Date))
        date = new Date(date);
    return date.toLocaleDateString("en-IN",{
                month:"2-digit",
                day:"2-digit",
                year:"numeric"
            })
            .split("/")
            .reduce((acc,str,i)=>{
                acc = i===0 ? str : str+"-"+acc;
                return acc;
            },"");
}

exports.bodyRowInpFillup = itemObj=>{
    document.querySelector("#add-item>button").click();
    selectedItem = itemObj;
    [...document.querySelectorAll(`.body.row:nth-last-child(2) input`)]
    .forEach(input=>{
        if(input.dataset.name!=="unit")
            input.value = itemObj[input.dataset.name];
        else
            [...input.list.querySelectorAll("option")]
            .forEach(opt=>{
                if(opt.value===itemObj.sellUnit){
                    opt.setAttribute("selected",true);
                    input.value = itemObj.sellUnit;
                }
                else
                    opt.removeAttribute("selected");
            });
    });
    calculateAmounts();
}

exports.tableFillupHelper = function(arr,theadSelector,tbodySelector,bodyRowGen,key="itemObj"){
    let cols = [...document.querySelectorAll(theadSelector)].map(p=>p.dataset.col);
    let tbody = document.querySelector(tbodySelector);
    arr.forEach((obj,index)=>tbody.appendChild(bodyRowGen({key,obj,cols,index})));
}

exports.applySpinner = async cb =>{
    let spinner = drawSpinner(document);
    let ret = cb.call(spinner);
    if(ret instanceof Promise)
        await ret;
    spinner.remove(window);
}

exports.assignDeliveryOptions = function(e){
    let transportDiv = document.getElementById("transport-div");
    if((e?.target || e).value==="transport"){
        transportDiv.classList.remove("hide");
        let transportOptDF = document.getElementById("transport-retractable-div-template").content.cloneNode(true);
        transportDiv.appendChild(transportOptDF);
    }
    else{
        transportDiv.classList.add("hide");
        transportDiv.querySelector(".retractable-div").remove();
        deleteKey([
            "deliveryType",
            "transportName",
            "transportAddress",
            "transportContact",
            "transportCharge"
        ],billMeta);
    }
}

exports.execRetractHandler = function(e){
    if(e.target.nodeName!=="DIV"){
        let retractableDiv = e.target.parentNode.parentNode.querySelector(".retractable-div");
        [...e.target.parentNode.querySelectorAll("button")].forEach(btn=>btn.classList.toggle("hide"));
        retractHandler(retractableDiv);
    }
}

exports.deleteKey = function(arr,obj){
    arr.forEach(key=>{
        if(key in obj)
            Reflect.deleteProperty(obj,key);
    })
}

exports.hexTohsl = function(hex){
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    var r = parseInt(result[1], 16);
    var g = parseInt(result[2], 16);
    var b = parseInt(result[3], 16);

    r /= 255, g /= 255, b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if(max == min){
        h = s = 0; // achromatic
    } else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch(max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    s = s*100;
    s = Math.round(s);
    l = l*100;
    l = Math.round(l);
    h = Math.round(360*h);
    return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';

}

exports.lightenHSL = function(h,s,l,a=0.5,shouldLighten=true,sAdj=10,lAdj=10){
    let _s;
    let _l;
    if(shouldLighten){
        _s= s + s*sAdj/100;
        _l= l + l*lAdj/100;
    }
    else{
        _s= s - s*sAdj/100;
        _l= l - l*lAdj/100;
    }
    if(shouldLighten){
        s = Math.min(100,_s);
        l = Math.min(100,_l);
    }
    else{
        s = Math.max(0,_s);
        l = Math.max(0,_l);
    }
    return `hsla(${h},${s}%,${l}%,${a})`;
}

exports.hslComponents = (hexColor)=>{
    return hexTohsl(hexColor).split(/[\D]/).filter(str=>str!=="").map(str=>+str);
}

exports.carosel = function(elems,i=0){
    caroselTimer = setInterval(()=>{
        elems[i].classList.remove("card-in");
        elems[i].classList.add("card-out");
        i++;
        if(i===elems.length)
            i = 0;
        elems[i].classList.remove("card-out");
        elems[i].classList.add("card-in");
    },10000);
}

exports.upperCaseInput = function(e){
    if(/\w/.test(e.key) && e.key.length===1)
        e.target.value = (e.target.value + e.key).toUpperCase();
    if(e.key!=="Enter")
        e.preventDefault();
}

exports.createORexecuteProgressbar = function(value=0,{text,text2,cancelObj:{useCancel,cancelBtnText,cancelToken,usePause,pauseBtnTextObj,pauseToken}={}}={}){
    let progressbar = document.getElementById("progressbar");
    if(!progressbar){
        progressbar = document.body.appendChild(document.getElementById("progressbar-template").content.cloneNode(true).querySelector("div"));
        progressbar.addEventListener("click",btnClickHandler1);
    }
    let cancelBTN = progressbar.querySelector("#progress-cancel-btn");
    let pauseBTN = progressbar.querySelector("#progress-pause-btn");
    progressbar.querySelector("#progress").value = value;
    progressbar.querySelector("#progress-text").textContent = text;
    progressbar.querySelector("#progress-context").textContent = text2;
    progressbar.querySelector("#percentage").textContent = `${value}%`;
    if(useCancel && cancelBTN.classList.contains("hide")){
        cancelBTN.classList.remove("hide");
        cancelBTN.textContent = cancelBtnText;
        cancelBTN.dataset.token = cancelToken;
    }
    if(usePause && pauseBTN.classList.contains("hide")){
        pauseBTN.classList.remove("hide");
        pauseBTN.textContent = pauseBtnTextObj.pause;
        pauseBTN.dataset.token = pauseToken;
        pauseBTN.dataset.pauseBtnTextObj = JSON.stringify(pauseBtnTextObj);
        pauseBTN.dataset.paused = "false";
    }
    if(value===100)
        progressbar.remove();
}

function btnClickHandler1(e){
    let { cmd } = e.target.dataset;
    if(cmd==="cancel"){
        ipcRenderer.invoke("cancel-download");
    }
    else
    if(cmd==="pause"){
        let pauseBTN = e.target;
        let isPaused = pauseBTN.dataset.paused === "true";
        if(isPaused){
            pauseBTN.dataset.paused = "false";
            isPaused = false;
            pauseBTN.textContent = JSON.parse(pauseBTN.dataset.pauseBtnTextObj).resume;
        }
        else{
            pauseBTN.dataset.paused = "true";
            isPaused = true;
            pauseBTN.textContent = JSON.parse(pauseBTN.dataset.pauseBtnTextObj).pause;
        }
        ipcRenderer.invoke("pause-download", isPaused);
    }
}

exports.deepCompareJSON = function deepCompareJSON(obj1,obj2){
    let keys1 = Object.keys(obj1);
    let keys2 = Object.keys(obj2);
    // Check for different number of keys in two JSONs
    if(keys1.length!=keys2.length) return false;
    // Check is all keys are same in both JSONs
    if(keys1.find(key=>!(keys2.includes(key))) &&  keys2.find(key=>!(keys1.includes(key)))) return false;
    // Checking nested objs
    let resp = keys1.find(key=>{
        if(typeof obj1[key]==="object" && typeof obj2[key]==="object")
            return !(deepCompareJSON(obj1[key],obj2[key]));
        else
            return false;
    });
    if(resp) return false;
    return true;
}

exports.textRollAnnimation = function(e){
    let elem = e.target;
    if(!["P","INPUT"].includes(elem.nodeName)) return;
    let { width:elemWidth } = elem.getBoundingClientRect();
    let elemScrollWidth = elem.scrollWidth;
    let diffX = elemScrollWidth - elemWidth,scrollLeft = Math.ceil(elem.scrollLeft),count=0,mode="right";
    if(diffX>1 && !n){
        n = requestAnimationFrame(function scrollFunc(){
            if(count==3){
                if(scrollLeft<diffX && mode==="right"){
                    elem.scrollBy(1,0);
                    mode = "right";
                }
                else{
                    elem.scrollBy(-1,0);
                    mode = "left";
                }
                scrollLeft = Math.ceil(elem.scrollLeft);
                count = 0;
            }
            else
                count++;
            if(elem.scrollLeft===0)
                mode = "right";
            n = requestAnimationFrame(scrollFunc);
            elem.addEventListener("mouseout",function mouseoutHelper(){
                cancelAnimationFrame(n);
                elem.scrollTo(0,0);
                n = null;
                elem.removeEventListener("mouseout",mouseoutHelper);
            });
        });
    }
}

exports.traverseParent = function traverseParent(elem,matchClass,checkNodeType){
    if(elem===document.body)
        return false;
    if(checkNodeType && elem.parentNode.nodeName===checkNodeType)
        return elem.parentNode;
    else
    if(elem.parentNode.classList.contains(matchClass))
        return elem.parentNode;
    else
        return traverseParent(elem.parentNode,matchClass);
}

exports.contextMenuFunction = (e,targetWin)=>{
    selectedRow = traverseParent(e.target,"body");
    let obj = JSON.parse(selectedRow.dataset.billObj);
    ipcRenderer.send("show-context-menu",{mode:"billObj",obj,targetWin});
}

exports.showTutorial = function(doc){
    // To demonstrate what is chnaged in perticular window
}

exports.scrollHelper = function(arr,index,direction,firstFlag=false,mainSection,secMainSection){
    let mainSectionDOM = mainSection.getBoundingClientRect();
    let alphabetDOM = secMainSection.getBoundingClientRect();

    function scrollHelper2(firstIndex,secondIndex){
        if(firstFlag)
            index++;
        arr[firstIndex].dataset.hasFocus = "1";
        arr[firstIndex].focus();
        arr[firstIndex].classList.add("focus");
        arr[firstIndex].focus();
        let firstElemDOM = arr[firstIndex].getBoundingClientRect();
        let topDiff = firstElemDOM.top-mainSectionDOM.bottom;
        if(topDiff>0)
            mainSection.scrollBy(0,topDiff+firstElemDOM.height);
        let bottomDiff = firstElemDOM.bottom - alphabetDOM.bottom;
        if(bottomDiff<0){
            mainSection.scrollBy(0,bottomDiff-firstElemDOM.height);
        }
        if(firstIndex===0 && direction==="ArrowDown") return;
        delete arr[secondIndex].dataset.hasFocus;
        arr[secondIndex].classList.remove("focus");
    }
    if(direction==="ArrowUp" && index>0){
        if(firstFlag)
            index++;
        scrollHelper2(--index,index+1);
    }
    else
    if(direction==="ArrowDown" && index<arr.length){
        if(firstFlag)
            index--;
        scrollHelper2(++index,index-1);
    }
}

// gstChecksum function - validates the GSTIN number format and checksum
exports.gstChecksum = function(gst) {
    // GSTIN format: 2 digits (state), 5 letters, 4 digits, 1 letter, 1 alphanumeric, 'Z', 1 alphanumeric
    const regex = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/;
    if (!regex.test(gst)) return false;
    const factor = [1,2,1,2,1,2,1,2,1,2,1,2,1,2];
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        let codePoint = chars.indexOf(gst[i]);
        let product = codePoint * factor[i];
        sum += Math.floor(product / 36) + (product % 36);
    }
    let checksum = (36 - (sum % 36)) % 36;
    let expected = chars[checksum];
    return gst[14] === expected;
}

// ============================================================
//  Feature Tour — guided walkthrough of [isUpdated] elements
//  Runs automatically on every renderer page after DOM is ready.
//  Skips silently if no elements have the "isUpdated" attribute.
// ============================================================
// ============================================================
//  Update Welcome + Feature Tour — driven by update.md
//  Single markdown file provides: welcome message, tour stops.
//  No isUpdated attributes needed in HTML — tour selectors
//  are in update.md and applied dynamically.
// ============================================================
var tourElements = [];
var tourIndex = 0;
var tourOverlay = null;
var tourTooltip = null;
var _updateTourStops = []; // { selector, msg } from update.md

/** In-page update prompt modal — shown before downloading an update.
 *  Cleaner than a separate BrowserWindow (no frame, no script loading issues). */
function showUpdatePrompt(data) {
    // Remove any existing prompt
    var existing = document.getElementById("update-prompt-overlay");
    if (existing) existing.remove();

    // Overlay
    var overlay = document.createElement("div");
    overlay.id = "update-prompt-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;animation:tourFadeIn 0.3s ease;";

    // Modal card
    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--theme-secondary,white);color:var(--theme-text-color,black);border-radius:12px;max-width:500px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;";

    // Header
    var header = document.createElement("div");
    header.style.cssText = "padding:1.2rem 1.5rem 0.5rem;";
    header.innerHTML = '<div style="display:flex;align-items:baseline;gap:0.5rem;"><h1 style="margin:0;font-size:1.3rem;">Update Available</h1><span style="background:var(--theme-primary);color:var(--theme-secondary);padding:0.15rem 0.5rem;border-radius:20px;font-size:0.75rem;font-weight:600;">v' + (data.version || '') + '</span></div><p style="margin:0.5rem 0 0;opacity:0.8;">' + (data.message || '') + '</p>';

    // Body — highlights + full changes
    var body = document.createElement("div");
    body.style.cssText = "padding:0.5rem 1.5rem;overflow-y:auto;flex:1;";

    var highlights = data.highlights || [];
    if (highlights.length) {
        var hlTitle = document.createElement("p");
        hlTitle.style.cssText = "font-weight:600;margin:0.75rem 0 0.25rem;";
        hlTitle.textContent = "What's New";
        body.appendChild(hlTitle);
        highlights.forEach(function(item) {
            var text = typeof item === "string" ? item : (item.title || item.description || JSON.stringify(item));
            var p = document.createElement("p");
            p.style.cssText = "margin:0.25rem 0 0.25rem 0.75rem;font-size:0.9rem;";
            p.textContent = "• " + text;
            body.appendChild(p);
        });
    }

    var fullchange = data.fullchange || [];
    if (fullchange.length) {
        var details = document.createElement("details");
        details.style.cssText = "margin:0.75rem 0;font-size:0.85rem;";
        var summary = document.createElement("summary");
        summary.style.cursor = "pointer";
        summary.textContent = "Full Changes";
        details.appendChild(summary);
        fullchange.forEach(function(item) {
            var text = typeof item === "string" ? item : (item.title || item.description || JSON.stringify(item));
            var p = document.createElement("p");
            p.style.cssText = "margin:0.15rem 0 0.15rem 0.75rem;";
            p.textContent = "• " + text;
            details.appendChild(p);
        });
        body.appendChild(details);
    }

    // Footer — buttons
    var footer = document.createElement("div");
    footer.style.cssText = "padding:1rem 1.5rem;display:flex;gap:0.75rem;justify-content:flex-end;border-top:1px solid rgba(128,128,128,0.2);";

    var downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Download Now";
    downloadBtn.style.cssText = "padding:0.5rem 1.2rem;border-radius:6px;border:none;font-size:0.9rem;font-weight:600;cursor:pointer;background:var(--theme-primary);color:var(--theme-secondary);";
    downloadBtn.addEventListener("click", function() {
        overlay.remove();
        ipcRenderer.send("update-prompt-response", "download");
    });

    var laterBtn = document.createElement("button");
    laterBtn.textContent = "Later";
    laterBtn.style.cssText = "padding:0.5rem 1.2rem;border-radius:6px;border:1px solid #ccc;font-size:0.9rem;cursor:pointer;background:transparent;color:var(--theme-text-color);";
    laterBtn.addEventListener("click", function() {
        overlay.remove();
        ipcRenderer.send("update-prompt-response", "cancel");
    });

    footer.appendChild(laterBtn);
    footer.appendChild(downloadBtn);

    // Click overlay background to dismiss
    overlay.addEventListener("click", function(e) {
        if (e.target === overlay) {
            overlay.remove();
            ipcRenderer.send("update-prompt-response", "cancel");
        }
    });

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

exports.showUpdatePrompt = showUpdatePrompt;

/** Fetch update content from update.md via IPC. Shows welcome modal
 *  if new version detected, then optionally starts the feature tour. */
async function checkForUpdate() {
    var content;
    try { content = await ipcRenderer.invoke("get-update-content"); }
    catch (_) { return; }

    if (!content || !content.version || !content.welcome) return;
    _updateTourStops = content.tourStops || [];
    showWelcomeModal(content.welcome, content.version);
}

/** Dynamically build and show the welcome modal. */
function showWelcomeModal(welcomeText, version) {
    // Overlay
    var overlay = document.createElement("div");
    overlay.id = "tour-overlay"; // reuse tour overlay styles
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.cursor = "default";
    document.body.appendChild(overlay);

    // Modal card — skip tour button if no tour stops available
    var hasTour = _updateTourStops && _updateTourStops.length > 0;
    var modal = document.createElement("div");
    modal.id = "welcome-modal";
    modal.innerHTML =
        '<div class="welcome-body">' +
            '<h1 class="welcome-version">v' + (version || "") + '</h1>' +
            '<div class="welcome-text">' + welcomeText.replace(/\n/g, "<br>") + '</div>' +
            '<div class="welcome-actions">' +
                (hasTour ? '<button class="welcome-btn-start" tabindex="0">Start Tour</button>' : '') +
                '<button class="welcome-btn-skip" tabindex="0">' + (hasTour ? 'Skip' : 'Got it') + '</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);

    // Button handlers
    if (hasTour) {
        modal.querySelector(".welcome-btn-start").addEventListener("click", function() {
            overlay.remove(); modal.remove();
            startTour();
        });
    }
    modal.querySelector(".welcome-btn-skip").addEventListener("click", function() {
        overlay.remove(); modal.remove();
        try { ipcRenderer.send("set-update-seen"); } catch (_) {}
    });
    // Clicking overlay outside modal = skip
    overlay.addEventListener("click", function(e) {
        if (e.target === overlay) {
            overlay.remove(); modal.remove();
            try { ipcRenderer.send("set-update-seen"); } catch (_) {}
        }
    });
}

/** Attach tour attributes from update.md selectors and launch the tour. */
function startTour() {
    // Dynamically attach isUpdated + updateMsg to matched elements
    var stops = [];
    for (var i = 0; i < _updateTourStops.length; i++) {
        var stop = _updateTourStops[i];
        try {
            var el = document.querySelector(stop.selector);
            if (!el) continue; // selector not on this page — skip silently
            el.setAttribute("isUpdated", "");
            el.setAttribute("updateMsg", stop.msg);
            stops.push(el);
        } catch (_) { /* invalid selector — skip */ }
    }
    if (stops.length === 0) {
        try { ipcRenderer.send("set-update-seen"); } catch (_) {}
        return;
    }

    tourElements = stops;
    tourIndex = 0;

    // Build tour overlay + tooltip (same as before)
    tourOverlay = document.createElement("div");
    tourOverlay.id = "tour-overlay";
    tourOverlay.addEventListener("click", advanceTour);
    document.body.appendChild(tourOverlay);

    tourTooltip = document.createElement("div");
    tourTooltip.id = "tour-tooltip";
    tourTooltip.innerHTML =
        '<div class="tour-arrow"></div>' +
        '<div class="tour-body">' +
            '<p class="tour-msg"></p>' +
            '<div class="tour-footer">' +
                '<span class="tour-counter"></span>' +
                '<button class="tour-btn">Got it</button>' +
            '</div>' +
        '</div>';
    tourTooltip.querySelector(".tour-btn").addEventListener("click", function(e) {
        e.stopPropagation();
        advanceTour();
    });
    document.body.appendChild(tourTooltip);

    showTourElement(0);
}

function showTourElement(index) {
    if (index >= tourElements.length) return endTour();
    var el = tourElements[index];
    var msg = el.getAttribute("updateMsg") || "New or updated feature";

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(function() {
        el.classList.add("tour-highlight");
        var rect = el.getBoundingClientRect();
        var tt = tourTooltip;
        tt.querySelector(".tour-msg").textContent = msg;
        tt.querySelector(".tour-counter").textContent = (index + 1) + " of " + tourElements.length;

        var ttHeight = 120;
        var spaceBelow = window.innerHeight - rect.bottom;
        var spaceAbove = rect.top;
        var top, arrowClass;
        if (spaceBelow > ttHeight + 20 || spaceBelow > spaceAbove) {
            top = rect.bottom + 12;
            arrowClass = "arrow-up";
        } else {
            top = rect.top - ttHeight - 12;
            arrowClass = "arrow-down";
        }
        var left = rect.left + rect.width / 2 - 160;
        left = Math.max(12, Math.min(left, window.innerWidth - 332));

        tt.style.top = top + "px";
        tt.style.left = left + "px";
        tt.className = "visible " + arrowClass;

        var arrowX = rect.left + rect.width / 2 - left;
        tt.style.setProperty("--arrow-x", arrowX + "px");
    }, 400);
}

function advanceTour() {
    if (tourElements[tourIndex]) {
        var el = tourElements[tourIndex];
        el.classList.remove("tour-highlight");
        el.removeAttribute("isUpdated");
        el.removeAttribute("updateMsg");
    }
    tourIndex++;
    if (tourIndex >= tourElements.length) {
        endTour();
    } else {
        showTourElement(tourIndex);
    }
}

function endTour() {
    if (tourOverlay) { tourOverlay.remove(); tourOverlay = null; }
    if (tourTooltip) { tourTooltip.remove(); tourTooltip = null; }
    tourElements = [];
    tourIndex = 0;
    try { ipcRenderer.send("set-update-seen"); } catch (_) {}
}

exports.startUpdateTour = function() { APP_ENV !== "DEV" && checkForUpdate(); };

// Auto-start on page load. Disabled in DEV mode.
(function autoStartTour() {
    if (typeof document === "undefined") return;
    if (APP_ENV === "DEV") return;
    function ready() { setTimeout(checkForUpdate, 200); }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ready);
    } else {
        ready();
    }
})();

// ============================================================
// Fuzzy search — module-level caches (persist across page re-inits,
// cleared only on refresh-data IPC). Stores value strings instead
// of DOM references so the index is shareable and survives re-init.
// ============================================================
let ngramIndex = {};       // { [tableName]: { [gram]: [valueString, ...] } }
let _ngramSeen = {};       // { [tableName::gram]: Set<valueString> } — fast dedup for n_gram
let dataCache = {};        // { [tableName]: rawObject[] }
let optionSnapshot = {};   // { [tableName]: HTMLOptionElement[] } (cloned, for restore)
let optionLookup = {};     // { [tableName]: Map<valueString, HTMLOptionElement> }
let gramArr = [];

// Listen for data-refresh from main process — clear all caches so
// the next appendToDL / fuzzySearch rebuilds the index from fresh data.
try {
    const { ipcRenderer: ipcR } = require("electron");
    ipcR.on("refresh-data", function() {
        ngramIndex = {};
        _ngramSeen = {};
        dataCache = {};
        optionSnapshot = {};
        optionLookup = {};
        gramArr = [];
    });
} catch (_) { /* ipcRenderer not available in this context */ }

function n_gram(str, tableName, option, mode) {
    if (mode === void 0) mode = "add";
    if(!tableName) return [];
    var grams = [];
    var n = 3;
    str = String(str).toLowerCase();// Convert to string and lowercase for case-insensitive search
    if(str.length < n || str=="   " || (mode === "add" && !(option instanceof HTMLOptionElement))) return [];
    ngramIndex[tableName] = ngramIndex[tableName] || {};
    for (var i = 0; i <= str.length - n; i++) {
        var gram = str.substring(i, i + n);
        grams.push(gram);
        if(mode === "add") {
            // Store the option's value string, not the DOM element itself.
            // This makes the index serializable and shareable across page re-inits.
            var val = option.value;
            ngramIndex[tableName][gram] = ngramIndex[tableName][gram] || [];
            // Use a Set for O(1) dedup instead of Array.indexOf O(n) scan
            var dedupKey = tableName + "::" + gram;
            _ngramSeen[dedupKey] = _ngramSeen[dedupKey] || new Set();
            if (!_ngramSeen[dedupKey].has(val)) {
                _ngramSeen[dedupKey].add(val);
                ngramIndex[tableName][gram].push(val);
            }
        }
    }
    if(mode!=="add")
        return grams;
    else
        return;
}

function fuzzySearch(query, tableName) {
    if(!query || query.length < 3) return [];
    var queryGrams = n_gram(query,tableName, null, "search");
    if(!queryGrams || queryGrams.length === 0 || !(queryGrams instanceof Array)) return [];
    var result = {};
    // console.log(queryGrams.length)
    // debugger
    for (var _i = 0; _i < queryGrams.length; _i++) {
        var gram = queryGrams[_i];
        if(!gramArr.includes(gram)) continue;
        if (ngramIndex[tableName] && typeof ngramIndex[tableName][gram]!=="undefined") {
            ngramIndex[tableName][gram].forEach(function(val) {
                // Normalize: val can be a string (from serialized index) or
                // HTMLOptionElement (after reInitFuzzyIndexWithOptions).
                // Skip null/undefined entries from failed lookup conversions.
                if (!val) return;
                var value = (typeof val === "string") ? val : val.value;
                if (!result[value]) {
                    result[value] = { value: val, count: 1 };
                } else {
                    result[value].count++;
                }
            });
        }
    }
    // Sort results by count in descending order, return value strings/elements
    if(result){
        var sortedResults = Object.values(result).sort(function(a, b) { return b.count - a.count; });
        return sortedResults.map(function(item) { return item.value; });
    }
    else
        return [];
}

const FUZZY_MIN_LENGTH = 3;
// Non-breaking space (U+00A0) used as a separator between the search query and the real
// option value. Prepending the query ensures the browser's built-in substring
// filter always matches, while option.label keeps the dropdown display clean.
let NBSP = " ", debounceTimer = null;

function fuzzySearchHandler(e){
    let input = e.target;
    let val = input.value.trim();
    let useFuzzySearch = input.dataset?.usefuzzysearch === "true" ?? false;
    let tableName = input.dataset?.tablename ?? "";
    let sig = input.dataset?.sig;
    if (!useFuzzySearch || !tableName || !preset.useFuzzySearch) return;

    
    // Always work with the persistent datalist — never change the input's
    // list attribute, never remove the datalist from the DOM.
    let dl = document.getElementById(input.getAttribute("list"));
    if (!dl) return;
    
    function debounceTimerHelper(){
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(()=>{
            restoreFullDatalist(dl, tableName);
        },200);
    }
    // Kill any pending debounce on every keystroke — even if we're about
    // to early-return (selection, short query), the old timer must not fire.
    clearTimeout(debounceTimer);

    // Detect a datalist selection: options have value = "query" + NBSP + "realValue"
    var nbspIdx = val.indexOf(NBSP);
    if (nbspIdx > 0 || val === "") {
        if (val === "") {
            // Input cleared — restore the full datalist for the next interaction.
            debounceTimerHelper();
            if(sig && sig==="order-manager"){
                [...document.querySelectorAll(".body.row")].forEach(row=>row.classList.remove("hide"));
            }
            return;
        }
        // User selected an option — extract the real value and place only the
        // matching option in the datalist. This avoids cloning every option
        // (restoreFullDatalist is expensive for large lists) while still letting
        // selectionHandler (which fires next via the 'change' event) find the
        // matching option by its original value attribute.
        val = val.substring(nbspIdx + 1).trim();
        input.value = val;
        dl.innerHTML = "";
        var match = optionLookup[tableName] && optionLookup[tableName].get(val);
        if (match) dl.appendChild(match.cloneNode(true));
        debounceTimerHelper();
        return;
    }
    // If the value exactly matches an option in the original (unfiltered)
    // datalist, the user selected from the default browser dropdown — not
    // from a fuzzy-filtered list. Restore the full datalist and return
    // without running fuzzy search, so the subsequent 'change' event can
    // find the matching option and trigger selectionHandler directly.
    if (optionLookup[tableName] && optionLookup[tableName].has(val)) {
        debounceTimerHelper();
        return;
    }

    if (!val || val.length < FUZZY_MIN_LENGTH) {
        // Don't clear — current filtered options are still useful for short
        // queries. Debounce the expensive restore so rapid backspacing
        // doesn't clone thousands of options on every keystroke.
        debounceTimerHelper();
        return;
    }
    // Immediately clear the datalist to prevent the browser from showing
    // stale options from the previous search during the debounce window.
    dl.innerHTML = "";
    debounceTimer = setTimeout(function() {
        // fuzzySearch returns value strings or HTMLOptionElements — look up
        // the actual option elements from the persistent lookup map.
        var matchedOpts = fuzzySearch(val, tableName);
        if(sig && sig=="order-manager") // removed unwanted options and reused same func for orderManger
            matchedOpts = matchedOpts.filter(obj=>{
                return typeof name_orderId_map[obj.value]!=="undefined"
            });
        matchedOpts = matchedOpts.slice(0,20);
        dl.innerHTML = "";
        if (!matchedOpts || matchedOpts.length === 0){
            showToastNotification("New keyword detected, press Ctrl+F to disable/re-enable the Fuzzy Search.",["animation-common","move-left","red-toast-box"]);
            return restoreFullDatalist(dl,tableName);
        }
        var fragment = document.createDocumentFragment();
        matchedOpts.forEach(function(option) {
            // Guard: option may be a string (from serialized index) or
            // HTMLOptionElement (after reInitFuzzyIndexWithOptions)
            if (!option) return;
            var cloned;
            if (typeof option === "string") {
                // Look up the real option element from the lookup map
                var realOpt = optionLookup[tableName] && optionLookup[tableName].get(option);
                if (!realOpt) return;
                cloned = realOpt.cloneNode(true);
            } else {
                cloned = option.cloneNode(true);
            }
            var realValue = cloned.value;
            cloned.value = val + NBSP + realValue;
            cloned.label = realValue;
            fragment.appendChild(cloned);
        });
        dl.appendChild(fragment);
    }, 50);
}

function restoreFullDatalist(dl, tableName) {
    var snapshot = optionSnapshot[tableName];
    if (!snapshot || snapshot.length === 0) return;
    if (dl.children.length === snapshot.length || dl.children.length>=30) return; // already restored
    // Use a DocumentFragment to batch all DOM insertions into a single reflow
    let fragment = document.createDocumentFragment();
    let first30Opts = snapshot.slice(0,30);
    let remainingOpts = snapshot.slice(30,snapshot.length);
    first30Opts.forEach(function(opt) { fragment.appendChild(opt.cloneNode(true)); });
    dl.innerHTML = "";
    dl.appendChild(fragment);
    clearTimeout(debounceTimer);
    let timer = 0;
    debounceTimer = setTimeout(async ()=>{
        let fragment = document.createDocumentFragment();
        await Promise.all(remainingOpts.map(async function(opt) { 
            timer++;
            return new Promise((res)=>setTimeout(()=>{
                fragment.appendChild(opt.cloneNode(true)); 
                res(true);
            },50+timer));
        }));
        dl.appendChild(fragment);
    },1000);
}

// Build (or rebuild) the option lookup map and snapshot from a freshly
// populated datalist. Call this after appendToDL fills the datalist.
function cacheDatalistState(dl, tableName) {
    if (!dl || !tableName) return;
    var children = dl.children;
    // Snapshot: cloned options for fast restore of the full list
    optionSnapshot[tableName] = Array.from(children).map(function(opt) { return opt.cloneNode(true); });
    // Lookup: Map<valueString, HTMLOptionElement> for fuzzySearchHandler
    var map = new Map();
    for (var i = 0; i < children.length; i++) {
        map.set(children[i].value, children[i]);
    }
    optionLookup[tableName] = map;
}

exports.getNGramIndex = function(){
    return ngramIndex;
}
// Allow pages to inject a pre-built n-gram index received from the main
// process, skipping the expensive trigram-calculation loop in appendToDL.
exports.setNGramIndex = function(idx) {
    if (idx && typeof idx === "object") ngramIndex = idx;
}

exports.reInitFuzzyIndexWithOptions = function(tableName,dl){
    let lookup = optionLookup[tableName];
    let ngramMap_table = ngramIndex[tableName];
    Object.keys(ngramMap_table).forEach(key=>{
        gramArr.push(key);
        ngramMap_table[key] = ngramMap_table[key].map((optStr)=>optionLookup[tableName].get(optStr));
    });
}

exports.fuzzySearchHandler = fuzzySearchHandler;
exports.cacheDatalistState = cacheDatalistState;

var name_orderId_map = {};

exports.reInitFuzzyIndexWithOrderID = function(orderIds=[],dl){
    exports.reInitFuzzyIndexWithOptions("customer",dl)
    orderIds.forEach(({name,orderId})=>{
        if(Array.isArray(name_orderId_map[name]))
            name_orderId_map[name].push(orderId);
        else
            name_orderId_map[name] = [orderId]
    });
}

exports.getOrderIds = function(name){
    return name_orderId_map[name];
}