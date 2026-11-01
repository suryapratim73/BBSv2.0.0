// Cloud Connect — renderer logic for the Cloud page. Loaded by mainPage.html
// next to mainPage.js; applyMode() calls cloudPageInit() when the user opens
// the Cloud menu. All server work happens in main via lib/cloudConnect.js.
//
// NOTE: classic scripts share one global scope — mainPage.js (loaded first)
// already declares ipcRenderer, showToastNotification, appendToHost,
// removeAllElem and showEulaPage, so this file must NOT redeclare them
// (const collision).

// Same rules as lib/cloudConnectLogic.js — checked here too so the user
// gets feedback without a network round trip.
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cloudState = null;
let cloudActiveTab = "connect";

async function cloudPageInit(){
    let host = document.getElementById("cloud-div");
    if(!host) return;
    armCloudStatePush();
    cloudState = await ipcRenderer.invoke("cloud-get-state");
    renderCloudView(host);
}

// Main pushes "cloud-state-changed" after a protocol URL (bbs://verify-email)
// completes server-side — re-pull state so an open Cloud page updates live.
// Armed once: classic scripts share one global scope, so guard against
// re-invocations stacking listeners.
let cloudStatePushArmed = false;
function armCloudStatePush(){
    if(cloudStatePushArmed) return;
    cloudStatePushArmed = true;
    ipcRenderer.on("cloud-state-changed", async function(){
        cloudState = await ipcRenderer.invoke("cloud-get-state");
        let host = document.getElementById("cloud-div");
        if(host) renderCloudView(host);
    });
    ipcRenderer.on("cloud-verify-email-error", function(event, message){
        showToastNotification(message || "Email verification failed.", ["animation-common","move-left","red-toast-box"], "app-banner");
    });
}

function renderCloudView(host){
    removeAllElem("#cloud-div > *");
    if(cloudState && cloudState.signedIn)
        renderCloudDashboard(host);
    else
        renderCloudAuth(host);
}

// ---- signed-out view: connect / sign in --------------------------------

function renderCloudAuth(host){
    let content = appendToHost("#cloud-auth-template", host, "div");

    // TOTP setup replaces the auth form once the email link has verified —
    // the JWT-only state (step 4 done, token exchange pending) shows success.
    if(cloudState.pendingTotp)
        return showTotpSetup(host, false);
    if(cloudState.jwt)
        return showTotpSetup(host, true);

    let profile = cloudState?.profile || {};
    let prefill = cloudState?.prefill || {};

    content.querySelector("[name='gstNumber']").value = profile.gstNumber || prefill.gst || "";
    content.querySelector("[name='email']").value = profile.email || "";
    content.querySelector("[name='name']").value = profile.name || "";
    content.querySelector("[name='phone']").value = profile.phone || "";
    content.querySelector("[name='company_name']").value = profile.company_name || prefill.companyName || "";
    content.querySelector("[name='company_address']").value = profile.company_address || "";
    content.querySelector("[name='device_name']").value = cloudState?.deviceName || "";

    content.querySelector(".cc-tabs").addEventListener("click", function(e){
        let tab = e.target.dataset?.tab;
        if(!tab) return;
        switchCloudTab(content, tab);
    });
    content.querySelector("#cloud-auth-form").addEventListener("submit", cloudAuthSubmit);
    switchCloudTab(content, "connect");
    console.log({
        cond:cloudState.authSet==false && cloudState.verification_expires && cloudState.verification_expires>new Date(),
        cond1:cloudState.authSet==false, 
        cond2:cloudState.verification_expires,
        cond3:cloudState.verification_expires>new Date()
    })
    if(cloudState.authSet==false && cloudState.verification_expires && new Date(cloudState.verification_expires)>new Date())
        showWaitingPage(host);
}

function switchCloudTab(content, tab){
    cloudActiveTab = tab;
    content.querySelectorAll(".cc-tabs button").forEach(btn=>{
        btn.classList.toggle("selected", btn.dataset.tab === tab);
    });
    // Sign-in needs only GST + email; Connect also collects business details
    content.querySelectorAll(".cc-signup-only").forEach(field=>{
        field.classList.toggle("hide", tab === "signin");
    });

    content.querySelectorAll(".cc-signin-only").forEach(field=>{
        field.classList.toggle("hide", tab === "connect");
    });
    content.querySelector("#cc-submit").textContent = tab === "signin" ? "Sign In" : "Connect to Cloud";
    let err = content.querySelector("#cc-error");
    err.textContent = "";
    err.classList.add("hide");
}

async function cloudAuthSubmit(e){
    e.preventDefault();
    let form = e.target;
    let errBox = form.querySelector("#cc-error");
    errBox.classList.add("hide");

    let gst = form.querySelector("[name='gstNumber']").value.trim();
    let email = form.querySelector("[name='email']").value.trim();
    if(!GST_PATTERN.test(gst))
        return showCloudError(errBox, "Enter a valid GST number, e.g. 27AAPFU0939F1ZV.");
    if(!email)
        return showCloudError(errBox, "Enter your business email address.");
    if(!EMAIL_PATTERN.test(email))
        return showCloudError(errBox, "Enter a valid email address.");

    // Sign-in sends only the account identity — the server matches the
    // account by GST, and hidden signup fields must not overwrite details.
    let payload = { gstNumber: gst, email };
    if(cloudActiveTab === "connect"){
        payload.name = form.querySelector("[name='name']").value;
        payload.phone = form.querySelector("[name='phone']").value;
        payload.company_name = form.querySelector("[name='company_name']").value;
        payload.company_address = form.querySelector("[name='company_address']").value;
        payload.device_name = form.querySelector("[name='device_name']").value;
    }

    // Signup (Connect tab) is gated by the API EULA — one OK button, shown
    // on every connect attempt (no persistence, same rule as the app EULA).
    // Sign-in skips it: the account already accepted the terms at signup.
    if(cloudActiveTab === "connect"){
        let eulas = null;
        try { eulas = await ipcRenderer.invoke("get-eula-content"); } catch(_) {}
        let apiMd = eulas && eulas.api ? eulas.api : "";
        if(!apiMd)
            return showCloudError(errBox, "Could not load the API terms of service. Please try again.");
        showEulaPage({
            title: "BBSv2 API Terms of Service & License Agreement",
            markdown: apiMd,
            onOk: function(){ doCloudRegister(form, errBox, payload); }
        });
        return;
    }
    doCloudRegister(form, errBox, payload);
}

async function doCloudRegister(form, errBox, payload){
    let btn = form.querySelector("#cc-submit");
    btn.disabled = true;
    let result = await ipcRenderer.invoke("cloud-register", payload);
    btn.disabled = false;
    if(!result || result.ok !== true)
        return showCloudError(errBox, (result && result.error) || "Could not connect to BBS Cloud. Please try again.");

    cloudState = result.data;
    if(result.authSet){
        showToastNotification("Connected to BBS Cloud.", ["animation-common","move-left","blue-toast-box"], "app-banner");
        renderCloudView(document.getElementById("cloud-div"));
    }
    else{
        showToastNotification("Complete registration by following link sent on email.", ["animation-common","move-left","blue-toast-box"], "app-banner");
        showWaitingPage(document.getElementById("cloud-div"));
    }
}

function showWaitingPage(cloudDiv){
    removeAllElem("#cloud-div .cc-auth-card *");
    let ccAuthCard = cloudDiv.querySelector(".cc-auth-card");
    let template = document.getElementById("email-verification-template");
    ccAuthCard.appendChild(template.content.cloneNode(true));
    let emailNode = ccAuthCard.querySelector("#user-email");
    if(emailNode && cloudState.profile && cloudState.profile.email)
        emailNode.textContent = cloudState.profile.email;
}

// ---- TOTP setup (after the email verification link opened the app) ------

function showTotpSetup(host, successOnly){
    removeAllElem("#cloud-div .cc-auth-card *");
    let card = host.querySelector(".cc-auth-card");
    if(!card) return;
    let tpl = document.getElementById("totp-setup-template");
    card.appendChild(tpl.content.cloneNode(true));
    let form = card.querySelector("#cc-totp-form");
    let success = card.querySelector("#cc-totp-success");
    if(successOnly){
        form.classList.add("hide");
        success.classList.remove("hide");
        return;
    }
    success.classList.add("hide");
    let totp = cloudState.pendingTotp || {};
    card.querySelector("#cc-totp-qr").src = totp.qrCode || "";
    card.querySelector("#cc-totp-manual").textContent = totp.manualEntry || totp.secret || "";
    card.querySelector("#cc-totp-copy").addEventListener("click", function(){
        copyTotpManual(card.querySelector("#cc-totp-manual").textContent || "", this);
    });
    form.addEventListener("submit", totpSetupSubmit);
}

function copyTotpManual(text, btn){
    let done = function(){
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(function(){
            btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        }, 2000);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done).catch(function(){});
        return;
    }
    // fallback: select the code so the user can copy it manually
    let node = document.getElementById("cc-totp-manual");
    if(node){
        let range = document.createRange();
        range.selectNodeContents(node);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    }
    done();
}

async function totpSetupSubmit(e){
    e.preventDefault();
    let form = e.target;
    let errBox = form.querySelector("#cc-totp-error");
    errBox.classList.add("hide");
    let payload = {
        password: form.querySelector("[name='password']").value,
        confirmPassword: form.querySelector("[name='confirmPassword']").value,
        totpCode: form.querySelector("[name='totpCode']").value.trim()
    };
    if(payload.password !== payload.confirmPassword)
        return showCloudError(errBox, "Passwords do not match.");
    let btn = form.querySelector("#cc-totp-submit");
    btn.disabled = true;
    let result = await ipcRenderer.invoke("cloud-verify-totp", payload);
    btn.disabled = false;
    if(!result || result.ok !== true)
        return showCloudError(errBox, (result && result.error) || "Could not verify the authentication code. Please try again.");
    cloudState = result.data;
    if(cloudState && cloudState.signedIn){
        // the JWT exchange succeeded — jump straight to the signed-in view
        showToastNotification("Verification complete — you're signed in to BBS Cloud.", ["animation-common","move-left","blue-toast-box"], "app-banner");
        renderCloudView(document.getElementById("cloud-div"));
    } else {
        // exchange unavailable (older server) — the JWT is stored and the
        // signed-in state arrives on the next Connect
        showToastNotification("Verification complete — your JWT is stored on this device.", ["animation-common","move-left","blue-toast-box"], "app-banner");
        showTotpSetup(document.getElementById("cloud-div"), true);
    }
}

function showCloudError(errBox, msg){
    errBox.textContent = msg;
    errBox.classList.remove("hide");
}

// ---- signed-in view: remote dashboard -------------------------------

function renderCloudDashboard(host){
    let content = appendToHost("#cloud-dashboard-template", host, "div");
    let profile = cloudState?.profile || {};

    content.querySelector("#cc-val-company").textContent = profile.company_name || "—";
    content.querySelector("#cc-val-gst").textContent = profile.gstNumber || "—";
    content.querySelector("#cc-val-email").textContent = profile.email || "—";
    content.querySelector("#cc-val-contact").textContent = [profile.name, profile.phone].filter(Boolean).join(" · ") || "—";
    content.querySelector("#cc-val-address").textContent = profile.company_address || "—";
    content.querySelector("#cc-val-device-name").textContent = cloudState.deviceName || "—";
    content.querySelector("#cc-val-platform").textContent = platformLabel(cloudState.platform);
    content.querySelector("#cc-val-device-id").textContent = cloudState.deviceId || "—";
    content.querySelector("#cc-val-user-id").textContent = cloudState.userId || "—";
    content.querySelector("#cc-val-beta").textContent = cloudState.isDev ? "Beta tester" : "Standard";
    content.querySelector("#cc-val-beta").classList.toggle("cc-beta", cloudState.isDev);
    content.querySelector("#cc-val-last").textContent = cloudState.lastConnectedAt ? formatDateTime(cloudState.lastConnectedAt) : "—";
    content.querySelector("#cc-last-connected").textContent = cloudState.lastConnectedAt ? `Last connected ${formatDateTime(cloudState.lastConnectedAt)}` : "";

    let refreshBtn = content.querySelector("#cc-btn-refresh");
    refreshBtn.addEventListener("click", function(){ cloudRefreshConnection(content); });

    // Two-click sign out — no extra modal for a rare, deliberate action
    let signoutBtn = content.querySelector("#cc-btn-signout");
    let signoutArmed = false;
    signoutBtn.addEventListener("click", function(){
        if(!signoutArmed){
            signoutArmed = true;
            signoutBtn.classList.add("cc-danger");
            signoutBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Click again to sign out';
            setTimeout(()=>{
                signoutArmed = false;
                signoutBtn.classList.remove("cc-danger");
                signoutBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Sign out';
            }, 3000);
            return;
        }
        cloudSignout(content);
    });
}

async function cloudRefreshConnection(content){
    let btn = content.querySelector("#cc-btn-refresh");
    let icon = btn.querySelector("i");
    btn.disabled = true;
    if(icon) icon.classList.add("fa-spin");
    let result = await ipcRenderer.invoke("cloud-refresh");
    if(icon) icon.classList.remove("fa-spin");
    btn.disabled = false;
    if(!result || result.ok !== true){
        showToastNotification((result && result.error) || "Could not refresh the connection.", ["animation-common","move-left","red-toast-box"], "app-banner");
        return;
    }
    cloudState = result.data;
    showToastNotification("Connection refreshed.", ["animation-common","move-left","blue-toast-box"], "app-banner");
    renderCloudView(document.getElementById("cloud-div"));
}

async function cloudSignout(content){
    let btn = content.querySelector("#cc-btn-signout");
    btn.disabled = true;
    let result = await ipcRenderer.invoke("cloud-signout");
    if(!result || result.ok !== true){
        btn.disabled = false;
        showToastNotification("Could not sign out. Please try again.", ["animation-common","move-left","red-toast-box"], "app-banner");
        return;
    }
    cloudState = result.data;
    showToastNotification("Signed out of BBS Cloud.", ["animation-common","move-left","blue-toast-box"], "app-banner");
    renderCloudView(document.getElementById("cloud-div"));
}

function platformLabel(platform){
    return platform === "win" ? "Windows" : platform === "linux" ? "Linux" : (platform || "—");
}

function formatDateTime(iso){
    let dt = new Date(iso);
    if(isNaN(dt.getTime())) return "";
    return dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
