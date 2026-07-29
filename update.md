# version: 2.22.2

## welcome
### Welcome to BBS v2.22.2

This update brings two major additions, both tucked under the **Sale** menu — Kiosk Mode and a reworked Order Manager. Here's what's new:

- **Kiosk Mode** — Let customers browse products and place orders from their phone over your local network. Configure sale mode, product layout, and receipt options from General App Settings.
- **Order Manager** — Manage partial bills with ease. View, edit, or delete unbilled orders, track payment history, and convert orders to full bills when ready. Press **Shift+F5** or click **Sale → View Orders**.
- **Save as Order** — Create a partial bill from the standard sale page without printing. Pick it up later from the Order Manager.
- **Fixes** — Bill amount accounting corrected for user-declared tax values, bill number wastage bug patched, and SQLITE_BUSY database lock errors resolved.

Let's take a quick tour. Click **Start Tour** to see what's new, or **Skip** to jump straight in.

## tour
[data-ui="nav-sale"] :: The Sale menu now houses both Kiosk Mode and Order Manager. Click "Start Kiosk Mode" to let customers shop from their phone, or "View Orders" (Shift+F5) to manage partial bills.

#kiosk-status-btn :: Kiosk Mode is now live! Click here to start the server — customers on your LAN can scan a QR code, browse products, and place orders. Configure sale mode (order-only or auto-bill), product layout, and customer selector visibility in General App Settings.

#order-table-div :: The Unbilled Orders table on your dashboard gives you a quick overview. Click any order to open the Order Manager — view items, check payment history, edit, delete, or generate a full bill when ready.
