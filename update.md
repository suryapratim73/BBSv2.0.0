# version: 2.23.1

## welcome
### Welcome to BBS v2.23.1

- **Kiosk Mode — fixed** — This update fixes the Kiosk Mode bug.
- **Order Manager — fixed** — This update fixes the Order Manager bug.
- **Paused Download Resume** — If an update download is paused or interrupted, BBS now detects the partial download and offers to resume it instead of starting over.
- **Beta Program — fixed** — The Beta Program prompt now appears once when you sign in to BBS Cloud (or stay signed in) and can be reopened anytime from the BBS menu → Beta Program.
- **Legal Page** — The App EULA and API Terms of Service are now permanently available from BBS → Legal.
- **Shipping Addresses — new** — Manage a customer's saved ship-to addresses from the Customer Portal (Ctrl+Shift+Y) — fix typos, add new or remove old entries; changes save automatically and appear in the sale page dropdown right away.

## tour
#scheduler-div :: New Scheduler — check upcoming events, assign actions and automate tasks.
#app-status-bar :: New status bar — Zen Mode, weather theme, kiosk and internet status at a glance.
#zen-status :: Click here to start Zen Mode and bill every invoice with the same date until the stop condition.
#sale-purchase-btn-div :: Proforma Bills are saved now — open Sale → View Orders (Shift+F5) to manage quotes and convert them to real invoices.
#overview-div .ov-toolbar :: New modifiable dashboard — click Customize to pick widgets, stack cards, and add or remove row bands on your Overview page.
#tab-proformas :: Proforma Bills are saved now — switch to this tab to create a quote and convert it to a real invoice in one click.
#btn-container button[data-cmd="cust-policy"] :: Customer Policy — payment terms, credit limit, discounts and automatic email reminders for this customer (Ctrl+Y).
#btn-container button[data-cmd="ship-info"] :: Shipping Addresses — fix, add or remove saved ship-to entries for this customer (Ctrl+Shift+Y).
#palette :: Bill Layout Designer — add sections, fields and tables here to build your own invoice layout with live preview.
#summary-div :: Item-wise discounts now show here — press Ctrl+S for the full bill summary with discounted rates.
[data-feildname="discount"] :: Item-wise discount — set it while editing an item in View Stock.
