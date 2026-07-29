const { ipcRenderer } = require("electron");

let eventName;

function generateHTML(parentElem,elemObj){
    let elem = document.createElement(elemObj.elem);
    parentElem.appendChild(elem);
    if("classList" in elemObj)
        elemObj.classList.forEach(className=>elem.classList.add(className));
    if("attrs" in elemObj)
        elemObj.attrs.forEach(({key,value})=>elem.setAttribute(key,value));
    if("innerHTML" in elemObj)
        elem.innerHTML = elemObj.innerHTML;
    if("textContent" in elemObj)
        elem.textContent = elemObj.textContent;
    if("children" in elemObj)
        elemObj.children.forEach(elemObj=>generateHTML(elem,elemObj));
    if("styles" in elemObj)
        Object.keys(elemObj.styles)
        .forEach(propKey=>elem.style[propKey]=elemObj.styles[propKey]);
}
ipcRenderer.on("init-page",(e,_eventName,payload)=>{
    eventName = _eventName;
    Object.entries(require("../js/common"))
    .forEach(([name,exported])=>window[name]=exported);

    // Clone template BEFORE clearing body (removeAllElem deletes <template> tags too)
    let tmplContent = null, tmplData = null;
    if(payload && payload.template){
        let tmpl = document.getElementById(payload.template);
        if(tmpl){
            tmplContent = tmpl.content.cloneNode(true);
            tmplData = payload.data;
        }
    }

    window["removeAllElem"]("body *");

    if(tmplContent){
        document.body.appendChild(tmplContent);
        if(tmplData){
            Object.entries(tmplData).forEach(([key,val])=>{
                document.querySelectorAll(`[data-bind="${key}"]`).forEach(el=>{
                    el.textContent = val != null ? String(val) : "";
                });
            });
        }
    } else {
        // Legacy: array of element objects
        payload.forEach(elemObj=>generateHTML(document.body,elemObj));
    }
});

function submitHandler(e){
    e.preventDefault();
    window["removeAllElem"]("div.hide");
    let data = Object.fromEntries(new FormData(e.target).entries());
    ipcRenderer.send(`${eventName}-response`,data);
}