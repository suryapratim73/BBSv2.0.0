const { ipcRenderer } = require("electron");
const { toggleDevTool,getAmtToWord, chooseFile , drawSpinner, retractHandler, removeAllElem, drawLineGraph, dataModal, showToastNotification, closeToast, validateInput, validateInput2, errorFormatter, capitalize, applyTheme, noDataPlaceholder, bodyRow, hexTohsl, lightenHSL, hslComponents, carosel, appendToHost, createModal, createORexecuteProgressbar, applySpinner, traverseParent, tableFillupHelper } = require("../js/common");
const { closeModal } = require("../js/common");
const uuid = require("uuid");


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
let currentMode = "overview",reducedBills = [],reducedPurchases = [];
let mode = 1,loggedinUser,compInfo,hiddenSection,caroselTimer,tags;
let selectedRow;

toggleDevTool(document);

async function initPage(){
    let spinner = drawSpinner(document);
    document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");
    await applyMode();
    global.appStatus = await ipcRenderer.invoke("get-app-status");
    if(global.appStatus!=="normal") return spinner.remove(window)
    let userListDL = document.getElementById("user-list");
    try{
        (await ipcRenderer.invoke("get-users"))
        .forEach(user=>{
            let option = document.createElement("option");
            option.textContent = user.name;
            option.dataset.id = user.id;
            option.dataset.name = user.name;
            userListDL.appendChild(option);
        });
    }
    catch(err){
        alert(err)
    }
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj); 
    spinner.remove(window); 
    ipcRenderer.send("booted")
}
initPage();

async function modeSwitcher(e){
    if(e.target.nodeName!=="P") return;
    currentMode = e.target.dataset.cmd;
    if(currentMode){
        let spinner = drawSpinner(document);
        [...document.querySelectorAll("#nav-div p")]
        .forEach(p=>{
            if(p.dataset.cmd===currentMode)
                p.classList.add("selected");
            else
                p.classList.remove("selected");
        });
        await applyMode();
        spinner.remove(window);
    }
    else{
        currentMode = "overview";
        document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");

    }
}

function reducedArr(arr,id){
    return arr.reduce((acc,{billDate,billAmt})=>{
        acc[0][0] += billAmt;
        acc[0][1].push({date:billDate,amt:billAmt});
        return acc;
    },[[ 0, [] ]])
    .map(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,id,"green","red");
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
        return [total,objs];
    });
}

async function initScheduleDiv(){
    let schedules = await ipcRenderer.invoke("get-chedules");
    removeAllElem(".event-page.removable");
    clearInterval(caroselTimer);
    if(schedules.length===0) 
        return document.querySelector(".event-page.first-page").classList.add("card-in");
    let schedulerDiv = document.getElementById("scheduler-div");
    let schedulesPage = document.getElementById("schedules-page-template").content.cloneNode(true).querySelector("div");
    schedulerDiv.appendChild(schedulesPage);
    let pHost = schedulesPage.querySelector("#event-host");
    schedules.forEach(evObj=>{
        let p = document.createElement("p");
        p.style.setProperty("--color",evObj.color);
        let [h,s,l] = hslComponents(evObj.color);
        p.style.setProperty("--lighter-shade",lightenHSL(h,s,l,0.3));
        p.dataset.obj = JSON.stringify(evObj);
        let span = document.createElement("span");
        span.textContent = evObj.label;
        p.appendChild(span);
        span = document.createElement("span");
        span.textContent = new Date(evObj.time).toLocaleDateString("en-IN",{
            day:"2-digit",
            month:"2-digit",
            year:"2-digit",
            hour:"2-digit",
            minute:"2-digit"
        });
        p.appendChild(span);
        pHost.appendChild(p);
    });
    document.querySelector(".event-page.first-page").classList.add("card-in");
    carosel([...document.querySelectorAll(".event-page")],0);
}

async function overviewPageInit(){
    let year = document.getElementById("fin-year").value
    let {stocks=[],unPaidBills=[]} = await ipcRenderer.invoke("get-overview-content",Number(year));
    let [dt,mnth,yr] = new Date().toLocaleDateString("en-GB",{dateStyle:"long"}).split(" ");
    let dtEventDiv = document.querySelector("#scheduler-div .event-div>#dt-div");
    dtEventDiv.querySelector("h1").textContent = dt;
    dtEventDiv.querySelector("p").textContent = `${mnth}, ${yr}`;
    removeAllElem(".no-data,#expired-bill-table-div .tbody>.body.row");
    let billTbody = document.querySelector("#expired-bill-table-div .tbody");
    let cols = [...document.querySelectorAll("#expired-bill-table-div .row.head .col>p")].map(p=>p.dataset.col);
    if(unPaidBills.length>0)
        unPaidBills.forEach((obj,index)=>billTbody.appendChild(bodyRow({key:"billObj",obj,cols,index})));
    else
        noDataPlaceholder(billTbody);
    let stockTbody = document.querySelector("#stock-div .tbody");
    cols = [...document.querySelectorAll("#stock-div .row.head .col>p")].map(p=>p.dataset.col);
    if(stocks.length>0)
        stocks.forEach((obj,index)=>stockTbody.appendChild(bodyRow({key:"stock",obj,cols,index})));
    else
        noDataPlaceholder(stockTbody);
    let orders = await ipcRenderer.invoke("get-orders");
    let orderTbody = document.querySelector("#order-table-div .tbody");
    if(!("fileList" in orders) || orders.fileList.length===0) 
        noDataPlaceholder(orderTbody);
    else{
        document.getElementById("order-table-div").classList.remove("hide");
        cols = [...document.querySelectorAll("#order-table-div .row.head .col>p")].map(p=>p.dataset.col);
        orders.fileList.forEach((obj,index)=>orderTbody.appendChild(bodyRow({key:"orderObj",obj,cols,index})));
    }
    initScheduleDiv();
}

function showOrderQueue(bills){
    let saleDivContent = document.getElementById("sale-div-content");
    let orderQueueContainer = document.getElementById("order-queue-container-template").content.cloneNode(true).querySelector("div");
    saleDivContent.appendChild(orderQueueContainer);
    if(bills.length===0)
        document.getElementById("order-queue-container").innerHTML = '<p class="item-obj">Create bill to show up here</p>';
    bills.forEach(({name,billNo,billItems},i)=>{
        let oderQueueDiv = document.getElementById("order-queue-template").content.cloneNode(true).querySelector("div");
        orderQueueContainer.appendChild(oderQueueDiv);
        if(i===0)
            oderQueueDiv.classList.add("visible-order");
        oderQueueDiv.querySelector(".bill-header .highlight[data-colname='name']").textContent = name;
        oderQueueDiv.querySelector(".bill-header .highlight[data-colname='billNo']").textContent = billNo;
        oderQueueDiv.dataset.billNo = billNo;
        let billItemContainer = oderQueueDiv.querySelector(".bill-item-div");
        billItems.forEach(itemObj=>{
            let itemObjDiv = document.getElementById("item-list-template").content.cloneNode(true).querySelector("div");
            [...itemObjDiv.querySelectorAll("span")]
            .forEach(span=>{
                span.textContent = itemObj[span.dataset.colname];
            });
            billItemContainer.appendChild(itemObjDiv);
        });
    });
}

function saleOverviewContext(){
    document.getElementById("overview-context").classList.remove("hide");

}

function showContextOptions(){
    let ctxOptDiv = document.getElementById("context-options");
    ctxOptDiv.classList.remove("hide");
}

async function updateSaleOverviewPreference(e){
    let opt = e.target.dataset.name;
    document.getElementById("context-options").classList.add("hide");
    let {bills=[],allBills=[]} = await ipcRenderer.invoke("get-sale-content") ?? {};
    ipcRenderer.send("update-preference",{preset:opt,currentMode,sec:"main"});
    removeAllElem("#sale-div-content .widget");
    if(opt==="orderQueue"){
        console.log(bills)
        showOrderQueue(bills);
    }
    else
    if(opt==="monthly1x"){
        overviewSaleTable(1,allBills);
    }
    else
    if(opt==="monthly3x"){
        overviewSaleTable(3,allBills);
    }
}

function overviewSaleTable(mode,bills){
    let saleDivContent = document.getElementById("sale-div-content");
    appendToHost("#sale-table-template",saleDivContent,"DIV");
    let currentMonth = new Date().getMonth(),arr,currentYear = new Date().getFullYear();
    if(mode===1)
        arr = bills.filter(obj=>obj.billDate.getMonth()===currentMonth && obj.billDate.getFullYear()===currentYear);
    else
    if(mode===3)
        arr = bills.filter(obj=>obj.billDate.getMonth()>currentMonth-3 && obj.billDate.getFullYear()===currentYear);
    tableFillupHelper(arr,".head.row p",".tbody",bodyRow,"billObj");
}

async function salePageInit(){
    let {bills=[],allBills=[],preset} = await ipcRenderer.invoke("get-sale-content") ?? {};
    // Show sale display widgets
    if(preset==="orderQueue")
        showOrderQueue(bills);
    else
    if(preset==="monthly1x")
        overviewSaleTable(1,allBills);
    else
    if(preset==="monthly3x")
        overviewSaleTable(3,allBills);
    // For drawing graph
    reducedBills = reducedArr(allBills,"#sale-graph");
}

async function purchasePageInit(){
    let allPurchases = await ipcRenderer.invoke("get-purchase-content") ?? {};
    let tbody = document.querySelector("#current-purchase .tbody");
    allPurchases
    .filter((billObj)=>(billObj.billDate.toLocaleDateString("en-GB")==new Date().toLocaleDateString("en-GB")))
    .forEach(({billNo,billDate,supplierName,billAmt})=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${billNo}</p>
            <p class="col eq-space">${billDate.toLocaleDateString("en-GB")}</p>
            <p class="col eq-space">${supplierName}</p>
            <p class="col eq-space">${billAmt}</p>
        `;
        tbody.appendChild(div);
    });
    reducedPurchases = reducedArr(allPurchases,"#purchase-graph");
    let canvas = document.querySelector("#purchase-graph");
    if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
        correctChart();
}

async function settingsPageInit(modeContent){
    if(!document.getElementById(modeContent.id))
        document.querySelector("#main-div>div:first-child").appendChild(modeContent);
    else
        document.getElementById(modeContent.id).classList.remove("hide");
    [...document.querySelectorAll("form")]
    .forEach(elem=>elem.classList.add("hide"));
    [...document.querySelectorAll(".settings *")]
    .forEach(elem=>elem.classList.remove("hide"));
    [...document.querySelectorAll(".settings-div>p")]
    .forEach(p=>{
        if(p.classList.contains(loggedinUser.role))
            p.classList.add("hide");
        else
            p.classList.remove("hide");
    });
    document.querySelector("#settings-div nav p[data-mode='app-settings']").click();
}

async function applyMode(){
    let modeContent;
    if(!currentMode)
        currentMode = "overview";
    if(currentMode==="logout")
        return ipcRenderer.send("logout");
    else
    if(currentMode==="lock")
        return ipcRenderer.send("lock");
    [...document.querySelectorAll("#main-div>div:first-child>*")]
    .forEach(elem=>{
        elem.classList.remove("hide")
    });
    [...document.querySelectorAll(".mode-content")]
    .forEach(div=>div.classList.add("hide"));
    if(["settings",'help'].includes(currentMode))
        [...document.querySelectorAll("#main-div>div:first-child>*")]
        .forEach(elem=>elem.classList.add("hide"));
    removeAllElem("#mode-host *");
    modeContent = document.getElementById(`${currentMode}-page-template`).content.cloneNode(true).querySelector("div");
    if(["overview","sale","purchase"].includes(currentMode))
        document.getElementById("mode-host").appendChild(modeContent);
    if(!modeContent) return;
    if(currentMode==="overview")
        overviewPageInit();
    else
    if(currentMode==="sale")
        salePageInit();
    else
    if(currentMode==="purchase")
        purchasePageInit();
    else
    if(currentMode==="settings")
        settingsPageInit(modeContent);
    correctChart();
}

function expandOrCollapsePanel(){
    retractHandler(document.getElementById("panel"),"width","0","40","vw");
    document.getElementById("knob").classList.toggle("switch-arrow");
    if(document.getElementById("panel").dataset.collapsed==="false")
        document.getElementById("right-div").style.zIndex = 4;
    else
        document.getElementById("right-div").style.zIndex = 2;
}

function controlAnimation(div,mode="opacity",val1="1",val2="0",unit=""){
    requestAnimationFrame(()=>{
        div.style[mode] = val2 + unit;
        requestAnimationFrame(()=>{
            div.style[mode] = val1 + unit;
        })
    });
}

function slideQueueCard(e){
    let transDir = e.target.dataset.translate;
    let oderQueueDiv = e.target.parentNode.parentNode;
    if(oderQueueDiv.classList.contains("oder-queue-div")){
        oderQueueDiv.classList.add(transDir);
        oderQueueDiv.classList.remove("visible-order");
        let oderQueueDivs = [...document.querySelectorAll(".oder-queue-div")]; 
        let currentIndex = oderQueueDivs.findIndex(div=>div===oderQueueDiv);
        currentIndex = currentIndex===oderQueueDivs.length-1?0:currentIndex + 1;
        let selectedDiv = oderQueueDivs[currentIndex];
        controlAnimation(selectedDiv);
        selectedDiv.classList.add("visible-order");
        selectedDiv.classList.remove(transDir);
    }
}

async function updateChart(e,canvasId){
    if(e){
        let option = e.target.querySelector(`[value="${e.target.value}"]`);
        mode = Number(option.dataset.mode);
        if(mode===3)
            reducedBills = reducedArr((await ipcRenderer.invoke("get-sale-content",true)).allBills,"#sale-graph");
        else    
            reducedBills = reducedArr((await ipcRenderer.invoke("get-sale-content")).allBills,"#sale-graph");
    }
    let arr = canvasId==="#sale-graph" ? reducedBills : reducedPurchases;
    arr.forEach(([total,objs])=>{
        const { canvas,reducedObjs } = drawLineGraph(total,objs,canvasId,"green","red",{mode});
        canvas.addEventListener("mousemove",dataModal.bind(canvas,[reducedObjs]));
        if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
            correctChart();
    });
}

function correctChart(){
    if(["sale","purchase"].includes(currentMode)){
        let id = currentMode==="sale" ? "#sale-graph" : "#purchase-graph";
        updateChart(null,id);
        let canvas = document.querySelector(id);
        if(canvas.width!==Math.round(0.95*canvas.parentNode.clientWidth))
            updateChart(null,id);
    }
}

window.addEventListener("resize",correctChart);

function switchSettingsNav(e){
    let settingsMode = e.target.dataset.mode;
    if(!settingsMode) return;
    [...document.querySelectorAll("#settings-div>nav>p")]
    .forEach(p=>{
        if(p.dataset.mode===settingsMode)
            p.classList.add("selected");
        else
            p.classList.remove("selected");
    });
    [...document.querySelectorAll(".settings")]
    .forEach(div=>{
        if(div.dataset.mode!==settingsMode)
            div.classList.add("hide");
        else
            div.classList.remove("hide");
    });
}

function initAdvThemePage(form,themeObj){
    [...form.querySelectorAll("input[type='color']")]
    .forEach(input=>{
        input.value = themeObj[input.name];
    });
    if(themeObj.applyBackgroundImage){
        form.querySelector(`input[name="applyBackgroundImage"]`).setAttribute("checked",true);
        form.querySelector(`[data-show="choosefile"]`).classList.remove("hide");
        form.querySelector("#file").value = themeObj.file;
    }
    if(themeObj.applyGradient)
        form.querySelector(`input[name="applyGradient"]`).setAttribute("checked",true);
}

async function showForm(e,cmd,show,prevData={}){
    if(e){
        cmd = e.target.dataset.cmd;
        show = e.target.dataset.show;
    }
    if(!cmd) return;
    if(e && e.target.nodeName==="FORM" && e.type!=="submit") return console.log("Form");
    let spinner = drawSpinner(document);
    if(cmd!=="back"){
        if(cmd==="enable-2-factor"){
            let dataURL = await ipcRenderer.invoke("generate-secret");
            if(dataURL){
                document.querySelector("#qrcode-div>img").src = dataURL;
                document.getElementById("done-btn").removeAttribute("disabled");
            }
        }
        else
        if(cmd==="disable-2-factor"){
            let show = e.target.dataset.show;
            await ipcRenderer.invoke("remove-secret");
            showToastNotification("2-Factor Authentication disabled.",["animation-common","move-left","blue-toast-box"],"main");
            showForm(null,"back",show);          
        }
        else
        if(cmd==="toggle-session-preference"){
            e.target.textContent = e.target.dataset.enable==="false" ? "Disable" : "Enable";
            document.getElementById("session-management-div").classList.toggle("hide");
            e.target.dataset.enable = !JSON.parse(e.target.dataset.enable);
        }
        else
        if(cmd==="toggle-visibility"){
            let input = e.target.previousSibling.previousSibling;
            input.type = show==="false" ? "text" : "password";
            e.target.textContent = show==="false" ? "Hide" : "Show";
            e.target.dataset.show = !JSON.parse(show);
        }
        else
        if(cmd==="advance-theming"){
            document.querySelector(".page1").classList.add("hide");
            let form = document.getElementById(`${cmd}-template`).content.cloneNode(true).querySelector("form");
            document.getElementById(`${show}`).appendChild(form);
            let resp = await ipcRenderer.invoke("get-theme");
            if(resp && typeof resp==="object")
                themeObj = {
                    ...themeObj,
                    ...resp
                };
            initAdvThemePage(form,themeObj)
        }
        else
        if(cmd==="reset-color"){
            let form = e.target.parentNode.parentNode.parentNode;
            themeObj = {
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
            initAdvThemePage(form,themeObj);
        }
        else
        if(cmd==="back-page1"){
            removeAllElem(".page2");
            document.querySelector(".page1").classList.remove("hide");
            // Experimental step
            [...document.querySelectorAll(".page1 button")]
            .forEach(btn=>{
                btn.parentNode.classList.remove("hide");
                btn.classList.remove("hide");
            });
            if("prevCMD" in prevData && prevData.prevCMD==="adv-bill-no"){
                removeAllElem(".selected-inv-format")
                let inpDiv = document.getElementById("disabled-input-template").content.cloneNode(true).querySelector("div");
                document.getElementById("bill-format-div").after(inpDiv);
                inpDiv.className = "selected-inv-format";
                let inp = inpDiv.querySelector("input");
                inpDiv.querySelector("label").textContent = "Selected format";
                inpDiv.querySelector("label").setAttribute("for","format");
                inp.name = "format";
                inp.id = "format";
                let formats = ["custom","billNo","fy/billNo","cabbr/fy/billNo",]
                let formatIndex = +prevData.formats;
                inp.value = (formatIndex===0 ? prevData['custom-format'] : formats[formatIndex]);
            }
        }
        else
        if(["annualHolidays","weeklyHolidays"].includes(cmd)){
            let inp = document.querySelector("#company-setting .left-sec "+(cmd==="weeklyHolidays" ? "select" : "input"));
            if(cmd==="annualHolidays"){
                let date = inp.valueAsDate;
                let dates = document.getElementById(cmd+"-textarea").value;
                if(dates==="")
                    document.getElementById(cmd+"-textarea").value = date.toLocaleDateString("en-IN");
                else
                    document.getElementById(cmd+"-textarea").value += "," + date.toLocaleDateString("en-IN");
            }
            else{
                let dayArray = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
                let dayIndex = inp.value;
                let offdays = document.getElementById(cmd+"-textarea").value;
                if(offdays==="")
                    document.getElementById(cmd+"-textarea").value = dayArray[dayIndex];
                else
                    document.getElementById(cmd+"-textarea").value += "," + dayArray[dayIndex];
            }
        }
        else{ // Settings with presets
            let form = document.getElementById(`${cmd}-template`).content.cloneNode(true).querySelector("form");
            e.target.parentNode.classList.add("hide");
            if(!document.getElementById(form.id))
                document.getElementById(`${show}`).appendChild(form);
            else
                document.querySelector(`#${show} #${form.id}`).classList.remove("hide");
            form.querySelector("input")?.focus();
            if(cmd==="session-management"){
                try{
                    let cookies = await ipcRenderer.invoke("check-session-info");
                    if(cookies.length>0){
                        // console.log(cookies[0].expirationDate-Date.now())
                        let {session,sessionTime} = JSON.parse(cookies[0].value);
                        if(session){
                            let numHour = sessionTime/(60*60);
                            document.getElementById("session-btn").click();
                            [...document.getElementById("expiry").querySelectorAll("option")]
                            .forEach(option=>{
                                if(Number(option.value)===numHour)
                                    option.setAttribute("selected","selected");
                                else
                                    option.removeAttribute("selected");
                            });
                        }
                    }
                }
                catch(err){
                    return alert(err);
                }
            }
            else
            if(cmd==="update-user" && loggedinUser.name!=="admin")
                document.getElementById("role-div").classList.add("hide");
            else
            if(cmd==="update-user" && loggedinUser.name==="admin")
                document.getElementById("role-div").classList.remove("hide");
            if(cmd==="add-user" && !["admin","all"].includes(loggedinUser.role))
                document.getElementById("add-user-role-div").classList.add("hide");
            else
            if(cmd==="add-user" && ["admin","all"].includes(loggedinUser.role))
                document.getElementById("add-user-role-div").classList.remove("hide");
            else
            if(cmd==="bill-template"){
                compInfo = await ipcRenderer.invoke("get-company-info");
                let { file,applyTemplate,applyEmblem=false,emblem="",applySeal,seal,captions=[ {first:"Original Buyer's Copy"}, {second:"Transporter's Copy"}, {third:'Book Copy'} ] } = compInfo.billTemplate;
                if(applyTemplate){
                    form.querySelector(`[name="applyTemplate"] option[value="${applyTemplate===true?'choosefile':'false'}"]`)
                    .setAttribute("selected",true);
                    form.querySelector(`[data-show="choosefile"]`).classList.remove("hide");
                    form.querySelector(`#file`).value = file;
                }
                else
                if(file==="default2")
                    form.querySelector(`[name="applyTemplate"] option[value="default2"]`)
                    .setAttribute("selected",true);
                if(applyEmblem){
                    form.querySelector(`[name="applyEmblem"] option[value="choosefile-2"]`)
                    .setAttribute("selected",true);
                    form.querySelector(`[data-show="choosefile-2"]`).classList.remove("hide");
                    form.querySelector(`#file-2`).value = emblem;
                }
                if(applySeal){
                    form.querySelector(`[name="applySeal"] option[value="choosefile-3"]`)
                    .setAttribute("selected",true);
                    form.querySelector(`[data-show="choosefile-3"]`).classList.remove("hide");
                    form.querySelector(`#file-3`).value = seal;
                }
                captions.forEach(obj=>{
                    let key = Object.keys(obj)[0];
                    form.querySelector(`input[name="${key}"]`).value = obj[key];
                });
            }
            else
            if(cmd==="company-profile"){
                compInfo = await ipcRenderer.invoke("get-company-info"); 
                removeAllElem("#host *");
                [...document.querySelectorAll("#table-of-content .tab")]
                .forEach(elem=>{
                    if(elem.dataset.cmd==="basic")
                        elem.classList.add("selected");
                    else
                        elem.classList.remove("selected");
                });
                ["#info-type-basic-template","#info-type-bank-template","#info-type-email-template"]
                .map(selector=>appendToHost(selector,"#view #host","DIV"))
                .forEach(elem=>{
                    if(!elem.classList.contains("basic"))
                        elem.classList.add("hide");
                    if(elem.classList.contains("bank"))
                        appendToHost("#bank-info-form-template",elem,"DIV")
                });
                ["biller","address","gst","phones","abbr",{bankDetails:["name","branch","acc-no","ifsc"]},"email","website"]
                .forEach(key=>{
                    let input;
                    if(typeof key!=="object"){
                        input = form.querySelector(`input[name="${key}"]`);
                        if(!input) return;
                        let text = key!=="phones" ? compInfo?.[key] : "";
                        if(key==="phones")
                            text = compInfo.phones?.reduce?.((acc,val,index,self)=>{
                                if(index===self.length-1)
                                    acc += val;
                                else
                                    acc += val + ", ";
                                return acc;
                            },"") ?? compInfo.phones;
                        input.value = text;
                    }
                    else{
                        let keys = key.bankDetails;
                        if("bankDetails" in compInfo && compInfo?.bankDetails?.length>0){
                            let host = document.querySelector("#view .host");
                            host.classList.remove("hide");
                            document.querySelector(".bank-form h2").classList.remove("hide");
                            compInfo.bankDetails.forEach(bankInfo=>{
                                let child = appendToHost("#bank-info-template",host,"DIV");
                                child.dataset.obj = JSON.stringify(bankInfo)
                                child.querySelector("[data-col='name']").textContent = bankInfo.bank;
                                child.querySelector("[data-col='acc-no']").textContent = bankInfo.accNo;
                                child.querySelector("[data-col='branch']").textContent = bankInfo.branch;
                                child.querySelector("[data-col='ifsc']").textContent = bankInfo.ifsc;                                
                            })
                        }
                    }
                });
            }
            else
            if(cmd==="lock-screen"){
                let cookies = await ipcRenderer.invoke("check-session-info");
                let userPolicy = await ipcRenderer.invoke("get-policy");
                if(cookies.length>0){
                    loggedinUser.usePasswd = JSON.parse(cookies[0].value).usePasswd;
                    if("lockOnIdle" in userPolicy && userPolicy.lockOnIdle)
                        form.idleTime.value = userPolicy.idleTime / 60;
                    else
                        form.idleTime.setAttribute("disabled",true);
                    [
                        {key:"usePasswd",obj:loggedinUser},
                        {key: "lockOnIdle" in userPolicy ? "lockOnIdle" : "",obj:userPolicy}
                    ].filter(({key})=>key!=="").forEach(({key,obj})=>{
                        [...form?.[key]?.querySelectorAll("option")]
                        .forEach(option=>{
                            if(option.value===`${obj[key]}`)
                                option.setAttribute("selected","selected");
                            else
                                option.removeAttribute("selected");
                        });
                    });
                }
            }
            else
            if(cmd==="appearance-management"){
                let appPolicy = await ipcRenderer.invoke("get-app-policy");
                Object.keys(appPolicy)
                .forEach(key=>{
                    let feild = form.querySelector(`input[name="${key}"],select[name="${key}"]`);
                    if(!feild) return;
                    if(feild.nodeName==="SELECT"){
                        let applyTheme = appPolicy.applyTheme ? "true" : "false";
                        feild.querySelector(`option[value="${applyTheme}"]`)?.setAttribute("selected",true);
                        if(applyTheme==="true")
                            form.querySelector(`[data-cmd="advance-theming"]`).classList.add("hide");
                        else
                            form.querySelector(`[data-cmd="advance-theming"]`).classList.remove("hide");
                    }
                    else
                    if(feild.nodeName==="INPUT" && key==="file"){
                        let div = form.querySelector(`div[data-show="choosefile"]`);
                        if(div && appPolicy.applyTheme){
                            div.classList.remove("hide")
                            feild.value = appPolicy.file;
                        }
                    }
                    else
                    if(feild.nodeName==="INPUT" && key==="useDarkTheme" && appPolicy.useDarkTheme)
                        feild.setAttribute("checked",true)
                });
            }
            else
            if(cmd==="registration"){
                let gst = await ipcRenderer.invoke("app-registration-info");
                if(gst){
                    form.gst.value = gst;
                    form.gst.setAttribute("disabled",true);
                }
                else{
                    form.querySelector("div:first-child>div:first-child").classList.add("hide");
                    form.querySelector("button[type='submit']").setAttribute("disabled",true);
                }
            }
            else
            if(cmd==="adv-invoice-format")
                document.querySelector(".page1").classList.add("hide");
            else
            if(cmd==="set-2-factor-auth")
                enableOrDisableQR();
            else
            if(cmd==="gst-setting"){
                let policy = await ipcRenderer.invoke("get-app-policy");
                if(!/^\d.-\d.$/.test(policy.financialYearStartDate))
                    policy.financialYearStartDate = "01-03";
                ["gstInterval","financialYearStartDate","default_gst"]
                .forEach(key=>{
                    let select = form.querySelector(`[name="${key}"]`);
                    if(!(key in policy)) return;
                    if(key === "financialYearStartDate"){
                        let mnth = policy.financialYearStartDate.split("-")[1];
                        select.querySelector(`[value="01-${mnth}"]`).setAttribute("selected",true);
                    }
                    else
                        select.querySelector(`[value="${policy[key]}"]`).setAttribute("selected",true);
                })
            }
            else
            if(cmd==="company-setting"){
                let policy = await ipcRenderer.invoke("get-policy");
                form["ret-days"].value = policy.noReturn;
                form.creditLimitDays.value = policy.creditLimitDays;
                ["annualHolidays","weeklyHolidays"]
                .forEach(key=>{
                    if(key in policy)
                        document.getElementById(key+"-textarea").value = policy[key];
                });
            }
        }
    }
    else
    if(cmd==="back"){
        let selectedSettings = document.getElementById(show);
        selectedSettings.querySelector("form").remove();
        selectedSettings.querySelector(".settings-div").classList.remove("hide");
    }
    spinner.remove(window);
}

function appendElem(e){
    let variable = document.getElementById("element").value;
    let sample = document.getElementById("custom-format-display").value;
    if(!new RegExp(variable).test(sample) || ["/","\\",".","_","-"].includes(variable))
        document.getElementById("custom-format-display").value = sample + variable;
}

function showOrHideDiv(e){
    let form = e.target.parentNode.parentNode.parentNode;
    let hideableDiv = form.querySelector(`[data-show="${e.target.value}"],[data-show="${e.target.dataset.target}"]`);
    if(!hideableDiv) return;
    hideableDiv.classList.toggle("hide");
    if(e.target.name==="applyTheme" && e.target.value==="true")
        form.querySelector(`[data-cmd="advance-theming"]`).classList.add("hide");
    else
    if(e.target.name==="applyTheme" && e.target.value==="false")
        form.querySelector(`[data-cmd="advance-theming"]`).classList.remove("hide");
}

async function saveSettings(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    let {dataset:{cmd,show}} = e.target;
    if(cmd==="update-user"){
        if(data.password!==data["re-password"]){
            document.getElementById("re-password").focus();
            return alert("Password entered doesn't match.");
        }
        try{
            let option = document.getElementById("name-2").list.querySelector(`[value="${data.name}"]`);
            if(option)
                data.id = option.dataset.id;
            await ipcRenderer.invoke("update-user",data);
            showToastNotification("User password updated",["animation-common","move-left","blue-toast-box"],"main");
        }
        catch(err){
            alert(errorFormatter(err));
        }
    }
    else
    if(cmd==="lock-screen"){
        try{
            data.usePasswd = JSON.parse(data.usePasswd);
            data.lockOnIdle = JSON.parse(data.lockOnIdle);
            data.idleTime = Number(data.idleTime) * 60;
            await ipcRenderer.invoke("update-wallpaper", data);
            showToastNotification("Lock screen setting updated",["animation-common","move-left","blue-toast-box"],"main");
        }
        catch(err){
            return alert(errorFormatter(err));
        }
    }
    else
    if(cmd==="add-user"){
        if(data.name.toLowerCase().trim()==="admin") return alert("Cannot use a system reserved name as username.")
        if(data.passwd !== data["re-passwd"]){
            document.getElementById("re-passwd").focus()
            return alert("Password entered doesn't match.")
        }
        await ipcRenderer.invoke("add-user", data);
        showToastNotification("New user added successfully.",["animation-common","move-left","blue-toast-box"],"main");
    }
    else
    if(cmd==="set-2-factor-auth"){
        await ipcRenderer.invoke("save-secret-for-user");
        showToastNotification("2-Factor Authentication enabled.",["animation-common","move-left","blue-toast-box"],"main");
    }
    else
    if(cmd==="session-management"){// for repeated logins.
        if(e.target.querySelector("button").dataset.enable==="true")
            await ipcRenderer.invoke("create-login-session",data);
        else{
            console.log("removing session")
            await ipcRenderer.invoke("remove-auth-session");
        }
        showToastNotification("Session settings updated.",["animation-common","move-left","blue-toast-box"],"main");
    }
    else
    if(cmd==="select-bill-template"){
        if(data.applyTemplate === "choosefile")
            data.applyTemplate = true;
        else{
            data.file = data.applyTemplate;
            data.applyTemplate = false;
        }
        data.applyEmblem = data.applyEmblem=="choosefile-2";
        data.applySeal = data.applySeal=="choosefile-3";
        data.captions = ["first","second","third"].map(key=>({[key]:data[key]}));
        ["first","second","third"].forEach(key=>Reflect.deleteProperty(data,key));
        ipcRenderer.send("company-profile-info",{billTemplate:data});
    }
    else
    if(cmd==="company-profile"){
        data.phones = data.phones.split(",").map(val=>Number(val.trim()));
        ["ifsc","branch","name","type","acc-no"]
        .forEach(key=>{
            Reflect.deleteProperty(data,key);
        });
        Object.keys(data)
        .forEach(key=>{
            if(data[key]==="undefined")
                data[key] = "";
        });
        ipcRenderer.send("company-profile-info",data);
    }
    else
    if(cmd==="appearance-management"){
        data.applyTheme = data.applyTheme === "true" ? true : false;
        data.useDarkTheme = e.target.querySelector(`input[type="checkbox"]`).checked;
        ipcRenderer.send("save-theme-setting",data);
    }
    else
    if(cmd==="adv-appearance-management"){
        data.applyBackgroundImage = e.target.querySelector(`input[name="applyBackgroundImage"]`).checked;
        data.applyGradient = e.target.querySelector(`input[name="applyGradient"]`).checked;
        ipcRenderer.send("save-theme",data);
        return showForm(null,"back-page1",show);
    }
    else
    if(cmd==="backup-manager"){
        data.items = [...e.target.querySelectorAll(".item")].filter(inp=>inp.checked).map(inp=>inp.name);
        data.createZip = e.target.querySelector("#archieve").checked;
        Object.keys(data)
        .forEach(key=>{
            if(!(["items","createZip","mode"].includes(key)))
                Reflect.deleteProperty(data,key);
        });
        let resp = await ipcRenderer.invoke("app-backup",data);
        if(resp===false)
            return;
        else
            showToastNotification("Backup successful.",["animation-common","move-left","blue-toast-box"],"main");
    }
    else
    if(cmd==="registration")
        ipcRenderer.send("app-registration",e.target.gst.value);
    else
    if(cmd==="adv-bill-no"){
        data.prevCMD = cmd;
        return showForm(null,"back-page1",show,data);
    }
    else
    if(cmd==="bill-no"){
        let resp = await ipcRenderer.invoke("billing-format-ipc",data);
        if(resp)
            showToastNotification("Billing preference saved.",["animation-common","move-left","blue-toast-box"],"main");
    }
    else
    if(cmd==="gst-setting"){
        data.gstInterval = Number(data.gstInterval);
        ipcRenderer.send("save-policy-settings",data);
    }
    else
    if(cmd==="company-setting")
        ipcRenderer.send("save-policy",data);
    showForm(null,"back",show);
}

async function enableOrDisableQR(e){
    let username = e && e.target.value;
    let option = e && e.target.list.querySelector(`[data-name="${username}"]`);
    let userId = option && option.dataset.id;
    if(e)
        e.target.dataset.id = userId;
    let secret = await ipcRenderer.invoke("get-user-status",userId);
    let btn;
    if(!secret)
        btn = document.getElementById("enable-2-factor");
    else
        btn = document.getElementById("disable-2-factor")        ;
    btn?.removeAttribute("disabled");
}

ipcRenderer.on("logged-in-user",(e,user)=>{
    loggedinUser = user;
    document.getElementById("gretings-header").textContent = `Welcome, ${capitalize(loggedinUser.name)}`;
});

ipcRenderer.on("error",(e,msg)=>{
    return alert(msg);
});

// Context Menu
function showContextMenu(e){
    let elem = e.target;
    let parentNode;
    if(elem.classList.contains("col")){
        parentNode = elem.parentNode;
        let obj = JSON.parse(parentNode.dataset.obj);
        selectedRow = parentNode;
        ipcRenderer.send("show-context-menu",{mode:parentNode.dataset.identifier,obj});
    }
}

ipcRenderer.on("show-bill",async (e,selectedBill)=>{
    if(!selectedBill) return;
    let spinner = drawSpinner(document);
    hiddenSection = document.querySelector(".mode-content");
    let modeHost = document.getElementById("mode-host");
    hiddenSection.classList.add("hide");
    let { billItemTable } = selectedBill;
    let quickHost = document.getElementById("quick-host-template").content.cloneNode(true).querySelector("div");
    modeHost.appendChild(quickHost);
    let mode = document.getElementById("bill-display-template").content.cloneNode(true).querySelector("div");
    quickHost.querySelector("#host").appendChild(mode);
    let [ id,billNo,billDate ] = billItemTable.split("_");
    let billItems = await ipcRenderer.invoke("get-bill-items-2",id,billNo,billDate);
    let tbody = mode.querySelector(".tbody");
    billItems.forEach(({name,quantity,unit,rate},index)=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${index+1}</p>
            <p class="col eq-space">${name}</p>
            <p class="col eq-space">${quantity+unit}</p>
            <p class="col eq-space">${rate}</p>
        `;
        tbody.appendChild(div);
    });
    let billMetaDiv = mode.querySelector("#bil-meta");
    [{key:"billNo",label:"Bill No."},{key:"billDate",label:"Bill Date"},{key:"billAmt",label:"Bill Amount"},{key:"netDue",label:"Net Due"},{key:"billStatus",label:"Bill Status"},{key:"deliveryStatus",label:"Order status"},{key:"paymentStatus",label:"Bill status"}]
    .forEach(({key,label})=>{
        let div = document.createElement("div");
        let p = document.createElement("p");
        p.textContent = label+":";
        div.appendChild(p);
        p = document.createElement("p");
        if(key==="billDate")
            p.textContent = billDate;
        else
        if(key==="paymentStatus")
            p.textContent = selectedBill[key] ? "Paid" : "Due";
        else
            p.textContent = selectedBill[key];
        div.appendChild(p);
        billMetaDiv.appendChild(div);
    });
    let customerObj = await ipcRenderer.invoke("get-customer-details",selectedBill.customerId);
    let customerMetaDiv = mode.querySelector("#customer-meta");
    [{key:"name",label:"Name"},{key:"address",label:"Address"},{key:"gst",label:"GST"},{key:"phones",label:"Contact"},{key:"email",label:"Email"}]
    .forEach(({key,label})=>{
        let div = document.createElement("div");
        let p = document.createElement("p");
        p.textContent = label+":";
        div.appendChild(p);
        p = document.createElement("p");
        if(key==="email")
            p.textContent = customerObj.moreInfo?.email;
        else
            p.textContent = customerObj[key];
        div.appendChild(p);
        customerMetaDiv.appendChild(div);
    });
    spinner.remove(window);
});

//Back action
function backAction(e){
    removeAllElem("#quick-host");
    hiddenSection.classList.remove("hide");
}

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function revalidateInput(e){
    if(Number(e.target.value)>Number(e.target.max))
        e.target.value = e.target.max;
}

ipcRenderer.on("check-for-update",async (e,UPDATE_REST,appVersion)=>{
    let changelog = [];
    try{
        if(navigator.onLine){
            let resp = await fetch(UPDATE_REST+"version");
            if(resp.ok){
                let obj = await resp.json();
                appVersion = obj.version;
                changelog = obj.changelog;
            }
        }
        ipcRenderer.send("check-for-update-response",{isOnline:navigator.onLine,appVersion,changelog});
    }
    catch(err){
        ipcRenderer.send("check-for-update-response",{isOnline:navigator.onLine,appVersion,err,changelog});
    }
});

document.addEventListener("click",(e)=>{
    if(e.target.classList.contains("drop-down-btn")) return;
    document.querySelector(".drop-down")?.classList.add("hide");
    if(e.target.dataset.cmd==="call-scheduler")
        ipcRenderer.send("call-scheduler");
});

ipcRenderer.on("update-content",async ()=>{
    let spinner = drawSpinner(document);
    await applyMode();
    spinner.remove(window);
});

function dblClickHandler(e){
    let elem = traverseParent(e.target,"body");
    if(!(elem && elem.classList.contains("row"))) return;
    let identifier = elem.dataset.identifier;
    if(identifier==="billObj"){
        let billObj = JSON.parse(elem.dataset.obj);
        ipcRenderer.send("dbl-click-resp",billObj,2);
    }
}

function changeHandler(e){
    if("target" in e.target.dataset && e.target.dataset.target==="idleTime"){
        let form = document.getElementById("lock-screen");
        if(e.target.value==="true")
            form.idleTime.removeAttribute("disabled");
        else
            form.idleTime.setAttribute("disabled",true);
    }
    else
    if("cmd" in e.target.dataset && e.target.dataset?.cmd==="invoice-format" && e.target.value==="0")
        document.getElementById("custom-format-div").classList.remove("hide");
    else
    if("cmd" in e.target.dataset && e.target.dataset?.cmd==="invoice-format" && e.target.value!="0")
        document.getElementById("custom-format-div").classList.add("hide");
}

function openScheduleManager(e){
    let selectedP = traverseParent(e.target,null,"P");
    if(!selectedP) return;
    let evObj = JSON.parse(selectedP.dataset.obj);
    ipcRenderer.send("open-event",evObj);
}

function collateUpdator(tagGrp,arr,i,evObj){
    if(i<5){
        let div = document.createElement("div");
        div.style.setProperty("--color",evObj.color);
        tagGrp.querySelector(".collate-content").appendChild(div);
    }
    else
    if(i===5){
        let p = document.createElement("p");
        p.textContent = (arr.length - 5) + "+ notifications";
        tagGrp.querySelector(".collate-content").appendChild(p);
    }
}

function camelCase(str){
    return str.split(" ").reduce((acc,str,i)=>{
        if(i>0)
            str = capitalize(str);
        acc += str;
        return acc;
    },"");
}

function reverseCamelCase(str){
    return str.replace(/[A-Z]/g,(str,i)=>{
        if(i===0)
            return str;
        return " "+str.toLowerCase();
    });
}

ipcRenderer.send("get-notification");

ipcRenderer.on("check-notification",()=>{
    ipcRenderer.send("get-notification");
});

ipcRenderer.on("notification",(e,notifyJobs,showToast=false)=>{
    removeAllElem(".notification-group");
    let notificationHost = document.getElementById("notification-div");
    if(notifyJobs.length===0)
        return appendToHost("#no-notification-template",notificationHost,"P");
    notifyJobs = notifyJobs.sort((obj1,obj2)=>new Date(obj2.time)-new Date(obj1.time));
    let firstPriorityTag = notifyJobs[0].tag;
    let notificatioGrpObj = notifyJobs.reduce((acc,job)=>{
        if(Object.keys(acc).includes(job.tag))
            acc[(job?.tag ?? "default")].push(job);
        else
            acc[(job?.tag ?? "default")] = [job];
        return acc;
    },{});
    tags = Object.keys(notificatioGrpObj);
    tags.splice(tags.findIndex(tag=>tag===firstPriorityTag),1);
    tags.unshift(firstPriorityTag);
    tags.forEach(tag=>{
        let tagGrp;
        if(document.getElementById(`${camelCase(tag)}-group`))
            tagGrp = document.getElementById(`${camelCase(tag)}-group`);
        else{
            tagGrp = document.getElementById("notification-group-template").content.cloneNode(true).querySelector("div");
            tagGrp.id = `${camelCase(tag)}-group`;
            notificationHost.appendChild(tagGrp);  
            tagGrp.querySelector('[data-col="tag"]').textContent = tag;          
        }
        removeAllElem(`#${camelCase(tag)}-group .collate-content *`);
        notificatioGrpObj[tag]
        .forEach((job,i,arr)=>{
            let notificationDiv = document.getElementById("notification-template").content.cloneNode(true).querySelector("div");
            tagGrp.querySelector(".retractable-div").appendChild(notificationDiv);
            notificationDiv.querySelector('[data-col="label"]').textContent = job.label;
            notificationDiv.querySelector('[data-col="time"]').textContent = job.time;
            notificationDiv.dataset.obj = JSON.stringify(job);
            let description = "";
            if(job.type==="reminder")
                description = job.note;
            else
            if(job.type==="bill-payment"){
                appendToHost("#add-payment-btn-template",notificationDiv.querySelector(".btn-container"),"BUTTON")
                if(job.billType==="sales-select")
                    description = `${job.billObj.name} Bill No: ${job.billObj.billNo} Amount Rs.${Math.round(job.billObj.netAmtTax)} is due for collection.`;
                if(job.billType==="purchase-select")
                    description = `${job.billObj.name} Bill No: ${job.billObj.billNo} Amount Rs.${Math.round(job.billObj.total)} is due for payment.`;
            }
            else
            if(job.type==="Error"){
                description = "An Error occured performing last operation. Contact developer to show your error."+job.error;
                showToastNotification("Error occoured, check notification",["animation-common","move-left","red-toast-box"]);
            }
            else
            if(job.type==="app-update"){
                description = "An update is available for download and install. Please update BBS to enjoy latest features and fixes. Update highlights are listed below:";
                let ul = notificationDiv.querySelector("ul");
                ul.classList.remove("hide");
                job.changeLogArr.forEach(log=>{
                    let li = document.createElement("li");
                    li.textContent = log;
                    ul.appendChild(li);
                });
                [...notificationDiv.querySelectorAll(".btn-container>button")]
                .forEach(btn=>{
                    if(btn.dataset.cmd==="update-now"){
                        btn.classList.remove("hide");
                        btn.dataset.version = job.version;
                    }
                    else
                        btn.classList.add("hide");
                });
            }
            notificationDiv.querySelector('[data-col="description"]').textContent = description;
            collateUpdator(tagGrp,arr,i,job);
            notificationDiv.style.setProperty("--color",job.color);
            let [h,s,l] = hslComponents(job.color);
            notificationDiv.style.setProperty("--lighter-shade",lightenHSL(h,s,l,0.3));
            if(showToast)
                showToastNotification(job.label,["animation-common","move-left","blue-toast-box"],"main-div",8,"9%");
        });
        retractHandler(tagGrp.querySelector(".retractable-div"));
        tagGrp.classList.toggle("collate");
        tagGrp.classList.toggle("expand");
        [...tagGrp.querySelectorAll(`.notification`)]
        .forEach(elem=>elem.classList.toggle("hide"));
        tagGrp.querySelector(".collate-content").classList.toggle("hide");
    });
    initScheduleDiv();
});

function execRetractHandler(e){
    if(e.target.nodeName!=="DIV"){
        let container = traverseParent(e.target,"retractable-div-container");
        let retractableDiv = container.querySelector(".retractable-div");
        container.classList.toggle("expand");
        [...document.querySelectorAll(`#${container.id} .notification`)]
        .forEach(elem=>elem.classList.toggle("hide"));
        container.classList.toggle("collate");
        [...document.querySelectorAll(`#${container.id} .collate-content`)]
        .forEach(elem=>elem.classList.toggle("hide"));
        retractHandler(retractableDiv);
    }
}

function clear2ndRemovable(){
    removeAllElem(".removable-2");
    [...document.querySelectorAll(".retractable-div")]
    .forEach(noticeDiv=>{
        noticeDiv.style.height = [...noticeDiv.querySelectorAll(".notification")].reduce((acc,elem)=>acc+elem.scrollHeight,0) + "px";
    });
}

function notificationAction(e){
    if(e.target.nodeName!=="BUTTON") return;
    let cmd = e.target.dataset.cmd;
    clear2ndRemovable();
    if(cmd==="delete-all"){
        let noticeGrp = traverseParent(e.target,"notification-group"),tag;
        let regex = /(?<![A-Z])(?<!^)[A-Z]{1}/g;
        // console.log(regex.test(noticeGrp.id.split("-group")[0]))
        if(regex.test(noticeGrp.id.split("-group")[0]))
            tag = reverseCamelCase(noticeGrp.id.split("-group")[0]);
        else
            tag = noticeGrp.id.split("-group")[0];
        tag = tags.find(_tag=>new RegExp(_tag,"i").test(tag));
        ipcRenderer.send("manage-schedule",tag,"exp-all",false);
        noticeGrp.classList.add("animation-common");
        noticeGrp.classList.add("vanish");
        setTimeout(()=>{
            noticeGrp.remove();
        },300);
    }
    else
    if(cmd==="delete"){
        let notification = traverseParent(e.target,"notification");
        let evObj = JSON.parse(notification.dataset.obj);
        ipcRenderer.send("manage-schedule",evObj.id,"exp-r",false);
        notification.classList.add("animation-common");
        notification.classList.add("vanish");
        setTimeout(()=>{
            notification.remove();
            removeAllElem(`#${camelCase(evObj.tag)}-group .collate-content *`);
            let arr = [...document.querySelectorAll(`#${camelCase(evObj.tag)}-group .notification`)].map(elem=>JSON.parse(elem.dataset.obj));
            let tagGrp = document.getElementById(`${camelCase(evObj.tag)}-group`);
            arr.forEach((obj,i)=>{
                collateUpdator(tagGrp,arr,i,obj);
            });
        },300);
    }
    else
    if(cmd==="clear")
        removeAllElem(".notification-group");
    else
    if(cmd==="postpone"){
        let notification = traverseParent(e.target,"notification");
        let noticeDiv = traverseParent(e.target,"retractable-div");
        let form = appendToHost("#postpone-template",notification);
        let evObj = JSON.parse(notification.dataset.obj);
        form.dataset.obj = JSON.stringify(evObj);
        noticeDiv.style.height = notification.scrollHeight + "px";
    }
    else
    if(cmd==="update-now"){
        let noticeGrp = traverseParent(e.target,"notification-group");
        noticeGrp.classList.add("animation-common");
        noticeGrp.classList.add("vanish");
        noticeGrp.remove();
        ipcRenderer.send("start-update",e.target.dataset.version);
    }
}

function submitHandler(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    let evObj = JSON.parse(e.target.dataset.obj);
    if(new Date(data.time)<new Date(evObj.time)){
        let p = appendToHost("#time-error-template",e.target,"p");
        setTimeout(()=>{p.remove()},2000);
    }
    else{
        evObj.time = data.time;
        ipcRenderer.send("manage-schedule",evObj,"exp-u",false,"time");
        clear2ndRemovable();
    }
}

function addFeilds(e){
    let { cmd } = e.target.dataset;
    [...document.querySelectorAll("#view .tab")]
    .forEach(tab=>{
        if(tab.dataset.cmd===cmd)
            tab.classList.add("selected");
        else
            tab.classList.remove("selected");
    });
    [...document.querySelectorAll("#view .info")]
    .forEach(div=>{
        if(div.classList.contains(cmd))
            div.classList.remove("hide");
        else
            div.classList.add("hide");
    })
}

async function addBank(e){
    let compInfo = await ipcRenderer.invoke("get-company-info");
    let form = traverseParent(e.target,"form","Div");
    form = [...form.querySelectorAll("input")].reduce((acc,input)=>{
        acc[input.name]=input.value;
        return acc;
    },{});
    let bank = form.name;
    let branch = form.branch;
    let accNo = form['acc-no'];
    let ifsc = form.ifsc;
    let bankID = uuid.v5(`${bank}-${accNo}`,"6ba7b814-9dad-11d1-80b4-00c04fd430c8")
    let host = document.querySelector("#view #host .bank");
    let { bankDetails=[] } = compInfo;
    if(!(bankDetails instanceof Array)) 
        bankDetails = [];
    if(bankDetails.find(({bankID:_id=""})=>_id===bankID))
        return alert("Bank exists");
    removeAllElem("#view #host .bank .bank-form");
    bankDetails.push({bank,branch,accNo,ifsc,bankID});
    appendToHost("#bank-info-form-template",host,"DIV");
    document.querySelector("#view #host .bank .host").classList.remove("hide");
    document.querySelector(".bank-form h2").classList.remove("hide");
    bankDetails.forEach(obj=>{
        let child = appendToHost("#bank-info-template","#view #host .bank .host","DIV");
        child.dataset.obj = JSON.stringify(obj);
        child.querySelector("[data-col='name']").textContent = obj.bank;
        child.querySelector("[data-col='acc-no']").textContent = obj.accNo;
        child.querySelector("[data-col='branch']").textContent = obj.branch;
        child.querySelector("[data-col='ifsc']").textContent = obj.ifsc;
    });
    compInfo.bankDetails = bankDetails;
    let resp = await ipcRenderer.invoke("manage-company-bank",compInfo,"a");
    if(resp)
        showToastNotification("Bank added.",["animation-common","move-left","blue-toast-box"],"main");
}

async function manageBank(e){
    e.preventDefault();
    let btn = e.target;
    let cmd = btn.dataset.cmd;
    let div = traverseParent(e.target,"bank-info");
    let obj = JSON.parse(div.dataset.obj);
    if(cmd==="delete"){
        let resp = await ipcRenderer.invoke("manage-company-bank",obj,"delete");
        if(resp){
            showToastNotification("Bank deleted.",["animation-common","move-left","blue-toast-box"],"main");
            div.remove();
        }
    }
    else
    if(cmd==="edit"){
        div.remove();
        await ipcRenderer.invoke("manage-company-bank",obj,"auto-delete");
        div = traverseParent(e.target,"bank-form");
        div.querySelector("input[name='name']").value = obj.bank;
        div.querySelector("input[name='branch']").value = obj.branch;
        div.querySelector("input[name='acc-no']").value = obj.accNo;
        div.querySelector("input[name='ifsc']").value = obj.ifsc;
    }
}

ipcRenderer.on("execute-progressbar",(e,val,obj)=>{
    createORexecuteProgressbar(val,obj)
});

let itemFormContent = function(form){
    if(!(this instanceof Array)) return console.log(this)
    let itemObj = this.pop();
    removeAllElem("#container *");
    form.dataset.lastFlag = this.length===0;
    form.dataset.itemID = itemObj.id;
    let formInpTem = document.getElementById("sample-form-input-template").content;
    form.querySelector("#prod-name").textContent = `${itemObj.name}`;
    ["standardSellPrice","taxSlab","buyPrice"]
    .forEach(key=>{
        if(itemObj.standardSellPrice!=0 || "taxSlab" in itemObj.pInfo) return;
        let inpDiv = formInpTem.cloneNode(true).querySelector("div");
        document.getElementById("container").appendChild(inpDiv);
        let input = inpDiv.querySelector("input");
        let label = inpDiv.querySelector("label");
        label.setAttribute("for","standardSellPrice");
        if(key==="standardSellPrice")
            label.textContent = "Standard sell price";
        else
        if(key==="taxSlab")
            label.textContent = "GST Slab";
        else
        if(key==="buyPrice")
            label.textContent = "Last buy price";
        input.setAttribute("type","text");
        input.setAttribute("id",key);
        input.setAttribute("name",key);
        input.dataset.type = "Number";
        input.dataset.subtype = "price";
        if(Number(itemObj?.[key])>0 || Number(itemObj.pInfo?.[key])>0)
            input.value = itemObj?.[key] ?? itemObj.pInfo?.[key]
        input.setAttribute("onkeypress","validateInput2(event)");
    });
    form.querySelector("input").focus();
}

ipcRenderer.on("product-info-fillup-modal",(e,stockList)=>{
    let itemModal = createModal("product-info-fillup-modal");
    document.querySelector(".cover").classList.add("hide");
    let form = appendToHost("#product-info-fillup-modal-template",itemModal);
    form.addEventListener("submit",saveItemInfo.bind(stockList))
    saveItemInfo.bind(stockList);
    itemFormContent = itemFormContent.bind(stockList);
    itemFormContent(form);
});

function saveItemInfo(e){
    e.preventDefault();
    let form = e.target;
    let { itemID:id,lastFlag } = form.dataset;
    let formData = Object.fromEntries(new FormData(form).entries());
    ipcRenderer.send("save-stock-info",id,formData);
    if(lastFlag==="false"){
        showToastNotification("Product updated.",["animation-common","move-left","blue-toast-box"],"main");
        itemFormContent(form);
    }
    else
        applySpinner(_closeModal);
}

async function _closeModal(){
    document.querySelector(".modal").appendChild(this.canvas)
    await ipcRenderer.invoke("refresh-stocklist")
    closeModal();
    return showToastNotification("Products updated.",["animation-common","move-left","blue-toast-box"],"main");
}

async function prodFormAction(e){
    if(e.target.type==="submit") return;
    let form = e.target.parentNode.parentNode;
    let { cmd,lastFlag } = e.target.dataset;
    if(cmd==="skip"){
        let id = form.dataset.itemID;
        ipcRenderer.send("item-pinfo",id,"skipFlag",true);
        itemFormContent(form);
        lastFlag==="true" && applySpinner(_closeModal);
    }
    else
    if(cmd==="close"){
        applySpinner(_closeModal)
    }
}

ipcRenderer.on("remove-row",()=>{
    if(!selectedRow) return;
    if(currentMode==="overview")
        selectedRow.remove();
    if(currentMode==="sale")
        selectedRow.querySelector(".col:last-child").textContent = "Paid";
});

ipcRenderer.on("msg-from-backend",(e,msg,type)=>{
    let classList = ["animation-common","move-left","blue-toast-box"];
    if(type==="error")
        classList = ["animation-common","move-left","red-toast-box"];
    showToastNotification(msg,classList)
});