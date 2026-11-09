/**
 * shipInfoManager.js — electron wrapper for per-customer ship-to addresses.
 * Entries live in the customer row's `moreInfo.shipInfos` JSON field (written
 * by the sale page on bill save). This module adds the management side the
 * portal needs: read fresh, edit/remove, persist, and keep the global
 * customer cache in sync. Registration is a 2-line main.js integration
 * (like customerPolicy.js).
 */

const { ipcMain } = require("electron");
const { customer } = require("../model/dbConfig");

function toObject(moreInfo) {
    if (moreInfo && typeof moreInfo === "object" && !Array.isArray(moreInfo)) return moreInfo;
    if (typeof moreInfo === "string") {
        try {
            const parsed = JSON.parse(moreInfo);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch (_) { /* fall through */ }
    }
    return {};
}

function normalizeShipInfos(shipInfos) {
    if (!Array.isArray(shipInfos)) return { ok: false, error: "shipInfos must be an array." };
    const infos = [];
    for (const entry of shipInfos) {
        if (!entry || typeof entry !== "object") continue;
        const info = {};
        ["name", "shipTo", "shipAddr", "shipPh", "shipGST"].forEach(key => {
            const v = entry[key];
            info[key] = (typeof v === "string") ? v.trim() : (v == null ? "" : String(v).trim());
        });
        if (!info.shipTo) continue; // an entry without a ship-to name is meaningless
        infos.push(info);
    }
    return { ok: true, infos };
}

async function getShipInfos(customerId) {
    try {
        const row = await customer.findOne({ where: { id: customerId } });
        const verdict = normalizeShipInfos(toObject(row?.dataValues?.moreInfo).shipInfos);
        return verdict.ok ? verdict.infos : [];
    } catch (_) {
        return [];
    }
}

async function setShipInfos(customerId, shipInfos) {
    const verdict = normalizeShipInfos(shipInfos);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    try {
        const row = await customer.findOne({ where: { id: customerId } });
        if (!row) return { ok: false, error: "Customer not found." };
        const moreInfo = toObject(row.dataValues.moreInfo);
        moreInfo.shipInfos = verdict.infos;
        await customer.update({ moreInfo }, { where: { id: customerId } });
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
    // Keep the global customer cache in sync so `get-customers` serves the
    // fresh list (the sale page and portal may hold their own copies).
    try {
        const cached = (global.customerList || []).find(c => String(c.id) === String(customerId));
        if (cached) {
            const moreInfo = toObject(cached.moreInfo);
            moreInfo.shipInfos = verdict.infos;
            cached.moreInfo = (typeof cached.moreInfo === "string") ? JSON.stringify(moreInfo) : moreInfo;
        }
    } catch (_) { /* the cache is an optimization — the DB is already correct */ }
    return { ok: true, shipInfos: verdict.infos };
}

function registerShipInfoIPC() {
    ipcMain.handle("get-ship-infos", async (_evObj, customerId) => {
        return getShipInfos(customerId);
    });
    ipcMain.handle("set-ship-infos", async (_evObj, customerId, shipInfos) => {
        return setShipInfos(customerId, shipInfos);
    });
}

module.exports = { getShipInfos, setShipInfos, registerShipInfoIPC };
