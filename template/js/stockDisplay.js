const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput, initSearchHandler, showOrHideScrollSym, scrollSymSet} = require("../js/common.js");
toggleDevTool(document);

let tbody = document.querySelector("#tbody");

(async ()=>{
    let stock = await ipcRenderer.invoke("get-stocks");
    let bodyRowTemp = document.getElementById("body-row-template");
    stock.forEach((itemObj,i)=>{
        let bodyRowDF = bodyRowTemp.content.cloneNode(true);
        let bodyRow = bodyRowDF.querySelector("div");
        bodyRow.querySelector("p").textContent = ++i;
        for(let key in itemObj){
            if(["name","quantity","buyPrice"].includes(key))
                bodyRow.querySelector(`[data-colName="${key}"]`).textContent = itemObj[key];
            if(key==="pInfo")
                bodyRow.querySelector(`[data-colName="type"]`).textContent = "type" in itemObj.pInfo ? itemObj.pInfo.type : "Not Defined";
            bodyRow.dataset[key] = typeof itemObj[key]==="object"?JSON.stringify(itemObj[key]):itemObj[key];            
        }
        tbody.appendChild(bodyRow);
    });
    if(tbody.clientHeight<tbody.scrollHeight)
        mousedownTimer = scrollSymSet(tbody);
})();

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