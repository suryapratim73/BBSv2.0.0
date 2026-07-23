const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput, initSearchHandler, capitalize, showOrHideScrollSym, scrollSymSet, drawSpinner, createModal, closeModal, removeAllElem, drawLineGraph, dataModal, roundOffTo2DecimalPlace, retractHandler, applyTheme, appendToDL, fuzzySearchHandler, setNGramIndex} = require("../js/common.js");
toggleDevTool(document);

let tbody = document.querySelector("#tbody"),timer,bodyRow;

async function initPage(){
    let spinner = drawSpinner(document);
    let stock = await ipcRenderer.invoke("get-stocks");
    // Inject the pre-built n-gram index from the main process so appendToDL
    // skips the expensive trigram-calculation loop.
    var preBuiltIndex = await ipcRenderer.invoke("get-ngram-index");
    if (preBuiltIndex) setNGramIndex(preBuiltIndex);
    // Populate the datalist and build the n-gram index for fuzzy search
    await appendToDL.call({tableName:"stock"}, "", document.getElementById("stock-names"), true, null, [], stock);
    let bodyRowTemp = document.getElementById("body-row-template");
    removeAllElem(".body.row");
    stock.forEach((itemObj,i)=>{
        let bodyRowDF = bodyRowTemp.content.cloneNode(true);
        let bodyRow = bodyRowDF.querySelector("div");
        bodyRow.querySelector("p").textContent = ++i;
        for(let key in itemObj){
            if(["name","quantity","buyPrice"].includes(key))
                bodyRow.querySelector(`[data-colName="${key}"]`).textContent = itemObj[key];
            if(key==="pInfo")
                bodyRow.querySelector(`[data-colName="type"]`).textContent = "type" in itemObj.pInfo ? itemObj.pInfo.type : itemObj.type;
            bodyRow.dataset[key] = typeof itemObj[key]==="object"?JSON.stringify(itemObj[key]):itemObj[key];            
        }
        tbody.appendChild(bodyRow);
    });
    spinner.remove(window);
    if(tbody.clientHeight<tbody.scrollHeight)
        scrollSymSet(tbody);
}
initPage();

ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null));

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function searchHandler(e){
    let { searchText, bodyRows } = initSearchHandler(e);
    if(/top/i.test(searchText)){
        //Show top 10 Stocks ranked by score. Do it after finalising ranking system
    }
    else
    if(/empty\b|low\b/i.test(searchText))
        bodyRows.forEach(row=>{
            let availQty = Number(row.dataset.quantity);
            if(availQty<100)
                row.classList.remove("hide");
        })
    else
    if(/type\b/i.test(searchText)){
        //Search by type
        let typeOnQuery = searchText.split(/type\b/i).filter(elem=>elem!==""),
            notDefinedMatch = false;
        if(typeOnQuery)
            bodyRows.forEach(row=>{
                let itemType = JSON.parse(row.dataset.pInfo)?.["type"] ?? "not defined";
                let { negativeVal,match } = typeOnQuery.reduce((acc,query)=>{
                    if(acc.match===false)
                       acc.match = new RegExp(itemType,"i").test(query)
                    if(acc.negativeVal===false)
                        acc.negativeVal = /not\b/i.test(query);
                    return acc;
                },{
                    negativeVal:false,
                    match:false
                })
                if(negativeVal===false && match===true)
                    row.classList.remove("hide");
                else
                if(negativeVal===true && match===false)
                    row.classList.remove("hide");
                else
                if(negativeVal===true && match===true && itemType==="not defined"){
                    row.classList.remove("hide");
                    notDefinedMatch = true;
                }
                row.dataset.match = match;
            });
        if(notDefinedMatch)
            bodyRows.forEach(row=>{
                let { match } = row.dataset;
                match = JSON.parse(match);
                if(!match)
                    row.classList.add("hide");
            })
    }
    else
    if(/(purchase\b.+|buy\b.+|price\b.+)(<|>|=)/i.test(searchText)){
        //Search by buy price
        let cmds = searchText.split(/[^<>=]/)
                       .filter(word=>word!=="")
                       .filter((_,i)=>i<2);
        let numbers = searchText.split(/\b/)
                        .filter(word=>word.match(/\d+\b/))
                        .map(text=>Number(text))
                        .filter((_,i)=>i<2);
        bodyRows.forEach(row=>{
            let buyPrice = Number(row.dataset.buyPrice);
            if(cmds.length===1 && eval(`${buyPrice}${cmds[0]}${numbers[0]}`))
                    row.classList.remove("hide")
            else
            if(cmds.length===2 && eval(`${buyPrice}${cmds[0]}${numbers[0]} && ${buyPrice}${cmds[1]}${numbers[1]}`))
                row.classList.remove("hide");
        })
    }
    else
        //Search by name if not found start deep search.
        bodyRows.forEach(row=>{
            let {
                name,
                id,
                hsn,
                pInfo
            } = row.dataset;
            pInfo = JSON.parse(pInfo);
            if([name,id,hsn,...Object.values(pInfo)].some(prop=>new RegExp(searchText,"i").test(prop)))
                row.classList.remove("hide");
        });
    showOrHideScrollSym();
}

tbody.addEventListener("click",function(e){
    bodyRow = e.target.parentNode;
    let { pHistory,specialPrice } = bodyRow.dataset;
    let modal = createModal("pHistory-modal",true);
    let pHistModalDivs = document.getElementById("pHistory-modal-template").content.cloneNode(true);
    modal.appendChild(pHistModalDivs);
    pHistory = JSON.parse(pHistory);
    pHistory
    .reduce((acc,obj)=>{
        acc[0][0].push(obj.rate);
        acc[0][1].push(obj);
        return acc;
    },[[[],[]]])
    .map(([sortedRate,objs])=>{
        sortedRate = Array.from(new Set(sortedRate));
        return [sortedRate,objs];
    })
    .reduce((acc,[sortedRate,objs])=>{
        acc[0][0] = sortedRate.reduce((acc,rate)=>(acc+rate),0)/sortedRate.length;
        acc[0][1] = objs.map(obj=>({date:obj.billDate,amt:obj.rate}));
        return acc;
    },[[]])
    .forEach(([total,objs])=>{
        let reducedArr = objs.reduce((acc,{date,amt})=>{
            if(!acc[date])
                acc[date] = {amt,count:1};
            else{
                acc[date].amt += amt;
                acc[date].count++;
            }
            return acc;
        },{});
        reducedArr = Object.keys(reducedArr).reduce((acc,date)=>{
            let {amt,count} = reducedArr[date];
            acc.push({date,amt:roundOffTo2DecimalPlace(amt/count)});
            return acc; 
        },[]);
        const { canvas,reducedObjs } = drawLineGraph(total,reducedArr,".modal canvas","green","red",{tOffset:24,bOffset:48});
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs,"Rate"]));
    });
    specialPrice = JSON.parse(specialPrice);
    let reducedSP = specialPrice.reduce((acc,{customerId:id,billDate})=>{
        if(!acc[id])
            acc[id] = [billDate];
        else
            acc[id].push(billDate);
        return acc;
    },{});
    let pArr = [];
    Object.keys(reducedSP).forEach(id=>{
        let dts = Array.from(new Set(reducedSP[id]));
        dts.forEach(dt=>{
            if(typeof dt==="string"){
                let [yr,mnt,dd] = dt.split("-").map(num=>Number(num));
                mnt--;
                dt = new Date(yr,mnt,dd);
            }
            pArr.push({id,date:dt});
        });
    });
    pArr.sort((a,b)=>{
        if(a.date>b.date)
            return -1;
        else
        if(a.date===b.date)
            return 0;
        else
            return 1;
    })
    .forEach(async ({id,date})=>{
        let { name } = await ipcRenderer.invoke("customer-id-to-name",id);
        let bodyRow = document.createElement("div");
        bodyRow.className = "body row";
        date = date.toLocaleDateString("en-GB");
        [name,date].forEach(key=>{
            let p = document.createElement("p");
            p.className = "col eq-space";
            p.textContent = key;
            bodyRow.appendChild(p);
        })
        document.querySelector(".modal .tbody").appendChild(bodyRow);
    });
});

function appendFeildCommon(tem,container,selector){
    let df = tem.content.cloneNode(true).querySelector("div");
    container.querySelector(selector).appendChild(df);
    return {df,input:df.querySelector("[data-colname='value']")};
}

function showUpdater(){
    document.querySelector(".modal .page1-elem").classList.add("hide");
    let modalPage2 = document.getElementById("stock-updater-template").content.cloneNode(true).querySelector("div");
    document.querySelector(".modal").appendChild(modalPage2);
    const itemObj = {...bodyRow.dataset};
    let newRowTemp = document.getElementById("new-row-template");
    ["name","hsn","standardSellPrice","type","pInfo"]
    .forEach(key=>{
        if(key!=="pInfo"){
            let {df,input} = appendFeildCommon(newRowTemp,modalPage2,"#feild-container");
            df.querySelector("[data-colname='feild']").textContent = capitalize(key==="standardSellPrice"?"rate":key);
            input.dataset.feildname = key;
            input.value = key==="standardSellPrice"?roundOffTo2DecimalPlace(Number(itemObj[key])):itemObj[key];
            if(["quantity","standardSellPrice","hsn"].includes(key)){
                input.setAttribute("onkeypress","validateInput(event)");
                input.dataset.type = "Number";        
            }
        }
        else{
            let pInfo = JSON.parse(itemObj.pInfo);
            Object.keys(pInfo)
            .forEach(key=>{
                let {df,input} = appendFeildCommon(newRowTemp,modalPage2,"#feild-container");
                df.querySelector("[data-colname='feild']").textContent = capitalize(key);
                input.dataset.feildname = key;
                input.value = pInfo[key];
                input.dataset.feildtype = "pInfo";
            })
        }
    });
}

function backToPage1(){
    document.querySelector(".modal .page2-elem").remove();
    document.querySelector(".modal .page1-elem").classList.remove("hide");
}

function updateStock(){
    let itemObj = {pInfo:{}};
    [...document.querySelectorAll(".modal .page2-elem input")]
    .forEach(input=>{
        let {feildname} = input.dataset;
        if("feildtype" in {...input.dataset})
            itemObj.pInfo[feildname] = input.value;
        else
            itemObj[feildname] = input.value;
    });
    itemObj.id = bodyRow.dataset.id;
    ipcRenderer.send("update-stock",itemObj);
    backToPage1();
}

ipcRenderer.on("update-stock-response",(e,itemObj)=>{
    bodyRow.dataset.stockUpdated = true;
    for(let key in itemObj)
        bodyRow.dataset[key] = typeof itemObj[key]!=="object" ? itemObj[key] : JSON.stringify(itemObj[key]);
});

function showAddNewFeild(){
    document.querySelector(".modal .page2-elem").classList.add("hide");
    let modalPage3 = document.getElementById("add-new-feild-template").content.cloneNode(true).querySelector("div");
    document.querySelector(".modal").appendChild(modalPage3);
}

function appendNewInfo(){
    let newRowTemp = document.getElementById("new-row-template");
    let {df,input} = appendFeildCommon(newRowTemp,document.querySelector(".modal .page2-elem"),"#feild-container");
    let feildname;
    [...document.querySelectorAll(".modal .page3-elem input")]
    .forEach((inp,index)=>{
        let { value } = inp;
        if(index===0){
            df.querySelector("[data-colname='feild']").textContent = capitalize(value);
            feildname = value;
        }
        else{
            input.value = value;
            input.dataset.feildtype = "pInfo";
            input.dataset.feildname = feildname;
        }
    });
    backToPage2();
}

function backToPage2(){
    document.querySelector(".modal .page3-elem").remove();
    document.querySelector(".modal .page2-elem").classList.remove("hide");
}

function getBodyRow(){
    return {bodyRow,initPage};
}

function showDeleteBTN(e){
    let target = e.target;
    if(target.nodeName==="INPUT" && "feildtype" in {...target.dataset} && target.dataset.feildtype==="pInfo"){
        let hoveredDiv = target.parentNode.parentNode;
        clearTimeout(timer);
        timer = setTimeout(()=>{
            hoveredDiv.classList.add("red-box-shadow");
            let button = document.createElement("button");
            button.textContent = "X";
            button.dataset.msg = "Delete Row";
            button.className = "hover right top";
            button.addEventListener("click",deleteRow.bind(hoveredDiv));
            setTimeout(()=>{
                hoveredDiv.appendChild(button);
            },300);
        },1000);
        hoveredDiv.addEventListener("mouseleave",hideDeleteBTN);
    }
}

function hideDeleteBTN(e){
    let target = e.target;
    if(target.classList.contains("new-row")){
        clearTimeout(timer);
        target.removeEventListener("mouseout",arguments.callee);
        // debugger
        [...target.querySelectorAll("button")].forEach(btn=>btn.remove());
        target.classList.remove("red-box-shadow");
    }
}

function deleteRow(e){
    e.target.removeEventListener("click",arguments.callee);
    this.remove();
}