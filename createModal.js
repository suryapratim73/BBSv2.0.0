const {BrowserWindow, dialog} = require("electron");
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
  cb
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
        partition
      },
      parent:BrowserWindow.getFocusedWindow(),
      contextIsolation:true,
      movable:false,
      show:false,
      modal:false,
      ...windowOptions
  };
  let appPolicy = JSON.parse(fs.readFileSync(getAppPolicyPath()).toString());
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
  else
    modal = new BrowserWindow(windowOptions);
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
      // dialog.showMessageBox({
      //   title:"HTML File Path",
      //   message:path.join(__dirname,pathToHTML)
      // })
      modal.loadFile(path.join(__dirname,pathToHTML));
    }
    else
      modal.loadURL(protocol+pathToHTML);
    return modal;
  }
}

exports.getMainWindow = ()=>(windowList.find(win=>win.label==="Main").modal);

exports.getTargetWindow = (label)=>(windowList.find(win=>win.label===label).modal);