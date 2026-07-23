/**
 * viewManager.js
 *
 * Centralized view + theme management:
 *   1. getTemplatePath() — standard HTML template path (used by all handlers)
 *   2. Weather-based theming — fetches theme from VPS, injects CSS class
 *   3. Announcement banners — fetches banner config from VPS, injects into renderer
 *
 * Server endpoints (you build on VPS):
 *   GET /api/weather-theme   → { theme: "monsoon" } or { theme: "none" }
 *   GET /api/announcement     → banner config object or null
 */

const path = require("path");
const fs = require("fs");
const axios = require("axios");

// ---- Config ----
const TIMEOUT = 4000;

// ---- Base directories ----
const TEMPLATE_DIR = path.join(__dirname, "template", "html");

// ---- Cached state ----
let lastTheme = null;
let lastThemeChkTime = new Date(0); // epoch — forces first fetch
let lastBanner = null;
let inflightFetch = null;
let lastUserThemeObj = null;
let weatherInterval = null; // hourly refresh timer

// ---- Dismissed banner storage ----
function getDismissedPath() {
    const { app } = require("electron");
    const base = process.env.APP_ENV === "PROD"
        ? app.getPath("appData")
        : __dirname;
    return path.resolve(base, "dismissed_banners.json");
}

function getDismissedBanners() {
    try {
        const p = getDismissedPath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, "utf8"));
        }
    } catch (_) { /* corrupt — start fresh */ }
    return [];
}

function saveDismissedBanner(bannerId) {
    try {
        const dismissed = getDismissedBanners();
        if (!dismissed.includes(bannerId)) {
            dismissed.push(bannerId);
            fs.writeFileSync(getDismissedPath(), JSON.stringify(dismissed), "utf8");
        }
    } catch (_) { /* not critical */ }
}

function isBannerDismissed(bannerId) {
    return getDismissedBanners().includes(bannerId);
}

// ---- Standard template path (used by all handler files) ----
function getTemplatePath(viewName) {
    const fileName = viewName.endsWith(".html") ? viewName : `${viewName}.html`;
    return `./template/html/${fileName}`;
}

// ---- Fetch weather theme from server ----
async function fetchWeatherTheme(serverUrl, city) {
    if (!city) return null;
    const { appLogger } = require("./common");
    appLogger({ title: "Log", message: `Fetching weather theme from server: ${serverUrl}api/weather-theme?city=${encodeURIComponent(city)}`, func: "viewManager.fetchWeatherTheme", appendToLog: true });
    try {
        if (lastThemeChkTime && (new Date() - lastThemeChkTime) < 3600000 && lastTheme) {
            appLogger("Weather theme fetch skipped (last checked < 1 hour ago)");
            return lastTheme; // avoid excessive server calls // 1 call per hour is enough, since weather doesn't change that fast
        }
        if(!lastTheme){
            let _lastTheme = await getThemeCookie(); // restore user theme from cookie
            lastThemeChkTime = new Date(_lastTheme?.lastThemeChkTime ?? new Date(0));
            if(_lastTheme && typeof _lastTheme.themeFromServer !== 'undefined' && lastThemeChkTime && (new Date() - lastThemeChkTime) < 3600000) {
                lastTheme = _lastTheme.themeFromServer;
                appLogger({ title: "Log", message: `ViewManager: restored last theme from cookie`, func: "viewManager.fetchWeatherTheme", allowConsole: true, appendToLog: true });
                return lastTheme; // return last theme if available, else null
            }
        }
        const resp = await axios.get(`${serverUrl}api/weather-theme?city=${encodeURIComponent(city)}`, {
            timeout: TIMEOUT
        });
        appLogger({ title: "Log", message: `Weather theme response: ${JSON.stringify(resp.data)}`, func: "viewManager.fetchWeatherTheme", appendToLog: true });
        const theme = resp.data?.theme;
        if(resp.status === 200)
            lastThemeChkTime = new Date();
        if (theme && theme !== "none") {
            console.log("ViewManager: fetched weather theme from server:", { ...lastUserThemeObj, weatherColors: getWeatherColors(theme),themeFromServer:theme });
            lastTheme = theme;
            lastThemeChkTime = new Date();
            await storeUserThemeObj({ ...lastUserThemeObj, weatherColors: getWeatherColors(theme),themeFromServer:theme,lastThemeChkTime }); // persist for restoration after weather clear
            return theme;
        }
    } catch (err) {
        console.error("Weather theme fetch error:", err.code || err.message);
        appLogger({ title: "Log", message: `ViewManager: weather fetch skipped (${err.code || err.message})`, func: "viewManager.fetchWeatherTheme" });
    }
    return null;
}

// ---- Fetch announcement banner from server ----
async function fetchAnnouncement(serverUrl, deviceId, gstNumber) {
    const { appLogger } = require("./common");
    try {
        appLogger({ title: "Log", message: `Fetching announcement banner from server: ${serverUrl}api/announcement`, func: "viewManager.fetchAnnouncement", appendToLog: true });
        const resp = await axios.get(`${serverUrl}api/announcement`, {
            timeout: TIMEOUT,
            params: { deviceId, gstNumber }
        });
        const data = resp.data;
        if (!data || !data.id || !data.message) return null;

        // Check if already dismissed
        if (data.displayOnce !== false && isBannerDismissed(data.id)) {
            return null;
        }

        // Check expiry
        if (data.validUntil && new Date(data.validUntil) < new Date()) {
            return null;
        }

        return data;
    } catch (err) {
        appLogger({ title: "Log", message: `ViewManager: announcement fetch skipped (${err.code || err.message})`, func: "viewManager.fetchAnnouncement" });
    }
    return null;
}

// ---- Fetch custom festive theme from server ----
// Server returns JSON: { name, css, validUntil }
// CSS is cached locally and only re-fetched when expired.
let cachedCustomCSS = null;
let customThemeMeta = null;

function getCustomThemePath() {
    const { app } = require("electron");
    const base = process.env.APP_ENV === "PROD"
        ? app.getPath("appData")
        : __dirname;
    return path.resolve(base, "custom_theme.json");
}

async function fetchCustomTheme(serverUrl, deviceId, gstNumber) {
    // Check memory cache validity
    if (cachedCustomCSS && customThemeMeta?.validUntil) {
        if (new Date(customThemeMeta.validUntil) > new Date()) {
            return cachedCustomCSS;
        }
    }

    try {
        const resp = await axios.get(`${serverUrl}api/custom-theme`, {
            timeout: TIMEOUT,
            params: { deviceId, gstNumber }
        });
        const data = resp.data;
        if (!data || !data.css) return null;

        // Check expiry
        if (data.validUntil && new Date(data.validUntil) < new Date()) {
            // Expired — clear any cached CSS
            cachedCustomCSS = null;
            customThemeMeta = null;
            return null;
        }

        cachedCustomCSS = data.css;
        customThemeMeta = data;

        // Persist to disk for offline / next launch
        try {
            fs.writeFileSync(getCustomThemePath(), JSON.stringify(data), "utf8");
        } catch (_) {}

        return data.css;
    } catch (_) {
        // Server unreachable — try disk cache
        try {
            const p = getCustomThemePath();
            if (fs.existsSync(p)) {
                const data = JSON.parse(fs.readFileSync(p, "utf8"));
                if (data.validUntil && new Date(data.validUntil) > new Date()) {
                    cachedCustomCSS = data.css;
                    customThemeMeta = data;
                    return data.css;
                }
            }
        } catch (__) {}
        return null;
    }
}

// ---- Apply custom CSS to renderer ----
// Uses insertCSS which layers on top of existing styles (no replacement).
function applyCustomCSS(win, css) {
    if (!win || win.isDestroyed() || !css) return;
    try {
        // Remove previous custom CSS by key, then re-insert
        win.webContents.removeInsertedCSS("custom-theme").catch(() => {});
        win.webContents.insertCSS(css, { key: "custom-theme" }).catch(() => {});
    } catch (_) {}
}

// ---- Clear custom CSS from renderer ----
function clearCustomCSS(win) {
    if (!win || win.isDestroyed()) return;
    try {
        win.webContents.removeInsertedCSS("custom-theme").catch(() => {});
    } catch (_) {}
}

// ---- Theme class name builder ----
function buildThemeClass(theme) {
    if (!theme) return null;

    // Night time modifier (6 PM – 6 AM)
    const hour = new Date().getHours();
    const isNight = hour >= 18 || hour < 6;

    // Dark mode modifier (system preference)
    const { nativeTheme } = require("electron");
    const isDark = nativeTheme.shouldUseDarkColors;

    // Compose: theme-{weather}[-night][-dark]
    let cls = `theme-${theme}`;
    if (isNight) cls += " night-mode";
    if (isDark) cls += " dark-mode";
    return cls;
}

// ---- Apply theme class to renderer body ----
async function applyTheme(win, theme) {
    if (!win || win.isDestroyed()) return;
    const classList = buildThemeClass(theme);
    if (!classList) return;

    const allThemes = [
        'theme-summer', 'theme-monsoon', 'theme-winter',
        'theme-cloudy', 'theme-haze', 'theme-thunderstorm',
        'theme-festive', 'theme-night',
        'weather-theme-active', 'night-mode', 'dark-mode'
    ];

    // Match the CSS variables from themes.css for direct property override.
    // These must run AFTER common.js/applyTheme, so via booted event.
    const weatherColors = typeof lastUserThemeObj.weatherColors !== 'undefined' ? lastUserThemeObj.weatherColors : getWeatherColors(theme);
    try {
        win.webContents.executeJavaScript(`
            (function() {
                try {
                    const body = document.body;
                    if (!body) return;
                    body.classList.remove(...${JSON.stringify(allThemes)});
                    body.classList.add(...${JSON.stringify(classList.split(' '))}, 'weather-theme-active');
                    body.dataset.useWeatherTheme = 'true';
                    delete body.dataset.weatherReset;

                    // Directly set --theme-* so common.js/applyTheme doesn't wipe them
                    var root = document.documentElement;
                    ${Object.entries(weatherColors).map(([k, v]) =>
                        `root.style.setProperty('${k}', '${v}');`
                    ).join("\n                    ")}
                } catch(e) {}
            })();
        `).catch(() => {});
    } catch (_) {}
}

// ---- Weather → CSS property mapping for direct style override ----
function getWeatherColors(theme) {
    const colors = {
        summer:        { '--theme-primary': '#d4700a', '--theme-primary-lighter': '#e8842c', '--theme-shadow-color': '#b8a090' },
        monsoon:       { '--theme-primary': '#2c5f8a', '--theme-primary-lighter': '#4a7da8', '--theme-shadow-color': '#8a9aaa' },
        winter:        { '--theme-primary': '#6b8fad', '--theme-primary-lighter': '#8aacc7', '--theme-shadow-color': '#a0b8cc' },
        cloudy:        { '--theme-primary': '#6b7b8a', '--theme-primary-lighter': '#8a9aaa', '--theme-shadow-color': '#98a8b4' },
        haze:          { '--theme-primary': '#9b8c7a', '--theme-primary-lighter': '#b8a898', '--theme-shadow-color': '#c0b4a4' },
        thunderstorm:  { '--theme-primary': '#4a3f6b', '--theme-primary-lighter': '#6b5f8a', '--theme-shadow-color': '#7b7a90' },
        festive:       { '--theme-primary': '#cc5500', '--theme-primary-lighter': '#e87820', '--theme-shadow-color': '#d4a050' },
        night:         { '--theme-primary': '#1a1a3e', '--theme-primary-lighter': '#2d3561', '--theme-shadow-color': '#3a3f6b' }
    };
    return colors[theme] || {};
}

// ---- Apply announcement banner to renderer ----
function applyBanner(win, banner) {
    if (!win || win.isDestroyed()) return;
    try {
        const bannerJSON = JSON.stringify({
            id: banner.id,
            message: banner.message,
            bgColor: banner.bgColor || "#ff6b35",
            textColor: banner.textColor || "#ffffff",
            ctaText: banner.ctaText || "",
            ctaUrl: banner.ctaUrl || ""
        });

        win.webContents.executeJavaScript(`
            (function() {
                try {
                    var data = ${bannerJSON};
                    var el = document.getElementById('app-banner');
                    if (!el) return;

                    el.innerHTML = '';
                    el.style.backgroundColor = data.bgColor;
                    el.style.color = data.textColor;

                    var msg = document.createElement('span');
                    msg.textContent = data.message;
                    el.appendChild(msg);

                    if (data.ctaText) {
                        var cta = document.createElement('span');
                        cta.className = 'banner-cta';
                        cta.textContent = data.ctaText;
                        cta.addEventListener('click', function() {
                            require('electron').shell.openExternal(data.ctaUrl);
                        });
                        el.appendChild(cta);
                    }

                    var dismiss = document.createElement('span');
                    dismiss.className = 'banner-dismiss';
                    dismiss.title = 'Dismiss';
                    dismiss.textContent = '\\u00d7';
                    dismiss.addEventListener('click', function() {
                        el.classList.remove('visible');
                        require('electron').ipcRenderer.send('dismiss-banner', data.id);
                    });
                    el.appendChild(dismiss);

                    el.classList.add('visible');
                } catch(e) {}
            })();
        `).catch(() => {});
    } catch (_) {}
}

function createThemeCookie(themeObj) {
    const { session } = require("electron");
    const sesCookies = session.defaultSession.cookies;
    sesCookies.set({
        url: "http://localhost",
        name: "userThemeObj",
        value: JSON.stringify(themeObj),
        expirationDate: Math.floor(Date.now() / 1000) + 31536000 // 1 year
    }).catch(() => {});
}

function getThemeCookie() {
    const { session } = require("electron");
    const sesCookies = session.defaultSession.cookies;
    return sesCookies.get({ url: "http://localhost", name: "userThemeObj" })
        .then(cookies => {
            if (cookies.length > 0) {
                try {
                    return JSON.parse(cookies[0].value);
                } catch (_) {
                    return null;
                }
            }
            return null;
        })
        .catch(() => null);
}

function clearThemeCookie() {
    const { session } = require("electron");
    const sesCookies = session.defaultSession.cookies;
    sesCookies.remove("http://localhost", "userThemeObj").catch(() => {});
}

// ---- Store user theme for restoration after weather clear ----
// Merges with existing cookie so concurrent writes (initTheme vs weather fetch)
// don't wipe each other's fields (e.g. weatherColors / themeFromServer).
async function storeUserThemeObj(themeObj) {
    const existing = await getThemeCookie();
    const merged = { ...existing, ...themeObj };
    createThemeCookie(merged);
    lastUserThemeObj = merged;
}

// ---- Clear all weather theme effects and restore user theme ----
// Set permanent=true when disabling the feature entirely (hides toggle)
function clearWeatherTheme(win, permanent = false) {
    const { appLogger } = require("./common");
    if (!win || win.isDestroyed()) return;

    const allThemes = [
        'theme-summer', 'theme-monsoon', 'theme-winter',
        'theme-cloudy', 'theme-haze', 'theme-thunderstorm',
        'theme-festive', 'theme-night',
        'weather-theme-active', 'night-mode', 'dark-mode'
    ];

    const weatherProps = [
        '--theme-primary', '--theme-primary-lighter', '--theme-shadow-color',
        '--weather-logo-solid', '--weather-logo-bg', '--weather-bg-tint'
    ];

    const dataOp = permanent
        ? "delete body.dataset.useWeatherTheme; delete body.dataset.weatherReset;"
        : "body.dataset.weatherReset = 'true';"; // keep toggle visible, show inactive

    try {
        win.webContents.executeJavaScript(`
            (function() {
                try {
                    var body = document.body;
                    if (body) {
                        body.classList.remove(...${JSON.stringify(allThemes)});
                        ${dataOp}
                    }
                    var root = document.documentElement;
                    ${weatherProps.map(p => `root.style.removeProperty('${p}');`).join("\n                    ")}
                } catch(e) {}
            })();
        `).catch(() => {});

        // Re-apply user's saved theme via IPC
        if (lastUserThemeObj) {
            win.webContents.send("apply-theme", lastUserThemeObj);
        }
        // Clear injected custom CSS if permanently disabling
        if (permanent) clearCustomCSS(win);
    } catch (_) {}

    lastTheme = null;
    lastBanner = null;
    // Preserve user theme in cookie — only remove weather-specific fields
    if (lastUserThemeObj) {
        const { themeFromServer, weatherColors, ...userTheme } = lastUserThemeObj;
        lastUserThemeObj = Object.keys(userTheme).length > 0 ? userTheme : null;
        createThemeCookie(lastUserThemeObj || {});
    } else {
        clearThemeCookie();
    }
    appLogger({ title: "Log", message: "ViewManager: weather theme cleared, user theme restored", func: "viewManager.clearWeatherTheme" });
}

// ---- Main entry point — called after mainPage loads ----
async function initializeThemeAndBanners(win) {
    if (!win || win.isDestroyed()) return;

    // Gate: user must explicitly enable weather themes
    if (!process.presets?.useWeatherTheme) {
        clearWeatherTheme(win, true); // permanent — hide toggle entirely
        clearWeatherInterval();
        return;
    }

    const serverUrl = process.env.APP_ENV === "DEV" ? "http://192.168.0.110:3030/" : process.env.UPDATE_REST;//
    if (!serverUrl) return;
    const { appLogger } = require("./common");

    // Store the promise so reapplyTheme can await it (fixes race with booted event)
    inflightFetch = (async () => {
        const city = process.presets?.placeOfJurisdiction;
        const deviceId = global.deviceUUID;
        const gst = process.presets?.gst;
        const [theme, banner, customCSS] = await Promise.all([
            fetchWeatherTheme(serverUrl, city),
            fetchAnnouncement(serverUrl, deviceId, gst),
            fetchCustomTheme(serverUrl, deviceId, gst)
        ]);
        return { theme, banner, customCSS };
    })();

    const { theme, banner, customCSS } = await inflightFetch;

    if (theme) {
        lastTheme = theme;
        await applyTheme(win, theme);
        appLogger({ title: "Log", message: `ViewManager: applied weather theme "${theme}"`, func: "viewManager.initializeThemeAndBanners" });
    }

    if (banner) {
        lastBanner = banner;
        applyBanner(win, banner);
        appLogger({ title: "Log", message: `ViewManager: applied banner "${banner.id}"`, func: "viewManager.initializeThemeAndBanners" });
    }

    // Custom festive theme — layers on top, independent of weather
    if (customCSS) {
        applyCustomCSS(win, customCSS);
        appLogger({ title: "Log", message: `ViewManager: applied custom theme "${customThemeMeta?.name || 'unnamed'}"`, func: "viewManager.initializeThemeAndBanners" });
    } else {
        clearCustomCSS(win);
    }

    // Start or restart hourly weather refresh
    startWeatherInterval(win);
}

// ---- Hourly weather refresh ----
function startWeatherInterval(win) {
    clearWeatherInterval();
    if (!process.presets?.useWeatherTheme) return;
    const { appLogger } = require("./common");
    weatherInterval = setInterval(async () => {
        const serverUrl = process.env.APP_ENV === "DEV" ? "http://192.168.0.110:3030/" : process.env.UPDATE_REST;
        if (!serverUrl) return;
        const city = process.presets?.placeOfJurisdiction;
        const theme = await fetchWeatherTheme(serverUrl, city);
        if (theme && theme !== lastTheme) {
            const { BrowserWindow } = require("electron");
            const wins = BrowserWindow.getAllWindows();
            await Promise.all(wins.map(w => {
                if (!w.isDestroyed()) return applyTheme(w, theme);
            }));
            appLogger({ title: "Log", message: `ViewManager: hourly refresh — applied weather theme "${theme}"`, func: "viewManager.startWeatherInterval" });
        }
    }, 3600000); // 1 hour
}

function clearWeatherInterval() {
    if (weatherInterval) { clearInterval(weatherInterval); weatherInterval = null; }
}

// ---- Reapply cached theme to a window (for lock screen etc.) ----
async function reapplyTheme(win) {
    if (!win || win.isDestroyed()) return;
    if (!process.presets?.useWeatherTheme) return;

    // Wait for any inflight fetch to complete (handles race with booted event)
    if (inflightFetch) {
        try { await inflightFetch; } catch (_) { /* fetch failed — nothing to apply */ }
    }
    if (!lastTheme) return;

    await applyTheme(win, lastTheme);
}

// ---- IPC handlers ----
function registerIPC(ipcMain) {
    ipcMain.on("dismiss-banner", (e, bannerId) => {
        saveDismissedBanner(bannerId);
        const { appLogger } = require("./common");
        appLogger({ title: "Log", message: `ViewManager: banner dismissed: ${bannerId}`, func: "viewManager.registerIPC" });
    });

    // Called when user toggles useWeatherTheme in settings
    ipcMain.on("refresh-weather-theme", async () => {
        const { BrowserWindow } = require("electron");
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;
        lastTheme = null;
        lastBanner = null;
        inflightFetch = null;
        await initializeThemeAndBanners(win);
    });

    // Called to manually reset to default theme (small toggle)
    ipcMain.on("reset-weather-theme", () => {
        const { BrowserWindow } = require("electron");
        const win = BrowserWindow.getFocusedWindow();
        if (win) clearWeatherTheme(win);
    });
}

module.exports = {
    getTemplatePath,
    initializeThemeAndBanners,
    reapplyTheme,
    clearWeatherTheme,
    storeUserThemeObj,
    getThemeCookie,
    clearThemeCookie,
    buildThemeClass,
    getWeatherColors,
    clearWeatherInterval,
    get lastTheme() { return lastTheme; }, // exposed for IPC state handler
    registerIPC
};
