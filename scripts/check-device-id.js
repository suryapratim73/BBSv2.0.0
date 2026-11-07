/**
 * Live deviceId continuity check — run with: npx electron scripts/check-device-id.js
 *
 * Compares the OLD getDeviceSerials pair (pre-update code path) against the NEW
 * pair (current common.js logic) on this real machine, then derives the
 * deviceId exactly as appRegistrationHandler (main.js) does.
 * The keytar secret is read but NEVER printed.
 */
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { v5 } = require("uuid");
const keytar = require("keytar");

function firstNonEmptyLine(out) {
  return (typeof out === "string" ? out : String(out ?? ""))
    .split("\n").map((l) => l.trim()).find((l) => l.length > 0) || null;
}

async function main() {
  const { app } = require("electron");
  try {
    // ---- OLD code path (pre-update): Buffer -> toString().trim(), one try/catch ----
    let oldDisk = null, oldBoard = null;
    try {
      oldDisk = execSync('powershell -Command "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber"').toString().trim();
      oldBoard = execSync('powershell -Command "Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber"').toString().trim();
    } catch (err) { oldDisk = null; oldBoard = null; }

    // ---- NEW code path (current common.js): encoding utf8, per-query catch, fallbacks ----
    const execOpts = { timeout: 8000, windowsHide: true, encoding: "utf8" };
    const runPs = (cmd) => { try { return execSync(`powershell -Command "${cmd}"`, execOpts); } catch (e) { return null; } };
    let newDisk = null, newBoard = null;
    const rawDisk = runPs('Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber');
    newDisk = rawDisk ? rawDisk.trim() || null : null;
    const rawBoard = runPs('Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber');
    newBoard = rawBoard ? rawBoard.trim() || null : null;
    if (!newDisk) newDisk = firstNonEmptyLine(runPs('Get-PhysicalDisk | Where-Object SerialNumber | Select-Object -First 1 -ExpandProperty SerialNumber'));
    if (!newBoard) newBoard = firstNonEmptyLine(runPs('Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID'));

    console.log("OLD pair:", JSON.stringify({ diskSerial: oldDisk, motherboardSerial: oldBoard }));
    console.log("NEW pair:", JSON.stringify({ diskSerial: newDisk, motherboardSerial: newBoard }));
    const pairsIdentical = oldDisk === newDisk && oldBoard === newBoard;
    console.log("PAIRS IDENTICAL:", pairsIdentical);

    // ---- secret readability (never printed) ----
    let secret = null;
    try { secret = await keytar.getPassword("BBSv2_ERP", "MasterEncryptionSecret"); } catch (err) { console.log("keytar read FAILED:", err.message); }
    console.log("secret present:", Boolean(secret));

    // ---- gst lookup, same priority as setAppPresets: policy.json -> appDefault.json -> saleConfig.json ----
    let gst = null;
    for (const f of ["policy.json", "appDefault.json", "saleConfig.json"]) {
      try {
        const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "config", f), "utf8"));
        if (data && typeof data.gst !== "undefined" && data.gst !== null && data.gst !== "") { gst = String(data.gst); console.log("gst source:", f); break; }
      } catch (err) { /* file missing/unreadable */ }
    }
    console.log("gst present:", Boolean(gst));

    // ---- derive deviceId exactly as appRegistrationHandler ----
    function derive(pair) {
      const rootData = gst + pair.motherboardSerial + pair.diskSerial;
      const encryptionKey = crypto.pbkdf2Sync(secret, rootData, 100000, 32, "sha256");
      const salt = crypto.pbkdf2Sync(
        encryptionKey,
        crypto.createHash("sha256").update(`${pair.diskSerial}-${pair.motherboardSerial}`).digest(),
        100000, 16, "sha256"
      );
      return v5(`${pair.diskSerial}-${pair.motherboardSerial}`, salt);
    }

    if (secret && gst && newDisk && newBoard) {
      const idNew = derive({ diskSerial: newDisk, motherboardSerial: newBoard });
      console.log("deviceId (new pair):", idNew);
      if (!pairsIdentical && oldDisk && oldBoard) {
        const idOld = derive({ diskSerial: oldDisk, motherboardSerial: oldBoard });
        console.log("deviceId (old pair):", idOld);
        console.log("VERDICT: PAIRS DIFFER — deviceId WOULD CHANGE:", idOld !== idNew);
      } else {
        console.log("VERDICT: deviceId UNCHANGED after update (identical serial pair -> identical derivation)");
      }
      console.log("NOTE: once the app runs, config/secret.json freezes this pair (and the derived deviceId + GST) forever.");
    } else {
      console.log("SKIPPED derivation — missing secret/gst/serials (appRegistrationHandler would bail the same way)");
    }
  } catch (err) {
    console.error("check failed:", err);
  }
  app.quit();
}

main();
