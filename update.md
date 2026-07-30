# version: 2.22.3

## welcome
### Welcome to BBS v2.22.3

This is a stability release with important bug fixes. Kiosk Mode and the reworked Order Manager (introduced in v2.22.2) are now more reliable.

- **Duplicate bill number fixed** — Cancelling a bill could leak its reserved number, causing the next sale to reuse it. The save flow now verifies the allocated number matches before consuming it.
- **Update download fixed** — The download button in the update prompt was non-functional due to IPC and script loading issues. Replaced with a reliable native dialog.
- **Log integrity hardened** — The appLogger hash chain now only advances when a log entry is actually written to disk, with backpressure handling to preserve strict ordering.

If you missed the v2.22.2 features: **Kiosk Mode** lets customers browse and order from their phone on your LAN, and the new **Order Manager** (Shift+F5) lets you manage partial bills with search, edit, and delete support. Both live under the **Sale** menu.

## tour
(no tour for this release)
