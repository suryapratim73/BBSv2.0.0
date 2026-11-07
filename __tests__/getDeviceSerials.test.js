/**
 * Device identity — stability contract: getDeviceSerials, getOrCreateDeviceId,
 * getKekRootCandidates.
 *
 * The uuid.v5 deviceId (appRegistrationHandler) and the log-encryption KEK are
 * derived from (secret, GST, serial pair). The pair and the id must be frozen
 * at first complete resolution: re-detecting on later runs must NEVER change
 * what the app derives, even if WMI sources change (driver updates,
 * primary-vs-fallback flips, disks attached/detached) or the GST is edited.
 * A GST change derives a NEW id but archives the old identity so log
 * decryption can still derive the old KEK.
 *
 * Identity store (DEV): <project>/config/secret.json — the real config dir,
 * so this test snapshots/restores any pre-existing file around itself.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v5: uuidv5 } = require("uuid");

jest.mock("child_process", () => ({ execSync: jest.fn() }));
const { execSync } = require("child_process");

const STORE_PATH = path.resolve(__dirname, "..", "config", "secret.json");

// Same derivation as appRegistrationHandler (main.js):
//   rootData = gst + motherboardSerial + diskSerial
//   encryptionKey = pbkdf2(secret, rootData, 100000, 32)
//   salt = pbkdf2(encryptionKey, sha256(`${disk}-${mb}`), 100000, 16)
//   deviceId = uuid.v5(`${disk}-${mb}`, salt)
function deriveDeviceId(diskSerial, motherboardSerial, secret = "test-secret", gst = "TESTGST") {
  const rootData = gst + motherboardSerial + diskSerial;
  const encryptionKey = crypto.pbkdf2Sync(secret, rootData, 100000, 32, "sha256");
  const salt = crypto.pbkdf2Sync(
    encryptionKey,
    crypto.createHash("sha256").update(`${diskSerial}-${motherboardSerial}`).digest(),
    100000,
    16,
    "sha256"
  );
  return uuidv5(`${diskSerial}-${motherboardSerial}`, salt);
}

let { getDeviceSerials, getOrCreateDeviceId, getKekRootCandidates } = require("../common");

let savedStoreContents = null;

beforeAll(() => {
  try { savedStoreContents = fs.readFileSync(STORE_PATH, "utf8"); } catch (err) { savedStoreContents = null; }
  fs.rmSync(STORE_PATH, { force: true });
});

afterAll(() => {
  fs.rmSync(STORE_PATH, { force: true });
  if (savedStoreContents !== null) fs.writeFileSync(STORE_PATH, savedStoreContents);
});

beforeEach(() => {
  execSync.mockReset();
  fs.rmSync(STORE_PATH, { force: true });
});

describe("getDeviceSerials stability contract", () => {
  test("first run: both primaries resolve → returned + persisted verbatim", async () => {
    execSync
      .mockReturnValueOnce("DISK-AAA\n")      // Win32_DiskDrive
      .mockReturnValueOnce("BOARD-BBB\n");    // Win32_BaseBoard

    const pair = await getDeviceSerials();
    expect(pair).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });

    const stored = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(stored).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
  });

  test("second run: persisted pair wins, detection never runs, deviceId unchanged", async () => {
    // Run 1 — primary sources
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    const first = await getDeviceSerials();
    const deviceIdFirstRun = deriveDeviceId(first.diskSerial, first.motherboardSerial);

    // Run 2 — WMI sources changed (driver now reports a different disk serial);
    // the app must return the persisted pair and NEVER call execSync.
    execSync.mockClear();
    execSync.mockReturnValue("DIFFERENT-DISK-999\n");

    const second = await getDeviceSerials();
    expect(execSync).not.toHaveBeenCalled();
    expect(second).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
    expect(deriveDeviceId(second.diskSerial, second.motherboardSerial)).toBe(deviceIdFirstRun);
  });

  test("fallback sources also freeze: deviceId stable when primary later becomes available", async () => {
    // Run 1 — primaries empty (NVMe/VM), fallbacks fill in
    execSync
      .mockReturnValueOnce("")                          // Win32_DiskDrive empty
      .mockReturnValueOnce("")                          // Win32_BaseBoard empty
      .mockReturnValueOnce("FALLBACK-DISK-123\n")       // Get-PhysicalDisk
      .mockReturnValueOnce("FALLBACK-UUID-456\n");      // Machine UUID

    const first = await getDeviceSerials();
    expect(first).toEqual({ diskSerial: "FALLBACK-DISK-123", motherboardSerial: "FALLBACK-UUID-456" });
    const deviceIdFirstRun = deriveDeviceId(first.diskSerial, first.motherboardSerial);

    // Run 2 — driver update: primaries now return values. Persisted pair must win.
    execSync.mockReset();
    execSync.mockReturnValue("NEW-PRIMARY-DISK\n");

    const second = await getDeviceSerials();
    expect(execSync).not.toHaveBeenCalled();
    expect(second).toEqual({ diskSerial: "FALLBACK-DISK-123", motherboardSerial: "FALLBACK-UUID-456" });
    expect(deriveDeviceId(second.diskSerial, second.motherboardSerial)).toBe(deviceIdFirstRun);
  });

  test("incomplete pair is NOT persisted — retried each run until complete", async () => {
    // Run 1 — disk resolves, board (incl. fallback) fails
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce(null)   // board primary throws
      .mockReturnValueOnce(null);  // board fallback throws

    const first = await getDeviceSerials();
    expect(first).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: null });
    expect(fs.existsSync(STORE_PATH)).toBe(false); // nothing stable to freeze

    // Run 2 — board recovers; detection runs again and completes
    execSync.mockReset();
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    const second = await getDeviceSerials();
    expect(second).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
    expect(fs.existsSync(STORE_PATH)).toBe(true);
  });

  test("corrupted / partial persisted file is ignored and re-detected", async () => {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ diskSerial: "PARTIAL-ONLY" }));
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    const pair = await getDeviceSerials();
    expect(pair).toEqual({ diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
  });

  test("complete persisted pair survives execSync total failure (timeouts, PS blocked)", async () => {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ diskSerial: "FROZEN-DISK", motherboardSerial: "FROZEN-BOARD" }));
    execSync.mockImplementation(() => { throw new Error("powershell blocked"); });

    const pair = await getDeviceSerials();
    expect(pair).toEqual({ diskSerial: "FROZEN-DISK", motherboardSerial: "FROZEN-BOARD" });
    expect(execSync).not.toHaveBeenCalled();
  });

  test("deviceId formula stability: identical pair yields identical deviceId across derivations", async () => {
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    const pair = await getDeviceSerials();

    const id1 = deriveDeviceId(pair.diskSerial, pair.motherboardSerial);
    const id2 = deriveDeviceId(pair.diskSerial, pair.motherboardSerial);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); // uuid v5, RFC 4122 variant
  });
});

describe("getOrCreateDeviceId — frozen id per (machine, GST)", () => {
  test("reuses the stored deviceId even when the secret is regenerated", async () => {
    // Real flow: appRegistrationHandler freezes the serial pair first
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    await getDeviceSerials();

    const first = getOrCreateDeviceId({
      secret: "secret-v1", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-A"
    });
    // Keychain loss would regenerate the secret — the frozen id must survive it.
    const afterSecretRegen = getOrCreateDeviceId({
      secret: "secret-v2-COMPLETELY-DIFFERENT", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-A"
    });
    expect(afterSecretRegen).toBe(first);

    const identity = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(identity.deviceId).toBe(first);
    expect(identity.gst).toBe("GST-A");
  });

  test("GST change derives a new id and archives the old identity in gstHistory", () => {
    const first = getOrCreateDeviceId({
      secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-OLD"
    });
    expect(deriveDeviceId("DISK-AAA", "BOARD-BBB", "test-secret", "GST-OLD")).toBe(first);

    const second = getOrCreateDeviceId({
      secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-NEW"
    });
    expect(deriveDeviceId("DISK-AAA", "BOARD-BBB", "test-secret", "GST-NEW")).toBe(second);
    expect(second).not.toBe(first);

    const identity = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(identity.gst).toBe("GST-NEW");
    expect(identity.deviceId).toBe(second);
    expect(identity.gstHistory).toEqual([
      { gst: "GST-OLD", deviceId: first, diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" }
    ]);
  });

  test("GST changes archive each identity exactly once (deduped)", () => {
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-OLD" });
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-NEW" });
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-OLD" }); // flips back
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-NEW" }); // and again

    const identity = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    const counts = {};
    for (const h of identity.gstHistory) counts[h.gst] = (counts[h.gst] || 0) + 1;
    expect(counts["GST-OLD"]).toBe(1);
    expect(counts["GST-NEW"]).toBe(1);
    // Derivation is deterministic, so the final id equals the one archived for GST-NEW
    expect(identity.deviceId).toBe(deriveDeviceId("DISK-AAA", "BOARD-BBB", "test-secret", "GST-NEW"));
  });
});

describe("getKekRootCandidates — multi-KEK decryption roots", () => {
  test("live values + frozen identity + gst history, deduped, live first", async () => {
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    await getDeviceSerials(); // freezes serials into the identity file
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-OLD" });
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-NEW" });

    const candidates = getKekRootCandidates("GST-NEW", "DISK-AAA", "BOARD-BBB");
    expect(candidates).toHaveLength(2); // live(frozen) GST-NEW deduped + archived GST-OLD
    expect(candidates[0]).toEqual({ gst: "GST-NEW", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
    expect(candidates[1]).toEqual({ gst: "GST-OLD", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
  });

  test("dedupes when live, frozen identity and history entries coincide", async () => {
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    await getDeviceSerials();
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-ONLY" });

    const candidates = getKekRootCandidates("GST-ONLY", "DISK-AAA", "BOARD-BBB");
    expect(candidates).toHaveLength(1); // live === frozen, history empty
    expect(candidates[0]).toEqual({ gst: "GST-ONLY", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB" });
  });

  test("ignores incomplete candidates (no serials / no gst)", () => {
    const candidates = getKekRootCandidates(null, null, null);
    expect(candidates).toEqual([]);
  });

  test("archived identities are usable even when live serials differ", async () => {
    execSync
      .mockReturnValueOnce("DISK-AAA\n")
      .mockReturnValueOnce("BOARD-BBB\n");
    await getDeviceSerials();
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-OLD" });
    getOrCreateDeviceId({ secret: "test-secret", diskSerial: "DISK-AAA", motherboardSerial: "BOARD-BBB", gstNumber: "GST-NEW" });

    // Simulate a caller whose live detection now returns different serials —
    // the frozen identity + history still provide every derivable KEK root.
    const candidates = getKekRootCandidates("GST-NEW", "OTHER-DISK", "OTHER-BOARD");
    const roots = candidates.map((c) => `${c.gst}|${c.diskSerial}|${c.motherboardSerial}`);
    expect(roots).toContain("GST-OLD|DISK-AAA|BOARD-BBB");
    expect(roots).toContain("GST-NEW|DISK-AAA|BOARD-BBB");
    expect(roots).toContain("GST-NEW|OTHER-DISK|OTHER-BOARD");
  });
});
