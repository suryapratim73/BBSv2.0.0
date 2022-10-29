const { toggleDevTool,validateInput,validateInput2, removeAllElem,drawTimer,applyTheme } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);


ipcRenderer.invoke("get-policy")
.then(policyObj=>{
    if("wallpaper" in policyObj && policyObj.wallpaper!=="")
        document.body.style.backgroundImage =  `url('${policyObj.wallpaper}')`;
    else
        document.body.style.backgroundImage =  `url("../../images/default-wallpaper.jpg")`;
});
// ipcRenderer.invoke("init-theme").then(applyTheme.bind(document,null)).finally(()=>{
// });

// ipcRenderer.on("apply-theme",applyTheme.bind(document));


async function unlockHandler(e,mode){
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target).entries());
    if(!("lock" in window) || ("lock" in window && window.lock===false)){
        if(mode===1){
            try{
                let retNum = await ipcRenderer.invoke("unlock-app", data);
                if(retNum===0)
                    ipcRenderer.send("load-lander-page");
                else
                if(retNum===1){
                    e.target.classList.add("hide");
                    let form2 = document.getElementById("six-digit-code-form-template").content.cloneNode(true).querySelector("form");
                    document.body.appendChild(form2);
                    form2.querySelector("input").focus();
                    let timerCanv = form2.querySelector("#timer");
                    let { width } = form2.getBoundingClientRect();
                    width *= 0.75;
                    timerCanv.width = width;
                    timerCanv.height = width;
                    let ctx = timerCanv.getContext("2d");
                    drawTimer(ctx,width,drawTimer);
                }
                else
                    alert("Incorrect password!!")
            }
            catch(err){
                alert(err);
            }
        }
        else{
            document.getElementById("code").value = "";
            document.getElementById("code").focus();
            if(data.code.length<6)
                return alert("code has to be 6 digit");
            try{
                let res = await ipcRenderer.invoke("verify-code",data); 
                if(res)
                    ipcRenderer.send("load-lander-page");
                else
                    return alert("code don't match");
            }
            catch(err){
                return alert(err);
            }
        }
    }
    else
    if("lock" in window && window.lock===true){
        data.name = window.currentUser.name;
        try{
            let retNum = await ipcRenderer.invoke("unlock-app", data);
            if(retNum>=0){
                e.target.querySelector("#name").removeAttribute("disabled");
                ipcRenderer.send("load-lander-page");
            }
            else
                alert("Incorrect password!!")
        }
        catch(err){
            alert(err);
        }
    }
}

function _validateInput2(e){
    if(e.target.value.length>5)
        e.preventDefault();
    return validateInput2(e);
}

ipcRenderer.on("lock",(e,currentUser)=>{
    window.currentUser = currentUser;
    window.lock = true;
    document.querySelector("form").classList.add("hide");
    removeAllElem("#lock-div");
    document.body.appendChild(document.getElementById("lock-div-template").content.cloneNode(true));
});

function lockHandler(e){
    removeAllElem("#lock-div");
    if(window.currentUser.usePasswd){
        document.querySelector("form").classList.remove("hide");
        document.querySelector("form").querySelector("#name").value = window.currentUser.name;
        document.querySelector("form").querySelector("#name").setAttribute("disabled","disabled");
        document.querySelector("form").querySelector("#passwd").focus();
    }
    else
        ipcRenderer.send('unlock')
}

ipcRenderer.on("use-lock",()=>{
    if("lock" in window && window.lock===true)
        window.lock = false;
});