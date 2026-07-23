const { BrowserWindow, ipcMain, dialog, app } = require("electron");
const { appLogger, getFivePercentOfMemory, queryStock } = require("./common");
const { createModal } = require("./createModal");
const { getTemplatePath } = require("./viewManager");
const { stock } = require("./model/dbConfig");
const fs = require("fs");
const path = require("path");

let windowOptions = {
    width: 800,
    height: 600
};

/**
 * Opens the Catalogue Creator window
 * @param {BrowserWindow} mainWindow - Reference to the main application window
 */
exports.openCatalogueCreator = mainWindow => {
    return () => {
        windowOptions.parent = mainWindow;
        let pathToHTML = getTemplatePath("catalogueCreator");
        createModal(windowOptions, pathToHTML, {
            maxWinCount: 1,
            label: "Catalogue-Creator"
        }).webContents.openDevTools({ mode: "detach" });
    };
};

/**
 * IPC: Get all stock items for catalogue creation
 * Returns items with id, name, type, pInfo (including key and refPics)
 */
ipcMain.handle("get-catalogue-data", async () => {
    try {
        let stocks = await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);
        // Return only the fields needed for catalogue creation
        let catalogueItems = stocks.map(item => ({
            id: item.id,
            name: item.name,
            hsn: item.hsn,
            type: item.type,
            unit: item.unit,
            standardSellPrice: item.standardSellPrice,
            pInfo: item.pInfo || {},
            quantity: item.quantity
        }));
        return catalogueItems;
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "get-catalogue-data"
        });
        return [];
    }
});

/**
 * IPC: Save catalogue categories for items
 * Updates the "key" property in pInfo for each item
 * @param {Object} data - { items: [{ id, key }] }
 */
ipcMain.on("save-catalogue-categories", async (e, data) => {
    try {
        let { items } = data;
        if (!items || !Array.isArray(items)) {
            throw new Error("Invalid data format: items array required");
        }

        for (let item of items) {
            let stockItem = await stock.findOne({ where: { id: item.id } });
            if (!stockItem) continue;

            let currentPInfo = stockItem.dataValues.pInfo || {};
            let updatedPInfo = {
                ...currentPInfo,
                key: item.key || "" // The category key/label
            };

            await stock.update(
                { pInfo: updatedPInfo },
                { where: { id: item.id } }
            );
        }

        // Refresh global stock cache
        global.stocks = undefined;
        await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);

        let msg = {
            type: "info",
            title: "Catalogue Saved",
            message: "Catalogue categories have been saved successfully."
        };
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(), msg);

        appLogger({
            title: "Catalogue Categories Saved",
            message: `Updated ${items.length} items`,
            func: "save-catalogue-categories"
        });

        e.sender.send("catalogue-save-response", { success: true });
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "save-catalogue-categories"
        });
        e.sender.send("catalogue-save-response", {
            success: false,
            error: err.message
        });
    }
});

/**
 * IPC: Save reference picture for an item
 * Opens a file dialog for the user to pick an image, then stores the path in pInfo.refPics
 */
ipcMain.handle("add-ref-pic", async (e, itemId) => {
    try {
        let win = BrowserWindow.fromId(e.frameId);
        let result = await dialog.showOpenDialog(win, {
            title: "Select Reference Picture",
            filters: [
                { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp"] }
            ],
            properties: ["openFile"]
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, cancelled: true };
        }

        let imagePath = result.filePaths[0];

        // Copy the image to the app's catalogue images directory
        let appPath = process.env.APP_ENV === "PROD"
            ? path.resolve(app.getPath("appData"), "./BBS/")
            : path.resolve(__dirname);
        let catalogueImgDir = path.resolve(appPath, "catalogue_images");
        if (!fs.existsSync(catalogueImgDir)) {
            fs.mkdirSync(catalogueImgDir, { recursive: true });
        }

        let ext = path.extname(imagePath);
        let destFileName = `${itemId}_${Date.now()}${ext}`;
        let destPath = path.resolve(catalogueImgDir, destFileName);
        fs.copyFileSync(imagePath, destPath);

        // Update pInfo with reference picture path
        let stockItem = await stock.findOne({ where: { id: itemId } });
        if (!stockItem) {
            return { success: false, error: "Stock item not found" };
        }

        let currentPInfo = stockItem.dataValues.pInfo || {};
        let refPics = currentPInfo.refPics || [];
        refPics.push(destPath);
        let updatedPInfo = {
            ...currentPInfo,
            refPics
        };

        await stock.update(
            { pInfo: updatedPInfo },
            { where: { id: itemId } }
        );

        appLogger({
            title: "Reference Picture Added",
            message: `Added ref pic for item ${itemId}: ${destPath}`,
            func: "add-ref-pic"
        });

        return { success: true, path: destPath, refPics };
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "add-ref-pic"
        });
        return { success: false, error: err.message };
    }
});

/**
 * IPC: Remove a reference picture for an item
 */
ipcMain.on("remove-ref-pic", async (e, data) => {
    try {
        let { itemId, picPath } = data;

        let stockItem = await stock.findOne({ where: { id: itemId } });
        if (!stockItem) return;

        let currentPInfo = stockItem.dataValues.pInfo || {};
        let refPics = (currentPInfo.refPics || []).filter(p => p !== picPath);

        // Delete the file if it exists
        // if (fs.existsSync(picPath)) {
        //     fs.unlinkSync(picPath);
        // }

        let updatedPInfo = {
            ...currentPInfo,
            refPics
        };

        await stock.update(
            { pInfo: updatedPInfo },
            { where: { id: itemId } }
        );

        appLogger({
            title: "Reference Picture Removed",
            message: `Removed ref pic for item ${itemId}: ${picPath}`,
            func: "remove-ref-pic"
        });

        e.sender.send("ref-pic-removed", { success: true, itemId, refPics });
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "remove-ref-pic"
        });
        e.sender.send("ref-pic-removed", { success: false, error: err.message });
    }
});

/**
 * IPC: Get existing categories (unique keys from all stock items' pInfo)
 */
ipcMain.handle("get-existing-categories", async () => {
    try {
        let stocks = await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);
        let categories = new Set();
        stocks.forEach(item => {
            let key = item.pInfo?.key;
            if (key && typeof key === "string" && key.trim() !== "") {
                categories.add(key.trim());
            }
        });
        return Array.from(categories).sort();
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "get-existing-categories"
        });
        return [];
    }
});

/**
 * IPC: Add a new item to stock (for catalogue creation workflow)
 */
ipcMain.handle("create-catalogue-item", async (e, itemObj) => {
    try {
        let result = await stock.findOrCreate({
            where: {
                name: itemObj.name,
            },
            defaults: {
                name: itemObj.name,
                hsn: itemObj.hsn || 7318,
                type: itemObj.type || "",
                unit: itemObj.unit || "Kg",
                buyPrice: 0,
                standardSellPrice: itemObj.standardSellPrice || 0,
                pInfo: {
                    key: itemObj.key || ""
                }
            }
        });

        // Refresh global stock cache
        global.stocks = undefined;
        await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);

        appLogger({
            title: "Catalogue Item Created",
            message: `Created item: ${itemObj.name}`,
            func: "create-catalogue-item"
        });

        return result[0].dataValues;
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "create-catalogue-item"
        });
        return null;
    }
});

/**
 * IPC: Remove an item from catalogue (clear its key in pInfo, does NOT delete the stock)
 */
ipcMain.on("remove-from-catalogue", async (e, itemId) => {
    try {
        let stockItem = await stock.findOne({ where: { id: itemId } });
        if (!stockItem) return;

        let currentPInfo = stockItem.dataValues.pInfo || {};
        delete currentPInfo.key;

        await stock.update(
            { pInfo: currentPInfo },
            { where: { id: itemId } }
        );

        // Refresh global stock cache
        global.stocks = undefined;
        await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);

        appLogger({
            title: "Item Removed from Catalogue",
            message: `Removed item ${itemId} from catalogue`,
            func: "remove-from-catalogue"
        });

        e.sender.send("remove-from-catalogue-response", { success: true, itemId });
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "remove-from-catalogue"
        });
        e.sender.send("remove-from-catalogue-response", {
            success: false,
            error: err.message
        });
    }
});

/**
 * IPC: Get reference pictures for all items (for batch auto-fill hint)
 */
ipcMain.handle("get-all-ref-pics", async () => {
    try {
        let stocks = await queryStock(stock, undefined, appLogger, getFivePercentOfMemory);
        let refPicsMap = {};
        stocks.forEach(item => {
            let pics = item.pInfo?.refPics;
            if (pics && Array.isArray(pics) && pics.length > 0) {
                refPicsMap[item.id] = pics;
            }
        });
        return refPicsMap;
    } catch (err) {
        appLogger({
            title: "Error",
            message: String(err),
            func: "get-all-ref-pics"
        });
        return {};
    }
});
