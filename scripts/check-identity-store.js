/**
 * Live dry-run of the secret.json identity store — run with:
 *   npx electron scripts/check-identity-store.js [expectedDeviceId]
 *
 * Exercises the exact code path the app takes at boot (getDeviceSerials ->
 * ensureSecret -> getOrCreateDeviceId) WITHOUT registering anything or
 * touching logs, then reports the identity-file state. The master secret is
 * NEVER printed — only whether it is present and whether keychain + file
 * agree.
 */
const fs = require("fs");
const path = require("path");
const {
  getDeviceSerials,
  ensureSecret,
  getSecret,
  getOrCreateDeviceId,
  getKekRootCandidates
} = require("../common");

const EXPECTED_ID = process.argv[2] || null;

async function main() {
  const { app } = require("electron");
  try {
    // ---- 1. frozen serials (persists a complete pair on first run) ----
    const pair = await getDeviceSerials();
    console.log("serials:", JSON.stringify(pair));
    if (!pair.diskSerial || !pair.motherboardSerial) {
      console.log("VERDICT: INCOMPLETE PAIR — appRegistrationHandler would bail (no deviceId).");
      app.quit();
      return;
    }

    // ---- 2. secret (keychain first, identity file second; never printed) ----
    const secret = await ensureSecret();
    const fileSecret = await getSecret();
    console.log("secret present:", Boolean(secret), "| getSecret stable across calls:", secret !== null && secret === fileSecret);

    // ---- 3. gst lookup, same priority as setAppPresets: policy -> appDefault -> saleConfig ----
    let gst = null;
    for (const f of ["policy.json", "appDefault.json", "saleConfig.json"]) {
      try {
        const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "config", f), "utf8"));
        if (data && typeof data.gst !== "undefined" && data.gst !== null && data.gst !== "") {
          gst = String(data.gst);
          console.log("gst source:", f);
          break;
        }
      } catch (err) { /* missing/unreadable */ }
    }
    if (!gst) {
      console.log("VERDICT: NO GST — appRegistrationHandler would bail (no deviceId).");
      app.quit();
      return;
    }

    // ---- 4. frozen deviceId (reuses stored id; archives old identity on GST change) ----
    const deviceId = getOrCreateDeviceId({
      secret,
      diskSerial: pair.diskSerial,
      motherboardSerial: pair.motherboardSerial,
      gstNumber: gst
    });
    console.log("deviceId:", deviceId);
    if (EXPECTED_ID) {
      console.log("deviceId matches pre-update id:", deviceId === EXPECTED_ID);
    }

    // ---- 5. KEK roots available to log decryption ----
    console.log("kek roots:", JSON.stringify(getKekRootCandidates(gst, pair.diskSerial, pair.motherboardSerial)));

    // ---- 6. identity file state (secret masked) ----
    const idPath = path.resolve(__dirname, "..", "config", "secret.json");
    const identity = JSON.parse(fs.readFileSync(idPath, "utf8"));
    const masked = { ...identity };
    masked.secret = masked.secret ? `<present, ${masked.secret.length} chars>` : null;
    console.log("identity file:", JSON.stringify(masked, null, 2));

    const ok = !EXPECTED_ID || deviceId === EXPECTED_ID;
    console.log(ok
      ? "VERDICT: identity store dry-run OK"
      : "VERDICT: DEVICE ID CHANGED — investigate before shipping");
  } catch (err) {
    console.error("check failed:", err);
  }
  app.quit();
}

main();
