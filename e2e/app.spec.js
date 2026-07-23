const { test, expect } = require("@playwright/test");
const { launchApp, closeApp } = require("./fixtures");

test.describe.serial("BBS App — E2E", () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    const launched = await launchApp();
    electronApp = launched.app;
    page = launched.page;
  }, 120000);

  test.afterAll(async () => {
    await closeApp(electronApp);
  });

  test("1. app launches and renders a page", async () => {
    expect(page).toBeTruthy();
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test("2. lock screen or main page is visible", async () => {
    const body = await page.locator("body");
    await expect(body).toBeVisible();

    const loginForm = await page.locator('[data-ui="login-form"]');
    const mainContent = await page.locator('[data-ui="main-content"]');
    const hasLogin = (await loginForm.count()) > 0;
    const hasMain = (await mainContent.count()) > 0;

    expect(hasLogin || hasMain).toBe(true);
  });

  test("3. login form has expected fields (when present)", async () => {
    const loginForm = await page.locator('[data-ui="login-form"]');
    if ((await loginForm.count()) === 0) {
      test.skip(true, "Already logged in");
      return;
    }

    await expect(loginForm).toBeVisible();
    await expect(loginForm.locator('input[name="name"]')).toBeVisible();
    await expect(loginForm.locator('input[name="passwd"]')).toBeVisible();
  });

  test("4. can log in with default admin credentials", async () => {
    const loginForm = await page.locator('[data-ui="login-form"]');
    if ((await loginForm.count()) === 0) {
      test.skip(true, "Already logged in");
      return;
    }

    await loginForm.locator('input[name="name"]').fill("admin");
    await loginForm.locator('input[name="passwd"]').fill("admin");
    await loginForm.locator('button[type="submit"]').click();

    // Wait for main page after login
    const mainContent = page.locator('[data-ui="main-content"]');
    await expect(mainContent).toBeVisible({ timeout: 15000 });
  });
});
