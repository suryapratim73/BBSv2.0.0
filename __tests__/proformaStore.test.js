// Proforma store — pure unit tests for lib/proformaStore.js
// The store mirrors the orders.json pattern: load (missing/corrupt file →
// []), upsert (dedup by proformaId, append), remove (by proformaId).

const {
    loadProformas,
    upsertProforma,
    removeProforma
} = require("../lib/proformaStore");

function fakeFs(initialFileContent){
    const files = new Map(Object.entries(initialFileContent || {}));
    return {
        files,
        existsSync(p){ return files.has(p); },
        readFileSync(p){
            if(!files.has(p)) throw new Error("ENOENT: no such file");
            return files.get(p);
        },
        writeFileSync(p, data){ files.set(p, data); }
    };
}

const entryA = { proformaId: "proforma_1", status: "pending", name: "A", netAmtTax: 100 };
const entryB = { proformaId: "proforma_2", status: "pending", name: "B", netAmtTax: 200 };
const PATH = "./proformas.json";

describe("loadProformas",()=>{
    test("missing file returns []",()=>{
        const fs = fakeFs();
        expect(loadProformas(PATH, fs)).toEqual([]);
    });

    test("corrupt file returns []",()=>{
        const fs = fakeFs({ [PATH]: "{not valid json" });
        expect(loadProformas(PATH, fs)).toEqual([]);
    });

    test("non-array content returns []",()=>{
        const fs = fakeFs({ [PATH]: '{"a":1}' });
        expect(loadProformas(PATH, fs)).toEqual([]);
    });

    test("valid array is returned",()=>{
        const fs = fakeFs({ [PATH]: JSON.stringify([entryA, entryB]) });
        expect(loadProformas(PATH, fs)).toEqual([entryA, entryB]);
    });
});

describe("upsertProforma",()=>{
    test("appends a new entry",()=>{
        const fs = fakeFs();
        const list = loadProformas(PATH, fs);
        const out = upsertProforma(list, entryA);
        expect(out).toEqual([entryA]);
    });

    test("dedups on proformaId (updated entry moves to the end)",()=>{
        const fs = fakeFs({ [PATH]: JSON.stringify([entryA, entryB]) });
        const list = loadProformas(PATH, fs);
        const out = upsertProforma(list, { ...entryA, netAmtTax: 999 });
        expect(out.length).toBe(2);
        expect(out[0].proformaId).toBe("proforma_2"); // untouched
        expect(out[1].netAmtTax).toBe(999);           // replaced entry
    });

    test("does not mutate the input list",()=>{
        const fs = fakeFs();
        const list = loadProformas(PATH, fs);
        const snapshot = JSON.stringify(list);
        upsertProforma(list, entryA);
        expect(JSON.stringify(list)).toBe(snapshot);
    });
});

describe("removeProforma",()=>{
    test("removes by proformaId",()=>{
        const fs = fakeFs({ [PATH]: JSON.stringify([entryA, entryB]) });
        const list = loadProformas(PATH, fs);
        const out = removeProforma(list, "proforma_1");
        expect(out).toEqual([entryB]);
    });

    test("unknown id leaves the list unchanged",()=>{
        const fs = fakeFs({ [PATH]: JSON.stringify([entryA]) });
        const list = loadProformas(PATH, fs);
        expect(removeProforma(list, "nope")).toEqual([entryA]);
    });

    test("empty list is fine",()=>{
        const fs = fakeFs();
        expect(removeProforma(loadProformas(PATH, fs), "proforma_1")).toEqual([]);
    });
});