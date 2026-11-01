/**
 * eula.js
 *
 * Bundled EULA serving for the renderer.
 *   - "get-eula-content" → { app, api } markdown read fresh from
 *     template/data (bundled, not downloaded — no tampering vector)
 *
 * Consumers: common.js checkForUpdate (app EULA before the update
 * presenter — highlights/tour) and the Cloud Connect signup (API EULA).
 * The renderer renders the markdown through common.js renderMarkdown inside
 * showEulaPage — one OK button, no persistence by design.
 */

const fs = require("fs");
const path = require("path");
const { ipcMain } = require("electron");

const EULA_DIR = path.resolve(__dirname, "..", "template", "data");

function readEula(name) {
    try {
        return fs.readFileSync(path.join(EULA_DIR, name), "utf-8");
    } catch (_) {
        return "";
    }
}

function registerEulaIPC() {
    ipcMain.handle("get-eula-content", () => ({
        app: readEula("app_eula.md"),
        api: readEula("api_eula.md")
    }));
}

module.exports = { registerEulaIPC };
