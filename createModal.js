const {BrowserWindow, dialog, nativeImage} = require("electron");
const path = require("path");
const fs = require("fs");


let windowList = [];
exports.createModal = (windowOptions={},pathToHTML,{
  show=true,
  loadFile=true,
  protocol="file://",
  maxWinCount,
  label,
  partition="persist:bbs_auth",
  cb,
  enableWebContents=true
}={})=>{
  let modal;
  let { getAppPolicyPath } = require("./template/js/common");
  windowOptions = {
      width: 400,
      height: 450,
      resizable:false,
      webPreferences: {
        nodeIntegration: true,
        devTools:true,
        partition,
        contextIsolation:false,
        enableRemoteModule: true
      },
      parent:BrowserWindow.getFocusedWindow(),
      // movable:false,
      show:false,
      modal:false,
      ...windowOptions
  };
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
  let appIcon = nativeImage.createFromPath(path.resolve(__dirname,"./logo256.png"));
  windowOptions.icon = appIcon//.resize({height:1024,width:1024});
  if(maxWinCount){
    if(windowList.filter(obj=>obj.label===label).length<maxWinCount){
      modal = new BrowserWindow(windowOptions);
      windowList.push({label,modal});
      modal.on("closed",function(e){
          this.removeListener("closed",arguments.callee);
          windowList = windowList.filter(obj=>obj.label!==label)
      });
    }
    else
      windowList.filter(obj=>obj.label===label)[0].modal.focus();
  }
  else{
    modal = new BrowserWindow(windowOptions);
    windowList.push({label,modal})
  }
  if(modal && enableWebContents)
    require("@electron/remote/main").enable(modal.webContents);
  if(modal){
    modal.removeMenu();
    modal.on("ready-to-show",function(){
      if(show)
        modal.show();
      if(cb && typeof cb==="function")
        cb.call(modal);
    });
    if(show && modal===windowList.find(win=>win.label==="Main").modal && "applyTheme" in appPolicy && appPolicy.applyTheme)
      modal.webContents.send("apply-theme",appPolicy.selectedTheme);
    if(loadFile){
      if(fs.existsSync(path.resolve(__dirname,pathToHTML)))
        modal.loadFile(path.resolve(__dirname,pathToHTML));
      // Apply cached weather theme + inject themes.css into every new window
      modal.webContents.once("did-finish-load", () => {
        try {
          const vm = require("./viewManager");
          vm.reapplyTheme(modal);

          // Inject themes.css so weather classes work on pages that don't link it
          const themesCSS = require("fs").readFileSync(
            require("path").join(__dirname, "template", "css", "themes.css"), "utf8"
          );
          modal.webContents.insertCSS(themesCSS, { key: "weather-themes" }).catch(() => {});
        } catch (_) {}
      });
    }
    else
      modal.loadURL(protocol+path.resolve(__dirname,pathToHTML));
    return modal;
  }
}

exports.getMainWindow = ()=>(windowList.find(win=>win.label==="Main")?.modal);

exports.getTargetWindow = (label)=>(windowList.find(win=>win.label===label).modal);

exports.createDialogBox = function(title,message,buttons,list){
  let winOpts = {
    width: 400,
      height: 450,
      resizable:false,
      webPreferences: {
        nodeIntegration: true,
        devTools:true,
      },
      parent:BrowserWindow.getFocusedWindow(),
      contextIsolation:true,
      movable:false,
      show:true,
      modal:true,
  }
  // let win = new BrowserWindow(winOpts,)
}