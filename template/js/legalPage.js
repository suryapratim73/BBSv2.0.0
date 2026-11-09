// Legal — standalone window page (opened from BBS → Legal, like the Sale
// page). Hosts both agreements in tabs: App EULA and API Terms of Service.
// Content is bundled markdown served by lib/eula.js through the
// get-eula-content IPC and rendered with renderMarkdown from common.js —
// the same renderer the EULA gate modals use.

const { ipcRenderer } = require("electron");
const { renderMarkdown } = require("../js/common");

const PANES = {
    app: { title: "BBSv2 End User License Agreement" },
    api: { title: "BBSv2 API Terms of Service & License Agreement" }
};

async function legalPageInit(){
    let eulas = null;
    try { eulas = await ipcRenderer.invoke("get-eula-content"); } catch(_) {}
    eulas = eulas && typeof eulas === "object" ? eulas : {};
    fillPane("app", eulas.app);
    fillPane("api", eulas.api);
    document.querySelector(".legal-tabs").addEventListener("click", switchLegalTab);
}

/** Title + scrollable rendered markdown body for one tab's pane. */
function fillPane(tab, markdown){
    let pane = document.getElementById(`legal-pane-${tab}`);
    if(!pane) return;
    pane.innerHTML = "";
    let head = document.createElement("h2");
    head.className = "legal-doc-title";
    head.textContent = PANES[tab].title;
    let body = document.createElement("div");
    body.className = "legal-doc";
    body.innerHTML = renderMarkdown(markdown || "") || "The document could not be loaded.";
    pane.appendChild(head);
    pane.appendChild(body);
}

function switchLegalTab(e){
    let tab = e.target.dataset && e.target.dataset.tab;
    if(!tab || !PANES[tab]) return;
    document.querySelectorAll(".legal-tab").forEach(btn=>{
        btn.classList.toggle("selected", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".legal-pane").forEach(pane=>{
        pane.classList.toggle("hide", pane.id !== `legal-pane-${tab}`);
    });
}

legalPageInit();
