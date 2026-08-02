# version: 2.22.4

## welcome
### Welcome to BBS v2.22.4

This is a stability release fixing critical bugs in billing and logging. Note: View Logs will show logs from 1st, August. Log backup/download functionality is not available before app launch.

- **Duplicate bill number fixed** — A type mismatch between the BillManager pool (always Numbers) and IPC renderer values (could arrive as Strings) caused `===` comparisons to silently fail, releasing every bill number instead of consuming it. Fixed with explicit `Number()` casts at all trust boundaries.
- **Update download fixed** — The download button in the pre-update prompt was non-functional due to IPC and script loading issues. Replaced with a reliable native dialog.
- **appLogger backpressure fixed** — Node's stream `write()` returning false doesn't mean data was lost — it means data IS buffered internally. The previous fix was re-writing queued entries on drain, silently duplicating every log line that hit backpressure. The drain handler now only confirms writes without re-writing.
- **Transparent background fixed** — UI background rendering issue resolved.
- **Theme & Auth cookie change** — Dev and Prod environments now use separate auth cookies.

If you missed v2.22.2 features: **Kiosk Mode** lets customers browse and order from their phone on your LAN, and the new **Order Manager** (Shift+F5) lets you manage partial bills with search, edit, and delete support.

## tour
(no tour for this release)
