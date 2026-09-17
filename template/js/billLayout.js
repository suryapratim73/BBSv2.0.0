const { ipcRenderer } = require("electron");
const { toggleDevTool,validateInput,validateInput2, removeAllElem,throttle, applyTheme, getAppPolicyPath, roundOffTo2DecimalPlace } = require("../js/common");
const { Section, Field, Page, buildStarter, mainSectionBand } = require("../../lib/billElementClasses");
const { VARIABLE_GROUPS, ALL_VARIABLE_KEYS } = require("../../lib/billVariableRegistry");
const fs = require("fs");
const uuid = require("uuid");

// console.log({remote})
const appDefault = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
toggleDevTool(document);

let mainDiv = document.querySelector("main"),selectedElem;
let observer = new ResizeObserver(resizeNote);
let deleteBTNDiv = document.getElementById("delete-btn-div");
let page = {};
let advOptionDiv = document.getElementById("adv-options");
let lastFocus,borderCanvas,actPointer = {};
let selectedBTN,moveFlag = true,shallResize = false,selectedCTRLDot;
let helperLineTimer,alignmentLineCSSTimer;
let columnObj = {},feildObj = {}, partitionObj = {}, focusTimer;
let midGuideTimer,zoomFactor = 1;
// Undo/redo history — snapshots of the page as pure legacy JSON.
// dragSnap: pre-session snapshot; historySession() commits it on a
// session's first mutation (drag / resize / nudge / slider drag).
let undoStack = [], redoStack = [], dragSnap = null;
const HISTORY_CAP = 100;

function initPageObj(){
    return new Page().toJSON();
}

function init(){
    ipcRenderer.send("set-app-status","block-non-sp-key");
    page = initPageObj();
    undoStack = []; redoStack = []; dragSnap = null; // fresh document — fresh history
    let {width,height} = appDefault[page.size];
    mainDiv.style.width = width + "px";
    mainDiv.style.height = height + "px";
    removeAllElem(".new-elem,canvas,.selector,#adv-options *,#adv-options-2 *");
    [...document.querySelectorAll(".selected-btn")]
    .forEach(btn=>btn.classList.remove("selected-btn"));
    let pageOpts = document.getElementById("page-option-template").content.cloneNode(true).querySelector("div");
    advOptionDiv.appendChild(pageOpts);
    document.querySelector(".ctrl-btns[data-cmd='page']").classList.add("selected-btn");
    // Adding some keyboard listeners
    if(mainDiv.getAttribute("keyboard-listeners")!=="true"){
        document.addEventListener("keydown",keydownListener);
        mainDiv.setAttribute("keyboard-listeners","true");
    }
    if(mainDiv.getAttribute("mouseup-listener")!=="true"){
        mainDiv.setAttribute("mouseup-listener","true");
        document.addEventListener("mouseup",mouseUpOnDocHelper);
        document.addEventListener("keyup",mouseUpOnDocHelper);
        document.addEventListener("dblclick",dblClickHandler);
    }
    borderCanvas = document.createElement("canvas");
    let { width:width_mainDiv,height:height_mainDiv } = mainDiv.getBoundingClientRect();
    borderCanvas.width = width_mainDiv;
    borderCanvas.height = height_mainDiv;
    mainDiv.appendChild(borderCanvas);
    document.addEventListener("mouseover",e=>{
        let { target } = e;
        if(["I","P","LABEL"].includes(target.nodeName)){
            if(target.nodeName==="I"){
                target.style.position = "relative";
                document.documentElement.style.setProperty("--top_range",-300+"%");
            }
            else{
                target.parentNode.style.position = "relative";
                // document.documentElement.style.setProperty("--top_range",-200+"%");
            }
            let { left } = target.getBoundingClientRect();
            document.documentElement.style.setProperty("--left_range",e.x - left+"%");
            document.documentElement.style.setProperty("--popup-width","fit-content");
            if(!target.dataset.msg && target.type!=="range")
                document.documentElement.style.setProperty("--display","none");
            else
                document.documentElement.style.setProperty("--display","flex");
        }
        else
        if(target.nodeName==="INPUT")
            document.documentElement.style.setProperty("--display",`flex`);
    });
    ipcRenderer.invoke("init-theme");
}
init();

ipcRenderer.on("apply-theme",applyTheme.bind(document));

function dblClickHandler(e){
    let { x,y } = e;
    if(selectedElem && selectedElem.classList.contains("feild-elem")) 
        return selectFeildCanv();
    let elem = [...document.elementsFromPoint(x,y)].filter(elem=>elem.classList.contains("new-elem")).reverse().pop();
    if(elem===selectedElem) return selectColumn(e);
    if(!["new-elem","selector","coordinate-marker"].some(key=>new RegExp(key).test(e.target.className))) return;
    removeSelector();
    selectedElem = elem;
    let selector = createSelector(1);
    blockOnFocus();
    showSelectorMarker(selector);
}

function mouseUpOnDocHelper(){
    moveFlag = true;
    shallResize = false;
    dragSnap = null; // session ended; its history entry stays committed
}

function pageDims(){
    let { width, height } = appDefault[page.size] || appDefault.a4;
    return [width, height];
}

function createSection(mode=1, role){
    // Header/Body/Footer arrive at their canonical band (full page width at
    // the top/middle/bottom); a generic section keeps the legacy 160×160
    // CSS-centered slot.
    let band = role ? mainSectionBand(role, ...pageDims()) : null;
    let section = new Section({
        ...(band || { width: actPointer?.width || 160, height: actPointer?.height || 160 }),
        role,
        name: role,
        applyBorder: true,
        border: 1,
    }).draw(mainDiv, page, band ? zoomFactor : 1);
    if(!band){
        // The class leaves a brand-new section in the CSS-centered slot; freeze
        // that position into logical (1px = 1pt) coordinates like legacy did.
        let { left:left_mainDiv,top:top_mainDiv } = mainDiv.getBoundingClientRect();
        let { left,top } = section.getBoundingClientRect();
        section.style.left = (left - left_mainDiv)/zoomFactor + "px";
        section.dataset.left = (left - left_mainDiv)/zoomFactor;
        section.style.top = (top - top_mainDiv)/zoomFactor + "px";
        section.dataset.top = (top - top_mainDiv)/zoomFactor;
    }
    if(mode===1){
        page.sections.push({id:section.dataset.id,elem:section});
        actPointer = page.sections.find(obj=>obj.id===section.dataset.id);
    }
    actPointer.id = section.dataset.id;
    return section;
}

/**
 * Promote the selected section to a main role (head/body/footer): the legacy
 * model bookkeeping, plus the canonical band geometry — a Header is a
 * full-width band at the top of the page, never the small new-section slot.
 */
function assignSectionRole(role){
    let band = mainSectionBand(role, ...pageDims());
    if(!band) return;
    Object.assign(actPointer, band, {
        role,
        name: role,
        applyBorder: actPointer.applyBorder ?? true,
        border: actPointer.border ?? 1,
        parentNode: mainDiv,
    });
    document.getElementById("section-name").value = role;
    document.getElementById("section-name").setAttribute("disabled",true);
    Object.keys(actPointer)
    .forEach(key=>{
        page[role][key] = actPointer[key];
    });
    page.sections = page.sections.filter(obj=>obj.id!==actPointer.id);
    // Re-fit the on-page canvas to the band (resetting a canvas clears it,
    // so border/partitions/table are redrawn from the model afterwards).
    let { x, y, width, height } = actPointer;
    selectedElem.width = width;
    selectedElem.height = height;
    selectedElem.style.width = width * zoomFactor + "px";
    selectedElem.style.height = height * zoomFactor + "px";
    selectedElem.style.left = x * zoomFactor + "px";
    selectedElem.style.top = y * zoomFactor + "px";
    selectedElem.dataset.left = x;
    selectedElem.dataset.top = y;
    selectedElem.dataset.width_100 = width;
    selectedElem.dataset.height_100 = height;
    selectedElem.dataset.aspectRatio = Math.round((width / height) * 100) / 100;
    redrawSectionCanvas();
    selectorPosHelper();
}

function selectorPosHelper(){
    if(!selectedElem)
        selectedElem = document.querySelector(".new-elem");
    let { width,height,top,left } = selectedElem.getBoundingClientRect();
    let { top:top_mainDiv,left:left_mainDiv } = mainDiv.getBoundingClientRect();
    let selector = document.getElementById("selector") || createSelector();
    selector.style.top = top - top_mainDiv - 20 + "px";
    selector.style.left = left - left_mainDiv - 20 + "px";
    selector.style.width = width + 40 + "px";
    selector.style.height = height + 40 + "px";
    selectedElem.parentNode.appendChild(selector);
    showSelectorMarker(selector);
}

function updateUI(){ 
    if(selectedElem)
        deleteBTNDiv.classList.remove("hide");
    else
        deleteBTNDiv.classList.add("hide");
    let { selection } = showSelectorMarker(document.getElementById("selector"));
    selection = typeof selection === "object" && selection.pop();
    let { cmd } = selectedBTN?.dataset || {};
    if(selection && "role" in selection && cmd==="section"){
        [...advOptionDiv.querySelectorAll('select[data-cmd="section"]>option')]
        .forEach(option=>{
            if(option.value===selection.role)
                option.setAttribute("selected",true);
            else
                option.removeAttribute("selected");
        });
        advOptionDiv.querySelector("#section-name").value = selection.name;
        if(["head","body","footer"].includes(selection.role))
            ['select[data-cmd="section"]',"#section-name"]
            .forEach(selector=>{
                advOptionDiv.querySelector(selector).setAttribute("disabled",true);
            });
    }
}

function mouseoverListenerOnCTRLPts(e){
    if(this.getAttribute("mousedown-listener")!=="true"){
        this.addEventListener("mousedown",mousedownListenerOnCTRLPts);
        this.setAttribute("mousedown-listener","true");
    }
}

function mousedownListenerOnCTRLPts(e){
    let { x:initX,y:initY } = e;
    this.dataset.initX = initX;
    this.dataset.initY = initY;
    shallResize = true;
    selectedCTRLDot =this;
}

function drawAdjPoints(){
    removeAllElem(".adj-pts");
    let selector = document.getElementById("selector");
    if(!selector) return;
    if(selectedElem.classList.contains("feild-elem")) return;
    let selectorPosObj = selector.getBoundingClientRect();
    [
        {top:"height",left:"width",factor1:0,factor2:0.5,tag:"top"},
        {top:"height",left:"width",factor1:0.5,factor2:1,tag:"right"},
        {top:"height",left:"width",factor1:1,factor2:0.5,tag:"bottom"},
        {top:"height",left:"width",factor1:0.5,factor2:0,tag:"left"},
    ]
    .forEach(({top,left,factor1,factor2,tag})=>{
        let ptCanv = document.createElement("canvas");
        selector.appendChild(ptCanv);
        ptCanv.width = 10;
        ptCanv.height = 10;
        ptCanv.className = "adj-pts";
        ptCanv.style.top = selectorPosObj[top]*factor1 + "px";
        ptCanv.style.left = selectorPosObj[left]*factor2 + "px";
        ptCanv.style.transform = "translate(-50%,-50%)";
        ptCanv.dataset.tag = tag;
        let ctx = ptCanv.getContext("2d");
        ctx.fillStyle = "red";
        ctx.arc(ptCanv.width/2,ptCanv.width/2,ptCanv.width/2,0,2*Math.PI,false);
        ctx.fill();
    });
}

function keydownListener(e){
    let selector = document.getElementById("selector");
    let { left:left_mainDiv,top:top_mainDiv,width:width_mainDiv,height:height_mainDiv } = mainDiv.getBoundingClientRect();
    let { code,ctrlKey,shiftKey } = e;
    if(ctrlKey && !shiftKey && code==="KeyZ"){
        e.preventDefault();
        return undo();
    }
    if((ctrlKey && shiftKey && code==="KeyZ") || (ctrlKey && code==="KeyY")){
        e.preventDefault();
        return redo();
    }
    if(code==="Escape" && dragSnap!==null){
        e.preventDefault();
        return cancelDrag();
    }
    if((ctrlKey && shiftKey && code==="Equal") || (ctrlKey && code==="NumpadAdd"))
        zoomFunc(width_mainDiv,height_mainDiv);
    if((ctrlKey && shiftKey && code==="Minus") || (ctrlKey && code==="NumpadSubtract"))
        zoomFunc(width_mainDiv,height_mainDiv,false);
    if(ctrlKey && code==="KeyN"){
        pushHistory();
        document.getElementById("blanck-header").classList.add("hide");
        selectedElem = createSection();
    }
    if(!selector) return;
    let { width:selectorWidth,height:selectorHeight } = selector.getBoundingClientRect();
    let { left,top } = selectedElem.getBoundingClientRect();
    let diffX = left - left_mainDiv, diffY = top - top_mainDiv;
    if(code==="ArrowRight")
        diffX++;
    else
    if(code==="ArrowLeft")
        diffX--;
    else
    if(code==="ArrowUp")
        diffY--;
    else
    if(code==="ArrowDown")
        diffY++;
    else
    if(!shiftKey && ctrlKey && code==="NumpadAdd" && checkConstraints(selectorWidth + 1,selectorHeight))
        selector.style.width = selectorWidth + 1 + "px";
    else
    if(!shiftKey && ctrlKey && code==="NumpadSubtract" && checkConstraints(selectorWidth - 1,selectorHeight))
        selector.style.width = selectorWidth - 1 + "px";
    else
    if(shiftKey && ctrlKey && code==="NumpadAdd" && checkConstraints(selectorWidth,selectorHeight + 1))
        selector.style.height = selectorHeight + 1 + "px";
    else
    if(shiftKey && ctrlKey && code==="NumpadSubtract" && checkConstraints(selectorWidth,selectorHeight - 1))
        selector.style.height = selectorHeight - 1 + "px";
    if(["ArrowRight","ArrowLeft","ArrowUp","ArrowDown","NumpadAdd","NumpadSubtract"].includes(code)){
        historySession();
        e.preventDefault();
    }
    if(["ArrowRight","ArrowLeft","ArrowUp","ArrowDown"].includes(code)){
        moveElemHelper(diffX,diffY);
        drawFeilds(diffX,diffY);
    }
    drawAdjPoints();
}

function zoomFunc(width_mainDiv,height_mainDiv,zoomIn=true){
    // Over and under zoom guard
    if(zoomFactor>1.4 && zoomIn===true){
        zoomFactor = 1.5;
        return;
    }
    if(zoomFactor<=0.5 && zoomIn===false){
        zoomFactor = 0.5;
        return;
    }
    if(zoomIn) zoomFactor += 0.1;
    else zoomFactor -= 0.1;
    zoomFactor *= 100;
    zoomFactor = Math.round(zoomFactor)/100;
    let zoomLabel = document.getElementById("zoom-label");
    if(zoomLabel)
        zoomLabel.textContent = Math.round(zoomFactor*100) + "%";
    let { width,height } = zoomHelper(mainDiv,width_mainDiv,height_mainDiv,zoomFactor);
    borderCanvas.width = width;
    borderCanvas.height = height;
    let { left,top } = mainDiv.getBoundingClientRect();
    left_mainDiv = left;
    top_mainDiv = top;
    width_mainDiv = width;
    height_mainDiv = height;
    let span = document.createElement("span");
    span.classList = "floating-toast";
    span.textContent = `Zoom ${zoomFactor}x`;
    mainDiv.parentNode.appendChild(span);
    setTimeout(function(){
        this.clearTimeout();
        span.remove();
    },2000);
    let elems = [...mainDiv.querySelectorAll("*")].filter(elem=>elem.classList.contains("new-elem"));
    elems.forEach(elem=>{
        let { height,width } = elem.getBoundingClientRect();
        zoomHelper(elem,width,height,zoomFactor);
        let initLeft = Number(elem.dataset.left);
        let initTop = Number(elem.dataset.top);
        elem.style.left = initLeft*zoomFactor + "px";
        elem.style.top = initTop*zoomFactor + "px";
    });
    if(!selectedElem) return;
    removeSelector();
    selectorPosHelper();
}

function zoomHelper(elem,width,height,zoomFactor){
    let _width,_height,aspectRatio;
    if(!("width_100" in elem.dataset)){
        elem.dataset["width_100"] = width;
        elem.dataset["height_100"] = height;
    }
    if(!("aspectRatio" in elem.dataset)){
        aspectRatio = Math.round((width/height)*100)/100;
        elem.dataset.aspectRatio = aspectRatio;
    }
    else
        aspectRatio = Number(elem.dataset.aspectRatio);
    if(!(`width_${Math.round(zoomFactor*100)}` in elem.dataset)){
        _width = roundOffTo2DecimalPlace(zoomFactor * aspectRatio * Number(elem.dataset["height_100"]));
        _height = roundOffTo2DecimalPlace(zoomFactor * (Number(elem.dataset["width_100"])/aspectRatio));
        elem.dataset[`width_${Math.round(zoomFactor*100)}`] = _width;
        elem.dataset[`height_${Math.round(zoomFactor*100)}`] = _height;
    }
    else{
        _width = Number(elem.dataset[`width_${Math.round(zoomFactor*100)}`]);
        _height = Number(elem.dataset[`height_${Math.round(zoomFactor*100)}`]);
    }
    elem.style.width = _width + "px";
    elem.style.height = _height + "px";
    return { 
        width:_width,
        height:_height,
        aspectRatio,
        delX:(zoomFactor - 1) * aspectRatio * Number(elem.dataset["height_100"]),
        delY:(zoomFactor - 1) * (Number(elem.dataset["width_100"])/aspectRatio)
    };
}

function drawAssist(e){// Work in progress- draw x,y coordinate of mouse, resize points
    if(selectedElem && selectedElem.classList.contains("feild-elem")) return;
    let { x,y,target:selector } = e instanceof MouseEvent ? e : {};
    if(!selector)
        selector = this.elem;
    if(selector.nodeName!=="DIV")
        selector = document.getElementById("selector");
    if(e instanceof MouseEvent){
        let selectorPosObj = selector.getBoundingClientRect();
        // Crosswire
        let coordinateMarker = document.getElementById("coordinate-marker");
        if(!coordinateMarker){
            coordinateMarker = document.createElement("canvas");
            selector.appendChild(coordinateMarker);
            coordinateMarker.width = 20;
            coordinateMarker.height = 20;
            coordinateMarker.id = "coordinate-marker";
            coordinateMarker.className = "coordinate-marker";
            coordinateMarker.style.zIndex = 10;
        }
        coordinateMarker.style.top = y - selectorPosObj.top + "px";
        coordinateMarker.style.left = x - selectorPosObj.left + "px";
        let ctx = coordinateMarker.getContext("2d");
        ctx.clearRect(0,0,coordinateMarker.width,coordinateMarker.height);
        ctx.moveTo(coordinateMarker.width/2,0);
        ctx.setLineDash([2,2])
        ctx.lineTo(coordinateMarker.width/2,coordinateMarker.height);
        ctx.moveTo(0,coordinateMarker.height/2);
        ctx.lineTo(coordinateMarker.width,coordinateMarker.height/2);
        ctx.stroke();
        // Adjustment points on selector
        drawAdjPoints();
        [...document.querySelectorAll(".adj-pts")]
        .forEach(ptCanv=>{
            if(ptCanv.getAttribute("mouseover-listener")!=="true"){
                ptCanv.setAttribute("mouseover-listener","true");
                ptCanv.addEventListener("mouseover",mouseoverListenerOnCTRLPts);
            }
        });
    }
}

function computeContraints(){
    if(!actPointer || Object.keys(actPointer).length===0) return {};
    let widthConstraints = 0, heightConstraints = 0;
    if(["head","body","footer"].includes(actPointer.role) || actPointer.parentNode===mainDiv){
        if(page.applyBorder){
            widthConstraints += page.border;
            heightConstraints += page.border;
        }
        if(page.applyMargin && typeof page.margin==="object"){
            widthConstraints += page.margin.left + page.margin.right;
            helperLineTimer += page.margin.top + page.margin.bottom;
        }
        else
        if(page.applyMargin && typeof page.margin==="number"){
            widthConstraints += 2*page.margin;
            heightConstraints += 2*page.margin;
        }
    }
    return {widthConstraints,heightConstraints};
}

async function btnCtrls(e){
    let { cmd,dir="" } = e.target.dataset;
    // The 3-pane shell delegates from panes that also hold plain text — and
    // cmd.startsWith below would throw on those clicks (a latent legacy crash).
    if(!cmd) return;
    let { width,height } = mainDiv.getBoundingClientRect();
    if(cmd.startsWith("Zoom"))
        return zoomFunc(width,height,cmd==="Zoom-In");
    if(cmd==="grid"){
        mainDiv.classList.toggle("grid-on");
        e.target.classList.toggle("active");
        return;
    }
    if(cmd==="preview")
        return togglePreview();
    if(cmd==="change-input"){
        let input = e.target.parentNode.querySelector("input");
        if(input.getAttribute("type")==="range")
            input.setAttribute("type","number");
        else
            input.setAttribute("type","range");
    }
    if(e.target.nodeName!=="BUTTON") return;
    selectedBTN = e.target;
    if(!cmd) return;
    if(cmd==="close") return removeAllElem("#adv-options *");
    let firstHeader = mainDiv.querySelector("#blanck-header");
    if(firstHeader)
        firstHeader.classList.add("hide");
    if(cmd==="new-col" && !["ok","cancel"].includes(dir)){
        removeAllElem("#adv-options-2 *");
        let advOpts = document.getElementById("table-2-option-template").content.cloneNode(true);
        document.getElementById("adv-options-2").appendChild(advOpts);
        columnObj.var = "slno";
        columnObj.width = 20;
    }
    else
    if(cmd==="new-col" && dir==="ok"){
        pushHistory();
        removeAllElem("#adv-options-2 *");
        if(("cols" in actPointer.plan ? actPointer.plan.cols : []).find(colObj=>colObj.var===columnObj.var)===undefined)
            actPointer.plan.cols = [...("cols" in actPointer.plan ? actPointer.plan.cols : []),columnObj];
        columnObj = {};
        drawTable();
    }
    else
    if(cmd==="new-col" && dir==="cancel"){
        removeAllElem("#adv-options-2 *");
        columnObj = {};
    }
    deleteBTNDiv.classList.add("hide");
    [...document.querySelectorAll(".ctrl-btns")]
    .forEach(btn=>{
        if(btn===e.target)
            btn.classList.add("selected-btn")
        else
            btn.classList.remove("selected-btn");
    });

    if(cmd==="section" || cmd==="new-section"){
        let role = e.target.dataset.role; // Header/Body/Footer palette buttons
        if(role && "elem" in page[role])
            return alert(`Cannot create 2 or more ${role}`);
        removeAllElem("#adv-options *,#adv-options-2 *");
        if(cmd==="new-section")
            removeSelector();
        let no_elems = [...document.querySelectorAll(".new-elem")]
                        .filter(elem=>!elem.classList.contains("feild-elem"))
        if((cmd==="section" && no_elems.length===0) || cmd==="new-section" || role){
            pushHistory();
            actPointer = {};
            selectedElem = createSection(1, role);
            if(role)
                assignSectionRole(role);
            blockOnFocus();
        }
        let advOpts = document.getElementById("block-option-template").content.cloneNode(true).querySelector("div");
        advOptionDiv.appendChild(advOpts);
        if((cmd==="section" && selectedElem) || cmd==="new-section")
            selectorPosHelper();
        let advOption3 = document.getElementById("block-option-3-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options-2").appendChild(advOption3);
        if(actPointer && "role" in actPointer && actPointer.role.applyBorder){
            document.querySelector(`#adv-options-2 option[value="${actPointer.role.applyBorder}"]`).setAttribute("selected",true)
            document.querySelector(`#adv-options-2 option[value="${!actPointer.role.applyBorder}"]`).removeAttribute("selected")
        }
    }
    else
    if(["page","feild","table"].includes(cmd)){
        removeAllElem("#adv-options *,#adv-options-2 *");
        let opts = document.getElementById(`${cmd}-option-template`).content.cloneNode(true).querySelector("div");
        advOptionDiv.appendChild(opts);
        if(cmd==="feild"){
            feildObj = {};
            if(selectedElem && selectedElem.classList.contains("feild-elem")){
                unFocusElem();
                opts = document.getElementById(`${cmd}-option-template`).content.cloneNode(true).querySelector("div");
                advOptionDiv.appendChild(opts);
            }
            if(!("feild" in actPointer))
                actPointer.feild = [];
            feildObj.type = "string";
            feildObj.fSize = 16;
            feildObj.fFamily = page.fFamily;
            feildObj.text = "";
            feildObj.fWidth = 50;
        }
        if(cmd==="table" && selectedElem){
            if(!("plan" in actPointer))
                actPointer.plan = {};
            [{key:"thHeight",val:32},{key:"fSize",val:16},{key:"rSpacing",val:8},{key:"padding",val:10}]
            .forEach(({key,val})=>{
                let value = key in actPointer.plan ? actPointer.plan[key] : val;
                actPointer.plan[key] = value;
                advOptionDiv.querySelector(`[data-cmd="${key}"]`).value = value;
            });
        }
    }
    if(cmd==="exit"){
        ipcRenderer.send("set-app-status","normal");
        return ipcRenderer.send("load-main-page");
    }
    else
    if(cmd==="save-exit"){
        let _page = elemRemoval(page);
        ipcRenderer.send("set-app-status","normal");
        ipcRenderer.send("save-bill-template",_page);
    }

    if(!selectedElem) return;

    if(cmd==="delete"){// Debug required
        pushHistory();
        if(selectedElem.classList.contains("feild-elem")){
            page.feilds = page.feilds.filter(obj=>obj.id!==feildObj.id);
            feildObj = {};
        }
        else{
            actPointer = {};
            removeSelector();
        }
        selectedElem.remove();
    }
    else
    if(cmd==="rem-table"){
        pushHistory();
        actPointer.plan = {};
    }
    else
    if(cmd==="rem-row" && actPointer.plan.cols.length>0 && columnObj){
        pushHistory();
        removeAllElem("#adv-options-2 *");
        actPointer.plan.cols = actPointer.plan.cols.filter(colObj=>colObj!==columnObj);
    }
    if(["rem-table","rem-row"].includes(cmd)){
        let ctx = selectedElem.getContext("2d");
        ctx.clearRect(0,0,selectedElem.width,selectedElem.height);
        ctx.strokeStyle = "black";
        ctx.strokeRect(0,0,selectedElem.width,selectedElem.height);
        ctx.beginPath();
        ctx.stroke();
        drawTable();
    }
    else
    if(cmd==="create-partition" && selectedElem){
        removeAllElem("#adv-options-2 .adv-option-div");
        let advOptionDiv2 = document.getElementById("block-option-2-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options-2").appendChild(advOptionDiv2);
        if(!selectedElem) return alert("Select a section.");
        partitionObj.direction = "col";
        partitionObj.range = 50;
        partitionObj.lWidth = 1;
        drawPartition();
    }
    else
    if(cmd==="save-partition"){
        pushHistory();
        actPointer.partitions.push(partitionObj);
    }
    else
    if(cmd==="undo-partitions"){
        pushHistory();
        actPointer.partitions.pop();
    }
    else
    if(cmd==="properties"){
        removeAllElem("#adv-options-2 *");
        let advOpt = document.getElementById("block-option-4-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options-2").appendChild(advOpt);
        let parentNode;
        if("parentNode" in actPointer)
            parentNode = actPointer.parentNode;
        else{
            parentNode = mainDiv;
            actPointer.parentNode = mainDiv;
        }
        let { widthConstraints=0,heightConstraints=0 } = computeContraints();
        let { width,height } = parentNode.getBoundingClientRect();
        width -= widthConstraints;
        height -= heightConstraints;
        let { width:elemWidth,height:elemHeight } = selectedElem.getBoundingClientRect();
        advOpt.querySelector('[data-cmd="width"]').value = Math.round((elemWidth/width)*100);
        advOpt.querySelector('[data-cmd="width"]').dataset.msg = Math.round((elemWidth/width)*100);
        advOpt.querySelector('[data-cmd="height"]').value = Math.round((elemHeight/height)*100);
        advOpt.querySelector('[data-cmd="height"]').dataset.msg = Math.round((elemHeight/height)*100);
        actPointer.iWidth = elemWidth;
        actPointer.iHeight = elemHeight;            
    }
    else
    if(cmd==="confirm-section-prop" && selectedElem){
        let { width:elemWidth,height:elemHeight } = selectedElem.getBoundingClientRect();
        actPointer.iWidth = "width" in actPointer ? actPointer.width : elemWidth;
        actPointer.iHeight = "height" in actPointer ? actPointer.height : elemHeight;
        removeAllElem("#adv-options-2 *");
    }
    else
    if(cmd==="cancel-section-prop"){
        actPointer.width = actPointer.iWidth;
        actPointer.height = actPointer.iHeight;
        let selector = document.getElementById("selector");
        if(selector){
            selector.style.width = actPointer.width + 40 + "px";
            selector.style.height = actPointer.height + 40 + "px";
        }
        removeAllElem("#adv-options-2 *");
    }
    if(["save-partition","cancel-partition"].includes(cmd)){
        partitionObj = {};
        drawPartition();
        removeAllElem("#adv-options-2 .adv-option-div");
    }
    updateUI();
}

function elemRemoval(obj){
    // Page.elemRemoval dispatches class instances through their toJSON()
    // first (so only the legacy keys are saved), then strips elem /
    // parentNode / id recursively — byte-identical to the legacy version.
    return Page.elemRemoval(obj);
}

// ---------- Undo/redo history (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) ----------

function snapshot(){ return JSON.stringify(elemRemoval(page)); }

function pushHistory(){
    undoStack.push(snapshot());
    if(undoStack.length>HISTORY_CAP) undoStack.shift();
    redoStack = []; // a fresh mutation invalidates the redo chain
}

// One entry per interaction session: the session's first mutation commits
// the pre-session snapshot; later events in the same session are one step.
function historySession(){
    if(dragSnap!==null) return;
    dragSnap = snapshot();
    pushHistory();
}

function undo(){
    if(!undoStack.length) return;
    redoStack.push(snapshot());
    if(redoStack.length>HISTORY_CAP) redoStack.shift();
    dragSnap = null;
    page = JSON.parse(undoStack.pop());
    restorePage(page);
}

function redo(){
    if(!redoStack.length) return;
    undoStack.push(snapshot());
    if(undoStack.length>HISTORY_CAP) undoStack.shift();
    dragSnap = null;
    page = JSON.parse(redoStack.pop());
    restorePage(page);
}

// Esc mid-drag: revert to the pre-session snapshot (no half-drag states).
function cancelDrag(){
    if(dragSnap===null) return;
    undoStack.pop(); // drop the session's entry — we are restoring it
    page = JSON.parse(dragSnap);
    dragSnap = null;
    removeSelector();
    restorePage(page);
}

function blockOnFocus(){
    let secBTN = document.querySelector(`button[data-cmd="section"]`);
    if(!selectedElem.classList.contains("feild-elem"))
        actPointer = [page.head,page.body,page.footer,...page.sections].find(obj=>obj.id===selectedElem.dataset.id);
    showSelectorMarker();
    if(actPointer && typeof actPointer==="object" && "elem" in actPointer && !(actPointer.elem.classList.contains("image-placeholder"))){
        actPointer.plan = !("plan" in actPointer) ? {} : actPointer.plan;
        if(!("role" in actPointer))
            actPointer.role = "section";
        if(!("elem" in actPointer))
            actPointer.elem = selectedElem;
        if(!("applyBorder" in actPointer)){
            actPointer.applyBorder = true;
            actPointer.border = 1;
        }
        if(!("partitions" in actPointer))
            actPointer.partitions = [];
    }
    [...document.querySelectorAll(".new-elem")]
    .forEach(elem=>{
        if(elem===selectedElem)
            elem.classList.add("selected");
        else
            elem.classList.remove("selected");
    });
    if(!secBTN.classList.contains("selected-btn") && !(selectedElem.classList.contains("feild-elem"))){
        [...document.querySelectorAll(".ctrl-btns")]
        .forEach(btn=>{
            if(btn===secBTN)
                btn.classList.add("selected-btn")
            else
                btn.classList.remove("selected-btn");
        });
    }
    let selector = document.getElementById("selector");
    if(selector && selector.getAttribute("mousemove-listener")!=="true"){
        selector.addEventListener("mousemove",drawAssist);
        selector.setAttribute("mousemove-listener","true");
        selector.addEventListener("mouseleave",()=>{
            [...document.querySelectorAll(".adj-pts")]
            .forEach(pt=>{
                pt.setAttribute("mouseover-listener","false");
                pt.removeEventListener("mouseover",mouseoverListenerOnCTRLPts);
            });
            removeAllElem("#coordinate-marker,.adj-pts");
        });
    }
}

function showSelectorMarker(selector){
    return [page.head,page.body,page.footer,...page.sections]
            .filter(({elem="",name=""})=>{
                if(elem=="" || name=="") return false;
                if(selector && elem===selectedElem){
                    selector.classList.add("show-msg");
                    selector.dataset["msg"] = name;
                }
                if(elem===selectedElem){
                    return true;
                }
                else
                    return false;
            });
}

function unFocusElem(){
    if(!selectedElem) return;
    lastFocus = selectedElem;
    if(selectedElem.classList.contains("feild-elem"))
        feildObj = {};
    selectedElem = null;
    [...document.querySelectorAll(".new-elem")]
    .forEach(elem=>elem.classList.remove("selected"));
    document.getElementById("selector") && removeSelector();
    if(lastFocus)
        lastFocus.style.zIndex = "2";
    updateUI();
    actPointer = {};
    removeAllElem("#adv-options *,#adv-options-2 *");
}

function removeSelector(){
    let selector = document.getElementById("selector");
    if(!selector) return;
    observer.unobserve(selector);
    selector.removeEventListener("mousemove",drawAssist);
    selector.remove();
    removeAllElem("#coordinate-marker");
}

function createSelector(){
    let selector = document.createElement("div");
    selector.id = "selector";
    selector.className = "selector";
    observer.observe(selector);
    selector.style.zIndex = Number(selectedElem.style.zIndex) + 10;
    if(arguments.length>0){
        let { top,left,width,height } = selectedElem.getBoundingClientRect();
        let { top:top_mainDiv,left:left_mainDiv } = mainDiv.getBoundingClientRect();
        selector.style.top = top - top_mainDiv - 20 + "px";
        selector.style.left = left - left_mainDiv - 20 + "px";
        selector.style.width = width + 40 + "px";
        selector.style.height = height + 40 + "px";
        selectedElem.parentNode.appendChild(selector);
    }
    return selector;
}

function moveElemHelper(newX,newY){
    if(!selectedElem) return;
    let selector = document.getElementById("selector");
    let { width:width_mainDiv,height:height_mainDiv,top:top_mainDiv,left:left_mainDiv } = mainDiv.getBoundingClientRect();
    let { width:elemWidth, height:elemHeight,left:left_selectedElem,top:top_selectedElem,bottom:bottom_selectedElem,right:right_selectedElem } = selectedElem.getBoundingClientRect();
    if(!moveFlag || !selector) return;
    let { width,height } = selector.getBoundingClientRect();
    if((Math.sign(newX)<0 && newX<0 - 0.5*width) || newX>0.99*width_mainDiv) return;
    if((Math.sign(newY)<0 && newY<0 - 0.5*height) || newY>0.99*height_mainDiv) return;
    removeAllElem("#helper-line");
    let upFlag, leftFag;
    let topVal = Number(selectedElem.style.top.split("px")[0]), leftVal = Number(selectedElem.style.left.split("px")[0]);
    if(Math.sign(Math.round(topVal - newY)) > 0)
        upFlag = 1;
    else
    if(Math.sign(Math.round(topVal - newY)) === 0)
        upFlag = 0;
    else
        upFlag = -1;
    if(Math.sign(Math.round(newX - leftVal)) > 0)
        leftFag = 1;
    else
    if(Math.sign(Math.round(newX - leftVal)) === 0)
        leftFag = 0;
    else
        leftFag = -1;
    selectedElem.style.borderColor = "blue";
    selectedElem.style.top = newY + "px";
    selectedElem.dataset.top = newY/zoomFactor;
    selectedElem.style.left = newX + "px";
    selectedElem.dataset.left = newX/zoomFactor;
    selector.style.top = newY - 20 + "px";
    selector.style.left = newX - 20 + "px";
    if(borderCanvas){
        let ctx = drawMargin();
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([3,3]);
        ctx.strokeStyle = "green";// "#91ee83";
        if(Math.abs(Math.round(newX+elemWidth/2-width_mainDiv/2))<=1){
            ctx.moveTo(width_mainDiv/2,0);
            ctx.lineTo(width_mainDiv/2,height_mainDiv);
        }
        if(Math.abs(Math.round(newY+elemHeight/2-height_mainDiv/2))<=1){
            ctx.moveTo(0,height_mainDiv/2);
            ctx.lineTo(width_mainDiv,height_mainDiv/2);
        }
        ctx.stroke();
        ctx.restore();
        clearTimeout(midGuideTimer);
        midGuideTimer = setTimeout(()=>{
            drawMargin();
            removeAllElem(".gap-displavy");
        },1000);
    }
    if(actPointer && "role" in actPointer && ["head","body","footer"].includes(actPointer.role)){
        page[actPointer.role].x = newX;
        page[actPointer.role].y = newY;
    }
    else{// When selection in undefined
        selectedElem.dataset.x = newX;
        selectedElem.dataset.y = newY;
    }
    if(actPointer){
        actPointer.x = newX;
        actPointer.y = newY;
    }
    [...document.querySelectorAll(".new-elem")]
    .forEach(elem=>elem.classList.remove("hovered-over"));
    drawAdjPoints();
    removeAllElem(".gap-displavy");
    let ctx = borderCanvas.getContext("2d");
    function commonCodes({text,left,top,y1,y2,x1,x2,lineDir}){
        let span = document.createElement("span");
        document.body.appendChild(span);
        span.className = "gap-displavy";
        ctx.clearRect(0,0,borderCanvas.width,borderCanvas.height);
        if(page.applyBorder)
            drawMargin();
        ctx.save();
        ctx.setLineDash([1,1]);
        ctx.beginPath();
        span.textContent = text + " px";
        span.style.left = left + "px";
        span.style.top = top + "px";
        if(lineDir==="horizontal"){
            y1 -= top_mainDiv;
            ctx.moveTo(0,y1);
            ctx.lineTo(borderCanvas.width,y1);
            y2 -= top_mainDiv;
            ctx.moveTo(0,y2);
            ctx.lineTo(borderCanvas.width,y2);
        }
        else{
            x1 -= left_mainDiv;
            ctx.moveTo(x1,0);
            ctx.lineTo(x1,borderCanvas.height);
            x2 -= left_mainDiv;
            ctx.moveTo(x2,0);
            ctx.lineTo(x2,borderCanvas.height);
        }
        ctx.stroke();
        ctx.restore();
    } // Display gap between elements if they are close.
    ctx.save();
    ctx.setLineDash([1,1]);
    if(Math.abs(upFlag)>0){// Horizontal guide lines
        ctx.moveTo(0,Math.abs(top_selectedElem - top_mainDiv));
        ctx.lineTo(borderCanvas.width, Math.abs(top_selectedElem - top_mainDiv));
        ctx.moveTo(0,Math.abs(bottom_selectedElem - top_mainDiv));
        ctx.lineTo(borderCanvas.width, Math.abs(bottom_selectedElem - top_mainDiv));
    }
    else
    if(Math.abs(leftFag)>0){// Vertical guide lines
        ctx.moveTo(Math.abs(left_selectedElem - left_mainDiv),0);
        ctx.lineTo(Math.abs(left_selectedElem - left_mainDiv),borderCanvas.height);
        ctx.moveTo(Math.abs(right_selectedElem - left_mainDiv),0);
        ctx.lineTo(Math.abs(right_selectedElem - left_mainDiv),borderCanvas.height);
    }
    ctx.stroke();
    ctx.restore();
    [page.body,page.head,page.footer,...page.feilds,...page.sections]
    .forEach(obj=>{
        if(!("elem" in obj) || obj.elem===selectedElem || (selectedElem.classList.contains("feild-elem") && !obj.elem.classList.contains("feild-elem"))) return;
        let { left:elemLeft,top:elemTop,bottom:elemBottom,right:elemRight } = obj.elem.getBoundingClientRect();
        if(upFlag>0 && leftFag===0 && Math.abs(top_selectedElem - elemBottom)<10 && Math.abs(left_selectedElem - elemLeft)<10){
            let _obj = {
                text: Math.round((top_selectedElem - elemBottom)*100)/100,
                left: elemLeft,
                top: (elemBottom+top_selectedElem)/2 - 7.2,
                y1: elemBottom,
                y2: top_selectedElem,
                lineDir: "horizontal"
            }
            commonCodes(_obj);
        }
        else
        if(upFlag<0 && leftFag===0 && Math.abs(bottom_selectedElem - elemTop)<10 && Math.abs(left_selectedElem - elemLeft)<10){
            let _obj = {
                text: Math.round((elemTop - bottom_selectedElem)*100)/100,
                left: elemLeft,
                top: (bottom_selectedElem+elemTop)/2 - 7.2,
                y1: bottom_selectedElem,
                y2: elemTop,
                lineDir: "horizontal"
            }
            commonCodes(_obj);
        }
        else
        if(upFlag===0 && leftFag>0 && Math.abs(right_selectedElem - elemLeft)<10 && Math.abs(top_selectedElem - elemTop)<10){
            let _obj = {
                text: Math.round((elemLeft - right_selectedElem)*100)/100,
                left: (elemLeft+right_selectedElem)/2-7.2,
                top: (elemBottom + elemTop)/2,
                lineDir: "vertical",
                x1: right_selectedElem,
                x2: elemLeft
            };
            commonCodes(_obj);
        }
        else
        if(upFlag===0 && leftFag<0 && Math.abs(left_selectedElem - elemRight)<10 && Math.abs(top_selectedElem - elemTop)<10){
            let _obj = {
                text: Math.round((left_selectedElem - elemRight)*100)/100,
                left: (elemRight+left_selectedElem)/2 + 7.2 ,
                top: (elemBottom + elemTop)/2,
                lineDir: "vertical",
                x1: left_selectedElem,
                x2: elemRight
            };
            commonCodes(_obj);
        }
    });
}

function drawHelperLine(mode,posObj){
    let selector = document.getElementById("selector");
    if(!selector || !selectedElem) return;
    let { width,height,left:left_mainDiv } = mainDiv.getBoundingClientRect();
    removeAllElem("#helper-line");
    let helperLineCanv = document.createElement("canvas");
    let ctx = helperLineCanv.getContext("2d");
    mainDiv.appendChild(helperLineCanv);
    helperLineCanv.id = "helper-line";
    let key = Object.keys(posObj).pop();
    helperLineCanv.style[key] = Math.round(posObj[key]) + "px";
    if(mode==1){
        helperLineCanv.width = 5;
        helperLineCanv.height = height;
        helperLineCanv.style.top = 0 + "px";
        ctx.moveTo(0,0);
        ctx.lineTo(0,helperLineCanv.height);
    }
    else{
        helperLineCanv.height = 5;
        helperLineCanv.width = width;
        helperLineCanv.style.left = 0 + "px";
        ctx.moveTo(0,0);
        ctx.lineTo(helperLineCanv.width,0);
    }
    clearTimeout(alignmentLineCSSTimer);
    [...document.querySelectorAll(".new-elem")]
    .forEach(elem=>{
        if(elem===selectedElem) return;
        elem.classList.remove("alignment-line-over")
        let elemPosObj = elem.getBoundingClientRect(); 
        let diff = Math.abs(elemPosObj[key]-posObj[key]-left_mainDiv);
        if(diff>0 && diff<2){
            elem.classList.add("alignment-line-over");
            alignmentLineCSSTimer = setTimeout(()=>{elem.classList.remove("alignment-line-over")},2000);
        }
    });
    ctx.strokeStyle = "black";
    ctx.setLineDash([1,1]);
    ctx.stroke();
}

function move(e){
    if(e.target!==selectedElem)
        lastFocus = selectedElem;
    if(e.target.nodeName==="CANVAS" && 
    e.target.classList.contains("new-elem"))
        selectedElem = e.target;
    else
    if((e.target.nodeName==="DIV" && e.target.id!=="selector") || 
    !selectedElem || 
    e.target.nodeName==="MAIN" || 
    e.target.className==="")
        return unFocusElem(e);
    if(!selectedElem) return;
    removeAllElem("#adv-options *,#adv-options-2 *");
    if(feildObj && Object.keys(feildObj).length>2 && "elem" in feildObj && feildObj.elem!==selectedElem)
        feildObj = {};
    let { left:left_mainDiv,top:top_mainDiv,right:right_mainDiv,bottom:bottom_mainDiv } = mainDiv.getBoundingClientRect();
    let { clientX,clientY } = e;
    let { left:elemLeft,top:elemTop,width:elemWidth,height:elemHeight } = selectedElem.getBoundingClientRect();
    let diffX = clientX - elemLeft;
    let diffY = clientY - elemTop;
    let selector = document.getElementById("selector");
    actPointer = {};
    blockOnFocus();
    if(selectedElem.classList.contains("feild-elem"))
        selectFeildCanv(1);
    if(actPointer && "elem" in actPointer && !(actPointer.elem.classList.contains("image-placeholder"))){
        let advOptDiv = document.getElementById("adv-options");
        let advOpt = document.getElementById("block-option-template").content.cloneNode(true).querySelector("div");
        advOptDiv.appendChild(advOpt);
        [...advOpt.querySelectorAll("div")]
        .forEach(div=>{
            let input = div.querySelector("input,select")
            if(input && input.nodeName==="INPUT")
                input.value = actPointer[input.dataset.cmd];
            else
            if(input && input.nodeName==="SELECT"){
                let option = input.querySelector(`option[value="${actPointer[input.dataset.cmd]}"]`);
                if(option)
                    option.setAttribute("selected",true);
                else{
                    option = input.querySelector(`option[value="${actPointer.role}"]`);
                    option?.setAttribute("selected",true);
                }

            }
        })
        if(advOpt.querySelector('[data-cmd="shape"]')){
            let shapeInput = advOpt.querySelector('[data-cmd="shape"]');
            shapeInput.value = actPointer.shape || "rectangle";
            advOpt.querySelector('[data-show="shape-rounded"]').classList.toggle("hide", shapeInput.value!=="rounded");
            let crInput = advOpt.querySelector('[data-cmd="cornerRadius"]');
            if(crInput)
                crInput.value = actPointer.cornerRadius ?? 8;
        }
    }
    deleteBTNDiv.classList.remove("hide");
    if(!document.getElementById("selector") || selectedElem!==lastFocus){
        if(document.getElementById("selector"))
            removeSelector()
        selector = createSelector();
        showSelectorMarker(selector);
        selector.style.top = clientY - top_mainDiv - diffY - 20 + "px";
        selector.style.left = clientX - left_mainDiv - diffX - 20 + "px";
        selector.style.width = elemWidth + 40 + "px";
        selector.style.height = elemHeight + 40 + "px";
        selectedElem.parentNode.appendChild(selector);
        selectedElem.style.cursor = "grabbing";
    }
    updateUI();
    drawAssist.call({elem:selector,type:"move"});
    function moveElem(e){
        historySession();
        if(shallResize && selectedElem.classList.contains("new-elem") && selectedCTRLDot){
            let { tag,initX,initY } = selectedCTRLDot.dataset;
            let { x,y } = e;
            let { width,height } = selector.getBoundingClientRect();
            let diffX = x - initX, diffY = y - initY;
            if(moveFlag)
                moveFlag = false;
            if(Math.abs(diffX)>4 || Math.abs(diffY)>4){
                diffX = Math.sign(diffX) * 4;
                diffY = Math.sign(diffY) * 4;
            }
            if(tag==="left" && checkConstraints(width - diffX , height)){
                selector.style.left = x - left_mainDiv + "px";
                selector.style.width = width - diffX + "px";
                selectedElem.style.left = x - left_mainDiv + 20 + "px";
                selectedElem.dataset.left = (x - left_mainDiv + 20)/zoomFactor;
                drawHelperLine(1,{left:x - left_mainDiv + 20});
            }
            else
            if(tag==="top" && checkConstraints(width,height - diffY)){
                selector.style.top = y - top_mainDiv + "px";
                selectedElem.style.top = y - top_mainDiv + 20 + "px";
                selectedElem.dataset.top = (y - top_mainDiv + 20)/zoomFactor;
                selector.style.height = height - diffY + "px";
                drawHelperLine(2,{top:y - top_mainDiv + 20});
            }
            else
            if(tag==="right" && checkConstraints(width + diffX,height)){
                selector.style.right = right_mainDiv - x + "px";
                selectedElem.style.right = right_mainDiv - x + 20 + "px";
                selectedElem.dataset.left = (selectedElem.getBoundingClientRect().left - left_mainDiv + 20)/zoomFactor;
                selector.style.width = width + diffX + "px";
                drawHelperLine(1,{right:right_mainDiv - x + 17.5});
            }
            else
            if(tag==="bottom" && checkConstraints(width,height + diffY)){
                selector.style.bottom = bottom_mainDiv - y + "px";
                selectedElem.style.bottom = bottom_mainDiv - y + 20 + "px";
                selectedElem.dataset.top = (selectedElem.getBoundingClientRect().top - top_mainDiv + 20)/zoomFactor;
                selector.style.height = height + diffY + "px";
                drawHelperLine(2,{bottom:bottom_mainDiv - y + 15});
            }
            selectedCTRLDot.dataset.initX = x;
            selectedCTRLDot.dataset.initY = y;
            drawAdjPoints();
            clearTimeout(helperLineTimer);
            helperLineTimer = setTimeout(removeAllElem,2000,"#helper-line");
        }
        // Block motion
        let { clientX,clientY } = e;
        let newX = clientX - left_mainDiv - diffX;
        let newY = clientY - top_mainDiv - diffY;
        if(!selectedElem.classList.contains("feild-elem"))
            actPointer = [page.head,page.body,page.footer,...page.sections].find(obj=>obj.id===selectedElem.dataset.id);
        moveElemHelper(newX,newY);
        drawFeilds(newX,newY);
    }
    dragSnap = null; // fresh drag session — the first movement commits history
    mainDiv.addEventListener("mousemove",moveElem);
    mainDiv.addEventListener("mouseup",function(e){
        if(!selectedElem) return;
        selectedElem.style.borderColor = "";
        selectedElem.style.cursor = "grab";
        this.removeEventListener("mousemove",moveElem);
        this.removeEventListener("mouseup",arguments.callee);
    });
    drawFeilds();
    drawTable();
}

function checkConstraints(width,height){
    width -= 40;
    height -= 40;
    let { width:width_mainDiv,height:height_mainDiv } = mainDiv.getBoundingClientRect();
    let widthConstraints = width_mainDiv;
    let heightConstraints = height_mainDiv;
    if(page.applyMargin){
        if(typeof page.margin === "object"){
            widthConstraints -= page.margin.left + page.margin.right;
            heightConstraints -= page.margin.top + page.margin.bottom;
        }
        else{
            widthConstraints -= 2 * page.margin;
            heightConstraints -= 2 * page.margin;
        }
    }
    if(page.applyBorder){
        widthConstraints -= page.border;
        heightConstraints -= page.border;
    }
    return width<=widthConstraints && height<=heightConstraints;
}

function resizeNote(entries){
    if(!selectedElem || selectedElem.classList.contains("feild-elem")) return 
    let selector = entries[0].target;
    let { width = selectedElem.width,height = selectedElem.height,left,top } = selector.getBoundingClientRect();
    selectedElem.width = width - 40;
    selectedElem.height = height - 40;
    if(!actPointer || !("role" in actPointer) || !selectedElem) return;
    if(["head","body","footer"].includes(actPointer.role)){
        page[actPointer.role].width = width - 40;
        page[actPointer.role].height = height - 40;
        selectedElem.dataset.width = width - 40;
        selectedElem.dataset.height = height - 40;
    }
    else{
        actPointer.width = width - 40;
        actPointer.height = height - 40;
        selectedElem.dataset.width = width - 40;
        selectedElem.dataset.height = height - 40;
    }
    // Shape-aware repaint through the class recipes (the legacy strokeRect
    // here would wipe a rounded/circle/ellipse border back to a rectangle).
    drawAssist.call({elem:selector,type:"resize"});
    drawPartition();
}

function drawMargin(){
    if(!borderCanvas) return;
    let ctx = borderCanvas.getContext("2d");
    let { width,height } = mainDiv.getBoundingClientRect();
    ctx.clearRect(0,0,width,height);
    if(page.applyBorder!==true) return ctx;
    ctx.beginPath();
    ctx.strokeStyle = "black";
    ctx.lineWidth = page.border;
    if(typeof page.margin === "object"){
        let { top=0,right=0,bottom=0,left=0 } = page.margin;
        ctx.strokeRect(left,top,width-left-right,height-top-bottom);
    }
    else{
        let { margin=0 } = page;
        ctx.strokeRect(margin,margin,width-2*margin,height-2*margin);
    }
    ctx.stroke();
    return ctx;
}

function pageSetup(e){
    let { cmd } = e.target.dataset;
    let { value:val } = e.target;
    historySession();
    if(cmd==="pageSize"){
        let { width,height } = appDefault[val];
        mainDiv.style.width = width + "px";
        mainDiv.style.height = height + "px";
    }
    else
    if(cmd==="margin"){
        removeAllElem("#adv-options-2 .adv-option-div");
        let secondAdvOpts = document.getElementById(`${val}-template`);
        if(secondAdvOpts){
            secondAdvOpts = secondAdvOpts.content.cloneNode(true).querySelector("div");
            document.getElementById("adv-options-2").appendChild(secondAdvOpts);
            page.applyMargin = true;
        }
        else{
            page.applyMargin = false;
            [...document.querySelector("select[data-cmd='apply-border']").querySelectorAll("option")]
            .forEach(option=>{
                if(option.value==="false")
                    option.setAttribute("selected",true);
                else
                    option.setAttribute("selected",false);
            })
            page.applyBorder = false;
        }
    }
    else
    if(cmd.startsWith("margin-")){
        let pos = cmd.split("margin-").filter(str=>str.length!==0).pop();
        if(pos!=="fixed"){
            page.margin = {
                ...page.margin,
                [pos]:Number(val)
            }
        }
        else
            page.margin = Number(val);
        page.applyBorder && drawMargin()
    }
    else
    if(cmd==="apply-border"){
        page.applyBorder = val === "true";
        removeAllElem("#adv-options-2 .adv-option-div");
        if(page.applyBorder){
            let secondAdvOpts = document.getElementById("border-size-template").content.cloneNode(true).querySelector("div");
            document.getElementById("adv-options-2").appendChild(secondAdvOpts);
            drawMargin();
        }
    }
    else
    if(cmd==="draw-border"){
        page.border = Number(val) || 1;
        drawMargin();
    }
    else
        page[cmd] = val;
    updateUI();
} // preliminary test complete 

function assignBlockOptions(e){
    let { cmd } = e.target.dataset;
    let { value:val } = e.target;
    if(!selectedElem) return;
    if(selectedElem.classList.contains("feild-elem")) return;
    if(["head","body","footer"].includes(val) && "elem" in page[val]) return alert(`Cannot create 2 or more ${val}`);
    historySession();
    if(cmd==="section" && ["head","body","footer"].includes(val)){
        assignSectionRole(val);
    }
    else
    if(cmd==="section" && !["head","body","footer"].includes(val)){
        page.sections.push(actPointer);
    }
    if(cmd==="name")
        actPointer.name = val;
    else
    if(cmd==="apply-border"){
        if(actPointer){
            if("role" in actPointer && ["head","body","footer"].includes(actPointer.role)){
                let { role } = actPointer;
                page[role].applyBorder = val==="true";
                page[role].border = 1;
            }
            else{
                actPointer.applyBorder = val==="true";
                selectedElem.dataset.applyBorder = val==="true";
            }
            removeAllElem("#adv-options-2 *");
            let ctx = selectedElem.getContext("2d");
            ctx.clearRect(0,0,selectedElem.width,selectedElem.height);
            if(val==="true"){
                let advOption3 = document.getElementById("block-option-3-template").content.cloneNode(true).querySelector("div");
                document.getElementById("adv-options-2").appendChild(advOption3);
                ctx.strokeStyle = "black";
            }
            else
                ctx.strokeStyle = "gray";
            ctx.strokeRect(0,0,selectedElem.width,selectedElem.height);
            ctx.stroke();
        }
    }
    else
    if(cmd==="border-width"){
        let ctx = selectedElem.getContext("2d");
        ctx.clearRect(0,0,selectedElem.width,selectedElem.height);
        ctx.lineWidth = Number(val) || 1;
        ctx.strokeRect(0,0,selectedElem.width,selectedElem.height);
        ctx.strokeStyle = "black";
        ctx.stroke();
        if(actPointer){
            if("role" in actPointer && ["head","body","footer"].includes(actPointer.role))
                page[actPointer.role].border = Number(val) || 1;
            else{
                selectedElem.dataset.border = Number(val) || 1;
                selectedElem.dataset.applyBorder = true;
                actPointer.applyBorder = true;
                actPointer.border = Number(val) || 1;
            }
        }
    }
    else
    if(["width","height"].includes(cmd)){
        let selector = document.getElementById("selector");
        let parentNode;
        if("parentNode" in actPointer)
            parentNode = actPointer?.parentNode;
        else 
            parentNode = mainDiv;
        if(parentNode && selector){
            let obj = parentNode.getBoundingClientRect();
            let { widthConstraints=0,heightConstraints=0 } = computeContraints();
            let constraint = cmd==="width" ? widthConstraints : heightConstraints;
            selector.style[cmd] = 40 - constraint + val * obj[cmd] * 0.01 - 10 + "px";
            actPointer[cmd] = val;
            commonFunc_range(e.target,val,"%");
        }
    }
    else
    if(cmd==="shape"){
        actPointer.shape = val;
        if(["head","body","footer"].includes(actPointer.role) && page[actPointer.role]!==actPointer)
            page[actPointer.role].shape = val;
        document.querySelector('[data-show="shape-rounded"]').classList.toggle("hide", val!=="rounded");
        drawPartition();
    }
    else
    if(cmd==="cornerRadius"){
        actPointer.cornerRadius = Number(val) || 8;
        if(["head","body","footer"].includes(actPointer.role) && page[actPointer.role]!==actPointer)
            page[actPointer.role].cornerRadius = Number(val) || 8;
        drawPartition();
    }
    updateUI();
}

function createBodySections(){
    let { top:top_mainDiv,left:left_mainDiv } = mainDiv.getBoundingClientRect();
    let { height,top,left } = page.body.elem.getBoundingClientRect();
    let section = createSection();
    section.style.height = height + "px";
    section.style.width = "50px";
    section.style.top = top - top_mainDiv + "px";
    section.style.left = left - left_mainDiv + "px";
    page.body.child.push({elem:section});
    mainDiv.appendChild(section);
    removeSelector();
    selectedElem = section;
    createSelector(1);
    return section;
}

function partitionManager(e){
    if(!selectedElem) return;
    let { value,dataset:{cmd},type } = e.target;
    if(cmd==="partition-direction"){
        document.querySelector(".changable").textContent = value=="row" ? "height" : "width";
        partitionObj.direction = value;
    }
    else
        partitionObj[cmd] = Number(value);
    if(type==="range")
        commonFunc_range(e.target,value);
    drawPartition();
}

function redrawSectionCanvas(extraPartition){
    if(!selectedElem || selectedElem.classList.contains("feild-elem")) return;
    let ctx = selectedElem.getContext("2d");
    ctx.clearRect(0,0,selectedElem.width,selectedElem.height);
    // One class-driven pass: border shape + partitions + table (the class
    // recipes mirror the legacy drawPartition/drawTable paint order).
    let section = new Section(actPointer);
    ctx.lineWidth = section.border || 1;
    ctx.strokeStyle = section.applyBorder ? "black" : "gray";
    section.drawShapePath(ctx);
    section.drawPartitions(ctx, extraPartition && Object.keys(extraPartition).length ? [extraPartition] : []);
    section.drawTable(ctx, page);
}

function drawPartition(){
    redrawSectionCanvas(partitionObj);
}

function drawTable(){
    redrawSectionCanvas();
}

// Table Design Section
function selectColumn(e){
    if(!actPointer || actPointer.role!=="body") return;
    let { x } = e;
    let { left,width } = selectedElem.getBoundingClientRect();
    drawTable();
    let diffX = x - left;
    columnObj = actPointer.plan.cols.filter((colObj)=>{
        let {xPos,width:wPercent} = colObj;
        if(diffX>xPos && diffX<xPos+wPercent*0.01*width)
            return colObj;
    }).pop();
    if(columnObj){
        removeAllElem("#adv-options-2 *");
        let advOpt = document.getElementById("table-2-option-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options-2").appendChild(advOpt);
        advOpt.querySelector(`[data-cmd="label"]`).value = columnObj.label;
        advOpt.querySelector(`[data-cmd="var"] option[value="${columnObj.var}"]`).setAttribute("selected",true);
        advOpt.querySelector(`[data-cmd="width"]`).value = columnObj.width;
        advOpt.querySelector(`[data-cmd="width"]`).dataset.msg = columnObj.width + "%";
        advOpt.querySelector(`[data-cmd="rem-row"]`).classList.remove("hide");
    }
}

function commonFunc_range(elem,value,msg="%"){
    document.documentElement.style.setProperty("--left_range",`${value}%`);
    elem.style.removeProperty("--left_range")
    elem.dataset.msg = value+msg;
    elem.focus();
    clearTimeout(focusTimer);
    focusTimer = setTimeout(()=>{
        elem.blur();
    },2000);
}

function tableDesignHelper(e){
    if(!selectedElem) return alert("Select host section.");
    let { dataset:{cmd,type},value:val } = e.target;
    // Draft-column edits commit only via the new-col OK button; page-
    // touching edits (table props, existing columns, sumup) open a session.
    if(type==="Number" || cmd==="sumup" || (["label","var","width"].includes(cmd) && actPointer.plan.cols.includes(columnObj)))
        historySession();
    if(type==="Number")
        actPointer.plan[cmd] = Number(val);
    else
    if(["label","var"].includes(cmd))
        columnObj[cmd] = val;
    else
    if(cmd==="width")
        columnObj.width = Number(val);
    else
    if(cmd==="sumup"){
        document.getElementById("table-col-width-input").setAttribute("disabled",true);
        let netPercent = actPointer.plan.cols.reduce((acc,{width})=>acc+width,0);
        columnObj.width = 100 - netPercent;
        alert("No more column can be added.");
    }
    if(e.target.type==="range")
        commonFunc_range(e.target,val);
    drawTable();
}

// Feild Assign Section

function selectImgFeild(){
    removeAllElem("#adv-options *");
    let advOptDiv = document.getElementById("adv-options");
    let advOpt = document.getElementById("img-opt-template").content.cloneNode(true).querySelector("div");
    advOptDiv.appendChild(advOpt);
    Object.keys(feildObj)
    .forEach(key=>{
        let input = advOptDiv.querySelector(`[data-cmd="${key}"]`);
        if(input){
            if(input.type==="range")
                commonFunc_range(input,feildObj[key],"%");
            if(input.type==="checkbox")
                input.setAttribute("checked",feildObj[key])
            else
                input.value = feildObj[key];
            if("applyAspectRatio" in feildObj && feildObj.applyAspectRatio){
                advOptDiv.querySelector(`[data-cmd="applyAspectRatio"]`).setAttribute("checked",true);
                advOptDiv.querySelector(`[data-show="applyAspectRatio"]`).classList.remove("hide");
            }
            else
            if("applyAspectRatio" in feildObj && feildObj.applyAspectRatio===false){
                advOptDiv.querySelector(`[data-cmd="applyAspectRatio"]`).removeAttribute("checked");
                advOptDiv.querySelector(`[data-show="applyAspectRatio"]`).classList.add("hide");
            }
        }
    });
}

function selectFeildCanv(mode=2){
    feildObj = page.feilds.find(obj=>obj.id===selectedElem.dataset.id);
    if("elem" in feildObj && feildObj.elem.classList.contains("image-placeholder"))
        return selectImgFeild();
    if(mode===2){
        removeAllElem("#adv-options *");
        let advOpt = document.getElementById("feild-option-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options").appendChild(advOpt);
        Object.keys(feildObj)
        .forEach(key=>{
            let feild = advOpt.querySelector(`[data-cmd="${key}"]`);
            if(feild)
                feild.value = feildObj[key];
            if(key==="type" && feildObj[key]==="variable"){
                advOpt.querySelector('[data-show="variable"]')?.classList.remove("hide");
                let fTypeOpt = advOpt.querySelector(`[data-show="variable"] option[value="${feildObj.fType}"]`);
                if(fTypeOpt)
                    fTypeOpt.setAttribute("selected",true);
                else{// free-text custom key — not one of the registry's options
                    advOpt.querySelector('[data-show="variable"] [data-cmd="fType"]').value = "__custom";
                    let customInput = advOpt.querySelector('[data-cmd="custom-fType"]');
                    customInput.classList.remove("hide");
                    customInput.value = feildObj.fType;
                }
            }
            if(key==="fFamily")
                advOpt.querySelector(`[data-cmd="fFamily"] option[value="${feildObj.fFamily}"]`)?.setAttribute("selected",true);
            if(["bold","italic","underline"].includes(key) && feildObj[key])
                advOpt.querySelector(`[data-cmd="${key}"]`)?.classList.add("selected-btn-2");
        });
    }
}

function drawFeilds(x,y){
    if(!selectedElem) return;
    if(!selectedElem.classList.contains("feild-elem")) return;
    if(x!==undefined && y!==undefined){
        feildObj.x = x;
        feildObj.y = y;
    }
    else{
        let { left:left_mainDiv,top:top_mainDiv } = mainDiv.getBoundingClientRect();
        let { left,top } = selectedElem.getBoundingClientRect();
        feildObj.x = left - left_mainDiv;
        feildObj.y = top - top_mainDiv;
    }
    page.feilds
    .forEach((feildObj)=>{
        drawFeildText(feildObj);
    });
}

function assignFeildOptions(e){
    let { value,dataset:{cmd} } = e.target;
    let advOpt = document.getElementById("field-option-1");
    let varOptDiv = advOpt.querySelector(`[data-show="variable"]`);
    if(page.feilds.includes(feildObj)) historySession(); // committed feild; drafts commit on Create
    if(cmd==="type"){
        [...advOpt.querySelectorAll("div")]
        .forEach(elem=>{
            elem.classList.remove("hide")
        });
        Object.keys(feildObj)
        .forEach(key=>{
            if(key==="type")
                feildObj[key] = value;
            else
                Reflect.deleteProperty(feildObj,key);
        });
        ["bold","italic","underline"]
        .forEach(key=>{
            if((key in feildObj)){
                feildObj[key] = false;
                advOpt.querySelector(`button[data-cmd="${key}"]`).classList.remove("selected-btn-2");
            }
        });
        feildObj.fSize = 16;
        feildObj.fFamily = page.fFamily;
        feildObj.text = "";
        feildObj.fWidth = 50;
    }
    if(value==="variable" && cmd==="type"){
        varOptDiv.classList.remove("hide");
        feildObj.fType = "date";
        varOptDiv.querySelector('[data-cmd="fType"]').value = "date";
        varOptDiv.querySelector('[data-cmd="custom-fType"]').classList.add("hide");
    }
    else
    if(value==="string" && cmd==="type")
        varOptDiv.classList.add("hide");
    else
    if(value==="image" && cmd==="type"){
        [...advOpt.querySelectorAll("div")]
        .forEach((elem,i,self)=>{
            if(i===0 || i===self.length-1) return;
            elem.classList.add("hide");
        });
        Object.keys(feildObj)
        .forEach(key=>{
            if(key==="type")
                feildObj[key] = value;
            else
                Reflect.deleteProperty(feildObj,key);
        });
        feildObj.imgWidth = 10;
        feildObj.imgHeight = 10;
        feildObj.imgOpacity = 100;
    }
    if(cmd==="fType"){
        feildObj.fType = value==="__custom" ? "" : value;
        advOpt.querySelector('[data-cmd="custom-fType"]').classList.toggle("hide", value!=="__custom");
    }
    else
    if(cmd==="custom-fType")
        feildObj.fType = value;
    else
    if(["fSize","fWidth"].includes(cmd))
        feildObj[cmd] =  Number(value);
    else
    if(["bold","italic","underline"].includes(cmd)){
        feildObj[cmd] = cmd in feildObj ? !(feildObj[cmd]) : true;
        e.target.classList.toggle("selected-btn-2");
    }
    else
        feildObj[cmd] = value;
    if(e.target.type==="range")
        commonFunc_range(e.target,value);
}

function drawFeildText(feildObj){
    // The Field class paints its own canvas (legacy drawFeildText recipe).
    if(!(feildObj instanceof Field))
        feildObj = new Field(feildObj);
    feildObj.draw(mainDiv, page);
}

function createFeildCanvas(){
    // Field.createCanvas carries the two legacy zoom fixes: the canvas gets
    // dataset.left/top (zoomFunc repositions it like sections) and
    // style.left/top honor the current zoomFactor instead of logical px.
    return new Field(feildObj).createCanvas(mainDiv, zoomFactor);
}

function insertFeild(){
    feildObj.id = "id" in feildObj ? feildObj.id : uuid.v4();
    if(!(page.feilds.some(obj=>obj.id===feildObj.id)))
        pushHistory(); // a brand-new feild; edits to existing ones already opened a session
    let feildCanv = "elem" in feildObj ? feildObj.elem : createFeildCanvas();
    feildObj.elem = feildCanv;
    feildObj.zIndex = 100;
    drawFeildText(feildObj);
    if(!(page.feilds.some(obj=>obj.id===feildObj.id)))
        page.feilds.push(feildObj);
    removeAllElem("#adv-options *,#adv-options-2 *");
    if(feildObj.elem.classList.contains("image-placeholder")){
        let advOpt = document.getElementById("img-opt-template").content.cloneNode(true).querySelector("div");
        document.getElementById("adv-options").appendChild(advOpt);
    }
    else
        feildObj = {};
    let selectedBTN = document.querySelector(".selected-btn");
    if(selectedBTN) selectedBTN.classList.remove("selected-btn");
}

function cancelFeild(){
    let { elem } = feildObj;
    removeAllElem("#adv-options *,#adv-options-2 *");
    if(!(page.feilds.some(obj=>obj.id===feildObj.id))){
        elem?.remove();
        feildObj = {};
    }
}

// File OPs IPCs
ipcRenderer.on("new-template",async ()=>{
    let sig = await ipcRenderer.invoke("new-template-response",elemRemoval(page));
    if(!("response" in sig)) return console.error(sig);
    let { response } = sig;
    if(response===0){
        let _page = elemRemoval(page);
        ipcRenderer.send("save-bill-template",_page);
    }
    init();

});

function renderSection(){
    // The Section class draws its own canvas: border shape (rectangle /
    // rounded / circle / ellipse), partitions and table — and positions it
    // at x * zoomFactor (the legacy NaN-at-zoom load quirk, fixed).
    let section = new Section(actPointer).draw(mainDiv, page, zoomFactor);
    actPointer.id = section.dataset.id;
    selectedElem = section;
    return section;
}

/** Re-render the designer from a template object at the CURRENT zoomFactor
    (the legacy open path dropped the zoom — sections landed at raw x/y px).
    Used by Open, the template picker and undo/redo. */
function restorePage(_page){
    page = _page;
    syncMainSize();
    removeAllElem(".new-elem,.selector");
    borderCanvas.getContext("2d").clearRect(0,0,borderCanvas.width,borderCanvas.height);
    let header = mainDiv.querySelector("#blanck-header");
    let hasContent = ["head","body","footer"].some(key=>Object.keys(page[key] || {}).length>1)
        || page.sections.length>0 || page.feilds.length>0;
    if(hasContent)
        header.classList.add("hide");
    else
        header.classList.remove("hide");
    drawMargin();
    ["head","body","footer"]
    .forEach(key=>{
        if(Object.keys(page[key]).length>1){
            actPointer = page[key];
            let elem = renderSection();
            page[key].elem = elem;
            page[key].parentNode = mainDiv;
        }
    });
    page.sections.forEach(sec=>{
        actPointer = sec;
        let elem = renderSection();
        sec.elem = elem;
    });
    page.feilds.forEach(_feildObj=>{
        feildObj = _feildObj;
        let elem = createFeildCanvas();
        feildObj.elem = elem;
        feildObj.id = elem.dataset.id;
        drawFeildText(feildObj);
    });
    selectedElem = null;
    actPointer = {};
    feildObj = {};
    updateUI();
}

/** Match main's size to the page's paper size at the current zoom, keeping
    the zoomHelper caches consistent (width_100 / aspectRatio / per-zoom). */
function syncMainSize(){
    let { width,height } = appDefault[page.size] || appDefault.a4;
    mainDiv.dataset.width_100 = width;
    mainDiv.dataset.height_100 = height;
    mainDiv.dataset.aspectRatio = Math.round((width/height)*100)/100;
    Object.keys(mainDiv.dataset)
        .filter(key=>/^(width|height)_\d+$/.test(key))
        .forEach(key=>delete mainDiv.dataset[key]);
    mainDiv.style.width = roundOffTo2DecimalPlace(width*zoomFactor) + "px";
    mainDiv.style.height = roundOffTo2DecimalPlace(height*zoomFactor) + "px";
    borderCanvas.width = width*zoomFactor;
    borderCanvas.height = height*zoomFactor;
}

ipcRenderer.on("set-opened-file",(e,_page,filePath)=>{
    page = _page;
    page.newDoc = false;
    page.filePath = filePath;
    restorePage(page);
    undoStack = []; redoStack = []; dragSnap = null; // opened document — fresh history
});

ipcRenderer.on("save-as",()=>{
    let _page = elemRemoval(page);
    ipcRenderer.send("save-bill-template",_page,true);
});

//Image or logo handler
function imageBox(feildObj){
    // The Field class paints its own image placeholder (legacy imageBox).
    if(!(feildObj instanceof Field))
        feildObj = new Field(feildObj);
    feildObj.draw(mainDiv, page);
}

function imgOpts(e){
    let { dataset:{cmd},value,type,checked } = e.target;
    if(page.feilds.includes(feildObj)) historySession();
    removeSelector();
    if(type==="checkbox"){
        feildObj.applyAspectRatio = checked;
        feildObj.aspectRatio = "1:1";
        document.querySelector(`#adv-options [data-show="applyAspectRatio"]`).className = !checked ? "hide" : "";
    }
    else
    if(["imgWidth","imgHeight","imgOpacity"].includes(cmd)){
        if(type==="range")
            commonFunc_range(e.target,value);
        feildObj[cmd] = Math.round(Number(value));
        let [ widthProportion, heightProportion ] = ("aspectRatio" in feildObj ? feildObj.aspectRatio : "1:1").split(":").map(str=>Number(str));
        if(feildObj.applyAspectRatio && "imgWidth" in feildObj && cmd==="imgHeight"){
            feildObj.imgWidth = Math.round((widthProportion/heightProportion) * feildObj.imgHeight);
            document.querySelector(`.adv-option-div [data-cmd="imgWidth"]`).value = Math.round(feildObj.imgWidth);
            document.querySelector(`.adv-option-div [data-cmd="imgWidth"]`).dataset.msg = Math.round(feildObj.imgWidth) + "%";
        }
        if(feildObj.applyAspectRatio && "imgHeight" in feildObj && cmd==="imgWidth"){
            feildObj.imgHeight = Math.round((heightProportion/widthProportion) * feildObj.imgWidth);
            document.querySelector(`.adv-option-div [data-cmd="imgHeight"]`).value = Math.round(feildObj.imgHeight);
            document.querySelector(`.adv-option-div [data-cmd="imgHeight"]`).dataset.msg = Math.round(feildObj.imgHeight) + "%";
        }
        imageBox(feildObj);
    }
    else
        feildObj[cmd] = value;
}

// Starter templates & the Quick Variable picker (the modern shell's extras)

// ---------- Dry-run preview: the engine renders this design with a sample
// bill to a temp PDF (main process), displayed page-by-page via pdfjs ----------

let pdfjsLib;
function initPDFJS(){
    if(pdfjsLib) return pdfjsLib;
    // pdfjs-dist 3.x legacy UMD build; its bundled worker can't load from
    // the packaged app, so pdf.js falls back to the main-thread fake worker.
    pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
    return pdfjsLib;
}

async function togglePreview(){
    let panel = document.getElementById("preview-panel");
    let btn = document.getElementById("preview-btn");
    if(!panel.classList.contains("hide")){// back to Design
        panel.classList.add("hide");
        document.getElementById("workspace-scroll").classList.remove("hide");
        btn.classList.remove("active");
        return;
    }
    try{// fresh render on every press (dry-run semantics)
        let bytes = await ipcRenderer.invoke("preview-bill-template", elemRemoval(page));
        if(!bytes || bytes.error) throw new Error(bytes?.error || "The engine returned no PDF.");
        removeAllElem("#preview-pages *");
        let pdf = await initPDFJS().getDocument({ data: bytes }).promise;
        let pagesDiv = document.getElementById("preview-pages");
        for(let i = 1; i <= pdf.numPages; i++){
            let pageObj = await pdf.getPage(i);
            let viewport = pageObj.getViewport({ scale: 1 });
            let canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            pagesDiv.appendChild(canvas);
            await pageObj.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
        document.getElementById("workspace-scroll").classList.add("hide");
        panel.classList.remove("hide");
        btn.classList.add("active");
    }
    catch(err){
        console.error(err);
        alert("Preview failed: " + (err.message || err));
    }
}

function pickTemplate(e){
    let name = e.target.value;
    if(!name) return;
    e.target.selectedIndex = 0;
    const labels = {blank:"Blank", sections:"Three Sections", default1:"Default 1", default2:"Default 2"};
    if(!window.confirm(`Start a new design from the "${labels[name]}" template? This replaces the current design.`))
        return;
    page = buildStarter(name, appDefault).toJSON();
    restorePage(page);
    undoStack = []; redoStack = []; dragSnap = null; // starter document — fresh history
}

function addQuickVariable(){
    let custom = document.getElementById("custom-variable");
    let key = (custom.value || "").trim() || document.getElementById("variable-picker").value;
    if(!key) return;
    feildObj = new Field({
        type: "variable",
        fType: key,
        fSize: 16,
        fFamily: page.fFamily,
        fWidth: 50,
        text: "",
    }).toJSON();
    insertFeild();
    custom.value = "";
}

/** Fill the feild-option fType select and the Quick Variable picker from
    the variable registry's grouped keys (mutates the <template> itself, so
    every clone inherits the optgroups). */
function hydrateVariableUI(){
    removeAllElem("#adv-options *");
    let advOpt = document.getElementById("feild-option-template").content.cloneNode(true).querySelector("div");
    document.getElementById("adv-options").appendChild(advOpt);
    let fTypeSelect = document.querySelector("#field-option-1 [data-cmd='fType']");
    VARIABLE_GROUPS.forEach(({group,keys})=>{
        let optgroup = document.createElement("optgroup");
        optgroup.label = group;
        keys.forEach(key=>{
            let option = document.createElement("option");
            option.value = key;
            option.textContent = key;
            optgroup.appendChild(option);
        });
        fTypeSelect.appendChild(optgroup);
        let pickerGroup = document.createElement("optgroup");
        pickerGroup.label = group;
        keys.forEach(key=>{
            let option = document.createElement("option");
            option.value = key;
            option.textContent = key;
            pickerGroup.appendChild(option);
        });
        document.getElementById("variable-picker").appendChild(pickerGroup);
    });
    let datalist = document.getElementById("variable-datalist");
    ALL_VARIABLE_KEYS.forEach(key=>{
        let option = document.createElement("option");
        option.value = key;
        datalist.appendChild(option);
    });
}
hydrateVariableUI();