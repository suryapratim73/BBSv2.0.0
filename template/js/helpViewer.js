const { ipcRenderer } = require("electron");

let rawMarkdown = "";
let userRole = "admin"; // default; updated by main process

function renderMarkdown(md) {
    // Skip the HELP-META comment block
    md = md.replace(/<!-- HELP-META[\s\S]*?HELP-META -->/, "");

    let html = md;

    // Code blocks (```)

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

    // Unordered lists — group consecutive items
    html = html.replace(/(?:^- .+\n?)+/gm, function(match) {
        const items = match.trim().split('\n').map(line =>
            '<li>' + line.replace(/^- /, '') + '</li>'
        ).join('');
        return '<ul>' + items + '</ul>';
    });

    // Ordered lists
    html = html.replace(/(?:^\d+\. .+\n?)+/gm, function(match) {
        const items = match.trim().split('\n').map(line =>
            '<li>' + line.replace(/^\d+\. /, '') + '</li>'
        ).join('');
        return '<ol>' + items + '</ol>';
    });

    // Tables — basic support
    html = html.replace(/(?:(?:\|.+\|[\s\S]*?)(?=\n\n|\n$|$))/gm, function(match) {
        const lines = match.trim().split('\n').filter(l => l.includes('|') && !l.match(/^\|[-:| ]+\|$/));
        if (lines.length === 0) return match;
        const rows = lines.map(line => {
            const cells = line.split('|').filter(c => c.trim() !== '');
            const tag = line === lines[0] ? 'th' : 'td';
            return '<tr>' + cells.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
        }).join('');
        // Skip the header separator row
        const cleanLines = lines.filter(l => !l.match(/^\|[-:| ]+\|$/));
        const headerRow = cleanLines[0];
        const bodyRows = cleanLines.slice(1);
        const thead = '<thead><tr>' + headerRow.split('|').filter(c => c.trim() !== '').map(c => '<th>' + c.trim() + '</th>').join('') + '</tr></thead>';
        const tbody = '<tbody>' + bodyRows.map(line => {
            const cells = line.split('|').filter(c => c.trim() !== '');
            return '<tr>' + cells.map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>';
        }).join('') + '</tbody>';
        return '<table>' + thead + tbody + '</table>';
    });

    // Paragraphs — any remaining text blocks
    // Split by double newlines and wrap in <p>
    const blocks = html.split(/\n\n+/);
    html = blocks.map(block => {
        block = block.trim();
        if (!block) return '';
        // Skip blocks that are already HTML tags
        if (/^<(h[1-4]|ul|ol|pre|table|blockquote|hr|div|code)/.test(block)) return block;
        // Replace single newlines with <br> inside paragraphs
        block = block.replace(/\n/g, '<br>');
        return '<p>' + block + '</p>';
    }).join('\n');

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
}

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
