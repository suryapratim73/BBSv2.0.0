const { _electron: electron } = require("playwright");
const path = require("path");

// Path to the Electron app entry point and electron binary
const MAIN_ENTRY = path.join(__dirname, "..", "main.js");
const ELECTRON_PATH = path.join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe");

/**
 * Launch the BBS Electron app for E2E testing.
 * Returns { app, page } — the Electron app handle and the first window page.
 */
async function launchApp() {
  const electronApp = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      APP_ENV: "DEV",
      NODE_ENV: "test",
    },
  });

  // Wait for the first BrowserWindow to appear (can take a while with DB init)
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  // Extra settle time for renderer JS to finish init
  await page.waitForTimeout(3000);

  return { app: electronApp, page };
}

/**
 * Clean up: close the Electron app.
 */
async function closeApp(electronApp) {
  if (electronApp) {
    await electronApp.close();
  }
}

module.exports = { launchApp, closeApp };
