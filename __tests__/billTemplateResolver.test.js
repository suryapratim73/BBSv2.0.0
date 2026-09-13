const { resolveTemplate } = require("../lib/billTemplateResolver");

const V2 = JSON.stringify({ version: 2, size: "a4", margin: {}, blocks: [{ type: "text", content: "Hi" }] });
const V1 = JSON.stringify({ size: "a4", margin: {}, head: {}, body: {}, footer: {}, sections: [], feilds: [] });
const GARBAGE = "{not json";

describe("resolveTemplate routing (legacy makePDF parity)", () => {
    test("applyTemplate true + v2 file -> user-v2", () => {
        const { template, source } = resolveTemplate(
            { billTemplate: { applyTemplate: true, file: "C:/t.json" } },
            () => V2
        );
        expect(source).toBe("user-v2");
        expect(template.version).toBe(2);
        expect(template.blocks).toHaveLength(1);
    });

    test("applyTemplate true + v1-shaped file -> legacy-v1 (legacy engine keeps working)", () => {
        const { template, source } = resolveTemplate(
            { billTemplate: { applyTemplate: true, file: "C:/t.json" } },
            () => V1
        );
        expect(source).toBe("legacy-v1");
        expect(template.head).toBeDefined();
    });

    test("applyTemplate true + unparseable file -> legacy-v1 (legacy throws its own error)", () => {
        const { template, source } = resolveTemplate(
            { billTemplate: { applyTemplate: true, file: "C:/t.json" } },
            () => GARBAGE
        );
        expect(source).toBe("legacy-v1");
        expect(template).toBeNull();
    });

    test("applyTemplate true + missing file -> default1 (line-54 gate falls through)", () => {
        const { template, source } = resolveTemplate(
            { billTemplate: { applyTemplate: true, file: "C:/gone.json" } },
            () => null
        );
        expect(source).toBe("default1");
        expect(template).toBeNull();
    });

    test("applyTemplate true + no reader -> default1", () => {
        const { source } = resolveTemplate(
            { billTemplate: { applyTemplate: true, file: "C:/t.json" } },
            undefined
        );
        expect(source).toBe("default1");
    });

    test("applyTemplate false + default2 sentinel -> default2 (shipped default)", () => {
        const { source } = resolveTemplate(
            { billTemplate: { applyTemplate: false, file: "default2" } },
            () => V2
        );
        expect(source).toBe("default2");
    });

    test("applyTemplate false + anything else -> default1", () => {
        expect(
            resolveTemplate({ billTemplate: { applyTemplate: false, file: "default1" } }, () => null).source
        ).toBe("default1");
        expect(
            resolveTemplate({ billTemplate: { applyTemplate: false, file: "custom" } }, () => null).source
        ).toBe("default1");
    });

    test("no billTemplate key -> default1", () => {
        expect(resolveTemplate({}, () => null).source).toBe("default1");
    });
});
