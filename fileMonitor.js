const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow } = require('electron');
const { getBillsDir, getPDF_FileName } = require('./common');

// Bills younger than this are left alone (user may be mid-print).
const REMINDER_GRACE_MINUTES = process.presets?.invoiceMinAge || 5;
// Bills older than this are never reminded about (too old to matter).
const REMINDER_MAX_AGE_DAYS = process.presets?.invoiceMaxAge || 3;
const DEFAULT_REMINDER_INTERVAL = (process.presets?.reminderInterval || 30) * 60 * 1000; // 30 minutes


class FileMonitor {
  constructor(billsPath) {
    this.billsPath = billsPath || getBillsDir();
    this.trackedFiles = new Map();
    this.reminderInterval = null;
    this.reminderTimeout = null;
    this.reminderDialogOpen = false;
    this.watcher = null;
    this.refWindow = null;
    this.reminderIntervalTime = DEFAULT_REMINDER_INTERVAL;
    this.printedFilesPath = path.resolve(app.getPath("userData"), "printedFiles.json");
    this.printedFiles = new Map();
    // Invoices the user removed from the Overview queue by hand. Persisted so
    // the next launch's scan doesn't re-queue them (they were never printed,
    // so printedFiles.json alone can't cover them).
    this.removedFilesPath = path.resolve(app.getPath("userData"), "removedFromQueue.json");
    this.removedFiles = new Set();
    this.defaultPrinter = null;
    this.spoolTrackerInterval = undefined;
    this.loadPrintedFiles();
    this.loadRemovedFiles();
  }

  loadRemovedFiles() {
    try {
      if (fs.existsSync(this.removedFilesPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.removedFilesPath, 'utf8'));
        if (Array.isArray(parsed)) parsed.forEach(name => this.removedFiles.add(name));
      }
    } catch (_) { /* non-critical */ }
  }

  saveRemovedFiles() {
    try {
      fs.writeFileSync(this.removedFilesPath, JSON.stringify(Array.from(this.removedFiles), null, 2), 'utf8');
    } catch (_) { /* non-critical */ }
  }

  loadPrintedFiles() {
    try {
      if (fs.existsSync(this.printedFilesPath)) {
        const data = fs.readFileSync(this.printedFilesPath, 'utf8');
        const parsed = JSON.parse(data);
        const threeDaysAgo = Date.now() - (REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
        for (const [fileName, printedDate] of Object.entries(parsed)) {
          const printedTime = new Date(printedDate).getTime();
          if (printedTime > threeDaysAgo) {
            this.printedFiles.set(fileName, printedDate);
          }
        }
        this.savePrintedFiles();
      }
    } catch (_) { /* non-critical */ }
  }

  savePrintedFiles() {
    try {
      const data = Object.fromEntries(this.printedFiles);
      fs.writeFileSync(this.printedFilesPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) { /* non-critical */ }
  }

  /**
   * Clean up old entries from printed files (older than 3 days)
   */
  cleanupOldPrintedFiles() {
    const threeDaysAgo = Date.now() - (REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    let removed = 0;
    for (const [fileName, printedDate] of this.printedFiles.entries()) {
      const printedTime = new Date(printedDate).getTime();
      if (printedTime < threeDaysAgo) {
        this.printedFiles.delete(fileName);
        removed++;
      }
    }
    if (removed > 0) this.savePrintedFiles();
  }

  async start(refWindow) {
    this.refWindow = refWindow || null;
    if (!fs.existsSync(this.billsPath)) {
      fs.mkdirSync(this.billsPath, { recursive: true });
    }
    await this.scanExistingFiles();
    this.watchDirectory();
    this.startReminderInterval();
    this.checkJobQueue(refWindow)
  }

  /**
   * Track PDFs created mid-session, so a bill saved after startup is still
   * reminded about within the same session (scan alone would only catch it
   * on the next launch — which may be past the 3-day cutoff).
   */
  watchDirectory() {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.billsPath, (eventType, filename) => {
        // Only 'rename' (create/delete/move); 'change' fires per write and
        // would stat half-written files repeatedly.
        if (!filename || eventType !== "rename") return;
        const filePath = path.resolve(this.billsPath, filename);
        if (this.shouldTrackFile(filePath)) this.onFileAdded(filePath);
      });
      this.watcher.on("error", () => {});
    } catch (_) { /* scan-only fallback if the directory can't be watched */ }
  }

  /**
   * Scan existing files in directory (async - non-blocking)
   */
  async scanExistingFiles() {
    try {
      const files = await fs.promises.readdir(this.billsPath);
      const trackPromises = files.map(async filename => {
        const filePath = path.resolve(this.billsPath, filename);
        if (this.shouldTrackFile(filePath)) await this.onFileAdded(filePath);
      });
      await Promise.all(trackPromises);
      this.cleanupOldPrintedFiles();
    } catch (_) { /* non-critical */ }
  }

  /**
   * Check if file should be tracked
   */
  shouldTrackFile(filePath) {
    return filePath.endsWith('.pdf') &&
           !path.basename(filePath).includes('_temp') &&
           !this.removedFiles.has(path.basename(filePath)) &&
           fs.existsSync(filePath);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.reminderTimeout) {
      clearTimeout(this.reminderTimeout);
      this.reminderTimeout = null;
    }
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
    if (this.spoolTrackerInterval) {
      clearInterval(this.spoolTrackerInterval);
      this.spoolTrackerInterval = undefined;
    }
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) {}
      this.watcher = null;
    }
  }

  status(){
    if(this.reminderTimeout && this.reminderInterval)
      return true;
    else
      return false;
  }

  /**
   * Handle new file added (async - non-blocking)
   */
  async onFileAdded(filePath) {
    // Only track PDF files, exclude temp files
    if (!filePath.endsWith('.pdf') || filePath.includes('_temp')) {
      return;
    }

    // Don't re-add if already tracking
    if (this.trackedFiles.has(filePath)) {
      return;
    }

    try {
      const stats = await fs.promises.stat(filePath);
      const fileName = path.basename(filePath);

      // Check if file was previously marked as printed
      const wasPrinted = this.printedFiles.has(fileName);

      this.trackedFiles.set(filePath, {
        created: stats.birthtime,
        accessed: stats.atime,
        modified: stats.mtime,
        printed: wasPrinted,
        size: stats.size
      });
      // Push the updated queue to the Overview file-monitor widget
      this.broadcastQueueUpdate();

    } catch (_) { /* non-critical */ }
  }

  /** Tell the renderer the unprinted queue changed (new file, printed,
   *  removed). No-op when no reference window is attached. */
  broadcastQueueUpdate() {
    try {
      if (this.refWindow && !this.refWindow.isDestroyed())
        this.refWindow.webContents.send("file-monitor-queue-update", this.getQueue());
    } catch (_) { /* non-critical */ }
  }

  /**
   * Mark a file as printed. Persists even when the file was never tracked —
   * printPDF can finish before the scanner/watcher sees the file, and the
   * next session's scan decides wasPrinted from the persisted map.
   */
  markAsPrinted(filePath) {
    const fileName = path.basename(filePath);
    const fileInfo = this.trackedFiles.get(filePath);
    if (fileInfo) {
      fileInfo.printed = true;
      fileInfo.printedAt = new Date();
    }
    this.printedFiles.set(fileName, new Date().toISOString());
    this.savePrintedFiles();
    this.broadcastQueueUpdate();
  }

  /**
   * Remove an invoice from the unprinted queue (the widget's delete button).
   * The PDF on disk is NOT deleted — the file is untracked and persisted so
   * the next launch's scan doesn't re-queue it.
   */
  removeFromQueue(filePath) {
    const fileName = path.basename(filePath);
    this.trackedFiles.delete(filePath);
    this.removedFiles.add(fileName);
    this.saveRemovedFiles();
    this.broadcastQueueUpdate();
    return { ok: true };
  }

  /**
   * Remove every unprinted invoice from the queue (the widget's "remove all"
   * button). Same semantics as removeFromQueue — PDFs on disk are NOT
   * deleted, only unqueued and persisted so a rescan doesn't re-queue them.
   */
  removeAllFromQueue() {
    let removed = 0;
    for (const item of this.getQueue()) {
      this.removedFiles.add(item.name);
      this.trackedFiles.delete(item.path);
      removed++;
    }
    this.saveRemovedFiles();
    this.broadcastQueueUpdate();
    return { ok: true, removed };
  }

  /**
   * The unprinted queue for the Overview widget. Unlike the reminder checks
   * there is NO grace period — the widget must show an invoice the moment it
   * lands, so only the 3-day cutoff applies.
   */
  getQueue() {
    const now = Date.now();
    const threeDayCutoff = REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const queue = [];

    for (const [filePath, fileInfo] of this.trackedFiles.entries()) {
      const ageMs = now - fileInfo.created.getTime();
      if (ageMs > threeDayCutoff) continue;
      if (fileInfo.printed) continue;
      queue.push({
        path: filePath,
        name: path.basename(filePath),
        created: fileInfo.created,
        age: Math.floor(ageMs / 60000) // minutes
      });
    }
    // Newest first — the invoice that just landed is the one the user looks for
    queue.sort((a, b) => b.created.getTime() - a.created.getTime());
    return queue;
  }

  /**
   * Mark file as printed by bill identifier
   */
  markBillAsPrinted(billNo, customerName, billDate) {
    const fileName = getPDF_FileName(customerName, billDate, billNo);
    this.markAsPrinted(path.resolve(this.billsPath, fileName));
  }

  /**
   * Get unprinted files
   */
  getUnprintedFiles(olderThanMinutes = REMINDER_GRACE_MINUTES) {
    const now = Date.now();
    const threshold = olderThanMinutes * 60 * 1000;
    const threeDayCutoff = REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const unprinted = [];

    for (const [filePath, fileInfo] of this.trackedFiles.entries()) {
      const ageMs = now - fileInfo.created.getTime();

      // Skip anything older than 3 days to avoid bothering the user
      if (ageMs > threeDayCutoff) {
        continue;
      }

      if (!fileInfo.printed && ageMs > threshold) {
        unprinted.push({
          path: filePath,
          name: path.basename(filePath),
          created: fileInfo.created,
          age: Math.floor(ageMs / 60000) // minutes
        });
      }
    }

    return unprinted;
  }

  /**
   * Check for unprinted files and notify user. dialogOpen guard stops the
   * interval from stacking dialogs while one is up (or while Print Now is
   * still spooling).
   */
  async checkAndRemind() {
    if (this.reminderDialogOpen) return;

    const unprintedFiles = this.getUnprintedFiles(REMINDER_GRACE_MINUTES);
    if (unprintedFiles.length === 0) {
      return;
    }

    this.reminderDialogOpen = true;
    try {
      await this.showPrintReminder(unprintedFiles);
    } catch (_) { /* non-critical */ }
    finally {
      this.reminderDialogOpen = false;
    }
  }

  /**
   * Show print reminder dialog. "Print Later" leaves the files unprinted so
   * the next interval re-asks; only "Mark as Printed" / the checkbox stops it.
   */
  async showPrintReminder(unprintedFiles) {
    const mainWindow = (this.refWindow && !this.refWindow.isDestroyed())
      ? this.refWindow
      : BrowserWindow.getAllWindows()[0];
    
    if (!mainWindow || !global.user) return;

    const fileList = unprintedFiles.map(f =>
      `  • ${f.name} (${f.age} min ago)`
    ).join('\n');

    const message = unprintedFiles.length === 1
      ? `You have 1 unprinted bill:\n\n${fileList}\n\nWould you like to print it now?`
      : `You have ${unprintedFiles.length} unprinted bills:\n\n${fileList}\n\nWould you like to print them now?`;

    try {
      const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Unprinted Bills Reminder',
        message: message,
        buttons: ['Print Now', 'Print Later', 'Mark as Printed'],
        defaultId: 0,
        cancelId: 1,
        noLink:true,
        checkboxLabel: "Don't remind me again for these bills",
        checkboxChecked: false
      });

      if (response === 0) {
        await this.printNow(unprintedFiles, mainWindow);
      } else if (response === 2 || checkboxChecked) {
        unprintedFiles.forEach(file => {
          this.markAsPrinted(file.path);
        });
      }

    } catch (_) { /* non-critical */ }
  }

  /**
   * Silently print the given bills to the default printer and mark the
   * successful ones as printed. Failures stay unprinted so the next reminder
   * re-offers them. Returns { printed, failed } (error string set when no
   * printer exists at all).
   */
  async printNow(files, mainWindow) {
    let printer;
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      printer = (printers.find(p => p.isDefault) || printers[0])?.name;
      this.defaultPrinter = process.presets.defaultPrintObj?.printer || printer;
    } catch (_) { /* fall through to the no-printer path */ }

    if (!printer) {
      dialog.showErrorBox(
        "No printer found",
        "Could not find a printer. The bills were left unprinted and will be reminded again."
      );
      return { printed: 0, failed: files.length, error: "No printer found — the invoices were left unprinted." };
    }

    const { printSilent } = require('./printHandler');
    let printed = 0, failed = 0;

    for (const file of files) {
      if (!fs.existsSync(file.path)) continue;
      this.refWindow.webContents.send("get-file-monitor-update",true," - Printing "+file.name);
      setTimeout(()=>{
        this.refWindow.webContents.send("get-file-monitor-update",true,"");
      },300);
      let { copies=1,paperSize="A4" } = process.presets.defaultPrintObj;
      const err = await new Promise(res => printSilent(file.path, printer, copies, paperSize, e => res(e)));
      if (err) {
        dialog.showErrorBox("Print failed", `${file.name}: ${err.message}`);
        failed++;
        continue; // leave unprinted → reminded again
      }
      this.markAsPrinted(file.path);
      printed++;
    }
    return { printed, failed };
  }

  /**
   * Start reminder interval
   */
  startReminderInterval() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }
    // Check immediately after 5 seconds (catches unprinted bills from before
    // this launch)
    this.reminderTimeout = setTimeout(() => this.checkAndRemind(), 5000);

    // Then check periodically
    this.reminderInterval = setInterval(() => {
      this.refWindow.webContents.send("get-file-monitor-update",true," - Checking for unprinted files");
      setTimeout(()=>{
        this.refWindow.webContents.send("get-file-monitor-update",true,"");
      },300);
      this.checkAndRemind();
    }, this.reminderIntervalTime);
  }

  /**
   * Set reminder interval time
   */
  setReminderInterval(minutes) {
    this.reminderIntervalTime = minutes * 60 * 1000;
    this.startReminderInterval();
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.trackedFiles.size;
    let printed = 0;
    let unprinted = 0;
    for (const fileInfo of this.trackedFiles.values()) {
      if (fileInfo.printed) printed++;
      else unprinted++;
    }
    return { total, printed, unprinted };
  }

  /**
   * Get printed files list for debugging
   */
  getPrintedFilesList() {
    return Array.from(this.printedFiles.entries()).map(([fileName, printedDate]) => ({
      fileName,
      printedDate,
      age: Math.floor((Date.now() - new Date(printedDate).getTime()) / (60 * 60 * 1000)) // hours
    }));
  }

  async checkJobQueue(mainWindow){
    const { execFile } = require('child_process');
    const printers = await mainWindow.webContents.getPrintersAsync();
    this.defaultPrinter = (printers.find(p => p.isDefault) || printers[0])?.name;
    if(this.spoolTrackerInterval) return;
    // WIP spooler probe — only armed when the helper script exists, so the
    // interval can never throw on a missing script or a stale hardcoded bill.
    let spoolerScript;
    try { spoolerScript = require('./common').getPythonExecutablePath; } catch(_) { spoolerScript = null; }
    const scriptPath = path.resolve(__dirname, "scripts", "check_spooler.py");
    if (!fs.existsSync(scriptPath)) return;
    const py = spoolerScript ? spoolerScript() : "python";
    const self = this;
    this.spoolTrackerInterval = setInterval(()=>{
      checkQueueViaPython(this.defaultPrinter)
    },1000)

    function checkQueueViaPython(printerName) {
      execFile(py, [scriptPath, printerName], (error, stdout) => {
        if (error || !stdout || !stdout.trim()) return;

        try {
          const activeJobs = JSON.parse(stdout);
          activeJobs.forEach(job => {
            // Match spooler jobs against tracked invoice files and close the
            // loop the other way: the OS finished printing → mark printed.
            const name = job && job.DocumentName;
            if (typeof name !== "string") return;
            for (const [filePath, info] of self.trackedFiles.entries()) {
              if (!info.printed && name.includes(path.basename(filePath, ".pdf")))
                self.markAsPrinted(filePath);
            }
          });
        } catch (err) {
          console.error("Failed to parse spooler JSON", err);
        }
      });
    }
  }

  /**
   * Clear all tracking data
   */
  clearAll() {
    this.trackedFiles.clear();
  }
}

// Export singleton instance
let monitorInstance = null;

function getFileMonitor(billsPath) {
  if (!monitorInstance) {
    monitorInstance = new FileMonitor(billsPath);
  }
  return monitorInstance;
}

module.exports = {
  FileMonitor,
  getFileMonitor
};
