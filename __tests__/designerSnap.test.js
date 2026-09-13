const { snapY, resizeColPair, effectiveColWidths } = require("../lib/designerSnap");

describe("designerSnap.snapY", () => {
    const targets = [
        { y: 264, label: "body top" },
        { y: 586, label: "body bottom" },
    ];

    test("snaps to the nearest alignment target inside the threshold", () => {
        expect(snapY(267, targets)).toEqual({
            value: 264,
            guide: 264,
            label: "body top",
            type: "align",
        });
        expect(snapY(584, targets)).toEqual({
            value: 586,
            guide: 586,
            label: "body bottom",
            type: "align",
        });
    });

    test("snaps exactly ON the threshold, not past it", () => {
        // 264 + 5 = 269 → aligns; 270 → outside, returns untouched
        expect(snapY(269, targets, { snapGrid: false }).type).toBe("align");
        expect(snapY(270, targets, { snapGrid: false })).toEqual({
            value: 270,
            guide: null,
            label: "",
            type: null,
        });
    });

    test("falls back to the grid within its tighter threshold", () => {
        expect(snapY(15, [], { gridStep: 8 })).toEqual({
            value: 16,
            guide: 16,
            label: "",
            type: "grid",
        });
    });

    test("alignment beats the grid when both are in range", () => {
        // 263: 1pt from the 264 target AND 1pt from grid line 264
        const snap = snapY(263, targets, { gridStep: 8 });
        expect(snap.type).toBe("align");
        expect(snap.value).toBe(264);
    });

    test("far from everything returns the original y with no guide", () => {
        expect(snapY(300, targets, { gridStep: 8 })).toEqual({
            value: 300,
            guide: null,
            label: "",
            type: null,
        });
    });

    test("honors snapGrid: false", () => {
        expect(snapY(15, [], { gridStep: 8, snapGrid: false }).value).toBe(15);
        expect(snapY(15, [], { gridStep: 8, snapGrid: false }).guide).toBeNull();
    });
});

describe("designerSnap.resizeColPair", () => {
    test("redistributes between neighbours keeping their combined share", () => {
        expect(resizeColPair(44, 22, 6)).toEqual([50, 16]);
        expect(resizeColPair(44, 22, -6)).toEqual([38, 28]);
    });

    test("clamps at the minimum width per column", () => {
        expect(resizeColPair(10, 10, -20)).toEqual([2, 18]);
        expect(resizeColPair(10, 10, 20)).toEqual([18, 2]);
    });

    test("refuses degenerate pairs (no room to redistribute)", () => {
        expect(resizeColPair(2, 2, 10)).toEqual([2, 2]);
    });
});

describe("designerSnap.effectiveColWidths", () => {
    test("a sumup column absorbs the space the fixed columns leave", () => {
        expect(
            effectiveColWidths([
                { width: 30 },
                { width: 30 },
                { width: 0, sumup: true },
            ])
        ).toEqual([30, 30, 40]);
    });

    test("without a sumup column the widths pass through unchanged", () => {
        expect(effectiveColWidths([{ width: 40 }, { width: 60 }])).toEqual([
            40, 60,
        ]);
    });

    test("overfull fixed columns still leave the sumup column a 1% minimum", () => {
        expect(
            effectiveColWidths([
                { width: 60 },
                { width: 60 },
                { width: 0, sumup: true },
            ])
        ).toEqual([60, 60, 1]);
    });

    test("handles missing/empty column lists", () => {
        expect(effectiveColWidths([])).toEqual([]);
        expect(effectiveColWidths(undefined)).toEqual([]);
    });
});
