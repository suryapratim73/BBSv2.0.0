<!-- HELP-META
{
  "version": "2.21.11",
  "sectionMarkers": {
    "role:admin": "Requires administrator role to access",
    "status:unavailable": "Feature disabled — under rewrite/review"
  },
  "adminSections": [8, 9, 13, 18],
  "unavailableSections": [10, 11]
}
HELP-META -->

# BBSv2 — Bigbyte Business Solution

**Version 2.21.11** | A complete GST-compliant ERP for Indian businesses.

> **How to read this guide:** Sections marked with `🔒 Admin` require administrator privileges. Sections marked with `🚧 Unavailable` are not yet available in the current version and will be enabled in a future update. Your renderer should skip rendering sections with these markers.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Navigation](#2-navigation)
3. [Sales Management](#3-sales-management)
4. [Purchase Management](#4-purchase-management)
5. [Customer Management](#5-customer-management)
6. [Supplier Management](#6-supplier-management)
7. [Inventory & Stock](#7-inventory--stock)
8. [Employee Management](#8-employee-management) 🔒 Admin
9. [GST & Taxation](#9-gst--taxation) 🔒 Admin
10. [Bill Designer](#10-bill-designer) 🚧 Unavailable
11. [PDF Tools](#11-pdf-tools) 🚧 Unavailable
12. [Order Management](#12-order-management)
13. [Service Registry](#13-service-registry) 🔒 Admin
14. [Settings & Configuration](#14-settings--configuration)
15. [Security](#15-security)
16. [Backup & Updates](#16-backup--updates)
17. [Weather Theme & Announcements](#17-weather-theme--announcements)
18. [Log Viewer](#18-log-viewer) 🔒 Admin
19. [Keyboard Shortcuts](#19-keyboard-shortcuts)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Getting Started

### First Launch

When you run BBS for the first time, you will see the **First Boot Wizard**. This helps you set up:

- **Company Name & GST Number** — required for GST-compliant billing
- **Financial Year Start Date** — typically April 1st for Indian businesses
- **Place of Jurisdiction** — your city/town, used on all bills and for weather-based theming
- **Default GST Rate** — applied automatically to new products

### Registration

BBS requires a one-time registration. The app uses your GST number and device hardware to generate a unique device ID. This ties your license to your machine and enables:

- Automatic updates from the server
- Encrypted log uploads for support diagnostics
- Weather-based theming (optional)
- Announcement banners from the BBS team (optional)

### Login

After registration, log in using any user account. Different users may have different access rights configured under **Settings → User Management**.

> ⚠️ **Keep your password safe.** If 2FA is enabled, you will need both your password and a 6-digit code from your authenticator app.

### Lock Screen

The app automatically locks after a period of inactivity (configurable in Settings). Use **Ctrl+L** to lock manually. The lock screen requires your password and 2FA code (if enabled) to unlock.

---

## 2. Navigation

### Sidebar Menu

The left sidebar provides quick access to the main sections:

| Menu Item | Description |
|-----------|-------------|
| **Overview** | Dashboard with date, events, stock alerts, unpaid bills |
| **Sale** | Create new sales and view sales history |
| **Purchase** | Record purchases and view purchase history |
| **Settings** | Configure users, themes, backup, GST, company info, and more |
| **Logout** | End your current session |
| **Lock** | Lock the app without logging out |

### Top Menu Bar

The application menu at the top provides access to ALL features, organized by category:

- **BBS Menu** — About, Check for Updates, Lock, Logout, Version Manager
- **Sale Menu** — All sales-related tools
- **Purchase Menu** — All purchase-related tools
- **People Menu** — Employee and freight management
- **Tools Menu** — Bill designer, quick sale, product info, log viewer
- **Window Menu** — Minimize, zoom, close, developer tools
- **Help Menu** — Links, report bug, changelog

### Overview Dashboard

The Overview page shows:

- **Date & Day** — Today's date prominently displayed
- **Event Scheduler** — Upcoming events with auto-scrolling carousel
- **Stock Alerts** — Products with low or zero quantity
- **Unpaid Bills** — Bills past their due date with customer details

---

## 3. Sales Management

### Creating a Sale

Go to **Sale → Add Sale** or click **Sale** in the sidebar. The sale form has 4 pages:

1. **Customer Selection** — Search and select an existing customer, or add a new one
2. **Bill Details** — Set bill date, type (cash/credit), reference number, shipping address, and e-way bill number
3. **Line Items** — Add products/services with quantity, rate, discount, and tax. Tax is calculated automatically based on product tax slabs (SGST, CGST, IGST)
4. **Payment & Summary** — Review totals, apply discounts, record payment (full or partial), print or save

### Payment Modes

BBS supports multiple payment methods per bill:
- **Cash**
- **Cheque** (with cheque number and bank details)
- **Net Banking** (with transaction reference)
- **Credit** (balance due tracked automatically)

### Viewing Sales

Use **Sale → Show Sales** to view and filter all sales records. You can filter by:
- Payment status (Paid / Unpaid / Open / Closed)
- Date range
- Customer name

Each sale can be opened to view details, print a copy, or record additional payments.

### Quick Sale

**Tools → Quick Sale** opens a streamlined sale form for walk-in customers. Faster than the full sale form — ideal for retail counters.

---

## 4. Purchase Management

### Recording a Purchase

Go to **Purchase → Add Purchase**. Similar to sales, the form has 4 pages:

1. **Supplier Selection** — Search and select a supplier
2. **Bill Items** — Add purchased products with quantity, rate, and tax
3. **Bill Headers** — Bill number, date, freight charges
4. **Payment** — Record payment to the supplier

### Viewing Purchases

Use **Purchase → Show Purchase** to view all purchase records. Filter by date range or supplier.

### Outward Payments

**Purchase → Check Out Payments** shows all payments made to suppliers within a selected time period.

---

## 5. Customer Management

Open the **Customer Portal** via **Sale → Customer Portal**. This comprehensive tool lets you:

- **Search** customers by name, phone, or GST number
- **View Ledger** — complete transaction history with running balance
- **Record Payments** — cash, cheque, or net banking
- **Update Profile** — name, address, phones, GST, credit limit
- **Manage Shipping** — add multiple shipping addresses with GST
- **View Charts** — pie charts showing payment distribution
- **Print Ledger** — generate a PDF of the customer's account statement

### Customer Credit Limit

Set a credit limit for each customer. The app will warn you when a customer exceeds their limit during a sale.

---

## 6. Supplier Management

Open the **Supplier Portal** via **Purchase → Supplier Portal**. Similar to the customer portal:

- **Search** suppliers by name, phone, or GST
- **View Ledger** — complete purchase and payment history
- **Record Payments** — track outward payments
- **Update Profile** — name, address, phones, GST, payment receiver details
- **View Charts** — purchase vs payment graphs

---

## 7. Inventory & Stock

### Stock Display

**Purchase → Stock Display** shows your entire inventory:

- Search by product name
- Filter by stock level
- View quantity, buy price, selling price, tax slab, HSN code
- **Add new products** directly from this screen
- **Edit existing products** — update prices, tax, unit, quantity

### Product Fields

Each stock item has:
- **Name & HSN Code** — for GST classification
- **Type** — Goods or Service
- **Unit** — pcs, kg, ltr, box, etc.
- **Buy Price** — your purchase cost
- **Standard Sell Price** — default selling price
- **Last Sell Price** — automatically updated
- **Special Price** — for specific customers (stored in `pInfo`)
- **Tax Slab** — SGST%, CGST%, IGST% (auto-calculated from slab)

### Goods Return

**Purchase → Item Return** handles returns for both customers and suppliers. Select the type, find the original bill, and process the return.

---

## 8. Employee Management <!-- role: admin -->

> 🔒 **Admin only.** This feature is accessible only to users with the Administrator role.

### Employee Portal

**People → Employee Portal** manages your team:

- **Add Employees** — name, role, contact details
- **View History** — attendance and salary records per employee

### Attendance

**People → Attendance** opens the attendance modal:

- See all employees with present/absent toggle
- One-click attendance marking for the day
- View attendance history in the employee portal

### Salary Payment

**People → Salary** opens the salary disbursement modal:

- Select employee and enter payment amount
- Record payment date and mode
- Payment history visible in employee portal

---

## 9. GST & Taxation <!-- role: admin -->

> 🔒 **Admin only.** GST tools are accessible only to users with the Administrator role.

### GST Summary

**Sale → GST Summary** shows real-time GST liability:

- Current month's SGST, CGST, IGST totals
- Historic GST data displayed as a bar chart
- Filter by financial year and month

### Tax Configuration

Tax is configured at the product level in **Stock Display**:

- Set tax slab for each product (e.g., 5%, 12%, 18%, 28%)
- SGST and CGST are auto-calculated as half of the total rate (for intra-state)
- IGST is applied at the full rate (for inter-state sales)

### Place of Supply

When creating a sale, you can set the **Place of Supply** with state code. This determines whether SGST/CGST or IGST applies.

### GSTR-1 Export

BBS can generate GSTR-1 JSON format for upload to the GST portal. This is handled via the GST JSON Generator accessible from the GST Summary page.

---

## 10. Bill Designer <!-- status: unavailable -->

> 🚧 **This feature is currently unavailable.** The bill designer code is undergoing a rewrite. Custom bill templates can be applied via Settings → Bill Template in the meantime.

**Tools → Bill Designer** lets you customize how your bills look when printed:

### Layout Editor

- **Drag and drop** sections, fields, and tables onto the bill canvas
- Choose from pre-built blocks: header, body (item table), footer, bank details, terms
- Arrange the order of sections
- Toggle fields on/off (GST column, discount column, shipping address, etc.)

### Templates

Three template styles are available:
- **Default** — traditional Indian bill format with company emblem
- **Default 2** — alternate layout
- **Template 3** — minimalist modern design with accent colors

### Save & Apply

- Save your custom layout — it applies to all future bills
- Use **Save As** to create multiple templates for different purposes
- Preview your design before saving

---

## 11. PDF Tools <!-- status: unavailable -->

> 🚧 **This feature is currently unavailable.** The Road Challan, Voucher, Payment Receipt, and Requirement Slip generators are under review and will be re-enabled in a future update.

All PDF tools are accessible from the **Sale** and **Purchase** menus:

### Road Challan
**Sale → Road Challan** — generates a delivery challan for goods transport. Includes vehicle details, item list, and consignee information.

### Payment Voucher
**Sale → Generate Voucher** — creates a payment voucher document for accounting records.

### Payment Receipt
**Sale → Payment Receipt** — generates a receipt when a customer makes a payment.

### Requirement Slip
**Sale → Requirement Slip** — creates a materials requirement slip for internal use or supplier communication.

All generated PDFs can be printed directly or saved to disk.

---

## 12. Order Management

**Sale → Register Order** and **Sale → Order Manager** handle advance orders:

- Register a new order with customer details and item list
- Convert orders to sales when fulfilled
- Track order status
- Orders appear as references on the final sale bill

---

## 13. Service Registry <!-- role: admin -->

> 🔒 **Admin only.** Service management is accessible only to users with the Administrator role.

**Purchase → Service Register** manages services (non-physical goods):

- Add services with name, rate, unit, HSN code
- Set tax slab for each service
- Services appear in the product list when creating sales

---

## 14. Settings & Configuration

Access settings from the sidebar **Settings** button or the top menu. Settings are organized into tabs:

### Company & Billing
- **Company Profile** — GST number, address, place of jurisdiction
- **Invoice Numbering** — customize bill number format
- **Biller Details** — name and designation shown on bills
- **GST Interval** — filing frequency (monthly/quarterly)

### Appearance
- **Apply Theme** — enable custom color themes
- **Dark Mode** — toggle dark color scheme
- **Background Image** — set a custom background
- **Weather Theme** — enable weather-reactive colors and effects

### Security
- **Lock on Idle** — auto-lock after inactivity
- **Idle Time** — minutes before auto-lock triggers
- **User Management** — add, edit, or remove users
- **Session Management** — view and terminate active sessions

### Two-Factor Authentication
- Enable/disable 2FA per user
- Scan QR code with Google Authenticator or similar app
- Enter 6-digit code to verify setup

### Data & Backup
- **Backup Database** — create a ZIP backup of your entire database
- **Restore Database** — restore from a previous backup
- **Backup Location** — choose where backups are saved

### Bill Template
- Select default bill template
- Configure bill format preferences

### GST Settings
- Set default GST rate
- Configure GST state codes
- Annual holiday list (for business day calculations)

---

## 15. Security

### Password Policy
- Passwords are hashed using bcrypt
- Each user has a unique salt
- Minimum password requirements enforced

### Two-Factor Authentication (2FA)
- Uses TOTP (Time-based One-Time Password)
- Compatible with Google Authenticator, Authy, Microsoft Authenticator
- Setup: scan QR code → enter verification code
- Required at login AND lock screen unlock

### Lock Screen
- Manual lock: **Ctrl+L** or sidebar Lock button
- Auto-lock: after configured idle time
- Lock screen requires password + 2FA (if enabled)
- All other windows are hidden during lock

### Audit Logs
- All critical operations are logged with timestamps
- Logs are encrypted using AES-256-GCM with device-bound keys
- Encrypted logs are uploaded to secure cloud storage
- Log integrity is protected by a SHA-256 hash chain (tamper detection)

### Data Encryption
- Encryption secrets stored in OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- Each device has a unique encryption key derived from GST number + hardware serials
- Log files use per-file data encryption keys (DEK) wrapped by a key encryption key (KEK)

---

## 16. Backup & Updates

### Database Backup
- Go to **Settings → Backup**
- Creates a ZIP archive of your SQLite database
- Timestamped filenames for easy identification
- Store backups on external drives or cloud storage

### Database Restore
- Go to **Settings → Restore**
- Select a backup ZIP file
- **Warning**: This replaces your current database — backup first if unsure

### App Updates
- **BBS → Check for Update** checks the VPS server for new versions
- Updates download in the background
- **BBS → Version Manager** shows version history and changelog
- Previous versions are backed up before update, allowing rollback if needed

---

## 17. Weather Theme & Announcements

### Weather Theme

When enabled in **Settings → Appearance → Weather Theme**, the app fetches the current weather for your business location (based on your Place of Jurisdiction) and applies a theme:

| Weather | Effect |
|---------|--------|
| ☀️ Sunny / Clear | Warm golden tones, heat shimmer animation |
| 🌧️ Rain / Drizzle | Cool blue tones, falling rain streaks |
| ❄️ Snow / Cold | Frosty blues, floating snow dots |
| ⛅ Cloudy | Soft greys, drifting cloud shapes |
| 🌫️ Haze / Fog | Warm earthy tones, subtle pulse |
| ⛈️ Thunderstorm | Deep purple, occasional lightning flash |
| 🎉 Festive | Server-pushed celebration colors |
| 🌙 Night (6PM–6AM) | Cooler darker tones, reduced animation |

### Theme Toggle

When weather theme is enabled, a **Theme** toggle appears in the sidebar. Click it to switch between weather theme and your default theme without disabling the feature entirely.

### Announcements

The BBS team can send announcements (festival wishes, promotion offers, maintenance notices) that appear as a banner at the top of the main page. These are:
- **Dismissable** — click the × to hide
- **Time-bound** — expire automatically after a set date
- **Optional** — only appear when your server sends them

---

## 18. Log Viewer <!-- role: admin -->

> 🔒 **Admin only.** The encrypted log viewer is accessible only to users with the Administrator role.

**Tools → Log Viewer** opens the encrypted application log viewer:

- **Search** logs by keyword, date, or level
- **Auto-scroll** to follow new entries
- **Detail Panel** — click any log entry to see full details
- **Tamper Detection** — logs are protected by a SHA-256 hash chain; any tampering is flagged with a warning
- Logs include: operations, errors, user actions, system events

---

## 19. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Up** | Cycle through open windows |
| **Ctrl+L** | Lock the application |
| **Ctrl+Shift+L** | Logout |
| **Shift+F2** | Open Version Manager |
| **F1** | Open Developer Tools (advanced) |

---

## 20. Troubleshooting

### App won't start
- Ensure you have write permissions to the app data directory
- Check that your antivirus isn't blocking the app
- Try running as administrator (one-time, for initial setup)

### Database errors
- Go to **Settings → Backup** and create a backup
- Contact support with the backup file if data appears corrupted

### Printing issues
- **Windows**: SumatraPDF is bundled with the app. If printing fails, reinstall SumatraPDF
- **Linux**: Ensure CUPS printing service is running (`lpstat -t`)
- Check that your printer is connected and has paper

### Lock screen stuck
- If 2FA is enabled and you lost access to your authenticator app, contact your administrator
- Admin can disable 2FA for any user from Settings → Users

### Weather theme not working
- Ensure **Settings → Appearance → Weather Theme** is enabled
- Ensure **Place of Jurisdiction** is set in Company Profile
- Check that your server connection is working (the feature requires VPS connectivity)
- Toggle the weather theme off and on again to refresh

### Contact Support
- Use the **Help → Report Bug** menu item
- Check **Help → Changelog** for recent fixes
- Visit the BBS website for documentation and support

---

© 2026 Bigbyte Business Solution. All rights reserved.
