// Minimal Electron mock for Jest unit tests.
// Main-process modules that require('electron') get this instead of the real thing.
// Only the APIs actually used by tested modules need stubs; add more as tests grow.

const { EventEmitter } = require("events");

// --- app ---
const app = new EventEmitter();
app.getPath = jest.fn((name) => `/mock/path/${name}`);
app.getAppPath = jest.fn(() => "/mock/app");
app.getName = jest.fn(() => "BBS (test)");
app.getVersion = jest.fn(() => "2.22.0");
app.isReady = jest.fn(() => true);
app.whenReady = jest.fn(() => Promise.resolve());
app.quit = jest.fn();
app.requestSingleInstanceLock = jest.fn(() => true);
app.commandLine = { appendSwitch: jest.fn(), appendArgument: jest.fn() };
app.setAsDefaultProtocolClient = jest.fn();
app.setAppUserModelId = jest.fn();

// --- BrowserWindow ---
function BrowserWindow(opts) {
  this.webContents = new EventEmitter();
  this.webContents.send = jest.fn();
  this.webContents.executeJavaScript = jest.fn();
  this.webContents.session = { webRequest: {} };
  this.id = Math.floor(Math.random() * 10000);
  this.isDestroyed = jest.fn(() => false);
  this.isMinimized = jest.fn(() => false);
  this.isVisible = jest.fn(() => true);
  this.focus = jest.fn();
  this.show = jest.fn();
  this.hide = jest.fn();
  this.close = jest.fn();
  this.destroy = jest.fn();
  this.minimize = jest.fn();
  this.restore = jest.fn();
  this.loadFile = jest.fn();
  this.loadURL = jest.fn();
  this.setBounds = jest.fn();
  this.getBounds = jest.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }));
  this.center = jest.fn();
  this.setMenu = jest.fn();
  this.setTitle = jest.fn();
  this.on = jest.fn(function (evt, cb) {
    if (evt === "close") this._closeCb = cb;
    return this;
  });
  this.once = jest.fn();
  this.removeAllListeners = jest.fn();
  this.setIgnoreMouseEvents = jest.fn();
  this.setAlwaysOnTop = jest.fn();
  this.setResizable = jest.fn();
  this.setFullScreen = jest.fn();
  this.setSkipTaskbar = jest.fn();
}
BrowserWindow.getAllWindows = jest.fn(() => []);
BrowserWindow.fromWebContents = jest.fn(() => null);
BrowserWindow.getFocusedWindow = jest.fn(() => null);

// --- ipcMain ---
const ipcMain = new EventEmitter();
ipcMain.handle = jest.fn();
ipcMain.handleOnce = jest.fn();
ipcMain.removeHandler = jest.fn();

// --- ipcRenderer ---
const ipcRenderer = new EventEmitter();
ipcRenderer.send = jest.fn();
ipcRenderer.invoke = jest.fn();
ipcRenderer.sendSync = jest.fn();
ipcRenderer.sendToHost = jest.fn();
ipcRenderer.removeAllListeners = jest.fn();

// --- dialog ---
const dialog = {
  showErrorBox: jest.fn(),
  showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
  showOpenDialog: jest.fn(() => Promise.resolve({ canceled: false, filePaths: [] })),
  showSaveDialog: jest.fn(() => Promise.resolve({ canceled: false, filePath: "" })),
};

// --- shell ---
const shell = {
  openPath: jest.fn(() => Promise.resolve("")),
  openExternal: jest.fn(() => Promise.resolve()),
  showItemInFolder: jest.fn(),
  beep: jest.fn(),
};

// --- net ---
const net = { request: jest.fn(), fetch: jest.fn() };

// --- session ---
const session = {
  defaultSession: {
    cookies: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      onChanged: { addListener: jest.fn() },
    },
    webRequest: {
      onBeforeSendHeaders: jest.fn(),
      onHeadersReceived: jest.fn(),
    },
    setPermissionRequestHandler: jest.fn(),
  },
  fromPartition: jest.fn(() => session.defaultSession),
};
session.defaultSession.cookies.get = jest.fn(() => Promise.resolve([]));

// --- protocol ---
const protocol = { registerSchemesAsPrivileged: jest.fn() };

// --- notification ---
function Notification(opts) {
  this.show = jest.fn();
  this.close = jest.fn();
}
Notification.isSupported = jest.fn(() => false);

// --- screen ---
const screen = {
  getPrimaryDisplay: jest.fn(() => ({
    workAreaSize: { width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  })),
  getAllDisplays: jest.fn(() => []),
  getCursorScreenPoint: jest.fn(() => ({ x: 0, y: 0 })),
};

// --- systemPreferences ---
const systemPreferences = {
  askForMediaAccess: jest.fn(() => Promise.resolve(true)),
  getMediaAccessStatus: jest.fn(() => "granted"),
};

// --- powerSaveBlocker ---
const powerSaveBlocker = { start: jest.fn(() => 1), stop: jest.fn() };

// --- nativeTheme ---
const nativeTheme = new EventEmitter();
nativeTheme.shouldUseDarkColors = false;
nativeTheme.themeSource = "system";

// --- Menu ---
const Menu = {
  buildFromTemplate: jest.fn(() => ({ items: [] })),
  setApplicationMenu: jest.fn(),
  getApplicationMenu: jest.fn(() => null),
};

// --- globalShortcut ---
const globalShortcut = { register: jest.fn(), unregister: jest.fn(), unregisterAll: jest.fn() };

// --- clipboard ---
const clipboard = { writeText: jest.fn(), readText: jest.fn(() => ""), clear: jest.fn() };

// --- contextBridge ---
const contextBridge = { exposeInMainWorld: jest.fn() };

// --- crashReporter ---
const crashReporter = { start: jest.fn(), addExtraParameter: jest.fn() };

module.exports = {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  dialog,
  shell,
  net,
  session,
  protocol,
  Notification,
  screen,
  systemPreferences,
  powerSaveBlocker,
  nativeTheme,
  Menu,
  globalShortcut,
  clipboard,
  contextBridge,
  crashReporter,
};
