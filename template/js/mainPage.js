const { ipcRenderer } = require("electron");
const { toggleDevTool, chooseFile , drawSpinner, retractHandler, removeAllElem, drawLineGraph, dataModal, showToastNotification, closeToast, validateInput, validateInput2, errorFormatter, capitalize, applyTheme, noDataPlaceholder, bodyRow, hexTohsl, lightenHSL, hslComponents, carosel } = require("../js/common");


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
let mode = 1,loggedinUser,compInfo,hiddenSection,caroselTimer;

toggleDevTool(document);

async function initPage(){
    let spinner = drawSpinner(document);
    document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");
    await applyMode();
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

async function overviewPageInit(){
    let {stocks=[],unPaidBills=[]} = await ipcRenderer.invoke("get-overview-content") ?? {};
    let [dt,mnth,yr] = new Date().toLocaleDateString("en-GB",{dateStyle:"long"}).split(" ");
    let dtEventDiv = document.querySelector("#scheduler-div .event-div>#dt-div");
    dtEventDiv.querySelector("h1").textContent = dt;
    dtEventDiv.querySelector("p").textContent = `${mnth}, ${yr}`;
    removeAllElem(".no-data");
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
    let schedules = await ipcRenderer.invoke("get-chedules");
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
    clearInterval(caroselTimer);
    carosel([...document.querySelectorAll(".event-page")],0);
}

async function salePageInit(){
    let {bills=[],allBills=[]} = await ipcRenderer.invoke("get-sale-content") ?? {};
    let orderQueueContainer = document.getElementById("order-queue-container");
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

function updateChart(e,canvasId){
    if(e){
        let option = e.target.querySelector(`[value="${e.target.value}"]`);
        mode = Number(option.dataset.mode);
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

async function showForm(e,cmd,show){
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
            let id = document.getElementById("name").dataset.id;
            let show = e.target.dataset.show;
            await ipcRenderer.invoke("remove-secret",id);
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
                            let numHour = sessionTime/(60*60*1000);
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
                let { billTemplate:{ file,applyTemplate } } = compInfo;
                if(applyTemplate){
                    form.querySelector(`[name="applyTemplate"] option[value="${applyTemplate===true?'choosefile':'false'}"]`)
                    .setAttribute("selected",true);
                    form.querySelector(`[data-show="choosefile"]`).classList.remove("hide");
                    form.querySelector(`#file`).value = file;
                }
            }
            else
            if(cmd==="company-profile"){
                compInfo = await ipcRenderer.invoke("get-company-info");
                ["biller","address","gst","phones"]
                .forEach(key=>{
                    let input = form.querySelector(`input[name="${key}"]`);
                    if(!input) return;
                    let text = key!=="phones" ? compInfo[key] : "";
                    if(key==="phones")
                        text = compInfo.phones.reduce((acc,val,index,self)=>{
                            if(index===self.length-1)
                                acc += val;
                            else
                                acc += val + ", ";
                            return acc;
                        },"");
                    if(["gst","biller"].includes(key))
                        input.setAttribute("disabled",true);
                    input.value = text;
                });
            }
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
                    ].forEach(({key,obj})=>{
                        [...form[key].querySelectorAll("option")]
                        .forEach(option=>{
                            if(option.value===`${obj[key]}`)
                                option.setAttribute("selected","selected");
                            else
                                option.removeAttribute("selected");
                        });
                    });
                }
            }
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
        data.applyTemplate = data.applyTemplate === "choosefile" ? true : false;
        ipcRenderer.send("company-profile-info",{billTemplate:data});
    }
    else
    if(cmd==="company-profile"){
        data.phones = data.phones.split(",").map(val=>Number(val.trim()));
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
        await ipcRenderer.invoke("app-backup",data);
    }
    else
    if(cmd==="registration")
        ipcRenderer.send("app-registration",e.target.gst.value);
    showForm(null,"back",show);
}

async function enableOrDisableQR(e){
    let username = e.target.value;
    let option = e.target.list.querySelector(`[data-name="${username}"]`);
    let userId = option.dataset.id;
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
    let { x,y } = e;
    let parentNode;
    if(elem.classList.contains("col")){
        parentNode = elem.parentNode;
        let obj = JSON.parse(parentNode.dataset.obj);
        ipcRenderer.send("show-context-menu",{mode:parentNode.dataset.identifier,x,y,obj});
    }
}

ipcRenderer.on("show-bill",async (e,selectedBill)=>{
    if(!selectedBill) return;
    let spinner = drawSpinner(document);
    hiddenSection = document.getElementById("overview-div");
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
    try{
        if(navigator.onLine){
            let resp = await fetch(UPDATE_REST+"version");
            if(resp.ok)
                appVersion = (await resp.json()).version;
        }
        ipcRenderer.send("check-for-update-response",{isOnline:navigator.onLine,appVersion});
    }
    catch(err){
        ipcRenderer.send("check-for-update-response",{isOnline:navigator.onLine,appVersion,err});
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
    let elem = e.path.find(elem=>elem.classList.contains("body") && elem.classList.contains("row"));
    if(elem)
        ipcRenderer.send("dbl-click-resp",JSON.parse(elem.dataset.obj),1);
}

function changeHandler(e){
    if("target" in e.target.dataset && e.target.dataset.target==="idleTime"){
        let form = e.path.find(elem=>elem.id==="lock-screen");
        if(e.target.value==="true")
            form.idleTime.removeAttribute("disabled");
        else
            form.idleTime.setAttribute("disabled",true);
    }
}

function openScheduleManager(e){
    let selectedP = e.path.find(elem=>elem.nodeName==="P");
    let evObj = JSON.parse(selectedP.dataset.obj);
    console.log(evObj);
    // Open event in event manager
}