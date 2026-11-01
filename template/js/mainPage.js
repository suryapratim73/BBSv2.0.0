const { ipcRenderer } = require("electron");
const { toggleDevTool,getAmtToWord, chooseFile , drawSpinner, retractHandler, removeAllElem, showToastNotification, closeToast, validateInput, validateInput2, errorFormatter, capitalize, applyTheme, hexTohsl, lightenHSL, hslComponents, appendToHost, createModal, createORexecuteProgressbar, applySpinner, traverseParent, startUpdateTour,appendToDL,getNGramIndex,showUpdatePrompt,showEulaPage, formatDateShort, formatTimeLeft } = require("../js/common");
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
let currentMode = "overview";
let loggedinUser,compInfo,hiddenSection,tags;
let selectedRow;
let nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    transporterDatalist = document.createElement("datalist");

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
transporterDatalist.id = "transport-dl";

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
        // Initiating Fuzzy map
        removeAllElem("#stock-names, #customer-names, #unit-dl, #transport-dl, #available-bill-no-div, #ship-info-dl");// This should prevent duplicate datalists on re-init
        await appendToDL.call({tableName:"stock"},"get-stocks", nameDatalist);
        await appendToDL.call({tableName:"stock"},"get-services", nameDatalist);
        await appendToDL.call({tableName:"customer"},"get-customers", customerNameDatalist);
        await appendToDL.call({tableName:"transporter"},"get-transporter", transporterDatalist);
        ipcRenderer.send("init-ngram-index",getNGramIndex());
    }
    catch(err){
        alert(err)
    }
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document,null,themeObj);
    spinner.remove(window);
    // App status bar (zen mode, weather theme, kiosk, connectivity)
    initStatusBar();
    startUpdateTour();
    ipcRenderer.send("booted")
}
initPage();

// ---------- App status bar ----------

function setStatusText(id, text){
    var el = document.getElementById(id);
    if (!el) return;
    var label = el.querySelector(".status-label");
    if (label) label.textContent = text;
}

function updateZenStatus(state){
    var el = document.getElementById("zen-status");
    if (!el) return;
    if (!state || !state.targetDate) {
        setStatusText("zen-status", "Zen Mode: Off");
        el.dataset.status = "off";
        el.dataset.msg = "Start Zen Mode";
        return;
    }
    var text = "Zen Mode: " + formatDateShort(state.targetDate);
    if (state.stopType === "bill-numbers") {
        var total = state.progress ? state.progress.totalBills : state.billNos.length,
            consumed = state.progress ? state.progress.consumedBills : 0,
            left = Math.max(0, total - consumed);
        text += " · " + left + " bill no" + (left === 1 ? "" : "s") + " left";
    } else if (state.stopType === "duration") {
        text += " · " + formatTimeLeft(state.progress ? state.progress.timeLeftMs : 0);
    } else {
        text += " · manual stop";
    }
    setStatusText("zen-status", text);
    el.dataset.status = "on";
    el.dataset.msg = "Zen Mode is active — manage it";
}

function weatherThemeName(){
    var match = String(document.body.className).match(/theme-(summer|monsoon|winter|cloudy|haze|thunderstorm|festive|night)/);
    return match ? capitalize(match[1]) : "";
}

function updateWeatherStatus(){
    var el = document.getElementById("weather-status");
    if (!el) return;
    var active = document.body.classList.contains("weather-theme-active"),
        name = weatherThemeName();
    if (active) {
        setStatusText("weather-status", "Weather Theme: " + (name || "On"));
        el.dataset.status = "on";
        el.dataset.msg = "Revert to default theme";
    } else {
        setStatusText("weather-status", "Weather Theme: Off");
        el.dataset.status = "off";
        el.dataset.msg = "Apply weather theme";
    }
}

function toggleWeatherTheme(){
    if (document.body.classList.contains("weather-theme-active"))
        ipcRenderer.send("reset-weather-theme"); // turn off
    else
        ipcRenderer.send("refresh-weather-theme"); // turn on
    // Turning on fetches the theme from the server — poll until it lands
    var tries = 0;
    var poll = setInterval(function(){
        updateWeatherStatus();
        if (++tries >= 8) clearInterval(poll);
    }, 800);
}

function updateKioskStatus(status) {
    var el = document.getElementById("kiosk-status");
    if (!el) return;
    if (status && status.running) {
        setStatusText("kiosk-status", "Kiosk: On" + (status.port ? " :" + status.port : ""));
        el.dataset.status = "on";
        el.dataset.msg = "Stop kiosk server";
    } else {
        setStatusText("kiosk-status", "Kiosk: Off");
        el.dataset.status = "off";
        el.dataset.msg = "Start kiosk server";
    }
}

function updateConnectivityStatus(online){
    var el = document.getElementById("connectivity-status");
    if (!el) return;
    setStatusText("connectivity-status", online ? "Internet: Online" : "Internet: Offline");
    el.dataset.status = online ? "on" : "off";
}

function updateFileMonitorStatus(status,txt=""){
    let el = document.getElementById("file-monitor-status");
    setStatusText("file-monitor-status",status ? "FileMonitor: On"+txt : "FileMonitor: off"+txt);
    el.dataset.status = status ? "on" : "off";
}

function initStatusBar(){
    ipcRenderer.on("zen-mode-update", function(e, state) { updateZenStatus(state); });
    ipcRenderer.invoke("get-zen-mode-state").then(updateZenStatus);
    ipcRenderer.on("kiosk-status-update", function(e, status) { updateKioskStatus(status); });
    ipcRenderer.invoke("get-kiosk-status").then(updateKioskStatus);
    ipcRenderer.on("connectivity-update", function(e, online) { updateConnectivityStatus(online); });
    ipcRenderer.invoke("get-connectivity-status").then(updateConnectivityStatus);
    ipcRenderer.invoke("get-file-monitor-status").then(updateFileMonitorStatus);
    ipcRenderer.on("get-file-monitor-update",(e,status,txt)=>{ updateFileMonitorStatus(status,txt); });
    updateWeatherStatus();
    document.getElementById("zen-status").addEventListener("click", function() {
        ipcRenderer.send("open-zen-mode");
    });
    document.getElementById("weather-status").addEventListener("click", toggleWeatherTheme);
    document.getElementById("kiosk-status").addEventListener("click", function() {
        ipcRenderer.invoke("toggle-kiosk-server").then(updateKioskStatus);
    });
    document.getElementById("file-monitor-status").addEventListener("click",async function(){
        let status = await ipcRenderer.invoke("toggle-file-monitor");
        updateFileMonitorStatus(status);
    });
    // Periodic refresh — catches duration-based zen stops and settings-driven
    // theme changes without a dedicated event. Connectivity is polled here too
    // (checkForInternet probe in main) so the dot tracks real reachability.
    setInterval(function(){
        ipcRenderer.invoke("get-zen-mode-state").then(updateZenStatus);
        updateWeatherStatus();
        ipcRenderer.invoke("get-connectivity-status").then(updateConnectivityStatus);
    }, 30000);
}

async function modeSwitcher(e){
    if(e.target.nodeName!=="P") return;
    let cmd = e.target.dataset.cmd;

    currentMode = cmd;
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
    if(["overview","cloud","scheduler"].includes(currentMode))
        document.getElementById("mode-host").appendChild(modeContent);
    if(!modeContent) return;
    if(currentMode==="overview")
        await renderOverviewPage();
    else
    if(currentMode==="cloud")
        cloudPageInit();
    else
    if(currentMode==="scheduler")
        schedulerPageInit();
    else
    if(currentMode==="settings")
        settingsPageInit(modeContent);
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
            if(cmd==="bill-no"){
                let presets = await ipcRenderer.invoke("get-presets");
                let fileNameFormat = presets.fileNameFormat;
                if(fileNameFormat)
                    form.querySelector(`#fileNameFormat>option[value="${fileNameFormat}"]`)
                    .setAttribute("selected",true);
                form.discVal.value = presets.discVal;
            }
            else
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
                let { paperSize="A4", margin=10 } = compInfo;
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
                if(paperSize)
                    form.querySelector(`[name="paperSize"] option[value="${paperSize}"]`)
                    .setAttribute("selected",true);
                form.querySelector(`input[name="margin"]`).value = margin;
                let option1 = form.querySelector(`[name="applyTemplate"] option[value="default1"]`);
                let option2 = form.querySelector(`[name="applyTemplate"] option[value="default2"]`); 
                let { d1Img,d2Img } = await ipcRenderer.invoke("generate-template-previews");
                if(d1Img){
                    option1.dataset.img = d1Img;
                    option2.dataset.img = d2Img;
                    document.querySelector("#default1-template-preview img").src = d1Img;
                    document.querySelector("#default1-template-preview button").dataset.img = d1Img;
                    document.querySelector("#default2-template-preview img").src = d2Img;
                    document.querySelector("#default2-template-preview button").dataset.img = d2Img;
                    let appPolicy = await ipcRenderer.invoke("get-app-policy");
                    let txtObj = appPolicy.default2 || {txt1:"txt1",txt2:"txt2",txt3:"txt3",txt4:"txt4"};
                    [...document.querySelectorAll("#d2-txts input")]
                    .forEach(inp=>{
                        inp.value = txtObj[inp.dataset.col];
                    });
                    showOrHideDiv({target:file==="default2" ? option2 : option1});
                }
                else
                    showToastNotification("Preview generation failed, try agin later",["animation-common","move-left","red-toast-box"])
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
                ["biller","address","gst","phones","abbr","placeOfJurisdiction",{bankDetails:["name","branch","acc-no","ifsc"]},"email","website"]
                .forEach(async key=>{
                    let input;
                    if(typeof key!=="object"){
                        input = form.querySelector(`input[name="${key}"]`);
                        if(!input) return;
                        let text = key!=="phones" ? compInfo?.[key] : "";
                        if(key==="placeOfJurisdiction" && !compInfo?.[key]){
                            let address = compInfo?.address ?? "";
                            if(address!=="")
                                text = await ipcRenderer.invoke("get-place-of-jurisdiction",address);
                        }
                        else
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
                    else
                    if(feild.nodeName==="INPUT" && key==="useWeatherTheme" && appPolicy.useWeatherTheme)
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
            else
            if(cmd==="general"){
                let settings = await ipcRenderer.invoke("get-general-app-settings");
                ({ useFuzzySearch, pin="", port="", includeCustomerSelector, productLayout, dbMode, generateReceipt } = settings);
                if(useFuzzySearch)
                    form.useFuzzySearch.setAttribute("checked",useFuzzySearch);
                form.pin.value = pin;
                form.port.value = port;
                if (includeCustomerSelector !== undefined)
                    form.includeCustomerSelector.value = String(includeCustomerSelector);
                if (productLayout)
                    form.productLayout.value = productLayout;
                if (dbMode)
                    form.dbMode.value = dbMode;
                if (generateReceipt)
                    form.generateReceipt.setAttribute("checked", generateReceipt);
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
    let form = e.target.closest("Form");
    let imgURL = e.target.dataset?.img || e.target.options[e.target.selectedIndex].dataset.img;
    let selectedOption = e.target.value;
    [...document.querySelectorAll(".img-div")]
    .forEach(div=>{
        div.classList.add("hide");
    });
    if(imgURL){
        document.getElementById(`${selectedOption}-template-preview`).classList.remove("hide");
    }
    [...document.querySelectorAll(".hiden-divs")].forEach(elem=>elem.classList.add("hide"));
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
    let form = e.target;
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
        let txtObj = {};
        if(data.file==="default2"){
            txtObj = {
                txt1:data["d2-txt1"],
                txt2:data["d2-txt2"],
                txt3:data["d2-txt3"],
                txt4:data["d2-txt4"],
            }
            delete data["d2-txt1"];
            delete data["d2-txt2"];
            delete data["d2-txt3"];
            delete data["d2-txt4"];
        }
        ipcRenderer.send("company-profile-info",{billTemplate:data},txtObj);
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
        data.useWeatherTheme = e.target.querySelector(`input[name="useWeatherTheme"]`).checked;
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
    else
    if(cmd==="general"){
        let useFuzzySearch = form.useFuzzySearch.checked;
        ({ pin=1234, port=3030, includeCustomerSelector="true", productLayout="uncategorized", dbMode="order-only" } = data);
        pin = Number(pin);
        port = Number(port);
        let generateReceipt = form.generateReceipt.checked;
        let kioskSetting = {
            pin,
            port,
            includeCustomerSelector: includeCustomerSelector === "true",
            productLayout,
            dbMode,
            generateReceipt
        };
        ipcRenderer.send("general-app-settings",{useFuzzySearch},kioskSetting);
        showToastNotification("General App Settings saved.",["animation-common","move-left","blue-toast-box"],"main");
    }
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

ipcRenderer.on("show-update-prompt", function(event, data) {
    showUpdatePrompt(data);
});

// ---- Beta Program prompt ----

ipcRenderer.on("show-beta-prompt", function() {
    showBetaPrompt();
});

ipcRenderer.on("beta-prompt-result", function(e, result) {
    showBetaPromptResult(result || {});
});

/** In-page modal asking the user to join the Beta Program. Built with
 *  createModal + the #beta-prompt-template clone (see product-info-fillup-modal). */
function showBetaPrompt(){
    if(document.getElementById("beta-program-modal")) return; // already open
    let modal = createModal("beta-program-modal");
    let content = appendToHost("#beta-prompt-template", modal, "div");
    content.querySelector("#bp-btn-join").addEventListener("click", function(){
        content.querySelector("#bp-btn-join").disabled = true;
        content.querySelector("#bp-btn-later").disabled = true;
        let err = content.querySelector("#bp-error");
        err.textContent = "";
        err.classList.add("hide");
        ipcRenderer.send("beta-prompt-response", {action:"join"});
    });
    content.querySelector("#bp-btn-later").addEventListener("click", function(){
        let dontAskAgain = content.querySelector("#bp-dont-ask-again").checked;
        ipcRenderer.send("beta-prompt-response", {action:"cancel", dontAskAgain});
        closeModal();
    });
}

/** Handle the main-process reply to "join" (beta-register call). */
function showBetaPromptResult({ok=false, error=""}={}){
    let modal = document.getElementById("beta-program-modal");
    if(!modal) return;
    let content = modal.querySelector(".beta-prompt-content");
    let joinBtn = content.querySelector("#bp-btn-join");
    let laterBtn = content.querySelector("#bp-btn-later");
    if(!ok){
        joinBtn.disabled = false;
        laterBtn.disabled = false;
        let err = content.querySelector("#bp-error");
        err.textContent = error || "Something went wrong. Please try again.";
        err.classList.remove("hide");
        return;
    }
    content.innerHTML = `
        <div class="bp-success">
            <i class="fa-solid fa-circle-check"></i>
            <h2>You're in! Welcome to the Beta Program.</h2>
            <p>You now get early access to new updates and cheaper API pricing once billing starts.</p>
            <button type="button" class="main-ui-btn" id="bp-btn-close" tabindex="0">Close</button>
        </div>
    `;
    content.querySelector("#bp-btn-close").addEventListener("click", closeModal);
}

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

document.addEventListener("click",(e)=>{
    if(e.target.classList.contains("drop-down-btn")) return;
    document.querySelector(".drop-down")?.classList.add("hide");
    if(e.target.dataset.cmd==="call-scheduler")
        document.querySelector('#nav-div [data-cmd="scheduler"]').click();
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
    // The old event-modal was folded into the Scheduler page
    document.querySelector('#nav-div [data-cmd="scheduler"]').click();
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

// F6 / Tools menu → open the Scheduler page
ipcRenderer.on("open-scheduler-page",()=>{
    document.querySelector('#nav-div [data-cmd="scheduler"]').click();
});

ipcRenderer.on("notification",(e,notifyJobs,showToast=false)=>{
    // The notification panel lives on the Overview dashboard; when the user
    // is on another page (e.g. Scheduler) the host does not exist.
    let notificationHost = document.getElementById("notification-div");
    if(!notificationHost) return;
    removeAllElem(".notification-group");
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
            if(job.type==="mail"){
                description = `Email due: ${(job.billObj && job.billObj.name) || job.label} Bill No ${(job.billObj && job.billObj.billNo) || ""} — sending the bill PDF to ${(job.mail && job.mail.to) || "the customer's email on record"}.`;
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
    if(window.refreshSchedulerWidget)
        window.refreshSchedulerWidget();
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

ipcRenderer.on("remove-progressbar",()=>{
    removeAllElem("#progressbar")
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
    if(!selectedRow || currentMode!=="overview") return;
    selectedRow.remove();
});

ipcRenderer.on("msg-from-backend",(e,msg,type)=>{
    let classList = ["animation-common","move-left","blue-toast-box"];
    if(type==="error")
        classList = ["animation-common","move-left","red-toast-box"];
    showToastNotification(msg,classList)
});

async function assignPlaceOfJurisdiction(event){
    let address = event.target.value;
    let placeOfJurisdiction = await ipcRenderer.invoke("get-place-of-jurisdiction",address);
    document.getElementById("placeOfJurisdiction").value = placeOfJurisdiction;
}

function previewImage(e){
    let img = e.target.dataset.img || e.target.src;
    let modal = createModal("image-previewer");
    modal.innerHTML = `
        <img src="${img}" />
    `;
    document.querySelector(".cover").addEventListener("click",closeModal);
    document.querySelector(".cover").innerHTML = `
        <h2>Click to close</h2>
    `;

}

function debounceFn(){
    let timer;
    return function(){
        if(timer)
            clearTimeout(timer);
        timer = setTimeout(async ()=>{
            let txtObj = [...document.querySelectorAll("#d2-txts input")].reduce((acc,inp)=>{
                return {
                    ...acc,
                    [inp.dataset.col]:inp.value
                }
            },{});
            let imgURL = await ipcRenderer.invoke("generate-selected-template-preview",2,txtObj);
            document.querySelector("#default2-template-preview img").src = imgURL;
            document.querySelector("#default2-template-preview button").dataset.img = imgURL;
        },1000);
    }
}

const generatePreview = debounceFn();