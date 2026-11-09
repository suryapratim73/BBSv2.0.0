// Beta Program prompt — decision logic unit tests
// The prompt must appear at most once ever for non-beta users (the caller
// persists the dismissal before showing), must never appear for beta users,
// and only fires when the user is signed in to BBS Cloud.

const { shouldShowBetaPrompt, BETA_PROMPT_ID } = require("../lib/betaPrompt");

describe("shouldShowBetaPrompt — show decisions", () => {
  const base = {
    isDev: false,
    hasDeviceId: true,
    cloudSignedIn: true,
    dismissedForever: false,
    shownThisSession: false
  };

  test("shows for a cloud-signed-in non-beta user", () => {
    expect(shouldShowBetaPrompt(base).show).toBe(true);
  });

  test("never shows for an existing beta tester", () => {
    expect(shouldShowBetaPrompt({ ...base, isDev: true })).toEqual({
      show: false,
      reason: "already-beta"
    });
  });

  test("stays silent after the user checks 'Don't ask me again'", () => {
    expect(shouldShowBetaPrompt({ ...base, dismissedForever: true }).show).toBe(false);
  });

  test("shows only once per session", () => {
    expect(shouldShowBetaPrompt({ ...base, shownThisSession: true }).show).toBe(false);
    // and a fresh session (shownThisSession false) may show again
    expect(shouldShowBetaPrompt(base).show).toBe(true);
  });

  test("waits until the device id is ready", () => {
    expect(shouldShowBetaPrompt({ ...base, hasDeviceId: false })).toEqual({
      show: false,
      reason: "no-device-id"
    });
  });

  test("waits until the user is signed in to BBS Cloud", () => {
    expect(shouldShowBetaPrompt({ ...base, cloudSignedIn: false })).toEqual({
      show: false,
      reason: "not-signed-in"
    });
  });

  test("beta status wins over the dismissal flag", () => {
    expect(shouldShowBetaPrompt({ ...base, isDev: true, dismissedForever: true }).show).toBe(false);
  });
});

describe("BETA_PROMPT_ID", () => {
  test("is a stable non-empty id (used as the dismissed_banners.json key)", () => {
    expect(typeof BETA_PROMPT_ID).toBe("string");
    expect(BETA_PROMPT_ID.length).toBeGreaterThan(0);
    expect(BETA_PROMPT_ID).toBe("beta-program-prompt"); // never change — old dismissals would be lost
  });
});
