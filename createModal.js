const {BrowserWindow} = require("electron");

exports.createModal = (windowOptions,pathToHTML,show=true,loadFile=true)=>{
    windowOptions = windowOptions ?? {
        width: 400,
            height: 450,
            resizable:false,
            webPreferences: {
              nodeIntegration: true,
              devTools:true
            },
            parent:BrowserWindow.getFocusedWindow(),
            contextIsolation:true,
            movable:false
    }
    // console.log(windowOptions)
    let modal = new BrowserWindow(windowOptions);
    modal.removeMenu();
    if(show)
      modal.on("ready-to-show",modal.show);
    if(loadFile)
      modal.loadFile(pathToHTML);
    else
      modal.loadURL("file://"+pathToHTML);
    return modal;
}