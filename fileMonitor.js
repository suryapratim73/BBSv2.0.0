const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow, Notification } = require('electron');
const { getBillsDir } = require('./common');

class FileMonitor {
  constructor(billsPath) {
    this.billsPath = billsPath || getBillsDir();
    this.trackedFiles = new Map();
    this.reminderInterval = null;
    this.reminderIntervalTime = 30 * 60 * 1000; // 30 minutes
    this.printedFilesPath = path.resolve(app.getPath("userData"), "printedFiles.json");
    this.printedFiles = new Map();
    this.loadPrintedFiles();
  }

  loadPrintedFiles() {
    try {
      if (fs.existsSync(this.printedFilesPath)) {
        const data = fs.readFileSync(this.printedFilesPath, 'utf8');
        const parsed = JSON.parse(data);
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
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
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
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

  async start() {
    if (this.reminderInterval) return;
    if (!fs.existsSync(this.billsPath)) {
      fs.mkdirSync(this.billsPath, { recursive: true });
    }
    await this.scanExistingFiles();
    this.startReminderInterval();
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
           fs.existsSync(filePath);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
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
        size: stats.size,
        reminded: false
      });

      if (!wasPrinted) {
        // file tracked silently
      }

    } catch (_) { /* non-critical */ }
  }
  fileName = path.basename(filePath);
    
  if (fileInfo) {
    fileInfo.printed = true;
    fileInfo.printedAt = new Date();
    fileInfo.reminded = false;
    
    // Persist to printedFiles
    this.printedFiles.set(fileName, new Date().toISOString());
    this.savePrintedFiles();
  }
  


  /**
   * Mark file as printed by bill identifier
   */
  markBillAsPrinted(billNo, customerName, billDate) {
    const fileName = `${customerName}_${billDate}_${billNo}.pdf`;
    const filePath = path.resolve(this.billsPath, fileName);
    
    this.markAsPrinted(filePath);
  }

  /**
   * Get unprinted files
   */
  getUnprintedFiles(olderThanMinutes = 5) {
    const now = Date.now();
    const threshold = olderThanMinutes * 60 * 1000;
    const threeDayCutoff = 3 * 24 * 60 * 60 * 1000;
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
   * Check for unprinted files and notify user
   */
  checkAndRemind() {
    const unprintedFiles = this.getUnprintedFiles(5);
    
    if (unprintedFiles.length === 0) {
      return;
    }

    // Filter files that haven't been reminded yet
    const newUnprinted = unprintedFiles.filter(file => {
      const fileInfo = this.trackedFiles.get(file.path);
      return fileInfo && !fileInfo.reminded;
    });

    if (newUnprinted.length === 0) {
      return;
    }

    // Show reminder dialog
    this.showPrintReminder(newUnprinted);

    // Mark as reminded
    newUnprinted.forEach(file => {
      const fileInfo = this.trackedFiles.get(file.path);
      if (fileInfo) {
        fileInfo.reminded = true;
      }
    });
  }

  /**
   * Show print reminder dialog
   */
  async showPrintReminder(unprintedFiles) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    
    if (!mainWindow) return;

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
        checkboxLabel: "Don't remind me again for these bills",
        checkboxChecked: false
      });

      if (response === 0) {
        mainWindow.webContents.send('print-unprinted-bills', unprintedFiles);
      } else if (response === 2 || checkboxChecked) {
        unprintedFiles.forEach(file => {
          this.markAsPrinted(file.path);
        });
      }

    } catch (_) { /* non-critical */ }
  }

  /**
   * Start reminder interval
   */
  startReminderInterval() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }

    // Check immediately after 5 seconds
    setTimeout(() => this.checkAndRemind(), 5000);

    // Then check periodically
    this.reminderInterval = setInterval(() => {
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