const { app, BrowserWindow, Menu, ipcMain } = require('electron')

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth:800,
    minHeight:600,
    webPreferences: {
      nodeIntegration: true
    },
    show:false,
    contextIsolation:true
  });

    let menu=Menu.buildFromTemplate(require("./menuTemplate")(mainWindow))

    Menu.setApplicationMenu(menu);
    // mainWindow.loadFile(__dirname+'/build/index.html');
    mainWindow.loadURL('http://localhost:5000');
    mainWindow.once("ready-to-show",mainWindow.show)
}

app.whenReady().then(createWindow);


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
