// verify-pdfkit-upgrade.js — smoke-tests the real bill-PDF engines against
// pdfkit 0.20.2 under plain node (electron is stubbed; no app launch needed):
//   1. makePDF.billPDF classic path  -> owner-password encrypted A4 PDF
//   2. makePDF.billPDF "D2" path     -> same
//   3. execCustomTemplate.main on the "default1" starter
// Each PDF is parsed with pdfjs-dist (page count/size/text) and the bill
// outputs are checked for the /Encrypt dict (secure-invoice feature).
// Run: node scripts/verify-pdfkit-upgrade.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const Module = require("module");

process.env.APP_ENV = "DEV";
// getPDF_FileName reads process.presets.fileNameFormat (main.js sets this in
// the app); provide the same shape here so the default engine can run.
process.presets = { fileNameFormat: "name_billDate_billNo", financialYearStartDate: "04-01" };

// ---------------------------------------------------------------------------
// Stub electron / @electron/remote BEFORE the engines are required.
// ---------------------------------------------------------------------------
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bbs-pdfkit-smoke-"));
const electronStub = {
  app: { getPath: () => TMP_ROOT },
  dialog: { showErrorBox: () => {} },
  ipcRenderer: { invoke: async () => ({}), send: () => {}, on: () => {} },
};
for (const id of ["electron", "@electron/remote"]) {
  try {
    const r = require.resolve(id);
    require.cache[r] = {
      id: r,
      filename: r,
      loaded: true,
      exports: id === "electron" ? electronStub : { app: electronStub.app },
    };
  } catch (e) {
    console.log("stub-skip", id, e.message);
  }
}

// ---------------------------------------------------------------------------
// Minimal saleConfig.json (config/ is gitignored; created only if missing,
// removed again in cleanup so the user's real config is never touched).
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, "..", "config", "saleConfig.json");
const hadConfig = fs.existsSync(CONFIG_PATH);
if (!hadConfig) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      biller: "Krishna Traders",
      address: "Main Road, Siliguri",
      phones: ["9830000000"],
      gst: "19AAACK1234F1Z5",
      email: "kt@example.com",
      bankDetails: [],
      borderRect: false,
      margin: 30,
      paperSize: "A4",
      format: "billNo",
      abbr: "KT",
      placeOfJurisdiction: "West Bengal",
      defaultFontFamily: "Times-Roman",
      defaultFontSize: 12,
      titleFontFamily: "Times-Bold",
      captionFontSize: 10,
      titileFontSize: 12,
      headingFontSize: 14,
      billTemplate: { applyTemplate: false, file: "default2", applyEmblem: false, emblem: "" },
    }, null, 2)
  );
}

const { billPDF } = require("./makePDF.default.js");
const { main: execTemplateMain } = require("../lib/execCustomTemplate");
const { buildStarter } = require("../lib/billElementClasses");
const PDFDocument = require("pdfkit");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

const appDefault = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config", "appDefault.json"), "utf8")
);

const billObj = {
  billMeta: {
    billNo: 101,
    billDate: "2026-09-13",
    billStatus: "open",
    // placeOfSupply is the salePage page-2 shipTo value in the real app flow.
    placeOfSupply: "Siliguri",
    shipTo: "Surya Traders",
    shipAddr: "Hill Cart Road, Siliguri",
    orderRef: "GR-123",
    ewayBill: "",
    transportName: "Road",
    deliveryType: "Transport",
    netQty: 5,
    netAmt: 950,
    netTax: 45,
    netAmtTax: 1000,
    netDue: 0,
    netPayment: 1000,
    paymentStatus: true,
    discVal: 50,
    delCharge: 0,
    scrapTDSAmt: 10,
    printObj: { captions: ["Original Buyer's Copy", "Duplicate Copy"], copies: 1 },
  },
  customer: { name: "Surya Traders", address: "Siliguri", gst: "19XYZ", phones: [null, "9123456789"] },
  payment: { type: "Cash" },
  orderItems: [
    { name: "Item A", hsn: "1001", qty: 2, sellUnit: "Kg", rate: 100, cgst: 2.5, sgst: 2.5, igst: 0 },
    { name: "Item B", hsn: "1002", qty: 1, sellUnit: "Pc", rate: 700, cgst: 0, sgst: 0, igst: 5 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function waitForStable(file, label) {
  const deadline = Date.now() + 15000;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0 && size === lastSize) return;
      lastSize = size;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label}: PDF never stabilized at ${file}`);
}

function newestPdf(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, files[0]);
}

let failures = 0;
function check(label, ok, detail) {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function inspectPdf(file, label, { expectEncrypt = false, expectedSize, expectPlaceOfSupply = false } = {}) {
  const bytes = fs.readFileSync(file);
  const encrypt = /\/Encrypt\b/.test(bytes.toString("latin1"));
  // Expected biller + page size come from the saleConfig the engines actually
  // used (config/saleConfig.json — the user's real one when it exists).
  const saleConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const expectedBiller = saleConfig.biller || "Ma Bhagawati Trading Co";
  const paper = String(saleConfig.paperSize || "A4").toLowerCase();
  if (!expectedSize) expectedSize = paper === "letter" ? [612, 792] : [595, 842];
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(" ");
  const size = [Math.round(vp.width), Math.round(vp.height)];
  const sizeOk = Math.abs(vp.width - expectedSize[0]) < 3 && Math.abs(vp.height - expectedSize[1]) < 3;
  check(`${label}: parses with pdfjs`, true, `${pdf.numPages} page(s), ${size}pt`);
  check(`${label}: page size matches config (${paper})`, sizeOk, `${size}pt`);
  check(`${label}: customer name present`, text.includes("Surya Traders"));
  check(`${label}: item rows present`, text.includes("Item A") && text.includes("Item B"));
  const hasBiller = text.includes(expectedBiller);
  check(`${label}: biller present`, hasBiller, expectedBiller);
  if (expectPlaceOfSupply)
    check(`${label}: place of supply (shipTo) present`, text.includes("Place of supply :Siliguri"));
  if (!hasBiller) console.log(`    (page-1 text: ${JSON.stringify(text.slice(0, 300))})`);
  if (expectEncrypt) {
    check(`${label}: /Encrypt dict present (secure invoice)`, encrypt);
  }
  await pdf.destroy();
  return { text, numPages: pdf.numPages };
}

async function run() {
  // 1 + 2: default engine (classic + D2) through the real billPDF flow.
  const billsDir = path.join(TMP_ROOT, "__Bills");
  for (const [label, templateID] of [["classic", undefined], ["D2", "D2"]]) {
    try {
      await billPDF(billObj, false, templateID);
      const file = newestPdf(billsDir);
      if (!file) throw new Error("no PDF produced in __Bills");
      await waitForStable(file, label);
      await inspectPdf(file, `billPDF ${label}`, { expectEncrypt: true, expectPlaceOfSupply: true });
    } catch (err) {
      const detail = String(err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : err);
      check(`billPDF ${label} generates`, false, detail);
    }
  }

  // 3: designer engine (default1 starter) on a real pdfkit document.
  try {
    const starter = buildStarter("default1", appDefault).toJSON();
    const outPath = path.join(TMP_ROOT, "custom-default1.pdf");
    const doc = new PDFDocument({ size: starter.size || "A4", margin: 0, autoFirstPage: true });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    await execTemplateMain(doc, outPath, billObj, starter);
    await waitForStable(outPath, "custom");
    // The starter template declares its own paper size (template wins in the app).
    const tSize = String(starter.size || "A4").toLowerCase();
    await inspectPdf(outPath, "execCustomTemplate default1", {
      expectEncrypt: false,
      expectedSize: tSize === "letter" ? [612, 792] : [595, 842],
    });
  } catch (err) {
    check("execCustomTemplate default1 generates", false, String(err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err));
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  // Cleanup: remove the temp config only if we created it; drop the temp tree.
  if (!hadConfig) fs.rmSync(CONFIG_PATH, { force: true });
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("FATAL", err);
  if (!hadConfig) fs.rmSync(CONFIG_PATH, { force: true });
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  process.exit(1);
});
