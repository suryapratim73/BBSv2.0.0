# BBSv2 (Bigbyte Business Solution) 🚀

> An offline-first, high-performance desktop Enterprise Resource Planning (ERP) application engineered for wholesale and trade businesses.

![License](https://img.shields.io/badge/License-EULA-blue?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-Desktop-47A248?style=flat-square&logo=electron&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla--JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Database](https://img.shields.io/badge/Database-SQLCipher-003B5C?style=flat-square&logo=sqlite&logoColor=white)
![Testing](https://img.shields.io/badge/Testing-Jest%20%7C%20Playwright-C21325?style=flat-square&logo=jest&logoColor=white)

BBSv2 is a lightweight, local-first ERP software designed to handle fast counter sales, billing, customer and supplier ledgers, inventory management, and tax reporting without requiring constant cloud connectivity.

---

## ✨ Key Capabilities

* ⚡ **Zero-Latency Offline Core:** Fast, native desktop experience powered by custom view handlers and local IPC pipelines without heavy JS framework bloat.
* 🛡️ **Encrypted Local Storage:** Local business database encrypted at rest using SQLCipher, ensuring hardware-level data ownership and privacy.
* 🧾 **Zen Billing & Counter Sales:** Optimized sales interface (`saleHandler.js`) with instant receipt generation, ledger updates, and continuous printing support.
* 📦 **Catalog & Inventory Tracking:** Complete stock management (`handleStock.js`), multi-category catalogs (`catalogueHandler.js`), and purchase order handling (`handlePurchase.js`).
* 🏷️ **GST Compliance Utilities:** Automated tax JSON exports (`gstJsonGenerator.js`) for seamless filing and ledger auditing.
* 🌐 **Embedded Kiosk Server:** Integrated local web server (`kioskServer.js`) enabling nearby mobile or terminal devices to process local sales on the same Wi-Fi network.
* 🧪 **Automated Quality Assurance:** Includes unit and integration test suites via Jest (`__tests__/`) and end-to-end browser automation via Playwright (`e2e/`).

---

## 🛠️ Architecture & Tech Stack

| Layer | Component / Technology |
|---|---|
| **Desktop Shell** | Electron, Node.js |
| **Frontend UI** | Vanilla JavaScript, HTML5, CSS3, SCSS, Less |
| **Data & Security** | SQLCipher (Encrypted SQLite), System Credential Stores |
| **Network & Kiosk** | Embedded HTTP/WebSocket Server (`kioskServer.js`) |
| **Testing** | Jest, Playwright (E2E), Custom Mocks |

---

## 📂 Repository Layout

```text
BBSv2.0.0/
├── main.js                  # Main Electron process entry point
├── viewManager.js           # Multi-window and view rendering manager
├── common.js                # Core utility functions and DOM helpers
├── kioskServer.js           # Embedded local kiosk service
├── gstJsonGenerator.js      # GST tax structure exporter
├── *Handler.js              # Business logic handlers (sale, customer, stock, supplier, print, log)
├── model/                   # Database schemas and models
├── lib/                     # Custom helper libraries and utilities
├── __tests__/               # Jest test suites
├── e2e/                     # Playwright end-to-end scenarios
└── package.json             # App scripts and dependencies