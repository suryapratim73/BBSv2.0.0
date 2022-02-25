const {BrowserWindow} = require("electron");


let windowList = [];

exports.createModal = (windowOptions={},pathToHTML,{
  show=true,
  loadFile=true,
  protocol="file://",
  maxWinCount,
  label,
  partition="persist:bbs_auth"
}={})=>{
  let modal;
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
  }
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
    if(show)
      modal.on("ready-to-show",modal.show);
    if(loadFile)
      modal.loadFile(pathToHTML);
    else
      modal.loadURL(protocol+pathToHTML);
    return modal;
  }
}

exports.getMainWindow = ()=>(windowList.find(win=>win.label==="Main").modal);

exports.getTargetWindow = (label)=>(windowList.find(win=>win.label===label).modal);