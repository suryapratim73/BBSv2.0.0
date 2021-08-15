const {toggleDevTool,drawSpinner} = require("../js/common");
const {ipcRenderer} = require("electron");


toggleDevTool(document);

const header = document.querySelector("header"),salesArr = [];
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
let spinner = drawSpinner(document);

header.addEventListener("click",function(e){
    const filterOptions = this.querySelector("#filter-options"),
        bodyRows = [...document.querySelectorAll(".body.row")],
        dots = [...document.querySelectorAll(".dot")];
    if(e.target.dataset.cmd==="toggle-filter-option")
        filterOptions.classList.toggle("hide");
    else
    if(["paid","unpaid","open","close"].includes(e.target.dataset.cmd)){
        bodyRows.forEach(bodyRow=>{
            let {paymentStatus,billStatus} = bodyRow.dataset;
            paymentStatus = paymentStatus===true?"paid":"unpaid";
            bodyRow.classList.remove("hide");
            if(![paymentStatus,billStatus].includes(e.target.dataset.cmd))
                bodyRow.classList.add("hide");
        });
    }
    else
    if(e.target.dataset.cmd==="all")
        bodyRows.forEach(row=>row.classList.remove("hide"));
    if(["paid","unpaid","open","close","all"].includes(e.target.dataset.cmd)){
        dots.forEach(dot=>{
            dot.classList.remove("select");
            dot.classList.add("deselect");
        });
        if(e.target.classList.contains("option")){
            e.target.querySelector(".dot").classList.add("select");
            e.target.querySelector(".dot").classList.add("deselect");
        }
        else{
            e.target.parentNode.querySelector(".dot").classList.add("select");
            e.target.parentNode.querySelector(".dot").classList.remove("deselect");
        }
    }
});

document.body.addEventListener("click",function(e){
    if(e.target!==document.querySelector("body > header > button")) 
        document.querySelector("#filter-options").classList.add("hide");
});

function searchHandler(e){
    let searchText = e.target.value;
    let bodyRows = [...document.querySelectorAll(".body.row")];
    if(searchText.length===0) return bodyRows.forEach(row=>row.classList.remove("hide"));
    bodyRows.forEach(row=>row.classList.add("hide"));
    let matches = [],cmd,searchBy = {feild:"name",dataFeild:"name"};
    let startDate,endDate;
    console.clear();
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
            salesArr.forEach(saleObj=>{
                if(word===saleObj.name)
                    matches.push(saleObj);
            });
        }
        else
        if(/\d+/.test(word) && !/[/]/g.test(word)){
            let _matches = salesArr.filter(({billNo})=>Number(word)===billNo);
            searchBy = {feild:"billNo",dataFeild:"bill-no"};;
            if(_matches.length>0)
                _matches.forEach(match=>matches.push(match));
        }
        else
        if(/[/]/g.test(word)){
            console.log(word)
            let [date,month,year] = word.split(/[/]/g);
            searchBy = {feild:"billDate",dataFeild:"bill-date"};
            if(!date || !month || !year) return;
            let searchDate = new Date(year,+month-1,date),_matches;
            if(cmd!=="between" || !cmd)
                _matches = !cmd?salesArr.filter(({billDate})=>{
                    if(searchDate.toLocaleDateString()===billDate.toLocaleDateString())
                        return true;
                }):salesArr.filter(({billDate})=>{
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
                    _matches = salesArr.filter(({billDate})=>{
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
        [...document.querySelectorAll(`[data-${searchBy.dataFeild}="${match[searchBy.feild]}"]`)]
            .forEach(row=>row.classList.remove("hide"));
    })
}

ipcRenderer.send("get-sales");

ipcRenderer.on("get-sales-response",(e,sales)=>{
    sales.forEach((saleObj,i)=>{
        let bodyDiv = document.createElement("div");
        bodyDiv.className = "row body";
        [...document.querySelectorAll(".row")].pop().after(bodyDiv);
        const {
            billDate,
            billNo,
            billAmt,
            tax,
            billItemTable,
            billStatus,
            name,
            customerId,
            paymentStatus
        } = saleObj;
        salesArr.push(saleObj);
        bodyDiv.dataset.billStatus = billStatus;
        bodyDiv.dataset.billNo = billNo;
        bodyDiv.dataset.billDate = billDate;
        bodyDiv.dataset.customerId = customerId;
        bodyDiv.dataset.name = name;
        bodyDiv.dataset.paymentStatus = paymentStatus;
        Object.keys({i,billDate,billNo,billAmt,tax}).forEach((key,index)=>{
            let p = document.createElement("p");
            p.textContent = key in saleObj?(key !=="billDate"?saleObj[key]:saleObj[key].toLocaleDateString("en-GB")):i+1;
            p.className = `col col${index+1}`;
            bodyDiv.appendChild(p);
        })
        bodyDiv.dataset.itemTable = billItemTable;
    });
    spinner.remove(window);
})