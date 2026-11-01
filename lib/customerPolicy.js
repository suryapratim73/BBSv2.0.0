/**
 * customerPolicy.js — electron wrapper for per-customer policies.
 * Policy lives in the customer row's `moreInfo.custPolicy` JSON field.
 * Registration is a 2-line main.js integration (like cloudConnect.js).
 */

const { ipcMain } = require("electron");
const { customer } = require("../model/dbConfig");
const { DEFAULT_POLICY, normalizePolicy } = require("./customerPolicyLogic");

function toObject(moreInfo) {
    if (moreInfo && typeof moreInfo === "object") return moreInfo;
    if (typeof moreInfo === "string") {
        try { return JSON.parse(moreInfo); } catch (_) { /* fall through */ }
    }
    return {};
}

async function getCustomerPolicy(customerId) {
    try {
        const row = await customer.findOne({ where: { id: customerId } });
        const custPolicy = toObject(row?.dataValues?.moreInfo)?.custPolicy;
        const verdict = normalizePolicy(custPolicy);
        return verdict.ok ? verdict.policy : { ...DEFAULT_POLICY };
    } catch (err) {
        return { ...DEFAULT_POLICY };
    }
}

async function setCustomerPolicy(customerId, policy) {
    const verdict = normalizePolicy(policy);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    try {
        const row = await customer.findOne({ where: { id: customerId } });
        if (!row) return { ok: false, error: "Customer not found." };
        const moreInfo = toObject(row.dataValues.moreInfo);
        moreInfo.custPolicy = verdict.policy;
        await customer.update({ moreInfo }, { where: { id: customerId } });
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
    return { ok: true, policy: verdict.policy, warnings: verdict.warnings };
}

function registerCustomerPolicyIPC() {
    ipcMain.handle("get-customer-policy", async (_evObj, customerId) => {
        return getCustomerPolicy(customerId);
    });
    ipcMain.handle("set-customer-policy", async (_evObj, customerId, policy) => {
        return setCustomerPolicy(customerId, policy);
    });
}

module.exports = { getCustomerPolicy, setCustomerPolicy, registerCustomerPolicyIPC };
