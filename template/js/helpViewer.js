const { ipcRenderer } = require("electron");
const { renderMarkdown } = require("../js/common");

let rawMarkdown = "";
let userRole = "admin"; // default; updated by main process

function filterSections(html) {
    // Parse section headers for role/status markers
    const sectionRegex = /<h2>(.+?)(?: <!-- (role: admin|status: unavailable) -->)?<\/h2>/g;
    const sections = [];
    let match;
    let lastIndex = 0;

    // Find all h2 positions
    const h2Regex = /<h2>/g;
    const h2Positions = [];
    while ((match = h2Regex.exec(html)) !== null) {
        h2Positions.push(match.index);
    }

    // Parse each section
    const headerRegex = /<h2>(.+?)(?: <!-- (role: admin|status: unavailable) -->)?<\/h2>/g;
    const sectionData = [];
    while ((match = headerRegex.exec(html)) !== null) {
        sectionData.push({
            fullMatch: match[0],
            title: match[1],
            marker: match[2] || null,
            startIndex: match.index,
            endIndex: match.index + match[0].length
        });
    }

    if (sectionData.length === 0) return html;

    // Build filtered HTML
    let result = html.substring(0, sectionData[0].startIndex);

    for (let i = 0; i < sectionData.length; i++) {
        const sec = sectionData[i];
        let contentStart = sec.endIndex;
        let contentEnd = i < sectionData.length - 1
            ? sectionData[i + 1].startIndex
            : html.length;

        // Check if section should be skipped
        let skip = false;
        if (sec.marker === "status: unavailable") {
            skip = true;
        } else if (sec.marker === "role: admin" && userRole !== "admin") {
            skip = true;
        }

        if (!skip) {
            // Keep the header but strip the marker comment
            const cleanHeader = sec.fullMatch.replace(/ <!-- (?:role: admin|status: unavailable) -->/, '');
            result += cleanHeader + html.substring(contentStart, contentEnd);
        }
    }

    return result;
}

async function init() {
    try {
        const { content, role } = await ipcRenderer.invoke("get-help-content");
        userRole = role || "admin";
        rawMarkdown = content;
        let html = renderMarkdown(content);
        html = filterSections(html);
        document.getElementById("help-content").innerHTML = html;
    } catch (err) {
        document.getElementById("help-content").innerHTML =
            '<p class="error">Failed to load help content: ' + err.message + '</p>';
    }
}

function searchHelp() {
    const query = document.getElementById("help-search").value.trim().toLowerCase();
    const content = document.getElementById("help-content");

    // Remove previous highlights
    content.querySelectorAll("mark").forEach(m => {
        m.replaceWith(m.textContent);
    });

    if (!query) return;

    // Highlight matches in text nodes
    function highlightNode(node) {
        if (node.nodeType === 3) { // Text node
            const text = node.textContent;
            const lower = text.toLowerCase();
            const idx = lower.indexOf(query);
            if (idx === -1) return;
            const span = document.createElement("span");
            span.innerHTML =
                text.substring(0, idx) +
                "<mark>" + text.substring(idx, idx + query.length) + "</mark>" +
                text.substring(idx + query.length);
            node.replaceWith(span);
        } else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "MARK"].includes(node.tagName)) {
            node.childNodes.forEach(highlightNode);
        }
    }

    content.childNodes.forEach(highlightNode);

    // Scroll to first match
    const firstMark = content.querySelector("mark");
    if (firstMark) firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeWindow() {
    ipcRenderer.send("close-help-window");
}

init();
