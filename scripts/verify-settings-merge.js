/**
 * Static verification of the settings refactor:
 *   - "Set 2 factor authentication" + "Session management" + "Lock screen"
 *     merged into ONE "Lock screen" settings item (lock-screen-template).
 *   - "Add user" + "Update user" merged into ONE "User management" item
 *     (user-management-template).
 *   - Each merged page is a SINGLE form with exactly ONE submit button and
 *     ONE cancel (back) button — no per-section Save/Done/Register buttons.
 *   - mainPage.js dispatch coverage for the merged form cmds.
 *   - HELP.md synced with the new settings structure.
 *
 * Pure static checks on template/html/mainPage.html, template/js/mainPage.js,
 * template/css/mainPage.css and HELP.md — no Electron required.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const html = read("template/html/mainPage.html");
const js = read("template/js/mainPage.js");
const css = read("template/css/mainPage.css");
const help = read("HELP.md");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(name); console.log(`\x1b[31m✗\x1b[0m ${name}`); }
}

// Extract one <template id="X">…</template> block (templates never nest here)
function template(id) {
  const m = html.match(new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`));
  return m ? m[1] : null;
}
// All id="…" inside a string
function ids(str) {
  return [...str.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}
function hasDuplicate(list) {
  return list.filter((v, i) => list.indexOf(v) !== i);
}
const count = (str, needle) => str.split(needle).length - 1;

// ---- 1. Settings list items ----
{
  const listBlock = html.match(/<div class="settings-div">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="settings hide" data-mode="company-settings"/);
  let block = listBlock ? listBlock[1] : "";
  block = block.replace(/<!--[\s\S]*?-->/g, "");
  const items = [...block.matchAll(/data-cmd="([^"]+)"/g)].map((m) => m[1]);
  check("list has exactly the expected app-settings items", JSON.stringify(items) === JSON.stringify(["general", "lock-screen", "user-management", "appearance-management", "backup-manager"]));
  for (const gone of ["set-2-factor-auth", "add-user", "update-user", "session-management"]) {
    check(`no standalone "${gone}" list item`, !items.includes(gone));
  }
  check("lock-screen item mentions 2 factor authentication + session management", /data-cmd="lock-screen"[^>]*data-msg="[^"]*(2 factor authentication|session management)/i.test(block));
  check("user-management item mentions add/update user", /data-cmd="user-management"[^>]*data-msg="[^"]*(users|user password|role)/i.test(block));
}

// ---- 2. Merged lock-screen-template (single form) ----
{
  const tpl = template("lock-screen-template");
  check("lock-screen-template exists", tpl !== null);
  if (tpl) {
    check("lock-screen-template wraps a .settings-page div", /<div class="settings-page">[\s\S]*<\/div>\s*$/.test(tpl));
    const formIds = [...tpl.matchAll(/<form[^>]*id="([^"]+)"[^>]*data-cmd="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    check("lock-screen page contains exactly 1 form (lock-screen)", JSON.stringify(formIds) === JSON.stringify(["lock-screen:lock-screen"]));
    check("lock-screen page has exactly 1 submit button", count(tpl, 'type="submit"') === 1);
    check("lock-screen page has exactly 1 cancel (back) button", count(tpl, 'data-cmd="back"') === 1);
    const dup = hasDuplicate(ids(tpl));
    check("no duplicate ids inside lock-screen page", dup.length === 0);
    if (dup.length) console.log("   duplicates:", dup.join(", "));
    for (const id of ["file-path", "usePasswd", "lockOnIdle", "idleTime", "session-btn", "session-management-div", "expiry", "enable-2-factor", "disable-2-factor", "qrcode-div"]) {
      check(`lock-screen page keeps #${id}`, tpl.includes(`id="${id}"`));
    }
    check("no stale #done-btn (2FA commit moved to the page Save)", !tpl.includes('id="done-btn"'));
    check("no per-section form ids (#session-management / #set-2-factor-auth-form)", !tpl.includes('id="session-management"') && !tpl.includes('id="set-2-factor-auth-form"'));
    const lockFormTag = (tpl.match(/<form[^>]*id="lock-screen"[^>]*>/) || [""])[0];
    check("lock screen form binds changeHandler", lockFormTag.includes('id="lock-screen"') && lockFormTag.includes('onchange="changeHandler(event)"'));
    check("lock screen form submits via saveSettings with data-show", lockFormTag.includes('onsubmit="saveSettings(event)"') && lockFormTag.includes('data-show="app-settings"'));
  }
}

// ---- 3. Merged user-management-template (single form) ----
{
  const tpl = template("user-management-template");
  check("user-management-template exists", tpl !== null);
  if (tpl) {
    check("user-management-template wraps a .settings-page div", /<div class="settings-page">[\s\S]*<\/div>\s*$/.test(tpl));
    const formIds = [...tpl.matchAll(/<form[^>]*id="([^"]+)"[^>]*data-cmd="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    check("user-management page contains exactly 1 form (user-management)", JSON.stringify(formIds) === JSON.stringify(["user-management:user-management"]));
    check("user-management page has exactly 1 submit button", count(tpl, 'type="submit"') === 1);
    check("user-management page has exactly 1 cancel (back) button", count(tpl, 'data-cmd="back"') === 1);
    const dup = hasDuplicate(ids(tpl));
    check("no duplicate ids inside user-management page", dup.length === 0);
    if (dup.length) console.log("   duplicates:", dup.join(", "));
    // Field NAMES must not collide now that one FormData collects both sections
    for (const name of ["add-name", "update-name", "passwd", "re-passwd", "old-password", "new-password", "re-password", "add-role", "update-role"]) {
      check(`single form has unique field name="${name}"`, count(tpl, `name="${name}"`) === 1);
    }
    for (const id of ["name", "password", "re-passwd", "name-2", "old-password", "new-password", "re-password", "role", "new-role", "role-div", "add-user-role-div"]) {
      check(`user-management page keeps #${id}`, tpl.includes(`id="${id}"`));
    }
    check("no `required` attributes (validation is conditional in saveSettings)", !tpl.includes("required"));
  }
}

// ---- 4. Old templates removed ----
for (const gone of ["set-2-factor-auth-template", "session-management-template", "add-user-template", "update-user-template"]) {
  check(`removed standalone template "${gone}"`, !html.includes(`<template id="${gone}">`));
}

// ---- 5. mainPage.js dispatch coverage ----
{
  const saveBody = js.split("async function saveSettings")[1] || "";
  check("showForm has merged-page branch for lock-screen/user-management", /cmd==="lock-screen" \|\| cmd==="user-management"/.test(js));
  check("showForm focuses #user-management on the user page", /getElementById\("user-management"\)\.querySelector\("input"\)/.test(js));
  check("initLockScreenSettings defined", /async function initLockScreenSettings\(\)/.test(js));
  check("initUserManagementSettings defined", /function initUserManagementSettings\(\)/.test(js));
  check("initLockScreenSettings presets session + 2FA sections", /initLockScreenSettings[\s\S]*session-btn/.test(js) && /enableOrDisableQR\(\)/.test(js));
  check("initLockScreenSettings resets twoFactorAction staging", /form\.dataset\.twoFactorAction = "";/.test(js));
  check("enable-2-factor stages the QR (no immediate save, no done-btn)", /dataset\.twoFactorAction = "enable"/.test(js) && !js.includes("done-btn"));
  check("disable-2-factor stays immediate (remove-secret)", /cmd==="disable-2-factor"[\s\S]*remove-secret/.test(js));
  check("saveSettings commits lock-screen via update-wallpaper", saveBody.includes('invoke("update-wallpaper"'));
  check("saveSettings commits session by session-btn state", /dataset\.enable==="true"[\s\S]*create-login-session[\s\S]*remove-auth-session/.test(saveBody));
  check("saveSettings commits staged 2FA via save-secret-for-user", saveBody.includes('invoke("save-secret-for-user"'));
  check("saveSettings user-management validates which section is filled", saveBody.includes('data["add-name"]') && saveBody.includes('data["update-name"]'));
  check("saveSettings user-management invokes add-user with renamed fields", /invoke\("add-user",\{name:addName[\s\S]*role:data\["add-role"\]/.test(saveBody));
  check("saveSettings user-management invokes update-user with renamed fields", /invoke\("update-user",\{[\s\S]*"old-password":data\["old-password"\]/.test(saveBody) && saveBody.includes('password:data["new-password"]') && saveBody.includes('role:data["update-role"]'));
  for (const stale of ['cmd==="update-user"', 'cmd==="add-user"', 'cmd==="set-2-factor-auth"', 'cmd==="session-management"']) {
    check(`no stale "${stale}" branch in saveSettings`, !saveBody.includes(stale));
  }
  check("back branch removes all forms + .settings-page wrappers", /querySelectorAll\("form"\)\.forEach\(form=>form\.remove\(\)\)/.test(js) && /querySelectorAll\("\.settings-page"\)/.test(js));
  check("no stale preset for removed list items in generic branch", !/cmd==="session-management"\)\{/.test(js.split("async function saveSettings")[0]));
}

// ---- 6. CSS for merged pages ----
{
  check("css has .settings-page wrapper rules", css.includes("#settings-container .settings-page{"));
  check("css neutralizes form height/overflow inside merged pages", /#settings-container \.settings-page form\{[\s\S]*height: auto/.test(css));
  check("css styles section cards + h3 (descendant, sections sit inside the form)", css.includes(".settings-page section{") && css.includes(".settings-page section>h3{"));
  check("css dropped the dead form#set-2-factor-auth-form rules", !css.includes("set-2-factor-auth-form"));
  check("css caps the QR image width", /#settings-container #qrcode-div>img\{[\s\S]*width: 300px/.test(css));
}

// ---- 7. HELP.md sync ----
{
  check("HELP.md documents Lock Screen with 2FA + session sections", /### Lock Screen[\s\S]*Session Management[\s\S]*2 Factor Authentication/.test(help));
  check("HELP.md documents User Management (Add/Update User)", /### User Management[\s\S]*Add User[\s\S]*Update User/.test(help));
  check("HELP.md troubleshooting points to Settings → User Management", help.includes("Settings → User Management"));
  check("HELP.md no longer lists the old standalone Security/2FA settings subsections", !/### Security[\s\S]*### Two-Factor Authentication/.test(help));
}

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed.length) {
  console.log("Failed:");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
