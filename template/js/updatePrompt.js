/**
 * updatePrompt.js
 *
 * Renders the update-available modal.
 * Receives {version, highlights[], fullchange[], message, qrDataUrl, changelogUrl, videoUrl}
 * from main process. Renders highlights (strings or {title,description,isNew} objects),
 * optional QR code + demo video, and sends the user's choice back.
 */

const { ipcRenderer } = require("electron");

// ---- State ----
let updateData = null;

// ---- IPC: receive update data ----
ipcRenderer.on("init-update-prompt", (event, data) => {
    updateData = data;
    renderAll(data);
});

/**
 * Render the entire modal
 */
function renderAll(data) {
    // Version
    let versionEl = document.getElementById("up-version");
    if (versionEl) versionEl.textContent = "v" + (data.version || "?.?.?");

    // Tagline
    let taglineEl = document.getElementById("up-tagline");
    if (taglineEl && data.message) taglineEl.textContent = data.message;

    // Highlights
    let highlights = data.highlights || [];
    renderHighlights(highlights);

    // Full changes
    let fullchange = data.fullchange || [];
    renderFullChanges(fullchange);

    // Extras: QR code + demo video
    renderExtras(data);
}

/**
 * Render highlights — supports both string and object formats.
 * String:  "New feature X"
 * Object:  { title: "Feature X", description: "Details about X", isNew: true }
 */
function renderHighlights(highlights) {
    let container = document.getElementById("up-highlights");
    if (!container) return;
    container.innerHTML = "";

    if (highlights.length === 0) {
        container.innerHTML = '<p class="up-highlight-text" style="font-style:italic">No highlights available.</p>';
        return;
    }

    highlights.forEach(item => {
        if (typeof item === "string") {
            renderStringHighlight(container, item);
        } else if (typeof item === "object" && item !== null && item.title) {
            renderCardHighlight(container, item);
        } else if (typeof item === "object" && item !== null && !item.title) {
            // Fallback: object without title — stringify the first value
            renderStringHighlight(container, JSON.stringify(item));
        }
    });
}

function renderStringHighlight(container, text) {
    let template = document.getElementById("up-highlight-string-template");
    let el = template.content.cloneNode(true).querySelector(".up-highlight-item");
    el.querySelector(".up-highlight-text").textContent = text;
    container.appendChild(el);
}

function renderCardHighlight(container, item) {
    let template = document.getElementById("up-highlight-card-template");
    let el = template.content.cloneNode(true).querySelector(".up-highlight-card");
    el.querySelector(".up-highlight-text").textContent = item.title;
    el.querySelector(".up-highlight-desc").textContent = item.description || "";

    // Hide description if empty
    if (!item.description) {
        let desc = el.querySelector(".up-highlight-desc");
        if (desc) desc.classList.add("hide");
    }

    // Show NEW badge
    if (item.isNew) {
        let badge = el.querySelector(".up-badge-sm");
        if (badge) badge.classList.remove("hide");
    }

    container.appendChild(el);
}

/**
 * Render full changes list inside the <details> block
 */
function renderFullChanges(fullchange) {
    let container = document.getElementById("up-fullchange-list");
    let details = document.getElementById("up-fullchange-details");
    if (!container || !details) return;

    container.innerHTML = "";

    if (!fullchange || fullchange.length === 0) {
        details.classList.add("hide");
        return;
    }

    details.classList.remove("hide");

    fullchange.forEach(item => {
        let text = typeof item === "string" ? item : (item.title || item.description || JSON.stringify(item));
        let template = document.getElementById("up-fullchange-item-template");
        let el = template.content.cloneNode(true).querySelector(".up-fullchange-item");
        el.querySelector(".up-fullchange-text").textContent = text;
        container.appendChild(el);
    });
}

/**
 * Render QR code and demo video if available
 */
function renderExtras(data) {
    let extras = document.getElementById("up-extras");
    let hasQR = !!(data.qrDataUrl);
    let hasVideo = !!(data.videoUrl);

    if (!hasQR && !hasVideo) {
        if (extras) extras.classList.add("hide");
        return;
    }

    if (extras) extras.classList.remove("hide");

    // QR Code
    let qrDiv = document.getElementById("up-qr");
    if (qrDiv && hasQR) {
        qrDiv.classList.remove("hide");
        let qrImg = document.getElementById("up-qr-img");
        if (qrImg) qrImg.src = data.qrDataUrl;
        let qrUrl = document.getElementById("up-qr-url");
        if (qrUrl) qrUrl.textContent = data.changelogUrl || "";
    } else if (qrDiv) {
        qrDiv.classList.add("hide");
    }

    // Demo Video
    let videoDetails = document.getElementById("up-video-details");
    if (videoDetails && hasVideo) {
        videoDetails.classList.remove("hide");
        let wrapper = document.getElementById("up-video-wrapper");
        if (wrapper) {
            wrapper.innerHTML = "";
            // Support both direct video URLs and YouTube/Vimeo embed URLs
            if (/youtube\.com|youtu\.be|vimeo\.com/.test(data.videoUrl)) {
                let iframe = document.createElement("iframe");
                iframe.src = data.videoUrl;
                iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                iframe.allowFullscreen = true;
                iframe.title = "Demo video";
                wrapper.appendChild(iframe);
            } else {
                let video = document.createElement("video");
                video.src = data.videoUrl;
                video.controls = true;
                video.preload = "metadata";
                video.style.width = "100%";
                video.style.height = "200px";
                wrapper.appendChild(video);
            }
        }
    } else if (videoDetails) {
        videoDetails.classList.add("hide");
    }
}

// ---- Button handlers ----

function handleDownload() {
    ipcRenderer.send("update-prompt-response", "download");
}

function handleLater() {
    ipcRenderer.send("update-prompt-response", "cancel");
}

// Expose for inline onclick (project convention)
window.handleDownload = handleDownload;
window.handleLater = handleLater;
