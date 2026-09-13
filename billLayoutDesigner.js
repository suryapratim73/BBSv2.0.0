

exports.billDesignerWindow = (mainWindow) => {
    const { MenuItem, nativeImage, Menu, dialog, app } = require("electron");
    const fs = require("fs");
    const path = require("path");
    return () => {
    const { getTemplatePath } = require("./viewManager");
    mainWindow.loadFile(getTemplatePath("billLayout"));
    let menu = Menu.getApplicationMenu();
    menu.append(
        new MenuItem({
        role: "fileMenu",
        submenu: [
            new MenuItem({
                label: "New",
                click: () => {
                    mainWindow.webContents.send("new-template");
                },
            }),
            new MenuItem({
                label: "Open",
                click: async () => {
                    try {
                    let { canceled, filePaths } = await dialog.showOpenDialog({
                        defaultPath: app.getPath("documents"),
                        filters: [{ name: "JSON Files", extensions: ["json"] }],
                        icon:nativeImage.createFromPath(path.resolve(__dirname,"./logo256.png"))
                    });
                    if (canceled) return;
                    fs.readFile(filePaths[0], (err, data) => {
                        if (err) throw err;
                        mainWindow.webContents.send(
                        "set-opened-file",
                        JSON.parse(data.toString()),
                        filePaths[0]
                        );
                    });
                    } catch (err) {
                    const { appLogger } = require('./common.js');
                    appLogger({title:"Error",message:String(err),func:"filepath read error"});
                    }
                },
            }),
            new MenuItem({
                label: "Save as",
                click: () => mainWindow.webContents.send("save-as"),
            }),
            new MenuItem({
                label: "Save & Exit",
                click: () => mainWindow.webContents.send("save-as-exit"),
            }),
        ],
        enabled: true,
        visible: true,
        label: "File",
        })
    );
    Menu.setApplicationMenu(menu);
    };
};
