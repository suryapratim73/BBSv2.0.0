/**
 * kioskServer.js — BBS Kiosk Mode
 *
 * Spins up a local HTTP server that serves a mobile-friendly sale interface.
 * Accessible from any device on the same network via the machine's LAN IP.
 *
 * KIOSK_ENABLED — set to true when frontend is complete (v2.23).
 *
 * Endpoints:
 *   GET  /              → kiosk login page (PIN entry)
 *   POST /api/login     → verify PIN, return session token
 *   GET  /sale          → kiosk sale page (protected)
 *   GET  /api/products  → list all stock items with prices
 *   GET  /api/customers → search customers by name/phone
 *   POST /api/sale      → create a new sale
 *   GET  /api/status    → server health check
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const url = require("url");
const crypto = require("crypto");

// ---- State ----
let server = null;
let serverPort = 0;
let kioskPIN = "";           // set from app policy or config
let kioskConfig = {};        // kiosk configuration loaded from kioskConf.json
let activeTokens = new Set(); // simple session tokens
const TOKEN_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// ---- Helpers ----
function getLocalIP() {
    const nets = os.networkInterfaces();
    var best = null;
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family !== "IPv4" || net.internal) continue;
            // Prefer common LAN prefixes (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
            if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address))
                return net.address;
            if (!best) best = net.address;
        }
    }
    return best || "127.0.0.1";
}

function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

function parseBody(req) {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            try { resolve(JSON.parse(body)); } catch (_) { resolve({}); }
        });
    });
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}

function serveFile(res, filePath, contentType) {
    try {
        const fullPath = path.join(__dirname, filePath);
        const content = fs.readFileSync(fullPath, "utf8");
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
    } catch (_) {
        res.writeHead(404);
        res.end("Not found");
    }
}

// ---- Auth middleware ----
function checkAuth(req) {
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/kiosk_token=([^;]+)/);
    if (!match) return false;
    return activeTokens.has(match[1]);
}

/**
 * Auto-categorizes products by detecting keywords in their names.
 * Returns an object mapping category names to arrays of product objects.
 * Common retail keywords are used as category hints.
 * @param {Array} products - Array of product objects with a `name` field
 * @returns {Object} { layout: "auto", categories: { "Category Name": [products...] } }
 */
function autoCategorizeProducts(products) {
    // Keyword-to-category mapping — products whose names contain these words get grouped
    const keywordMap = {
        "Rice": ["rice", "basmati", "sona", "ponni", "chawal"],
        "Flour & Atta": ["flour", "atta", "maida", "sooji", "rava", "besan", "wheat"],
        "Pulses & Dal": ["dal", "pulse", "chana", "moong", "masoor", "toor", "urad", "gram", "lentil", "chickpea"],
        "Oil & Ghee": ["oil", "ghee", "mustard", "sunflower", "groundnut", "coconut oil", "butter"],
        "Spices": ["spice", "masala", "turmeric", "chilli", "coriander", "cumin", "jeera", "pepper", "cardamom", "clove", "cinnamon", "garam"],
        "Tea & Coffee": ["tea", "coffee", "chai", "espresso", "latte"],
        "Beverages": ["drink", "juice", "soda", "water", "cola", "smoothie", "shake", "milk"],
        "Snacks": ["snack", "chips", "biscuit", "cookie", "namkeen", "mixture", "nuts", "cashew", "almond"],
        "Dairy": ["milk", "paneer", "cheese", "curd", "yogurt", "dahi", "cream", "butter"],
        "Vegetables": ["vegetable", "potato", "onion", "tomato", "brinjal", "cabbage", "carrot", "beans", "spinach"],
        "Fruits": ["fruit", "apple", "banana", "mango", "orange", "grape", "papaya"],
        "Bakery": ["bread", "cake", "pastry", "bun", "puff", "toast"],
        "Personal Care": ["soap", "shampoo", "cream", "lotion", "paste", "brush", "powder", "oil hair", "deodorant"],
        "Cleaning": ["clean", "detergent", "wash", "bleach", "floor", "glass", "dishwash", "mop"],
        "Electronics": ["cable", "charger", "battery", "bulb", "led", "lamp", "phone", "adapter"]
    };

    // Initialize category buckets
    const categories = {};
    const categorized = new Set(); // track which products have been assigned

    // First pass: assign products to categories by keyword match
    for (const [category, keywords] of Object.entries(keywordMap)) {
        const matches = products.filter(p => {
            const nameLower = (p.name || "").toLowerCase();
            return keywords.some(kw => nameLower.includes(kw));
        });
        if (matches.length > 0) {
            categories[category] = matches;
            matches.forEach(p => categorized.add(p.id));
        }
    }

    // Second pass: gather uncategorized products
    const uncategorized = products.filter(p => !categorized.has(p.id));

    return {
        layout: "auto",
        categories: categories,
        uncategorized: uncategorized
    };
}

// ---- Request router ----
async function handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const route = parsed.pathname;
    const method = req.method.toUpperCase();

    // ---- Static pages ----
    if (method === "GET" && route === "/") {
        return serveFile(res, "template/html/kioskLogin.html", "text/html");
    }
    if (method === "GET" && route === "/sale") {
        if (!checkAuth(req)) {
            res.writeHead(302, { Location: "/" });
            return res.end();
        }
        return serveFile(res, "template/html/kioskSale.html", "text/html");
    }
    // Serve static assets
    if (method === "GET" && route === "/kiosk.css") {
        return serveFile(res, "template/css/kiosk.css", "text/css");
    }
    if (method === "GET" && route === "/kiosk.js") {
        return serveFile(res, "template/js/kiosk.js", "application/javascript");
    }
    if (method === "GET" && route === "/css/common.css") {
        return serveFile(res, "template/css/common.css", "text/css");
    }

    // ---- API: Login ----
    if (method === "POST" && route === "/api/login") {
        const body = await parseBody(req);
        if (Number(body.pin) === kioskPIN) {
            const token = generateToken();
            activeTokens.add(token);
            // Auto-expire token
            setTimeout(() => activeTokens.delete(token), TOKEN_TIMEOUT);
            return sendJSON(res, { token, success: true });
        }
        return sendJSON(res, { success: false, error: "Invalid PIN" }, 401);
    }

    // ---- API: Logout ----
    if (method === "POST" && route === "/api/logout") {
        const cookies = req.headers.cookie || "";
        const match = cookies.match(/kiosk_token=([^;]+)/);
        if (match) activeTokens.delete(match[1]);
        return sendJSON(res, { success: true });
    }

    // ---- Protected routes below ----
    if (!checkAuth(req)) {
        return sendJSON(res, { error: "Unauthorized" }, 401);
    }

    // ---- API: Kiosk config (non-sensitive settings for the sale page) ----
    if (method === "GET" && route === "/api/config") {
        return sendJSON(res, {
            includeCustomerSelector: kioskConfig.includeCustomerSelector !== false, // default true
            productLayout: kioskConfig.productLayout || "uncategorized",
            generateReceipt: kioskConfig.generateReceipt !== false                  // default true
        });
    }

    // ---- API: Product list (v1 — flat list of all stock) ----
    if (method === "GET" && route === "/api/products") {
        try {
            const { stock } = require("./model/dbConfig");
            const rows = await (await stock.sync()).findAll({ raw: true });
            const products = rows.map((p) => ({
                id: p.id,
                name: p.name,
                hsn: p.hsn,
                rate: (function() {
                    var r = p.standardSellPrice || 0;
                    // Fallback to last sale price from pHistory
                    if (!r && p.pHistory) {
                        try {
                            var h = typeof p.pHistory === "string" ? JSON.parse(p.pHistory) : p.pHistory;
                            if (Array.isArray(h) && h.length > 0) r = h[h.length - 1].rate;
                        } catch (_) {}
                    }
                    return r || 0;
                })(),
                unit: p.unit || "pcs",
                sgst: p.sgst || 0,
                cgst: p.cgst || 0,
                igst: p.igst || 0,
                quantity: p.quantity || 0,
            }));
            return sendJSON(res, products);
        } catch (err) {
            return sendJSON(res, { error: String(err) }, 500);
        }
    }

    // ---- API: Customer search ----
    if (method === "GET" && route === "/api/customers") {
        try {
            const query = (parsed.query.q || "").toLowerCase();
            const { customer } = require("./model/dbConfig");
            const rows = await (await customer.sync()).findAll({ raw: true });
            const results = rows
                .filter((c) => {
                    const name = (c.name || "").toLowerCase();
                    const phone = (c.phones || "").toLowerCase();
                    return name.includes(query) || phone.includes(query);
                })
                .slice(0, 20)
                .map((c) => ({
                    id: c.id,
                    name: c.name,
                    phones: c.phones,
                    address: c.address,
                    gst: c.gst
                }));
            return sendJSON(res, results);
        } catch (err) {
            return sendJSON(res, { error: String(err) }, 500);
        }
    }

    // ---- API: Fuzzy product search (uses main process n-gram index) ----
    if (method === "GET" && route === "/api/search") {
        var query = (parsed.query.q || "").toLowerCase().trim();
        try {
            const { stock: stockModel } = require("./model/dbConfig");
            const rows = await (await stockModel.sync()).findAll({ raw: true });
            // Helper: get full product object by name or superkey
            function productByNameOrKey(name) {
                return rows.find(function(p) {
                    return p.name === name || (p.itemNo && p.itemNo === name);
                });
            }
            if (!query || query.length < 3) {
                return sendJSON(res, rows.map(function(p) {
                    return { id: p.id, name: p.name, hsn: p.hsn,
                        rate: p.standardSellPrice || 0,
                        unit: p.unit || "pcs",
                        sgst: p.sgst || 0, cgst: p.cgst || 0, igst: p.igst || 0,
                        quantity: p.quantity || 0 };
                }));
            }
            var ngram = global.nGramIndex;
            if (!ngram || !ngram.stock) {
                // Fallback: substring filter
                return sendJSON(res, rows.filter(function(p) {
                    return (p.name || "").toLowerCase().includes(query);
                }).slice(0, 20).map(function(p) {
                    return { id: p.id, name: p.name, hsn: p.hsn,
                        rate: p.standardSellPrice || 0,
                        unit: p.unit || "pcs",
                        sgst: p.sgst || 0, cgst: p.cgst || 0, igst: p.igst || 0,
                        quantity: p.quantity || 0 };
                }));
            }
            // Generate trigrams from query
            var grams = [];
            for (var i = 0; i <= query.length - 3; i++) {
                grams.push(query.substring(i, i + 3));
            }
            // Score matches — handle both strings and HTMLOptionElements
            var scores = {};
            grams.forEach(function(g) {
                var vals = ngram.stock[g] || [];
                vals.forEach(function(v) {
                    var key = (typeof v === "string") ? v : (v && v.value ? v.value : "");
                    if (!key) return;
                    scores[key] = (scores[key] || 0) + 1;
                });
            });
            var matchedProducts = Object.keys(scores)
                .sort(function(a, b) { return scores[b] - scores[a]; })
                .slice(0, 20)
                .map(function(name) { return productByNameOrKey(name); })
                .filter(Boolean);
            return sendJSON(res, matchedProducts.map(function(p) {
                return { id: p.id, name: p.name, hsn: p.hsn,
                    rate: p.standardSellPrice || 0,
                    unit: p.unit || "pcs",
                    sgst: p.sgst || 0, cgst: p.cgst || 0, igst: p.igst || 0,
                    quantity: p.quantity || 0 };
            }));
        } catch (err) {
            return sendJSON(res, { error: String(err) }, 500);
        }
    }

    // ---- API: Create sale ----
    if (method === "POST" && route === "/api/sale") {
        try {
            const { customerId, customerName, items, payment = 0 } = await parseBody(req);
            if (!items || !items.length) {
                return sendJSON(res, { error: "No items in cart" }, 400);
            }

            // Allow anonymous sales when customer selector is disabled
            // customerId will be null/undefined for walk-in purchases
            const effectiveCustomerId = customerId || null;
            const effectiveCustomerName = customerName || "Walk-in Customer";

            // Build sale data for the main process handler
            const saleData = {
                customerId: effectiveCustomerId,
                customerName: effectiveCustomerName,
                items,
                payment,
                isKioskSale: true
            };

            // Forward to the main process handler via ipcMain.emit
            const { ipcMain } = require("electron");
            ipcMain.emit("kiosk-create-sale", { sender: { id: null } }, saleData);

            return sendJSON(res, { success: true, message: "Sale created" });
        } catch (err) {
            return sendJSON(res, { error: String(err) }, 500);
        }
    }

    // ---- API: Server status (no auth required) ----
    if (method === "GET" && route === "/api/status") {
        return sendJSON(res, { status: "running", port: serverPort });
    }

    // ---- 404 ----
    res.writeHead(404);
    res.end("Not found");
}

// ---- Public API ----
/**
 * Starts the kiosk HTTP server.
 * @param {number} port - Port to listen on (0 = random available port)
 * @param {string} pin  - PIN code for kiosk login authentication
 * @param {object} config - Kiosk configuration object (from kioskConf.json)
 * @returns {Promise<{success: boolean, port?: number, ip?: string, error?: string}>}
 */
function start(port = 0, pin = "1234", config = {}) {
    if (server) return { success: false, error: "Already running" };

    kioskPIN = Number(pin);
    kioskConfig = config || {};

    return new Promise((resolve) => {
        server = http.createServer(handleRequest);
        server.listen(port, () => {
            serverPort = server.address().port;
            const ip = getLocalIP();
            console.log(`[Kiosk] Server running at http://${ip}:${serverPort}`);
            console.log(`[Kiosk] Config: layout=${kioskConfig.productLayout || "uncategorized"}, dbMode=${kioskConfig.dbMode || "order-only"}`);
            resolve({ success: true, port: serverPort, ip });
        });
        server.on("error", (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

function stop() {
    return new Promise((resolve) => {
        if (!server) return resolve({ success: false, error: "Not running" });
        activeTokens.clear();
        server.close(() => {
            server = null;
            serverPort = 0;
            console.log("[Kiosk] Server stopped");
            resolve({ success: true });
        });
    });
}

function getStatus() {
    return {
        running: server !== null,
        port: serverPort,
        ip: server ? getLocalIP() : null,
        activeSessions: activeTokens.size
    };
}

module.exports = { start, stop, getStatus, ENABLED: true };
