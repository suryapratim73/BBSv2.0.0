const { ipcRenderer } = require("electron");
const { toggleDevTool, drawSpinner, retractHandler, removeAllElem, drawLineGraph, dataModal, showToastNotification, closeToast, validateInput, validateInput2, errorFormatter, capitalize } = require("../js/common");



let currentMode = "overview",timer,reducedBills = [],reducedPurchases = [];
let mode = 1,loggedinUser;

toggleDevTool(document);

async function initPage(){
    let spinner = drawSpinner(document);
    document.querySelector(`#nav-div [data-cmd='${currentMode}']`).classList.add("selected");
    await applyMode();
    let userListDL = document.getElementById("user-list");
    (await ipcRenderer.invoke("get-users"))
    .forEach(user=>{
        let option = document.createElement("option");
        option.textContent = user.name;
        option.dataset.id = user.id;
        option.dataset.name = user.name;
        userListDL.appendChild(option);
    });
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
    let {stocks,unPaidBills} = await ipcRenderer.invoke("get-overview-content");
    let [dt,mnth,yr] = new Date().toLocaleDateString("en-GB",{dateStyle:"long"}).split(" ");
    let dtEventDiv = document.querySelector("#scheduler-div .event-div>#dt-div");
    dtEventDiv.querySelector("h1").textContent = dt;
    dtEventDiv.querySelector("p").textContent = `${mnth}, ${yr}`;
    let billTbody = document.querySelector("#expired-bill-table-div .tbody");
    unPaidBills.forEach(billObj=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${billObj.billNo}</p>
            <p class="col eq-space">${billObj.billDate.toLocaleDateString('en-GB')}</p>
            <p class="col eq-space">${billObj.name}</p>
            <p class="col eq-space">${billObj.billAmt}</p>
        `;
        billTbody.appendChild(div);
        
    });
    let stockTbody = document.querySelector("#stock-div .tbody");
    stocks.forEach(stock=>{
        let div = document.createElement("div");
        div.className = "body row";
        div.innerHTML = `
            <p class="col eq-space">${stock.name}</p>
            <p class="col eq-space">${stock.quantity}</p>
        `;
        stockTbody.appendChild(div);
    });
}

async function salePaageInit(){
    let {bills,allBills} = await ipcRenderer.invoke("get-sale-content");
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
    let allPurchases = await ipcRenderer.invoke("get-purchase-content");
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
    document.querySelector("#main-div>div:first-child").appendChild(modeContent);
    [...document.querySelectorAll(".settings-div>p")]
    .forEach(p=>{
        if(p.classList.contains(loggedinUser.role))
            p.classList.add("hide");
        else
            p.classList.remove("hide");
    })
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
    if(!document.getElementById(`${currentMode}-div`)){
        modeContent = document.getElementById(`${currentMode}-page-template`).content.cloneNode(true).querySelector("div");
        if(["overview","sale","purchase"].includes(currentMode))
            document.getElementById("mode-host").appendChild(modeContent);
        if(!modeContent) return;
        if(currentMode==="overview")
            await overviewPageInit();
        else
        if(currentMode==="sale")
            await salePaageInit();
        else
        if(currentMode==="purchase")
            await purchasePageInit();
        else
        if(currentMode==="settings")
            await settingsPageInit(modeContent);
    }
    else{
        modeContent = document.getElementById(`${currentMode}-div`);
        modeContent.classList.remove("hide");
        correctChart();
    }
}

function expandOrCollapsePanel(){
    retractHandler(document.getElementById("panel"),"width","0","40","vw");
    document.getElementById("knob").classList.toggle("switch-arrow");
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
    })
}

async function showForm(e,cmd,show){
    if(e){
        cmd = e.target.dataset.cmd;
        show = e.target.dataset.show;
    }
    if(!cmd) return;
    if(e && e.target.nodeName==="FORM" && e.type!=="submit") return console.log("Form");
    let appSettingsDiv = document.getElementById("app-settings");
    if(cmd!=="back"){
        if(cmd==="enable-2-factor"){
            let id = document.getElementById("name").dataset.id;
            let dataURL = await ipcRenderer.invoke("generate-secret",id);
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
        else{ // Settings with presets
            let form = document.getElementById(`${cmd}-template`).content.cloneNode(true).querySelector("form");
            e.target.parentNode.classList.add("hide");
            appSettingsDiv.appendChild(form);
            form.querySelector("input")?.focus();
            if(cmd==="session-management"){
                try{
                    let cookies = await ipcRenderer.invoke("check-session-info");
                    if(cookies.length>0){
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
            if(cmd==="lock-screen"){
                let cookies = await ipcRenderer.invoke("check-session-info");
                if(cookies.length>0){
                    loggedinUser.usePasswd = JSON.parse(cookies[0].value).usePasswd;
                    [...document.querySelectorAll("#usePasswd>option")]
                    .forEach(option=>{
                        if(JSON.parse(option.value)==loggedinUser.usePasswd)
                            option.setAttribute("selected","selected");
                        else
                            option.removeAttribute("selected");
                    });
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
}

async function saveSettings(e){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    let {cmd,show} = e.target.dataset;
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
    if(cmd==="set-2-factor-auth")
        showToastNotification("2-Factor Authentication enabled.",["animation-common","move-left","blue-toast-box"],"main");
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
    showForm(null,"back",show);
}

async function chooseFile(e){
    let input = e.target.previousSibling.previousSibling;
    let selectionObj = await ipcRenderer.invoke("get-image-path");
    if(!selectionObj.canceled)
        input.value = selectionObj.filePaths[0];
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