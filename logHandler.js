const { getTemplatePath } = require("./viewManager");
const { createModal } = require("./createModal");
const { ipcMain, app, dialog, BrowserWindow, shell } = require("electron");
const path = require("path");
const crypto = require('crypto');
const fs = require('fs');
const axios = require("axios");

const {
    getSecret,
    getDeviceSerials,
    appLogger
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
            return null;
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
        appLogger({title:"Error", message:`Error decrypting log file ${encryptedFilePath}: ${err.message}`, func:"decryptLogFile"});
        return null;
    }
}

// Extract date from .enc filename like "log-2026-06-18.enc" or "appLogs_2026-06-18.enc" → Date object
function extractFileDate(filename) {
    // Support both naming conventions: "log-YYYY-MM-DD.enc" (current) and "appLogs_YYYY-MM-DD.enc" (legacy)
    const match = filename.match(/[-_](\d{4}-\d{2}-\d{2})\.enc$/);
    if (!match) return null;
    return new Date(match[1]);
}

const HASH_CHAIN_CUTOFF = new Date("2026-12-1"); // Skip files dated on or before June 17 — predate hash chain

ipcMain.on("get-logs", async (event)=>{
    const baseLogDir = process.env.APP_ENV==="PROD" ? path.resolve(app.getPath("appData"),"./BBS/logs/") : path.resolve(__dirname,"./logs/");
    const encDir = path.resolve(baseLogDir, "upload"); // Match encryption output directory
    const encFiles = fs.existsSync(encDir) ? fs.readdirSync(encDir).filter(file=>file.endsWith(".enc")) : [];
    const secret = await getSecret();
    const { motherboardSerial,diskSerial } = await getDeviceSerials();
    if(!motherboardSerial || !diskSerial || !process.presets.gst) return;
    const rootData = process.presets.gst + motherboardSerial + diskSerial; // Combine GST number and hardware IDs
    const kek = crypto.pbkdf2Sync(secret, rootData, 100000, 32, 'sha256');
    const decryptedLogs = [];
    for (const file of encFiles) {
        // Skip files from June 17 or earlier — predate the hash chain feature
        const fileDate = extractFileDate(file);
        if(fileDate<new Date(2026,7,1)) continue;
        const filePath = path.join(encDir, file);
        console.log(`Decrypting log file: ${filePath}`);
        const decryptedLog = await decryptLogFile(filePath, kek);
        let reverseLines = [];
        if (decryptedLog) {
            let lines = decryptedLog.split('\n');
            // Calculate hash of each line and append to the line for integrity check.
            // Filter out truly empty lines (trailing newline artifact) so they don't
            // pollute the hash chain validation with ghost {} entries.
            let todaysLogFile = fs.readdirSync(encDir).find(file => file.endsWith(".txt"));
            if(todaysLogFile){
                const todaysLogPath = path.join(encDir, todaysLogFile);
                const todaysLogContent = fs.readFileSync(todaysLogPath, 'utf-8');
                const todaysLogLines = todaysLogContent.split('\n').filter(line => line.trim() !== '');
                lines = [
                    ...lines,
                    ...todaysLogLines
                ];
            }
            lines = lines
                .filter(line => line.trim() !== "")
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
            
            reverseLines = lines.reverse(); // Reverse the order of lines to show the latest logs first
        }
        let tampered = false;
        reverseLines.forEach((line,i,self) => {
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
                console.error(
                    `[${file}] Log integrity check FAILED at line ${i} (hash mismatch): ` +
                    `line.ts="${line.ts || 'N/A'}", line.func="${line.func || 'N/A'}". ` +
                    `Stored hash: ${line.hash}, Computed hash of older line: ${nextLine._hash}`
                );
            }
        });
        if(tampered){
            console.error(`Log integrity check FAILED for file: ${file} — tampering detected.`);
            appLogger({title:"Log", message:`Log integrity check failed for file: ${file} — possible tampering.`, func:"get-logs"});
            decryptedLogs.length = 0; // Clear the decrypted logs since tampering is detected
            event.sender.send("log-entries", decryptedLogs,true); // Send tampered flag as true
            return;
        }
        else
            decryptedLogs.push(...reverseLines.reverse()); // Append decrypted lines to the main array
    }
    event.sender.send("log-entries", decryptedLogs,false); // Send tampered flag as false
});

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