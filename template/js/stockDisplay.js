const { ipcRenderer } = require("electron");
const {toggleDevTool,validateInput, initSearchHandler, showOrHideScrollSym, scrollSymSet, drawSpinner, createModal, closeModal, removeAllElem, drawLineGraph, dataModal, roundOffTo2DecimalPlace} = require("../js/common.js");
toggleDevTool(document);

let tbody = document.querySelector("#tbody"),timer;

(async ()=>{
    let spinner = drawSpinner(document);
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
    spinner.remove(window);
    if(tbody.clientHeight<tbody.scrollHeight)
        scrollSymSet(tbody);
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

tbody.addEventListener("click",function(e){
    let bodyRow = e.target.parentNode;
    let { pHistory,specialPrice } = bodyRow.dataset;
    let modal = createModal("pHistory-modal");
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