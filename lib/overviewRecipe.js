/**
 * overviewRecipe.js — file + IPC surface for the Overview page recipe.
 *
 * The recipe is a plain JSON file (config/overviewRecipe.json — DEV resolves
 * to {root}/config/, PROD to appData/BBS/config/, same as policy.json).
 * Read/save always go through normalizeRecipe so a hand-edited or corrupt
 * file can never break the renderer; on structural failure the default
 * recipe is served.
 */

const fs = require("fs");
const path = require("path");
const { app, ipcMain } = require("electron");
const { DEFAULT_RECIPE, normalizeRecipe } = require("./overviewRecipeLogic");

function overviewRecipePath() {
    if (process.env.APP_ENV === "DEV")
        return path.resolve(__dirname, "..", "config", "overviewRecipe.json");
    return path.resolve(app.getPath("appData"), "BBS", "config", "overviewRecipe.json");
}

/** Read + normalize the recipe. Never throws — falls back to the default. */
function readOverviewRecipe() {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(overviewRecipePath()).toString());
    } catch (_) {
        return { recipe: DEFAULT_RECIPE, fromFile: false };
    }
    const verdict = normalizeRecipe(raw);
    if (!verdict.ok) return { recipe: DEFAULT_RECIPE, fromFile: false };
    return { recipe: verdict.recipe, fromFile: true };
}

/** Validate + persist. Returns { ok, error?, recipe?, warnings }. */
function saveOverviewRecipe(recipe) {
    const verdict = normalizeRecipe(recipe);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    try {
        const dir = path.dirname(overviewRecipePath());
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(overviewRecipePath(), JSON.stringify(verdict.recipe, null, 2));
    } catch (err) {
        return { ok: false, error: String(err) };
    }
    return { ok: true, recipe: verdict.recipe, warnings: verdict.warnings };
}

function registerOverviewRecipeIPC() {
    ipcMain.handle("get-overview-recipe", () => readOverviewRecipe());
    ipcMain.handle("save-overview-recipe", (e, recipe) => saveOverviewRecipe(recipe));
    ipcMain.handle("revert-to-default-layout", ()=>{
        saveOverviewRecipe(DEFAULT_RECIPE);
        return true;
    });
}

module.exports = { overviewRecipePath, readOverviewRecipe, saveOverviewRecipe, registerOverviewRecipeIPC };
