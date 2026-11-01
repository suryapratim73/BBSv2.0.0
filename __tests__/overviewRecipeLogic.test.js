const { WIDGETS, MIN_ROWS, DEFAULT_RECIPE, normalizeRecipe } = require("../lib/overviewRecipeLogic");

describe("overviewRecipeLogic", () => {
    test("registry: card ids are stackable, big ids are not", () => {
        expect(WIDGETS["net-turnover"].type).toBe("card");
        expect(WIDGETS["order-table"].type).toBe("big");
        expect(WIDGETS["file-monitor"]).toBeDefined();
        expect(WIDGETS["cloud-usage"]).toBeDefined();
        expect(MIN_ROWS).toBe(1);
    });

    test("default recipe is valid and uses the specified layout", () => {
        const { ok, recipe } = normalizeRecipe(DEFAULT_RECIPE);
        expect(ok).toBe(true);
        expect(recipe.rows).toHaveLength(3);
        expect(recipe.rows[0].cells[0]).toEqual({ col: "full", widgets: ["cloud-usage"] });
        expect(recipe.rows[1].cells[0].widgets).toEqual(["net-turnover", "net-purchase"]);
        expect(recipe.rows[1].cells[1].widgets).toEqual(["sale-purchase-graph"]);
        expect(recipe.rows[2].cells[0].widgets).toEqual(["order-table"]);
        expect(recipe.rows[2].cells[1].widgets).toEqual(["scheduler"]);
    });

    test("rejects non-object and rows-less recipes", () => {
        expect(normalizeRecipe(null).ok).toBe(false);
        expect(normalizeRecipe([]).ok).toBe(false);
        expect(normalizeRecipe({}).ok).toBe(false);
        expect(normalizeRecipe({ rows: "nope" }).ok).toBe(false);
    });

    test("rows are sorted and renumbered 1..N", () => {
        const { ok, recipe } = normalizeRecipe({
            rows: [
                { row: 3, cells: [{ col: "left", widgets: ["monthly-sale"] }] },
                { row: 1, cells: [{ col: "left", widgets: ["stock-low"] }] }
            ]
        });
        expect(ok).toBe(true);
        expect(recipe.rows.map(r => r.row)).toEqual([1, 2]);
        expect(recipe.rows[0].cells[0].widgets).toEqual(["stock-low"]);
        expect(recipe.rows[1].cells[0].widgets).toEqual(["monthly-sale"]);
    });

    test("removing a middle band leaves no gap", () => {
        const { ok, recipe } = normalizeRecipe({
            rows: [
                { row: 1, cells: [{ col: "left", widgets: ["stock-low"] }] },
                { row: 3, cells: [{ col: "right", widgets: ["scheduler"] }] }
            ]
        });
        expect(ok).toBe(true);
        expect(recipe.rows.map(r => r.row)).toEqual([1, 2]);
        expect(recipe.rows[1].cells[0].widgets).toEqual(["scheduler"]);
    });

    test("at least one row band must remain", () => {
        const empty = normalizeRecipe({ rows: [] });
        expect(empty.ok).toBe(false);
        expect(empty.error).toMatch(/at least one row/i);
        // a row below 1 that leaves nothing behind also fails
        const bad = normalizeRecipe({ rows: [{ row: 0, cells: [{ col: "left", widgets: ["scheduler"] }] }] });
        expect(bad.ok).toBe(false);
    });

    test("full cell wins over left/right in the same row", () => {
        const { ok, recipe, warnings } = normalizeRecipe({
            rows: [{ row: 1, cells: [
                { col: "left", widgets: ["scheduler"] },
                { col: "full", widgets: ["cloud-usage"] }
            ] }]
        });
        expect(ok).toBe(true);
        expect(recipe.rows[0].cells).toEqual([{ col: "full", widgets: ["cloud-usage"] }]);
        expect(warnings.length).toBe(0);
    });

    test("big widget cannot share a cell — extras dropped with a warning", () => {
        const { ok, recipe, warnings } = normalizeRecipe({
            rows: [{ row: 3, cells: [{ col: "left", widgets: ["order-table", "net-turnover"] }] }]
        });
        expect(ok).toBe(true);
        expect(recipe.rows[0].cells[0].widgets).toEqual(["order-table"]);
        expect(warnings.some(w => w.includes("can't share a cell"))).toBe(true);
    });

    test("cards stack freely, duplicates and unknown ids dropped", () => {
        const { ok, recipe, warnings } = normalizeRecipe({
            rows: [{ row: 2, cells: [{ col: "left", widgets: ["monthly-sale", "yearly-sale", "net-turnover", "net-purchase", "monthly-sale", "wat"] }] }]
        });
        expect(ok).toBe(true);
        expect(recipe.rows[0].cells[0].widgets).toEqual(["monthly-sale", "yearly-sale", "net-turnover", "net-purchase"]);
        expect(warnings.some(w => w.includes('unknown widget "wat"'))).toBe(true);
    });

    test("row numbers above the band count are renumbered, duplicates skipped", () => {
        const { ok, recipe, warnings } = normalizeRecipe({
            rows: [
                { row: 9, cells: [{ col: "left", widgets: ["scheduler"] }] },
                { row: 1, cells: [{ col: "left", widgets: ["stock-low"] }] },
                { row: 1, cells: [{ col: "right", widgets: ["scheduler"] }] }
            ]
        });
        expect(ok).toBe(true);
        expect(recipe.rows.map(r => r.row)).toEqual([1, 2]);
        expect(recipe.rows[0].cells[0].widgets).toEqual(["stock-low"]);
        expect(recipe.rows[1].cells[0].widgets).toEqual(["scheduler"]);
        expect(warnings.length).toBe(1);
    });

    test("empty cell widgets drop the cell", () => {
        const { ok, recipe } = normalizeRecipe({
            rows: [{ row: 3, cells: [{ col: "right", widgets: [] }] }]
        });
        expect(ok).toBe(true);
        expect(recipe.rows[0].cells).toEqual([]);
    });

    test("a widget id may appear only once in the whole recipe", () => {
        const { ok, recipe, warnings } = normalizeRecipe({
            rows: [
                { row: 1, cells: [{ col: "full", widgets: ["scheduler"] }] },
                { row: 3, cells: [{ col: "right", widgets: ["scheduler", "stock-low"] }] }
            ]
        });
        expect(ok).toBe(true);
        expect(recipe.rows[0].cells[0].widgets).toEqual(["scheduler"]);
        expect(recipe.rows[1].cells[0].widgets).toEqual(["stock-low"]);
        expect(warnings.some(w => w.includes("appears twice"))).toBe(true);
    });
});
