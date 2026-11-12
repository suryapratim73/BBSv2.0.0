const { getTemplatePath } = require("./viewManager");
const { createModal } = require("./createModal");
const { ipcMain, app, dialog, BrowserWindow, shell } = require("electron");
const path = require("path");
const crypto = require('crypto');
const fs = require('fs');
const axios = require("axios");

const {
    ensureSecret,
    getKekRootCandidates,
    getDeviceSerials,
    appLogger,
    attempt,
    getLocalDateStr,
    resyncLastLineHash
} = require("./common");

async function decryptLogFile(encryptedFilePath, kek) {
    try {
        // Read entire file as a single buffer — no chunk/line boundary issues
        const fileBuffer = fs.readFileSync(encryptedFilePath);

        /**
         *  ┌────────┬──────┬──────────────────────┬───────────────────────────────────────────────┐
            │ Offset │ Size │        Field         │                    Source                     │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 0      │ 2    │ "V1"                 │ Buffer.from("V1") (line 867)                  │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 2      │ 1    │ wrappedDek.length    │ Buffer.from([wrappedDek.length]) (line 868)   │
            │        │      │ (64)                 │                                               │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 3      │ 64   │ wrappedDek           │ [iv(16) | authTag(16) | encryptedDEK(32)]     │
            │        │      │                      │ (line 863)                                    │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 67     │ 16   │ logIv                │ crypto.randomBytes(16) (line 865)             │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 83     │ N    │ encrypted log body   │ ciphertext from piping (line 877)             │
            ├────────┼──────┼──────────────────────┼───────────────────────────────────────────────┤
            │ 83+N   │ 16   │ auth tag             │ cipher.getAuthTag() (line 880)                │
            └────────┴──────┴──────────────────────┴───────────────────────────────────────────────┘
         */

        // 1. Read Version (2 bytes)
        const version = fileBuffer.readUInt16BE(0);

        // 2. Read Wrapped DEK Length (1 byte)
        const wrappedDekLength = fileBuffer.readUInt8(2);

        // 3. Read Wrapped DEK (64 bytes)
        const wrappedDek = fileBuffer.slice(3, 3 + wrappedDekLength);

        // 4. Read Log IV (16 bytes) at offset 67
        const iv = fileBuffer.slice(3 + wrappedDekLength, 3 + wrappedDekLength + 16);

        // 5. Read Auth Tag (last 16 bytes of entire file)
        const _authTag = fileBuffer.slice(-16);

        // 6. Read Encrypted Log Body (offset 83 to end-16)
        const encryptedLogBody = fileBuffer.slice(3 + wrappedDekLength + 16, -16);

        // 7. Decrypt DEK using KEK
        const [kekiv, authTag, encryptedDek] = [
            wrappedDek.slice(0, 16),   // KEK IV
            wrappedDek.slice(16, 32),  // Auth tag from KEK wrapping
            wrappedDek.slice(32)        // Encrypted DEK
        ];
        const decipher = crypto.createDecipheriv('aes-256-gcm', kek, kekiv);
        decipher.setAuthTag(authTag);
        let decryptedDek;
        try{

            decryptedDek = Buffer.concat([
                decipher.update(encryptedDek),
                decipher.final()
            ]);
        }
        catch(err){
            console.error(`Error decrypting DEK for log file ${encryptedFilePath}: ${err.message}`);
            appLogger({title:"Error", message:`Error decrypting DEK for log file ${encryptedFilePath}: ${err.message}`, func:"decryptLogFile"});
            return "";
        }

        // 8. Decrypt Log Body using DEK + Log IV
        const logDecipher = crypto.createDecipheriv('aes-256-gcm', decryptedDek, iv);
        logDecipher.setAuthTag(_authTag);
        const decryptedLog = Buffer.concat([
            logDecipher.update(encryptedLogBody),
            logDecipher.final()
        ]);

        return decryptedLog.toString('utf-8');
    }
    catch(err){
        console.error(`Error decrypting log file ${encryptedFilePath}: ${err.message}`);
        // appLogger({title:"Error", message:`Error decrypting log file ${encryptedFilePath}: ${err.message}`, func:"decryptLogFile"});
        return "";
    }
}

// Extract date from .enc filename like "log-2026-06-18.enc" or "appLogs_2026-06-18.enc" → Date object
function extractFileDate(filename) {
    // Support both naming conventions: "log-YYYY-MM-DD.enc" (current) and "appLogs_YYYY-MM-DD.enc" (legacy);
    // .txt (today's unencrypted log) is accepted too so repair can date-check it.
    const match = filename.match(/[-_](\d{4}-\d{2}-\d{2})\.(enc|txt)$/);
    if (!match) return null;
    return new Date(match[1]);
}

const HASH_CHAIN_CUTOFF = new Date("2026-12-1"); // Skip files dated on or before June 17 — predate hash chain

/** event.sender.send throws "Object has been destroyed" if the viewer closes
 *  mid-request — never let that kill the handler. */
function safeSend(event, channel, ...args) {
    try { event.sender.send(channel, ...args); }
    catch (err) { console.error(`[safeSend] ${channel} failed: ${err.message}`); }
}

ipcMain.on("get-logs", async (event)=>{
    const baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    const encDir = path.resolve(baseLogDir, "upload"); // Match encryption output directory
    const encFiles = fs.existsSync(encDir) ? fs.readdirSync(encDir).filter(file=>file.endsWith(".enc")) : [];
    const secret = await ensureSecret();
    const { motherboardSerial,diskSerial } = await getDeviceSerials();
    if(!motherboardSerial || !diskSerial || !process.presets.gst){
        safeSend(event, "log-entries", [], false); // Renderer must not hang with no response
        return;
    }
    // Multi-KEK decryption: derive a KEK for every (gst, serials) combination
    // that could have encrypted a log — live values first, then the frozen
    // identity, then identities archived when GST changed. Only the matching
    // KEK authenticates the file header; the rest fail the DEK unwrap and
    // decryptLogFile returns "".
    const kekCandidates = getKekRootCandidates(process.presets.gst, diskSerial, motherboardSerial)
        .map(({gst, diskSerial: d, motherboardSerial: m}) =>
            crypto.pbkdf2Sync(secret, gst + m + d, 100000, 32, 'sha256'));
    const decryptedLogs = [];
    let anyTampered = false;
    for (const file of encFiles) {
        const fileDate = extractFileDate(file);
        const fileName = file.split(".")[0];
        const filePath = path.join(encDir, file);
        // console.log(`Decrypting log file: ${filePath}`);
        let shouldContinue = await attempt(async ()=>{
            let decryptedLog = "";
            for (const candidateKek of kekCandidates) {
                decryptedLog = await decryptLogFile(filePath, candidateKek);
                if (decryptedLog !== "") break;
            }
            let lines = decryptedLog.split('\n');
            // Calculate hash of each line and append to the line for integrity check.
            // Filter out truly empty lines (trailing newline artifact) so they don't
            // pollute the hash chain validation with ghost {} entries.
            let {tampered,lineNo} = tamperChecker(lines, file);
            if(tampered){
                // Real tampering keeps the logs in the viewer — only the flag is set
                // so the frontend can toast the hash-chain breakage.
                const isRealTampering = await tamperActionHelper(fileName, fileDate, lines, lineNo);
                if(isRealTampering) anyTampered = true;
            }
            decryptedLogs.push(...lines.reverse());
            return true;
        },{});
        if(!shouldContinue) break;
    }
    async function tamperActionHelper(fileName, fileDate, reverseLines, lineNos){
        const isRealTampering = await analyzeTamperedLogFile(fileName, fileDate, reverseLines, lineNos);
        appLogger({title:"Log", message:`Log integrity check failed for file: ${fileName} — possible tampering.`, func:"get-logs"});
        return isRealTampering;
    }
    // Select today's LOCAL-date file specifically; skip it if a .enc counterpart
    // already exists (source unlink failed) — prevents double-count in the viewer.
    const todaysDate = getLocalDateStr();
    let todaysLogFile = null;
    if (fs.existsSync(encDir)) {
        todaysLogFile = fs.readdirSync(encDir).find(file =>
            file === `log-${todaysDate}.txt` &&
            !fs.existsSync(path.join(encDir, file.replace(/\.txt$/, ".enc")))
        );
    }
    if(todaysLogFile){
        const todaysLogPath = path.join(encDir, todaysLogFile);
        const todaysLogContent = fs.readFileSync(todaysLogPath, 'utf-8');
        const todaysLogLines = todaysLogContent.split('\n').filter(line => line.trim() !== '');
        const {tampered,lineNo} = tamperChecker(todaysLogLines, todaysLogFile);
        if(tampered){
            // Real tampering keeps the logs — only the flag is set so the frontend
            // can toast the hash-chain breakage.
            const isRealTampering = await tamperActionHelper(todaysLogFile.replace(/\.txt$/, ""), extractFileDate(todaysLogFile), todaysLogLines, lineNo);
            if(isRealTampering) anyTampered = true;
        }
        decryptedLogs.push(...todaysLogLines.reverse()); // Append today's log lines to the main array
    }
    let _decryptedLogs = decryptedLogs.filter(e=>(e!="" && typeof e!="undefined")).map(e=>{
        try{
            return JSON.parse(e);
        }
        catch(err){
            console.log("line",e)
            console.log("Error",err)
            return {};
        }
    }).sort((a,b)=>new Date(a.ts)-new Date(b.ts));
    console.log({len:_decryptedLogs.length});
    safeSend(event, "log-entries", _decryptedLogs, anyTampered); // anyTampered=true → frontend toasts hash-chain breakage
});

function tamperChecker(lines, file, reversedLines) {
    let tampered = false;
    const lineNos = []; // ALL failing indices (newest-first) — a single overwritten lineNo
                        // would let a user-entry tamper hide behind a system-line failure
    lines = lines
        .filter(line => (line?.trim() !== "" && typeof line!="undefined"))
        .map(line => {
            const hash = crypto.createHash('sha256').update(line).digest('hex');
            try {
                const logEntry = JSON.parse(line.trim());
                logEntry._hash = hash; // Append hash to log entry
                return logEntry;
            }
            catch(err){
                console.error(`Error parsing log line in ${file}: ${line}. Error: ${err.message}`);
                return { rawLine: line, _hash: hash }; // Return raw line with hash if JSON parsing fails
            }
        });
    
    lines.reverse(); // Reverse the order of lines to show the latest logs first
    
    lines.forEach((line,i,self) => {
        // Hash chain: line.hash stores the SHA-256 of the chronologically PREVIOUS line.
        // Reversed array = newest first. So self[i+1] is the chronologically older neighbor.
        //
        // Normal check (backward):   line.hash === self[i+1]._hash
        // Genesis check (forward):   self[i-1].hash === line._hash
        //   — the newer neighbor must point back to this line, proving it's a
        //     legitimate chain restart, not a hash someone cleared to hide tampering.

        if (i === self.length - 1) return; // Oldest line — nothing older to validate against

        if (line.hash === "" || line.hash === undefined) {
            // Potential genesis — validate forward instead
            if (i > 0) {
                // Newer neighbor exists — it must point to this line's computed _hash
                if (self[i - 1].hash === line._hash) return;          // Legitimate genesis
                if (self[i - 1].hash === "" || self[i - 1].hash === undefined) return; // Consecutive genesis (rapid restart)
                // Forward link broken — cleared hash to hide tampering
                tampered = true;
                lineNos.push(i);
                console.error(
                    `[${file}] Log integrity check FAILED at line ${i} (genesis not corroborated): ` +
                    `line.ts="${line.ts || 'N/A'}", line.func="${line.func || 'N/A'}". ` +
                    `Newer line hash: ${self[i - 1].hash}, expected (this line's _hash): ${line._hash}`
                );
            }
            // i === 0 (newest line): can't validate forward — acceptable blind spot
            return;
        }

        // Normal backward validation
        const nextLine = self[i + 1];
        if (line.hash !== nextLine._hash) {
            tampered = true;
            lineNos.push(i);
            console.error(
                `[${file}] Log integrity check FAILED at line ${i} (hash mismatch): ` +
                `line.ts="${line.ts || 'N/A'}", line.func="${line.func || 'N/A'}". ` +
                `Stored hash: ${line.hash}, Computed hash of older line: ${nextLine._hash}`
            );
        }
    });
    return {tampered, lineNo: lineNos};
}
exports._tamperChecker = tamperChecker;

/** Post-Oct-1 policy: real tampering iff ANY flagged line is a user entry.
 *  For a hash-mismatch failure the broken link implicates EITHER the flagged line
 *  (its stored hash was altered) OR its older neighbor (its content changed and
 *  broke the link) — both are checked. Genesis failures implicate only the
 *  flagged line. `lines` must be newest-first raw strings with empty lines
 *  filtered out, in the same order as tamperChecker's internal array.
 *  Exported for tests. */
function isUserTampering(lines, lineNos) {
    const tryParse = (line) => {
        if (typeof line !== "string") return null;
        try { return JSON.parse(line.trim()); }
        catch(err) { return null; }
    };
    if (!Array.isArray(lineNos)) return false;
    return lineNos.some((i) => {
        const flagged = tryParse(lines[i]);
        // Unparseable lines can't be attributed to a user — repair drops them
        const candidates = (flagged && flagged.hash) ? [i, i + 1] : [i];
        return candidates.some((idx) => {
            const entry = tryParse(lines[idx]);
            return !!(entry && entry.user && entry.user !== "App");
        });
    });
}
exports._isUserTampering = isUserTampering;

async function analyzeTamperedLogFile(fileName, fileDate, reverseLines, lineNos) {
    const mandatoryRepairDate = new Date(2026,9,1); // October 1, 2026
    reverseLines = reverseLines.reverse(); // tamperChecker's lineNos index a newest-first array
    if(!(fileDate instanceof Date) || fileDate<mandatoryRepairDate){
        // Offering free repair of tampered log files before October 1, 2026. After this date, tampered logs are repaired only if the tampered line is a system message.
        console.log("[logHandler>analyzeTamperedLogFile]: Offering free repair")
        repair_save_log_file(fileName, reverseLines);
        return false;
    }
    // Post-Oct-1: free repair only when EVERY tampered line is a SYSTEM entry
    // (user missing or "App"). A real username on any tampered line means genuine
    // tampering — keep the logs and let the frontend toast the hash-chain breakage.
    const nonEmptyLines = reverseLines.filter(line => line.trim() !== "");
    if (isUserTampering(nonEmptyLines, lineNos)) {
        console.log(`[analyzeTamperedLogFile] A USER entry is among the tampered lines (indices ${JSON.stringify(lineNos)}) — REAL tampering.`);
        return true;
    }
    console.log("[analyzeTamperedLogFile] All tampered lines are system messages — offering free repair.");
    repair_save_log_file(fileName, reverseLines);
    return false;
}

/** Rebuild a hash chain from raw lines. Drops unparseable lines (repair's purpose).
 *  Returns re-serialized lines in chronological order. Exported for tests. */
function rebuildChain(lines) {
    const clean = [];
    for (const raw of lines) {
        if (typeof raw !== "string") continue;
        const trimmed = raw.trim();
        if (trimmed === "") continue;
        let obj;
        try { obj = JSON.parse(trimmed); }
        catch(err){
            console.error(`[repair_save_log_file] dropping unparseable line: ${err.message}`);
            continue;
        }
        delete obj._hash;
        clean.push(obj);
    }
    const rebuilt = [];
    for (let i = 0; i < clean.length; i++) {
        // i === 0 keeps its stored hash (link into the previous day — never validated)
        // Others hash the previous entry's FINAL bytes — the stale raw line may
        // still carry a corrupted hash that is being fixed right here.
        if (i > 0)
            clean[i].hash = crypto.createHash('sha256').update(rebuilt[i - 1]).digest('hex');
        rebuilt.push(JSON.stringify(clean[i]));
    }
    return rebuilt;
}
exports._rebuildChain = rebuildChain;

function repair_save_log_file(fileName, lines) {
    console.log(`[logHandler>repair_save_log_file]: Repairing tampered log file: ${fileName}`);
    const baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    const encDir = path.resolve(baseLogDir, "upload");
    lines.reverse(); // Caller passes newest-first — restore chronological order
    const serialized = rebuildChain(lines);
    if (serialized.length === 0)
        return console.log("[logHandler>repair_save_log_file] : Repair aborted — no parseable lines");
    // Verify against exactly the bytes that will be written
    let { tampered } = tamperChecker(serialized, fileName);
    if(tampered)
        return console.log("[logHandler>repair_save_log_file] : Repair failed")
    console.log("[logHandler>repair_save_log_file] : Repair successful")
    const path2RepairDir = path.resolve(encDir, `${fileName}.txt`);
    console.log("[logHandler>repair_save_log_file] : path2RepairDir :",path2RepairDir)
    fs.writeFileSync(path2RepairDir, serialized.join("\n") + "\n");
    if (fileName === `log-${getLocalDateStr()}` && serialized.length > 0) {
        // Repairing TODAY's live file — the in-memory chain pointer must follow
        // the rewritten tail, or the next appLogger write stamps a stale hash
        // and the repair→re-break loop starts over.
        resyncLastLineHash(serialized[serialized.length - 1]);
    }
    const encPath = path.resolve(encDir, `${fileName}.enc`);
    if (fs.existsSync(encPath)) {
        try { fs.unlinkSync(encPath); }
        catch(err){ console.error(`[repair_save_log_file] failed to remove ${encPath}: ${err.message}`); }
    }
    ipcMain.emit("encrypt-and-upload-logs", null, true); // Trigger encryption of repaired log file
}

ipcMain.handle("download-missing-enc", async () => {
    if(new Date()<HASH_CHAIN_CUTOFF)
        return dialog.showMessageBox(BrowserWindow.getFocusedWindow(),{
            title:"Feature not available",
            message:"Feature will unlock after App Launch"
        })
    const baseLogDir = process.env.APP_ENV === "PROD"
        ? path.resolve(app.getPath("appData"), "./BBS/logs/")
        : path.resolve(__dirname, "./logs/");
    const encDir = path.resolve(baseLogDir, "upload");

    // Ensure upload dir exists
    if (!fs.existsSync(encDir)) fs.mkdirSync(encDir, { recursive: true });

    // Scan local .enc files and extract dates
    const localDates = new Set();
    if (fs.existsSync(encDir)) {
        for (const file of fs.readdirSync(encDir)) {
            if (!file.endsWith(".enc")) continue;
            const d = extractFileDate(file);
            if (d) localDates.add(d.toISOString().split("T")[0]);
        }
    }

    // Build list of missing dates from HASH_CHAIN_CUTOFF to yesterday
    // (today's log is still a .txt file, not encrypted yet)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const missingFileNames = [];
    for (let d = new Date(HASH_CHAIN_CUTOFF); d <= yesterday; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        if (!localDates.has(dateStr)) {
            missingFileNames.push(`log-${dateStr}.enc`);
        }
    }

    if (missingFileNames.length === 0) {
        return { downloaded: 0, total: 0 };
    }

    // Request signed URLs from server for all missing files in one call
    const serverUrl = process.env.APP_ENV === "PROD"
        ? process.env.UPDATE_REST
        : "http://192.168.0.110:3030/";

    let data;
    try {
        const resp = await axios.post(serverUrl + "app-logs/download", {
            deviceId: global.deviceUUID,
            gstNumber: process.presets.gst,
            fileNames: missingFileNames
        }, { timeout: 10000 });
        data = resp.data;
    } catch (err) {
        console.error("Failed to request signed URLs from server:", err.message);
        appLogger({ title: "Error", message: `Failed to request signed URLs: ${err.message}`, func: "download-missing-enc" });
        return { downloaded: 0, total: missingFileNames.length, error: "Server unreachable" };
    }

    if (!data.files || data.files.length === 0) {
        return { downloaded: 0, total: missingFileNames.length };
    }
    // console.log(data.files)
    // Download each file via its signed URL
    let downloaded = 0;
    for (const { fileName, signedURL } of data.files) {
        try {
            const resp = await axios.get(signedURL, {
                responseType: "arraybuffer",
                timeout: 30000
            });
            fs.writeFileSync(path.join(encDir, fileName), Buffer.from(resp.data));
            downloaded++;
            console.log(`Downloaded missing log file: ${fileName}`);
        } catch (err) {
            console.error(`Failed to download ${fileName}:`, err);
            // appLogger({ title: "Error", message: `Failed to download log file ${fileName}: ${err.message}`, func: "download-missing-enc" });
        }
    }

    return { downloaded, total: missingFileNames.length };
});

ipcMain.handle("save-dialog",(e,opts)=>{
    return dialog.showSaveDialogSync(BrowserWindow.getFocusedWindow(),opts)
});

ipcMain.handle("write-file",(e,{path,data})=>{
    fs.writeFileSync(path,data);
    return true;
});

ipcMain.on("open-log-folder",()=>{
    const baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    shell.openExternal(baseLogDir)
});

exports.logViewer = (refWindow) => {
    let winOpt = {
        width: 800,
        height: 600,
        parent: refWindow
    }
    return () =>{
        createModal(winOpt, getTemplatePath("logViewer"),{
            maxWinCount: 1,
            label: "Log-Viewer",
        });
    }
}

// Reused by lib/feedbackMail.js (opt-in log snippet for error reports) —
// decrypts one .enc file with a KEK, returns "" on any failure.
exports.decryptLogFile = decryptLogFile;

// Encrypted-log directory: PROD → <appData>/BBS/logs/upload, DEV → ./logs/upload.
// Same base as the get-logs handler above.
exports.getEncLogDir = () => {
    const baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    return path.resolve(baseLogDir, "upload");
}