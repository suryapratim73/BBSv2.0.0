const { ipcRenderer } = require("electron");
const { toggleDevTool, drawBarGraph, roundOffTo2DecimalPlace,drawSpinner,renderPieChart } = require("../js/common");


toggleDevTool(document);

let monthObj = ["Jan","Feb","Mar","Apr","May","June","July","Aug","Sep","Oct","Nov","Dec"];
let weekObj = ["Mon","Tues","Wed","Thurs","Fri","Sat","Sun"];
let startAngle = 0,endAngle = 0,sum = 0,total = 0;

ipcRenderer.send("get-total-sale-purchase",7);

function getOptionObj(
    {canvas,period=7,fillStyle,strokeStyle,i,text,fontSize=20,ht}){
    return { 
        canvas,
        ctx:null,
        i,
        ht,
        width:10,
        offsetLeft:24,
        offsetTop:5,
        direction:-1,
        text,
        period,
        fontSize,
        style:{fillStyle,strokeStyle} 
    };
}

function reduceFunction(acc,{amt,date}){
    let day = weekObj[date.getDay()-1];
    acc[day] = !acc[day]?amt:acc[day] + amt;
    acc.total += amt;
    return acc;
}

function applyDrawBarGraph({text,i,canvas,fillStyle,strokeStyle,arr}){
    let dayAmt = typeof arr[text]==="number"?arr[text]:0;
    let ht = Math.round(roundOffTo2DecimalPlace(dayAmt/arr.total)*150) ?? 0;
    console.log({ht,total:arr.total,text})    
    drawBarGraph(getOptionObj({canvas,fillStyle,strokeStyle,i,text,fontSize:24,ht}));
}

ipcRenderer.on("get-total-sale-purchase-response",(e,{sales,purchases,outPaymentObjs,inPaymentObjs,period})=>{
    let todaySale,todayPurchase,todayInPayment,todayOutPayment,
    netWeeklySale = sales.reduce((acc,{billAmt,billDate})=>reduceFunction(acc,{amt:billAmt,date:billDate}),{total:0}),
    netWeeklyPurchase = purchases.reduce((acc,{billAmt,billDate})=>reduceFunction(acc,{amt:billAmt,date:billDate}),{total:0}),
    netWeeklyCash = inPaymentObjs.reduce((acc,{payment,date})=>reduceFunction(acc,{amt:payment,date}),{total:0}),
    netWeeklyPayment = outPaymentObjs.reduce((acc,{payment,date})=>reduceFunction(acc,{amt:payment,date}),{total:0}),
    dayOfWeek = (new Date()).getDay()-1,
    prevDays = [];
    weekObj = weekObj.map((day,i)=>{
        if(i>dayOfWeek)
            return day;
        if(i==dayOfWeek){
            todaySale = netWeeklySale[day] ?? 0;
            todayPurchase = netWeeklyPurchase[day] ?? 0;
            todayInPayment = netWeeklyCash[day] ?? 0;
            todayOutPayment = netWeeklyPayment[day] ?? 0;
            return day;
        }
        else{
            prevDays.push(day);
            return;
        }
    }).filter(val=>val!==undefined);
    weekObj = [...weekObj,...prevDays];
    weekObj.forEach((day,i)=>{
        let canvas = document.querySelector("#sale-canvas");
        applyDrawBarGraph({text:day,i,canvas,arr:netWeeklySale,fillStyle:"blue",strokeStyle:"blue"})
        canvas = document.querySelector("#purchase-canvas");
        applyDrawBarGraph({text:day,i,canvas,arr:netWeeklyPurchase,fillStyle:"red",strokeStyle:"red"})
        canvas = document.querySelector("#in-payment-canvas");
        applyDrawBarGraph({text:day,i,canvas,arr:netWeeklyCash,fillStyle:"green",strokeStyle:"green"})
        canvas = document.querySelector("#out-payment-canvas");
        applyDrawBarGraph({text:day,i,canvas,arr:netWeeklyPayment,fillStyle:"purple",strokeStyle:"purple"})
    });
    document.querySelector("#weekly-stat-div > div:nth-child(1) > div:nth-child(2) > p").textContent = todaySale;
    document.querySelector("#weekly-stat-div > div:nth-child(1) > div:nth-child(3) > p").textContent = todayPurchase;
    document.querySelector("#weekly-stat-div > div:nth-child(1) > div:nth-child(4) > p").textContent = todayInPayment;
    document.querySelector("#weekly-stat-div > div:nth-child(1) > div:nth-child(5) > p").textContent = todayOutPayment;
    e.sender.send("get-total-sale-purchase",365);
});

function getNetAmtArr(tables){
    let netAmt = [];
    Object.keys(tables).forEach(table=>{
        netAmt.push(tables[table].reduce((acc,{billAmt})=>acc+billAmt,0));
    });
    return netAmt;
}

function initCanvas(selector,arr,colors){
    let canvas = document.querySelector(selector);
    canvas.width = 150;
    canvas.height = 150;
    total = arr.reduce((acc,sum)=>acc+sum,0);
    sum = 0;
    arr.forEach((amt,i)=>{
        sum+=amt;
        endAngle = 2*Math.PI*sum/total;
        renderPieChart(canvas,startAngle,endAngle,colors[i]);
        startAngle = endAngle;
    })
}

ipcRenderer.on("get-yearly-sale-purchase-response",(e,{sales,purchases,allSales,allPurchases})=>{
    let netAmts =  getNetAmtArr({sales,purchases});
    let allNetAmts = getNetAmtArr({allSales,allPurchases});
    initCanvas("#debit-credit-chart",netAmts,["blue","red"])
    initCanvas("#sale-purchase-chart",allNetAmts,["green","purple"]);    
})