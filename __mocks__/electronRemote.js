// Mock for @electron/remote
module.exports = {
  require: jest.fn(() => ({})),
  getCurrentWindow: jest.fn(() => null),
  getCurrentWebContents: jest.fn(() => ({})),
  getGlobal: jest.fn((name) => global[name]),
  app: {
    getPath: jest.fn((name) => `/mock/path/${name}`),
    getAppPath: jest.fn(() => "/mock/app"),
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
    getFocusedWindow: jest.fn(() => null),
  },
  dialog: {
    showErrorBox: jest.fn(),
    showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
  },
};
