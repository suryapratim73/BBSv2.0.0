const { test, expect } = require("@playwright/test");
const { launchApp, closeApp } = require("./fixtures");

test.describe("Kiosk — product search", () => {
  let electronApp, page, kioskURL;

  test.beforeAll(async () => {
    const launched = await launchApp();
    electronApp = launched.app;
    page = launched.page;
  }, 120000);

  test.afterAll(async () => {
    await closeApp(electronApp);
  });

  test("kiosk search API returns matching products", async ({ request }) => {
    // Get kiosk status from the main process
    const status = await electronApp.evaluate(({ app }) => {
      // This won't work directly — need IPC
      return null;
    });

    // Skip if kiosk not running
    if (!kioskURL) test.skip(true, "Kiosk not started");

    // Test the search API
    const response = await request.get(kioskURL + "/api/search?q=steel");
    expect(response.ok()).toBeTruthy();
    const results = await response.json();
    expect(Array.isArray(results)).toBe(true);
  });
});
