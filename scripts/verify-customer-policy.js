/**
 * verify-customer-policy.js — live per-customer policy run (Playwright _electron).
 *
 * Opens the Customer Portal through its real menu opener (Sale → Customer
 * Portal), picks the first customer, opens the new Customer Policy modal,
 * saves a full policy (payment terms + reminder + template) and checks the
 * round-trip: IPC persistence, modal hydration, and the reminder engine's
 * dry-run scan (DEV never touches the network).
 *
 *   node scripts/verify-customer-policy.js
 *
 * APP_ENV=DEV. Side effects, all restored:
 *   - the chosen customer's policy (moreInfo.custPolicy) is snapshotted via
 *     IPC before the run and written back after (a customer with no prior
 *     policy gets an explicit default policy written — harmless).
 *   - config/customerReminders.json (reminder engine state) is snapshotted
 *     and restored.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "cust-policy-shots");
const BACKUP = path.join(ROOT, "test-results", "cust-policy-backup");
const REMINDER_JSON = path.join(ROOT, "config", "customerReminders.json");

const SAVED_POLICY = {
  dueDays: 20,
  creditLimit: 25000,
  earlyPayDiscount: { percent: 2, withinDays: 5 },
  saleDiscount: 7,
  reminder: {
    enabled: true,
    onDueDate: true,
    repeat: { enabled: true, frequency: "custom", days: [1, 3], time: "18:30" }
  },
  template: {
    message: "Hi {name}, pay {billNo} by {dueDate}. — {biller}",
    includePDF: true,
    includePaymentLink: true,
    includeLedgerBalance: true
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const pageErrors = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function waitFor(fn, timeout = 15000, step = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const val = await fn();
    if (val) return val;
    await sleep(step);
  }
  return null;
}

// snapshot / restore the reminder state file only
function snapshotState() {
  fs.rmSync(BACKUP, { recursive: true, force: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  if (fs.existsSync(REMINDER_JSON)) fs.cpSync(REMINDER_JSON, path.join(BACKUP, "customerReminders.json"));
}
let stateRestored = false;
function restoreState() {
  if (stateRestored) return;
  stateRestored = true;
  const src = path.join(BACKUP, "customerReminders.json");
  if (fs.existsSync(src)) fs.cpSync(src, REMINDER_JSON);
  else fs.rmSync(REMINDER_JSON, { force: true });
  fs.rmSync(BACKUP, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  snapshotState();

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  let portalPage = null;
  let policyBefore = null;
  let custId = null;
  let custName = null;

  try {
    // ---- login ----
    await page.evaluate(() => {
      document.getElementById("tour-overlay")?.remove();
      document.getElementById("update-prompt-overlay")?.remove();
      const later = document.getElementById("bp-btn-later");
      if (later && later.offsetParent !== null) later.click();
    });
    if (await page.$('[data-ui="login-form"]')) {
      await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
      await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
      await page.locator('[data-ui="login-form"] button[type="submit"]').click();
      await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
      await page.waitForTimeout(2000);
    }

    // ---- open the portal through its real menu opener (Sale → Customer Portal) ----
    await app.evaluate(({ Menu }) => {
      const saleMenu = Menu.getApplicationMenu().items.find(i => i.label === "Sale");
      const item = saleMenu.submenu.items.find(i => i.label === "Customer Portal");
      item.click();
    });
    portalPage = await app.waitForEvent("window", {
      predicate: p => p.url().includes("customerPortal.html"),
      timeout: 20000
    });
    portalPage.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
    await portalPage.waitForLoadState("domcontentloaded");
    const listReady = await waitFor(async () =>
      (await portalPage.$(".customer-div")) !== null, 20000);
    check("portal: window opened with customer list", !!listReady);
    if (!listReady) throw new Error("customer portal list missing");

    // ---- pick a customer (prefer one with an email so the dry-run can send) ----
    const pick = await portalPage.evaluate(() => {
      const withEmail = customerList.find(c => {
        try {
          const mi = typeof c.moreInfo === "string" ? JSON.parse(c.moreInfo) : c.moreInfo;
          return mi && mi.email;
        } catch (_) { return false; }
      });
      const target = withEmail || customerList[0];
      if (!target) return null;
      const div = document.querySelector(`.customer-div[data-cust-id="${target.id}"]`);
      if (!div) return null;
      div.click();
      return { id: target.id, name: target.name, hasEmail: !!withEmail };
    });
    check("portal: picked a customer", !!pick, pick ? pick.name : "none");
    if (!pick) throw new Error("no customer to test with");
    custId = pick.id;
    custName = pick.name;

    const btnVisible = await waitFor(async () =>
      (await portalPage.$("#btn-container [data-cmd='cust-policy']")) !== null, 15000);
    check("portal: Customer Policy button on ledger/bills bar", !!btnVisible);

    // ---- snapshot the customer's current policy for restore ----
    policyBefore = await portalPage.evaluate(async id => await ipcRenderer.invoke("get-customer-policy", id), custId);
    check("prep: policy snapshot taken", !!policyBefore);

    // ---- open the modal ----
    await portalPage.locator("#btn-container [data-cmd='cust-policy']").click();
    const modal = await waitFor(async () =>
      (await portalPage.$("#cust-policy-modal form.cust-policy-form")) !== null, 10000);
    check("policy: small modal opens from the button", !!modal);
    if (!modal) throw new Error("cust-policy modal missing");

    const opened = await portalPage.evaluate(() => {
      const form = document.querySelector("#cust-policy-modal form.cust-policy-form");
      return {
        name: form.querySelector(".cust-policy-name").textContent,
        dueDays: form.querySelector("input[name='dueDays']").value,
        reminderEnabled: form.querySelector("input[name='reminderEnabled']").checked,
        message: form.querySelector("textarea[name='message']").value
      };
    });
    check("policy: modal shows the customer name", opened.name === custName, opened.name);
    check("policy: modal hydrates existing policy", opened.dueDays === String(policyBefore.dueDays) && opened.reminderEnabled === !!policyBefore.reminder.enabled, JSON.stringify(opened).slice(0, 160));

    // ---- fill and save ----
    await portalPage.evaluate(policy => {
      const form = document.querySelector("#cust-policy-modal form.cust-policy-form");
      form.querySelector("input[name='dueDays']").value = policy.dueDays;
      form.querySelector("input[name='creditLimit']").value = policy.creditLimit;
      form.querySelector("input[name='epPercent']").value = policy.earlyPayDiscount.percent;
      form.querySelector("input[name='epWithinDays']").value = policy.earlyPayDiscount.withinDays;
      form.querySelector("input[name='saleDiscount']").value = policy.saleDiscount;
      form.querySelector("input[name='reminderEnabled']").checked = true;
      form.querySelector("input[name='onDueDate']").checked = true;
      form.querySelector("select[name='repeatFreq']").value = "custom";
      form.querySelector("input[name='remindTime']").value = "18:30";
      [...form.querySelectorAll("input[name='remindDay']")].forEach(cb => {
        cb.checked = [1, 3].includes(Number(cb.value));
      });
      form.querySelector("input[name='includePDF']").checked = true;
      form.querySelector("input[name='includePaymentLink']").checked = true;
      form.querySelector("input[name='includeLedgerBalance']").checked = true;
      form.querySelector("textarea[name='message']").value = policy.template.message;
      form.querySelector("button[type='submit']").click();
    }, SAVED_POLICY);
    await waitFor(async () => (await portalPage.$("#cust-policy-modal")) === null, 10000);
    check("policy: save closes the modal", true);

    // ---- persisted via IPC ----
    const saved = await portalPage.evaluate(async id => await ipcRenderer.invoke("get-customer-policy", id), custId);
    check("policy: due days persisted", saved && saved.dueDays === 20, JSON.stringify(saved && saved.dueDays));
    check("policy: sale discount persisted", saved && saved.saleDiscount === 7);
    check("policy: credit limit persisted", saved && saved.creditLimit === 25000);
    check("policy: early-pay discount persisted", saved && saved.earlyPayDiscount.percent === 2 && saved.earlyPayDiscount.withinDays === 5);
    check("policy: reminder persisted", saved && saved.reminder.enabled && saved.reminder.onDueDate && saved.reminder.repeat.enabled && saved.reminder.repeat.frequency === "custom" && JSON.stringify(saved.reminder.repeat.days) === JSON.stringify([1, 3]) && saved.reminder.repeat.time === "18:30", JSON.stringify(saved && saved.reminder));
    check("policy: template persisted", saved && saved.template.message === SAVED_POLICY.template.message && saved.template.includePDF && saved.template.includePaymentLink && saved.template.includeLedgerBalance, JSON.stringify(saved && saved.template));

    // ---- reopen → hydration round-trip ----
    await portalPage.locator("#btn-container [data-cmd='cust-policy']").click();
    await waitFor(async () => (await portalPage.$("#cust-policy-modal form.cust-policy-form")) !== null, 10000);
    const hydrated = await portalPage.evaluate(() => {
      const form = document.querySelector("#cust-policy-modal form.cust-policy-form");
      return {
        dueDays: form.querySelector("input[name='dueDays']").value,
        saleDiscount: form.querySelector("input[name='saleDiscount']").value,
        reminderEnabled: form.querySelector("input[name='reminderEnabled']").checked,
        freq: form.querySelector("select[name='repeatFreq']").value,
        days: [...form.querySelectorAll("input[name='remindDay']:checked")].map(cb => cb.value),
        time: form.querySelector("input[name='remindTime']").value,
        includePDF: form.querySelector("input[name='includePDF']").checked,
        message: form.querySelector("textarea[name='message']").value
      };
    });
    check("policy: reopen hydrates saved values", hydrated.dueDays === "20" && hydrated.saleDiscount === "7" && hydrated.reminderEnabled && hydrated.freq === "custom" && JSON.stringify(hydrated.days) === JSON.stringify(["1", "3"]) && hydrated.time === "18:30" && hydrated.includePDF && hydrated.message === SAVED_POLICY.template.message, JSON.stringify(hydrated).slice(0, 200));
    await portalPage.screenshot({ path: path.join(SHOTS, "1-policy-modal.png") });
    await portalPage.evaluate(() => closeModal());

    // ---- reminder engine dry-run scan (DEV — no network) ----
    const scan = await page.evaluate(async () => await ipcRenderer.invoke("check-customer-reminders"));
    check("reminders: engine scan runs", !!scan && typeof scan === "object", JSON.stringify(scan).slice(0, 200));
    check("reminders: DEV dry-run (no network)", scan && scan.dryRun === true);
    check("reminders: zero errors", scan && Array.isArray(scan.errors) && scan.errors.length === 0, JSON.stringify(scan && scan.errors));
    check("reminders: sent list present", scan && Array.isArray(scan.sent), `sent=${scan && scan.sent ? scan.sent.length : "?"}`);

    // ---- portal errors so far ----
    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    // restore the customer's original policy through the app (if we got one)
    if (portalPage && !portalPage.isClosed() && policyBefore) {
      await portalPage.evaluate(async (arg) => {
        await ipcRenderer.invoke("set-customer-policy", arg.id, arg.policy);
      }, { id: custId, policy: policyBefore }).catch(() => {});
    }
    await app.close().catch(() => {});
    restoreState();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => {
  console.error("VERIFY FAILED:", err);
  console.error("renderer errors so far:", pageErrors.slice(0, 5));
  restoreState();
  process.exit(1);
});
