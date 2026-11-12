const {
    validateFeedbackPayload,
    formatFeedbackError,
    base64Bytes,
    MAIL_TYPES
} = require("../lib/feedbackMailLogic");

const VALID = { mail_type: "feedback", message: "  Great app!  " };

describe("validateFeedbackPayload — message (compulsory)", () => {
    test("minimal valid payload passes and trims the message", () => {
        const v = validateFeedbackPayload(VALID);
        expect(v.ok).toBe(true);
        expect(v.payload.message).toBe("Great app!");
        expect(v.payload.mail_type).toBe("feedback");
    });
    test("missing / empty / non-string message is rejected", () => {
        expect(validateFeedbackPayload({}).ok).toBe(false);
        expect(validateFeedbackPayload({ message: "" }).ok).toBe(false);
        expect(validateFeedbackPayload({ message: "   " }).ok).toBe(false);
        expect(validateFeedbackPayload({ message: 42 }).ok).toBe(false);
        expect(validateFeedbackPayload(null).ok).toBe(false);
        expect(validateFeedbackPayload([]).ok).toBe(false);
    });
});

describe("validateFeedbackPayload — mail_type", () => {
    test("all three server types pass through", () => {
        for (const type of MAIL_TYPES) {
            const v = validateFeedbackPayload({ mail_type: type, message: "x" });
            expect(v.ok).toBe(true);
            expect(v.payload.mail_type).toBe(type);
        }
    });
    test("unknown type falls back to feedback (server default)", () => {
        const v = validateFeedbackPayload({ mail_type: "spam", message: "x" });
        expect(v.ok).toBe(true);
        expect(v.payload.mail_type).toBe("feedback");
    });
});

describe("validateFeedbackPayload — subject (optional)", () => {
    test("subject is trimmed and capped at 255 chars", () => {
        const v = validateFeedbackPayload({ ...VALID, subject: "  " + "s".repeat(300) + "  " });
        expect(v.ok).toBe(true);
        expect(v.payload.subject).toBe("s".repeat(255));
    });
    test("blank subject is dropped, non-string rejected", () => {
        expect(validateFeedbackPayload({ ...VALID, subject: "   " }).payload.subject).toBeUndefined();
        expect(validateFeedbackPayload({ ...VALID, subject: 7 }).ok).toBe(false);
    });
});

describe("validateFeedbackPayload — metadata (optional, max 1 MB)", () => {
    test("valid object metadata passes through", () => {
        const md = { page: "salePage.html", func: "save_exit" };
        const v = validateFeedbackPayload({ ...VALID, metadata: md });
        expect(v.ok).toBe(true);
        expect(v.payload.metadata).toEqual(md);
    });
    test("non-object metadata is rejected", () => {
        expect(validateFeedbackPayload({ ...VALID, metadata: "nope" }).ok).toBe(false);
        expect(validateFeedbackPayload({ ...VALID, metadata: ["a"] }).ok).toBe(false);
    });
    test("metadata over 1 MB is rejected", () => {
        const md = { logs: "x".repeat(1024 * 1024 + 100) };
        expect(validateFeedbackPayload({ ...VALID, metadata: md }).ok).toBe(false);
    });
    test("metadata under the limit (incl. log snippet) passes", () => {
        const md = { logs: "x".repeat(150000) };
        expect(validateFeedbackPayload({ ...VALID, metadata: md }).ok).toBe(true);
    });
});

describe("validateFeedbackPayload — attachments (single image, max 5 MB)", () => {
    const dataURL = (bytes) => "data:image/png;base64," + "A".repeat(Math.ceil(bytes * 4 / 3));
    test("single image dataURL attachment passes, type derived from mime", () => {
        const v = validateFeedbackPayload({ ...VALID, attachments: { url: dataURL(1000) } });
        expect(v.ok).toBe(true);
        expect(v.payload.attachments.type).toBe("png");
        expect(v.payload.attachments.url).toMatch(/^data:image\/png;base64,/);
    });
    test("explicit type is used and lowercased", () => {
        const v = validateFeedbackPayload({ ...VALID, attachments: { url: dataURL(1000), type: "JPG" } });
        expect(v.payload.attachments.type).toBe("jpg");
    });
    test("more than one attachment (array) is rejected", () => {
        expect(validateFeedbackPayload({ ...VALID, attachments: [{ url: dataURL(10) }] }).ok).toBe(false);
    });
    test("non-image dataURL is rejected", () => {
        expect(validateFeedbackPayload({ ...VALID, attachments: { url: "data:text/plain;base64,AAA" } }).ok).toBe(false);
        expect(validateFeedbackPayload({ ...VALID, attachments: { url: "not-a-data-url" } }).ok).toBe(false);
    });
    test("attachment over 5 MB is rejected", () => {
        const v = validateFeedbackPayload({ ...VALID, attachments: { url: dataURL(5 * 1024 * 1024 + 1024) } });
        expect(v.ok).toBe(false);
        expect(v.error).toMatch(/5 MB/);
    });
    test("attachment just under 5 MB passes", () => {
        const v = validateFeedbackPayload({ ...VALID, attachments: { url: dataURL(5 * 1024 * 1024 - 1024) } });
        expect(v.ok).toBe(true);
    });
});

describe("base64Bytes", () => {
    test("accounts for padding", () => {
        expect(base64Bytes("")).toBe(0);
        expect(base64Bytes("AAAA")).toBe(3);
        expect(base64Bytes("AA==")).toBe(1);
        expect(base64Bytes("AAA=")).toBe(2);
    });
});

describe("formatFeedbackError", () => {
    test("prefers the server's error field", () => {
        expect(formatFeedbackError({ response: { data: { error: "Message is required" } } }))
            .toBe("Message is required");
    });
    test("timeouts get a friendly message", () => {
        expect(formatFeedbackError({ code: "ECONNABORTED" })).toMatch(/did not respond in time/);
    });
    test("falls back to err.message, then a generic line", () => {
        expect(formatFeedbackError(new Error("boom"))).toBe("boom");
        expect(formatFeedbackError(null)).toMatch(/check your internet connection/);
    });
});
