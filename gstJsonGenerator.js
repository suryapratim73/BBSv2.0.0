// gstJsonGenerator.js
// Utility to generate GST portal-compatible JSON for GSTR-1 filing
// Supports B2B, B2C (small/large), and basic structure. Extend as needed.

/**
 * Generate GSTR-1 JSON for GST portal upload
 * @param {Object} params
 * @param {string} params.gstin - Your GSTIN
 * @param {string} params.period - Filing period in MMYYYY
 * @param {number} params.grossTurnover - Previous year gross turnover
 * @param {number} params.currentGrossTurnover - Current year gross turnover
 * @param {Array} params.b2b - Array of B2B invoices
 * @param {Array} params.b2cs - Array of B2C small sales
 * @param {Array} params.b2cl - Array of B2C large sales
 * @returns {Object} GSTR-1 JSON object
 */
function generateGSTR1JSON({
  gstin,
  period,
  grossTurnover,
  currentGrossTurnover,
  b2b = [],
  b2cs = [],
  b2cl = []
}) {
  return {
    gstin,
    fp: period,
    gt: grossTurnover,
    cur_gt: currentGrossTurnover,
    ...(b2b.length ? { b2b } : {}),
    ...(b2cs.length ? { b2cs } : {}),
    ...(b2cl.length ? { b2cl } : {})
  };
}

// Example usage:
// const json = generateGSTR1JSON({
//   gstin: '22AAAAA0000A1Z5',
//   period: '012026',
//   grossTurnover: 1234567.89,
//   currentGrossTurnover: 234567.89,
//   b2b: [ ... ],
//   b2cs: [ ... ],
//   b2cl: [ ... ]
// });
// require('fs').writeFileSync('gstr1.json', JSON.stringify(json, null, 2));

module.exports = { generateGSTR1JSON };

/**
 * Convert sales data (our schema) to GST JSON format (b2b, b2cs, b2cl)
 * @param {Array} sales - Array of sale objects (from saleSchema)
 * @returns {Object} { b2b, b2cs, b2cl }
 */
function convertSalesToGSTJSON(sales) {
  const b2bMap = {};
  const b2cs = [];
  const b2clMap = {};

  sales.forEach(sale => {
    const isRegistered = sale.shipGST && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/.test(sale.shipGST);
    const isInterState = sale.placeOfSupply && sale.placeOfSupply !== (sale.shipGST ? sale.shipGST.substring(0,2) : "");
    const invoiceValue = Number(sale.billAmt) || 0;
    let items = [];
    try {
      items = typeof sale.billItemTable === 'string' ? JSON.parse(sale.billItemTable) : sale.billItemTable;
    } catch (e) { items = []; }

    // Helper to convert items to GST format with HSN, qty, unit, per_unit_rate
    const gstItems = (items || []).map((item, idx) => ({
      num: idx + 1,
      itm_det: {
        hsn_sc: item.hsn || item.hsn_sc || '',
        qty: Number(item.qty || item.quantity || 0),
        unit: item.unit || '',
        per_unit_rate: Number(item.rate || item.per_unit_rate || 0),
        rt: item.tax || (Number(item.sgst || 0) + Number(item.cgst || 0) + Number(item.igst || 0)) || 0,
        txval: Number(item.taxableValue || item.txval || item.amount || item.value || 0),
        iamt: Number(item.igst || 0),
        camt: Number(item.cgst || 0),
        samt: Number(item.sgst || 0),
        csamt: Number(item.cess || 0)
      }
    }));

    if (isRegistered) {
      // B2B
      if (!b2bMap[sale.shipGST]) b2bMap[sale.shipGST] = [];
      b2bMap[sale.shipGST].push({
        inum: String(sale.billNo),
        idt: formatDate(sale.billDate),
        val: invoiceValue,
        pos: sale.placeOfSupply || (sale.shipGST ? sale.shipGST.substring(0,2) : ""),
        rchrg: "N",
        inv_typ: "R",
        itms: gstItems
      });
    } else if (invoiceValue > 250000 && isInterState) {
      // B2CL
      const pos = sale.placeOfSupply || "";
      if (!b2clMap[pos]) b2clMap[pos] = [];
      b2clMap[pos].push({
        inum: String(sale.billNo),
        idt: formatDate(sale.billDate),
        val: invoiceValue,
        etin: "",
        itms: gstItems
      });
    } else {
      // B2CS
      (gstItems || []).forEach(gstItem => {
        b2cs.push({
          sply_ty: isInterState ? "INTER" : "INTRA",
          pos: sale.placeOfSupply || "",
          rt: gstItem.itm_det.rt,
          txval: gstItem.itm_det.txval,
          iamt: gstItem.itm_det.iamt,
          camt: gstItem.itm_det.camt,
          samt: gstItem.itm_det.samt,
          csamt: gstItem.itm_det.csamt
        });
      });
    }
  });

  // Format b2b and b2cl as arrays
  const b2b = Object.entries(b2bMap).map(([ctin, inv]) => ({ ctin, inv }));
  const b2cl = Object.entries(b2clMap).map(([pos, inv]) => ({ pos, inv }));
  return { b2b, b2cs, b2cl };
}

// Helper to format date as DD-MM-YYYY
function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

module.exports.convertSalesToGSTJSON = convertSalesToGSTJSON;
