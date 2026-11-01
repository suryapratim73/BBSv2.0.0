/**
 * verify-scheduler.js — live Scheduler page run (Playwright _electron).
 * Drives the real app through: page navigation (sidebar + F6 + dashboard "+"),
 * create/edit/remove events, overdue firing (timer → history), the self-filled
 * task flow, the email action (cloud-API dry-run in DEV), and the burst offer
 * (Print all / Not now). APP_ENV=DEV, so every print/email action is a
 * dry-run — no real printer is touched and no email is sent.
 *
 *   node scripts/verify-scheduler.js
 *
 * The dev store (project-root scheduler.json) is snapshotted before the run
 * and restored afterwards, so the repo stays clean. Checks are baseline-based
 * (the dev store may already hold events) and key off unique SCHPV-* labels.
 */

const { _electron } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "scheduler-shots");
const SCHEDULER_JSON = path.join(ROOT, "scheduler.json");

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

// datetime-local value `minutesFromNow` minutes from now (local time)
function localInput(minutesFromNow) {
  const d = new Date(Date.now() + minutesFromNow * 60000);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const snapshot = fs.existsSync(SCHEDULER_JSON) ? fs.readFileSync(SCHEDULER_JSON, "utf-8") : null;

  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    args: [path.join(ROOT, "main.js")],
    env: { ...process.env, APP_ENV: "DEV", NODE_ENV: "test" }
  });
  const page = await app.firstWindow();
  page.on("pageerror", err => pageErrors.push(String((err && err.stack) || err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4000);

  try {
    // ---- login ----
    await page.evaluate(() => {
      document.getElementById("tour-overlay")?.remove();
      document.getElementById("update-prompt-overlay")?.remove();
    });
    if (await page.$('[data-ui="login-form"]')) {
      await page.locator('[data-ui="login-form"] input[name="name"]').fill("admin");
      await page.locator('[data-ui="login-form"] input[name="passwd"]').fill("admin");
      await page.locator('[data-ui="login-form"] button[type="submit"]').click();
      await page.waitForSelector('[data-ui="main-content"]', { timeout: 20000 });
      await page.waitForTimeout(2000);
    }

    // ---- sidebar opens the page ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="scheduler"]').click());
    await page.waitForSelector("#scheduler-page-div", { timeout: 15000 });
    await page.waitForTimeout(500);
    check("nav: Scheduler page renders", !!(await page.$("#scheduler-page-div")));
    check("nav: sections present", !!(await page.$("#schp-upcoming")) && !!(await page.$("#schp-expired")) && !!(await page.$("#schp-history")) && !!(await page.$("#schp-settings")));
    await page.locator("#scheduler-page-div").screenshot({ path: path.join(SHOTS, "1-page.png") });

    const upcomingBefore = await page.locator("#schp-upcoming .schp-card").count();

    // ---- create an upcoming reminder ----
    await page.evaluate(() => document.querySelector('#scheduler-page-div [data-act="new-event"]').click());
    await page.waitForSelector("#schp-editor-form", { timeout: 5000 });
    await page.locator("#schp-label").fill("SCHPV-reminder");
    await page.locator("#schp-time").fill(localInput(60));
    await page.locator("#schp-editor-form button[type=submit]").click();
    const created = await waitFor(async () => (await page.locator("#schp-upcoming").textContent()).includes("SCHPV-reminder"), 10000);
    check("create: reminder appears in Upcoming", !!created);

    // ---- persisted with an id in the store ----
    const stored = await page.evaluate(async () => {
      const state = await ipcRenderer.invoke("scheduler-get-state");
      const ev = state.schedules.find(item => item.label === "SCHPV-reminder");
      return ev ? { id: ev.id, action: ev.action } : null;
    });
    check("main: event persisted with an id and notify action", !!stored && !!stored.id && stored.action === "notify", JSON.stringify(stored));

    // ---- edit OUR reminder (not the first card — the dev store has its own) ----
    await page.evaluate(() => {
      const card = [...document.querySelectorAll("#schp-upcoming .schp-card")]
        .find(c => c.textContent.includes("SCHPV-reminder"));
      card.querySelector('[data-act="edit-event"]').click();
    });
    await page.waitForSelector("#schp-editor-form", { timeout: 5000 });
    await page.locator("#schp-label").fill("SCHPV-reminder EDITED");
    await page.locator("#schp-editor-form button[type=submit]").click();
    const edited = await waitFor(async () => (await page.locator("#schp-upcoming").textContent()).includes("SCHPV-reminder EDITED"), 10000);
    check("edit: label updated in Upcoming", !!edited);

    // ---- remove the reminder ----
    await page.evaluate(() => {
      const card = [...document.querySelectorAll("#schp-upcoming .schp-card")]
        .find(c => c.textContent.includes("SCHPV-reminder"));
      card.querySelector('[data-act="remove-event"]').click();
    });
    const removed = await waitFor(async () => !(await page.locator("#schp-upcoming").textContent()).includes("SCHPV-reminder"), 10000);
    check("remove: reminder gone from Upcoming", !!removed && (await page.locator("#schp-upcoming .schp-card").count()) === upcomingBefore);

    // ---- overdue event fires immediately through the timer → expired + history ----
    await page.evaluate(() => document.querySelector('#scheduler-page-div [data-act="new-event"]').click());
    await page.waitForSelector("#schp-editor-form", { timeout: 5000 });
    await page.locator("#schp-label").fill("SCHPV-overdue");
    await page.locator("#schp-time").fill(localInput(-2));
    await page.locator("#schp-editor-form button[type=submit]").click();
    const firedHist = await waitFor(async () => (await page.locator("#schp-history").textContent()).includes("SCHPV-overdue"), 15000);
    check("fire: overdue event recorded in history", !!firedHist);
    check("fire: overdue event in Expired list", (await page.locator("#schp-expired").textContent()).includes("SCHPV-overdue"));

    // ---- dismiss OUR expired entry ----
    await page.evaluate(() => {
      const card = [...document.querySelectorAll("#schp-expired .schp-card")]
        .find(c => c.textContent.includes("SCHPV-overdue"));
      card.querySelector('[data-act="dismiss-expired"]').click();
    });
    const dismissed = await waitFor(async () => !(await page.locator("#schp-expired").textContent()).includes("SCHPV-overdue"), 10000);
    check("expired: dismiss works", !!dismissed);

    // ---- task flow: due task stays listed until the input is completed ----
    await page.evaluate(() => document.querySelector('#scheduler-page-div [data-act="new-event"]').click());
    await page.waitForSelector("#schp-editor-form", { timeout: 5000 });
    await page.locator("#schp-type").selectOption("task");
    await page.locator("#schp-label").fill("SCHPV task 12345");
    await page.locator("#schp-prompt").fill("How much cash is in the drawer?");
    await page.locator("#schp-time").fill(localInput(-1));
    await page.locator("#schp-editor-form button[type=submit]").click();
    const taskCard = await waitFor(async () => page.evaluate(() => {
      const card = [...document.querySelectorAll("#schp-upcoming .schp-card")]
        .find(c => c.textContent.includes("SCHPV task 12345"));
      return card ? { fired: !!card.querySelector(".schp-hint"), hasInput: !!card.querySelector('[data-act-src="task-answer"]') } : null;
    }), 15000);
    check("task: due task stays listed (not moved to expired)", !!taskCard);
    check("task: fired badge + answer input shown", taskCard && taskCard.fired && taskCard.hasInput);
    await page.locator("#scheduler-page-div").screenshot({ path: path.join(SHOTS, "2-task-due.png") });

    await page.evaluate(() => {
      const card = [...document.querySelectorAll("#schp-upcoming .schp-card")]
        .find(c => c.textContent.includes("SCHPV task 12345"));
      card.querySelector('[data-act-src="task-answer"]').value = "Rs. 4,850";
      card.querySelector('[data-act="complete-task"]').click();
    });
    const taskDone = await waitFor(async () => (await page.locator("#schp-history").textContent()).includes("Rs. 4,850"), 10000);
    check("task: answer accepted into history", !!taskDone);
    const taskGone = await waitFor(async () => !(await page.locator("#schp-upcoming").textContent()).includes("SCHPV task 12345"), 10000);
    check("task: completed task leaves Upcoming", !!taskGone);

    // ---- mail event: pick a real sale bill, DEV dry-run → history detail ----
    // (DEV never touches the network — the cloud API call is a dry-run no-op)
    const mailBill = await page.evaluate(async () => {
      const sales = await ipcRenderer.invoke("get-sales");
      const row = (Array.isArray(sales) ? sales : [])[0];
      return row && row.billNo ? String(row.billNo) : null;
    });
    await page.evaluate(() => document.querySelector('#scheduler-page-div [data-act="new-event"]').click());
    await page.waitForSelector("#schp-editor-form", { timeout: 5000 });
    await page.locator("#schp-type").selectOption("mail");
    await page.locator("#schp-label").fill("SCHPV-email");
    await page.locator("#schp-mail-to").fill("verify@example.com");
    await page.locator("#schp-time").fill(localInput(-1));
    const mailBillOpt = await waitFor(async () => page.evaluate(() => {
      const sel = document.getElementById("schp-bill-no");
      const opt = sel ? [...sel.options].find(o => o.value) : null;
      return opt ? opt.value : null;
    }), 10000);
    check("mail: bill select offers sale bills", mailBill ? !!mailBillOpt : true, mailBill ? `first=${mailBill}` : "no sale bills in dev DB — exercising the failure path");
    if (mailBillOpt) await page.locator("#schp-bill-no").selectOption(mailBillOpt);
    await page.locator("#schp-editor-form button[type=submit]").click();
    const mailHist = await waitFor(async () => {
      const rows = await page.evaluate(() => [...document.querySelectorAll("#schp-history .schp-card")].map(r => r.textContent));
      return rows.find(r => r.includes("SCHPV-email")) || null;
    }, 20000);
    check("mail: due email event recorded in history", !!mailHist, (mailHist || "").slice(0, 160));
    if (mailBillOpt) {
      check("mail: DEV dry-run — no real email sent", !!mailHist && mailHist.includes("Dry-run: would email"), (mailHist || "").slice(0, 160));
      check("mail: recipient in the dry-run detail", !!mailHist && mailHist.includes("verify@example.com"), (mailHist || "").slice(0, 160));
    } else {
      check("mail: no-bill event fails gracefully into history", !!mailHist && mailHist.includes("Event has no bill attached"), (mailHist || "").slice(0, 160));
    }

    // ---- burst offer: 5 saves → modal → Print all (DEV dry-run) ----
    await page.evaluate(() => ipcRenderer.invoke("scheduler-set-settings", { burstEnabled: true, burstThreshold: 5 }));
    await page.evaluate(async () => {
      for (let i = 1; i <= 5; i++)
        await ipcRenderer.invoke("scheduler-dev-note-bill-saved", "VERIFY-BURST-" + i);
    });
    await page.waitForSelector("#schp-burst-overlay", { timeout: 10000 });
    const burstText = await page.evaluate(() => document.querySelector("#schp-burst-overlay")?.textContent || "");
    check("burst: offer modal appears after 5 saves", burstText.includes("Print 5 bills"), burstText.slice(0, 80));
    await page.screenshot({ path: path.join(SHOTS, "3-burst-offer.png") });

    await page.evaluate(() => document.getElementById("schp-burst-print").click());
    const burstHist = await waitFor(async () => {
      const rows = await page.evaluate(() => [...document.querySelectorAll("#schp-history .schp-card")].map(r => r.textContent));
      return rows.find(r => r.includes("Burst print (5 bills)")) || null;
    }, 20000);
    check("burst: Print all recorded in history", !!burstHist, (burstHist || "").slice(0, 160));
    check("burst: DEV dry-run (no failures)", !!burstHist && !burstHist.includes("FAILED"), (burstHist || "").slice(0, 160));

    // ---- second burst → Not now dismisses ----
    await page.evaluate(async () => {
      for (let i = 6; i <= 10; i++)
        await ipcRenderer.invoke("scheduler-dev-note-bill-saved", "VERIFY-BURST-" + i);
    });
    await page.waitForSelector("#schp-burst-overlay", { timeout: 10000 });
    await page.evaluate(() => document.getElementById("schp-burst-notnow").click());
    await waitFor(async () => !(await page.$("#schp-burst-overlay")), 5000);
    check("burst: Not now closes the offer", !(await page.$("#schp-burst-overlay")));

    // ---- settings card persists (toast lives ~2s, so poll fast) ----
    await page.evaluate(() => document.getElementById("schp-settings-form").querySelector('button[type=submit]').click());
    const settingsToast = await waitFor(async () => {
      const t = await page.evaluate(() => [...document.querySelectorAll(".toast-div")].map(x => x.textContent).join(" | "));
      return t.includes("Settings saved") ? t : null;
    }, 6000, 100);
    check("settings: save button works", !!settingsToast, (settingsToast || "").split("\n")[0]);

    // ---- F6 path: main-process "open-scheduler-page" switches to the page ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="overview"]').click());
    await page.waitForTimeout(800);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("open-scheduler-page");
    });
    await page.waitForSelector("#scheduler-page-div", { timeout: 10000 });
    check("F6: open-scheduler-page brings up the page", !!(await page.$("#scheduler-page-div")));

    // ---- dashboard "+" button jumps to the page ----
    await page.evaluate(() => document.querySelector('#nav-div [data-cmd="overview"]').click());
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('[data-cmd="call-scheduler"]').click());
    await page.waitForSelector("#scheduler-page-div", { timeout: 10000 });
    check('dashboard: "+" button opens the page', !!(await page.$("#scheduler-page-div")));

    // ---- no renderer errors anywhere in the run ----
    check("renderer: zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await app.close().catch(() => {});
    if (snapshot !== null)
      fs.writeFileSync(SCHEDULER_JSON, snapshot); // restore the dev store
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error("VERIFY FAILED:", err); process.exit(1); });
