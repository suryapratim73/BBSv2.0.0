/**
 * billTemplateResolver.js — pure routing for invoice template selection.
 *
 * Reproduces the routing of the legacy makePDF.default.js:49-147 logic as a
 * testable table:
 *
 *   applyTemplate === true  && file exists  && v2 shape  -> "user-v2"   (new block engine)
 *   applyTemplate === true  && file exists  && other      -> "legacy-v1" (execCustomTemplate keeps working)
 *   applyTemplate === true  && file missing              -> "default1"  (legacy parity: falls to Default1)
 *   applyTemplate === false && file === "default2"       -> "default2"  (shipped default)
 *   otherwise                                            -> "default1"
 *
 * During the migration the legacy engine still draws default1/default2 and
 * v1 templates (user instruction: keep buildPage.default until the new
 * generator is verified). When the flip happens, only the "legacy-v1"
 * handling changes (to a clear error dialog) and default1/default2 start
 * loading the bundled JSONs in template/billTemplates/.
 *
 * readFile: (filePath) => string | null | undefined   (injected for testability)
 */
function parseOrNull(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        return null;
    }
}

function resolveTemplate(saleConfig, readFile) {
    const billTemplate = saleConfig.billTemplate ?? {};
    const userFile = billTemplate.file;

    if (billTemplate.applyTemplate === true && userFile) {
        const text = typeof readFile === "function" ? readFile(userFile) : null;
        if (text !== null && text !== undefined && text !== "") {
            const parsed = parseOrNull(text);
            if (parsed && parsed.version === 2 && Array.isArray(parsed.blocks))
                return { template: parsed, source: "user-v2" };
            // v1 shape, unknown shape, or unparseable — the legacy engine
            // decides (and throws its own error on bad JSON, as before).
            return { template: parsed, source: "legacy-v1" };
        }
        // File missing → Default1 (legacy parity: the line-54 gate falls
        // through to the hardcoded Default1 branch).
        return { template: null, source: "default1" };
    }

    if (
        billTemplate.applyTemplate === false &&
        userFile === "default2"
    )
        return { template: null, source: "default2" };

    return { template: null, source: "default1" };
}

module.exports = { resolveTemplate };
