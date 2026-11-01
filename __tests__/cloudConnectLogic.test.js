// Cloud Connect — pure logic unit tests (lib/cloudConnectLogic.js)
// Covers the client-side rules of BBSv2-Client-API.md §2: GSTIN as account
// identity, one-call signup/login, and the server's error table mapping.

const {
    GST_PATTERN,
    EMAIL_PATTERN,
    validateCloudPayload,
    validateTotpPayload,
    formatCloudError,
    toPublicState,
    defaultCloudState
} = require("../lib/cloudConnectLogic");

describe("validateCloudPayload — signup/login payload", () => {
    const base = {
        gstNumber: "27AAPFU0939F1ZV",
        email: "accounts@example.com",
        name: "Priya Sharma",
        phone: "+91-98765-43210",
        company_name: "Example Traders",
        company_address: "12 Market Road, Kolkata",
        device_name: "Office Desktop"
    };

    test("accepts a valid payload and normalizes the GST to uppercase", () => {
        const verdict = validateCloudPayload({ ...base, gstNumber: "27aapfu0939f1zv" });
        expect(verdict.ok).toBe(true);
        expect(verdict.payload.gstNumber).toBe("27AAPFU0939F1ZV");
    });

    test("trims every field", () => {
        const verdict = validateCloudPayload({ ...base, name: "  Priya Sharma  ", email: " a@b.co " });
        expect(verdict.ok).toBe(true);
        expect(verdict.payload.name).toBe("Priya Sharma");
        expect(verdict.payload.email).toBe("a@b.co");
    });

    test("rejects a missing GST number", () => {
        expect(validateCloudPayload({ ...base, gstNumber: "" }).ok).toBe(false);
    });

    test("rejects a malformed GST number", () => {
        expect(validateCloudPayload({ ...base, gstNumber: "AAPFU0939F1ZV" }).ok).toBe(false);
        expect(validateCloudPayload({ ...base, gstNumber: "27AAPFU0939F1Z-" }).ok).toBe(false);
    });

    test("rejects a malformed email when one is provided", () => {
        expect(validateCloudPayload({ ...base, email: "not-an-email" }).ok).toBe(false);
    });

    test("allows an empty email (optional per the API spec)", () => {
        expect(validateCloudPayload({ ...base, email: "" }).ok).toBe(true);
    });

    test("enforces the phone length limit", () => {
        expect(validateCloudPayload({ ...base, phone: "9".repeat(21) }).ok).toBe(false);
        expect(validateCloudPayload({ ...base, phone: "9".repeat(20) }).ok).toBe(true);
    });

    test("enforces the device name length limit", () => {
        expect(validateCloudPayload({ ...base, device_name: "d".repeat(256) }).ok).toBe(false);
        expect(validateCloudPayload({ ...base, device_name: "d".repeat(255) }).ok).toBe(true);
    });

    test("tolerates a null/undefined raw payload", () => {
        expect(validateCloudPayload(null).ok).toBe(false);
        expect(validateCloudPayload(undefined).ok).toBe(false);
    });
});

describe("GST_PATTERN / EMAIL_PATTERN (mirrors the server)", () => {
    test("GST_PATTERN is case-insensitive per the API spec", () => {
        expect(GST_PATTERN.test("27aapfu0939f1zv")).toBe(true);
        expect(GST_PATTERN.test("27AAPFU0939F1ZV")).toBe(true);
    });

    test("GST_PATTERN requires the full 15-character GSTIN", () => {
        expect(GST_PATTERN.test("27AAPFU0939F1Z")).toBe(false);  // 14 chars
        expect(GST_PATTERN.test("27AAPFU0939F1ZV1")).toBe(false); // 16 chars
    });

    test("EMAIL_PATTERN rejects addresses without a domain", () => {
        expect(EMAIL_PATTERN.test("name@")).toBe(false);
        expect(EMAIL_PATTERN.test("name@domain")).toBe(false);
        expect(EMAIL_PATTERN.test("name@domain.com")).toBe(true);
    });
});

describe("formatCloudError — API spec §2 error table", () => {
    test("409 maps to the duplicate-email message", () => {
        const err = { response: { status: 409, data: { error: "Email exists" } } };
        expect(formatCloudError(err)).toContain("already used by another business account");
    });

    test("400 prefers the server's details array", () => {
        const err = { response: { status: 400, data: { error: "Validation failed", details: ["bad gst", "bad email"] } } };
        expect(formatCloudError(err)).toBe("bad gst bad email");
    });

    test("400 falls back to the error string when details are absent", () => {
        const err = { response: { status: 400, data: { error: "Invalid deviceId" } } };
        expect(formatCloudError(err)).toBe("Invalid deviceId");
    });

    test("500 maps to a server-problem message", () => {
        const err = { response: { status: 500, data: {} } };
        expect(formatCloudError(err)).toContain("server ran into a problem");
    });

    test("network failure (no response) maps to a connection message", () => {
        expect(formatCloudError({ message: "ECONNREFUSED" })).toContain("Could not reach the BBS Cloud server");
    });

    test("unknown statuses fall back to the server error string or a generic message", () => {
        expect(formatCloudError({ response: { status: 418, data: { error: "teapot" } } })).toBe("teapot");
        expect(formatCloudError({ response: { status: 418, data: {} } })).toContain("418");
    });
});

describe("toPublicState — renderer-facing state shape", () => {
    const state = defaultCloudState("6f4c2a9e-1234-4abc-9def-0123456789ab", "win");

    test("signedIn requires BOTH a user id and an access token", () => {
        expect(toPublicState({ ...state, userId: "u1" }, { accessToken: "tok" }).signedIn).toBe(true);
        expect(toPublicState({ ...state, userId: "u1" }, { accessToken: null }).signedIn).toBe(false);
        expect(toPublicState({ ...state, userId: null }, { accessToken: "tok" }).signedIn).toBe(false);
    });

    test("passes the stored profile through", () => {
        const pub = toPublicState({ ...state, profile: { gstNumber: "GST1", email: "a@b.co" } }, {}, {});
        expect(pub.profile.gstNumber).toBe("GST1");
        expect(pub.profile.email).toBe("a@b.co");
        expect(pub.profile.name).toBe(""); // missing keys default to ""
    });

    test("prefill comes from the app presets, not the profile", () => {
        const pub = toPublicState(state, {}, { gst: "PRESETGST", companyName: "Preset Co" });
        expect(pub.prefill).toEqual({ gst: "PRESETGST", companyName: "Preset Co" });
    });

    test("defaultCloudState has a null-safe skeleton", () => {
        const fresh = defaultCloudState("", "");
        expect(fresh.userId).toBeNull();
        expect(fresh.isDev).toBe(false);
        expect(fresh.profile).toEqual({});
        expect(fresh.pendingTotp).toBeNull();
        expect(fresh.jwt).toBeNull();
        expect(fresh.lastConnectedAt).toBeNull();
    });

    test("exposes pendingTotp (QR + manual entry) when present", () => {
        const withTotp = {
            ...state,
            pendingTotp: { secret: "JBSWY3DP", qrCode: "data:image/png;base64,xyz", manualEntry: "JBSWY3DP" }
        };
        const pub = toPublicState(withTotp, {}, {});
        expect(pub.pendingTotp.qrCode).toBe("data:image/png;base64,xyz");
        expect(pub.pendingTotp.manualEntry).toBe("JBSWY3DP");
        expect(pub.pendingTotp.secret).toBe("JBSWY3DP");
    });

    test("pendingTotp is null when absent and jwt passes through", () => {
        expect(toPublicState(state, {}, {}).pendingTotp).toBeNull();
        expect(toPublicState(state, {}, {}).jwt).toBeNull();
        expect(toPublicState({ ...state, jwt: "jwt.header.payload" }, {}, {}).jwt).toBe("jwt.header.payload");
    });
});

describe("validateTotpPayload — TOTP setup form (step 3)", () => {
    const base = { password: "password123", confirmPassword: "password123", totpCode: "123456" };

    test("accepts matching passwords and a 6-digit code", () => {
        const verdict = validateTotpPayload(base);
        expect(verdict.ok).toBe(true);
        expect(verdict.payload.password).toBe("password123");
        expect(verdict.payload.totpCode).toBe("123456");
    });

    test("rejects a password below the minimum length", () => {
        expect(validateTotpPayload({ ...base, password: "short", confirmPassword: "short" }).ok).toBe(false);
    });

    test("rejects mismatched passwords", () => {
        expect(validateTotpPayload({ ...base, confirmPassword: "different1" }).ok).toBe(false);
    });

    test("rejects a non-6-digit authenticator code", () => {
        expect(validateTotpPayload({ ...base, totpCode: "12345" }).ok).toBe(false);
        expect(validateTotpPayload({ ...base, totpCode: "abcdef" }).ok).toBe(false);
        expect(validateTotpPayload({ ...base, totpCode: " 123456 " }).ok).toBe(true); // trimmed
    });

    test("tolerates a null/undefined raw payload", () => {
        expect(validateTotpPayload(null).ok).toBe(false);
        expect(validateTotpPayload(undefined).ok).toBe(false);
    });
});
