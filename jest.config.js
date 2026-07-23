/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.js"],
  // Mock native modules and Electron — they don't exist in a plain Node test runner
  moduleNameMapper: {
    "^electron$": "<rootDir>/__mocks__/electron.js",
    "^@electron/remote$": "<rootDir>/__mocks__/electronRemote.js",
    "^keytar$": "<rootDir>/__mocks__/empty.js",
    "^bcrypt$": "<rootDir>/__mocks__/empty.js",
    "^sqlite3$": "<rootDir>/__mocks__/empty.js",
    "^pdfkit$": "<rootDir>/__mocks__/empty.js",
    "^qrcode$": "<rootDir>/__mocks__/empty.js",
    "^speakeasy$": "<rootDir>/__mocks__/empty.js",
    "^electron-window-state$": "<rootDir>/__mocks__/empty.js",
    "^socket.io-client$": "<rootDir>/__mocks__/empty.js",
    "^adm-zip$": "<rootDir>/__mocks__/empty.js",
  },
  // Don't transform anything — project is plain CommonJS
  transform: {},
  // Clear mocks between tests
  clearMocks: true,
  // Collect coverage from main-process source files (not template/ or node_modules/)
  collectCoverageFrom: [
    "*.js",
    "model/**/*.js",
    "lib/**/*.js",
    "scripts/**/*.js",
    "!template/**",
    "!node_modules/**",
    "!__tests__/**",
    "!__mocks__/**",
    "!e2e/**",
    "!coverage/**",
  ],
  coverageDirectory: "coverage",
};
