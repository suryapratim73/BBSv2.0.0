const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  // Generous timeout — Electron app startup can be slow
  timeout: 60000,
  // Retry once on CI, never in local dev
  retries: process.env.CI ? 1 : 0,
  // Reporter
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    // Take screenshot on failure
    screenshot: "only-on-failure",
    // Collect trace on failure
    trace: "on-first-retry",
  },
});
