/**
 * proformaStore.js — pure helpers for the proformas.json file.
 *
 * Proforma bills are quotes, not invoices: they live in a JSON file (same
 * shape convention as orders.json) and are only ever materialized into the
 * sale DB when the user converts one to a real invoice from Order Manager.
 * Keeping read/merge/filter logic here lets it be unit-tested without
 * Electron.
 */

/** Read proformas.json into an array; missing/corrupt file → []. */
function loadProformas(proformasPath, fs) {
    try {
        const data = JSON.parse(fs.readFileSync(proformasPath, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}

/** Insert/replace an entry (dedup by proformaId) and return the new list. */
function upsertProforma(list, entry) {
    const proformas = Array.isArray(list) ? list : [];
    const proformaId = entry && entry.proformaId;
    return [
        ...proformas.filter(o => o.proformaId !== proformaId),
        entry
    ];
}

/** Remove an entry by proformaId and return the new list. */
function removeProforma(list, proformaId) {
    const proformas = Array.isArray(list) ? list : [];
    return proformas.filter(o => o.proformaId !== proformaId);
}

module.exports = { loadProformas, upsertProforma, removeProforma };
