const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow, Notification } = require('electron');
const { appLogger } = require('./common');

class FileMonitor {
  constructor(billsPath) {
    this.billsPath = billsPath || path.resolve(app.getPath("documents"), "./Bills/");
    this.trackedFiles = new Map(); // Map<filePath, {created: Date, printed: boolean, reminded: boolean}>
    this.reminderInterval = null;
    this.reminderIntervalTime = 30 * 60 * 1000; // 30 minutes
    this.printedFilesPath = path.resolve(app.getPath("userData"), "printedFiles.json");
    this.printedFiles = new Map(); // Map<fileName, printedDate>
    this.loadPrintedFiles();
  }

  /**
   * Load printed files from persistent storage
   */
  loadPrintedFiles() {
    try {
      if (fs.existsSync(this.printedFilesPath)) {
        const data = fs.readFileSync(this.printedFilesPath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Convert to Map and filter out entries older than 3 days
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        
        for (const [fileName, printedDate] of Object.entries(parsed)) {
          const printedTime = new Date(printedDate).getTime();
          if (printedTime > threeDaysAgo) {
            this.printedFiles.set(fileName, printedDate);
          }
        }
        
        // Save back to remove old entries
        this.savePrintedFiles();
        
        appLogger({
          message: `Loaded ${this.printedFiles.size} printed file records`
        });
      }
    } catch (err) {
      appLogger({
        title: "Error loading printed files",
        message: String(err),
        func: "FileMonitor.loadPrintedFiles"
      });
    }
  }

  /**
   * Save printed files to persistent storage
   */
  savePrintedFiles() {
    try {
      const data = Object.fromEntries(this.printedFiles);
      fs.writeFileSync(this.printedFilesPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      appLogger({
        title: "Error saving printed files",
        message: String(err),
        func: "FileMonitor.savePrintedFiles"
      });
    }
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
    
    if (removed > 0) {
      this.savePrintedFiles();
      appLogger({
        message: `Cleaned up ${removed} old printed file records`
      });
    }
  }

  /**
   * Start monitoring the bills folder
   */
  async start() {
    if (this.reminderInterval) {
      appLogger({ message: "File monitor already running" });
      return;
    }

    // Ensure directory exists
    if (!fs.existsSync(this.billsPath)) {
      fs.mkdirSync(this.billsPath, { recursive: true });
    }

    // Scan existing files first (async - won't block main thread)
    await this.scanExistingFiles();

    // Start reminder interval (no add/delete watching)
    this.startReminderInterval();

    appLogger({ message: "File monitor started for: " + this.billsPath });
  }

  /**
   * Scan existing files in directory (async - non-blocking)
   */
  async scanExistingFiles() {
    try {
      const files = await fs.promises.readdir(this.billsPath);
      
      // Process files in parallel batches to avoid blocking
      const trackPromises = files.map(async filename => {
        const filePath = path.resolve(this.billsPath, filename);
        if (this.shouldTrackFile(filePath)) {
          await this.onFileAdded(filePath);
        }
      });
      
      await Promise.all(trackPromises);
      
      // Clean up old printed file records
      this.cleanupOldPrintedFiles();
      
    } catch (err) {
      appLogger({
        title: "Error scanning existing files",
        message: String(err),
        func: "FileMonitor.scanExistingFiles"
      });
    }
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

    appLogger({ message: "File monitor stopped" });
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
        appLogger({
          title: "New bill PDF detected",
          message: fileName
        });
      }

    } catch (err) {
      appLogger({
        title: "Error tracking file",
        message: String(err),
        func: "FileMonitor.onFileAdded"
      });
    }
  }
  fileName = path.basename(filePath);
    
  if (fileInfo) {
    fileInfo.printed = true;
    fileInfo.printedAt = new Date();
    fileInfo.reminded = false;
    
    // Persist to printedFiles
    this.printedFiles.set(fileName, new Date().toISOString());
    this.savePrintedFiles();
    
    appLogger({
      title: "Bill marked as printed",
      message: fileName,
      [fileInfo.printedAt]: new Date(),
      [fileInfo.reminded]: false
    });
    
    appLogger({
      title: "Bill marked as printed",
      message: path.basename(filePath)
    });
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
        // Print Now - send to renderer to open print dialog
        mainWindow.webContents.send('print-unprinted-bills', unprintedFiles);
      } else if (response === 2 || checkboxChecked) {
        // Mark as Printed or Don't remind again
        unprintedFiles.forEach(file => {
          this.markAsPrinted(file.path);
        });
      }

      appLogger({
        title: "Print reminder shown",
        message: `${unprintedFiles.length} files, response: ${response}`
      });

    } catch (err) {
      appLogger({
        title: "Error showing print reminder",
        message: String(err),
        func: "FileMonitor.showPrintReminder"
      });
    }
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

    appLogger({
      message: `Print reminder interval started (${this.reminderIntervalTime / 60000} minutes)`
    });
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
      if (fileInfo.printed) {
        printed++;
      } else {
        unprinted++;
      }
    }

    return { total, printed, unprinted };
    this.printedFiles.clear();
        this.savePrintedFiles();
    appLogger({ message: "File monitor tracking data cleared" });
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
    appLogger({ message: "File monitor tracking data cleared" });
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