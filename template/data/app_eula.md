# END USER LICENSE AGREEMENT (EULA)

**Last Updated:** October 15, 2026

PLEASE READ THIS END USER LICENSE AGREEMENT ("AGREEMENT") CAREFULLY BEFORE DOWNLOADING, INSTALLING, LAUNCHING, OR USING **BBSv2** ("APPLICATION").

BY DOWNLOADING, INSTALLING, LAUNCHING, EXECUTING, OR DISTRIBUTING THE APPLICATION, YOU EXPLICITLY AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT. IF YOU DO NOT AGREE TO THESE TERMS, DO NOT INSTALL, LAUNCH, OR USE THE APPLICATION, AND UNINSTALL ALL COPIES IMMEDIATELY.

---

### 1\. GRANT OF LICENSE, OFFLINE-FIRST ARCHITECTURE & FREE DISTRIBUTION

* **Free & Offline-First Use:** The Application is provided to you completely free of charge and operates as an offline-first desktop application. The Developer grants you a non-exclusive, perpetual, royalty-free license to install, run, and execute the Application for your personal or commercial business operations locally on your host system without requiring mandatory internet connectivity for core offline database operations.  
* **Right to Distribute:** You are explicitly permitted to share, copy, host, and redistribute unmodified installer packages of the Application to third parties, provided that you include this EULA unchanged with any copy you distribute.  
* **Prohibition on Sale & Reporting Obligation:** You may not sell, rent, lease, or charge a direct fee for the Application itself, its installer binaries, or core software features. If you become aware that any third party is selling, charging fees for, or improperly commercializing the Application or its installer packages, you are requested and encouraged to report such unauthorized sale or distribution activity to the Developer.

### 2\. INTELLECTUAL PROPERTY & OWNERSHIP

* **Application & Code:** The Application, including its source code, compiled binaries, schema designs, prompt structures, visual interface, and algorithms, remains the sole intellectual property of the Developer. This Agreement grants you a license to use and distribute the Application; it does not transfer ownership of the underlying software code or branding.  
* **User Data:** All local database files (`app.db`, `agent.db`, logs, and operational records) created during your use of the Application are and shall remain your exclusive property.

### 3\. ENCRYPTION & KEY MANAGEMENT

* The Application uses client-side encryption algorithms (SQLCipher/SQLite) to secure local database records stored on your system.  
* Cryptographic keys generated or used by the Application are stored locally on your device using native system credential stores (e.g., Keytar / system Keychain / Credential Manager).  
* The Developer does not possess, transmit, or back up your encryption keys. You maintain total technical control and physical custody over your local keys and data files.

* ### 4\. ACCESS CONTROL, BAN CONDITIONS & TECHNICAL DEFENSES

* **Prohibition on Unauthorized Commercialization:** You are strictly prohibited from selling, renting, leasing, charging a direct fee for, or commercially exploiting the Application binaries, installer packages, or core software features without explicit written consent from the Developer.  
* **License Revocation & Technical Enforcement:** In the event of a breach of this Agreement (including unauthorized resale, distribution violations, or reverse engineering attempts), the Developer reserves the right to immediately revoke software execution privileges via technical defenses, including:  
  * **Software Access Blocking:** Preventing the Application user interface and main processes from launching.  
  * **Application Schema & Model Deactivation:** Removing, wiping, or deactivating internal application database models, DDL migration scripts, and Sequelize schema definitions embedded within the application binary runtime, rendering software features non-functional even if client-side UI blockers are bypassed.  
  * **Sync & Service Blocking:** Permanently refusing multi-device schema synchronization and cloud relay connections for banned installations or API keys.  
* **User Data Preservation:** Technical defenses and software bans strictly disable application runtime code, internal schemas, and cloud services. Under no circumstances will software access restrictions delete, wipe, or alter local user database files (`app.db`, `agent.db`) or encryption keys residing on your machine.

### 5\. END-TO-END ENCRYPTED DATA SYNCHRONIZATION & TRANSIT

* **Multi-Device Transit:** If you enable multi-device communication or data synchronization features across your instances of the Application, data payload packets may pass through or relay across infrastructure operated by or contracted by the Developer.  
* **Zero-Knowledge Architecture:** All synced data payload contents are client-side end-to-end encrypted (E2EE) on your local device prior to transmission.  
* **Server Accessibility:** Relaying servers, edge workers, and network routing mechanisms act purely as blind transmission channels. The Developer and any server infrastructure possess no technical capability, decryption keys, or plaintext access to read, inspect, parse, or log your synchronized payload contents.

### 6\. DIRECT DATA ACCESS & THIRD-PARTY UTILITIES

Because your database files and encryption keys reside entirely on your local machine, you retain full capability to access, inspect, or export your raw data using external database viewers or custom scripts.

**Disclaimer on Direct Modification:** The Developer provides no warranty, support, or guarantee of application stability if you directly modify, query, or alter database schemas or contents outside the Application's official user interface.

### 7\. DISCLAIMER OF WARRANTIES & LIMITATION OF LIABILITY

* **AS IS Basis:** The Application is provided "AS IS" and "AS AVAILABLE" without warranty of any kind, express or implied, including but not limited to fitness for a particular purpose or non-infringement.  
* **Limitation of Liability:** To the maximum extent permitted under applicable law, in no event shall the Developer be liable for any indirect, incidental, special, or consequential damages, including loss of business profits or data loss, arising from the use or inability to use the Application.

### 8\. AI-GENERATED CONTENT & DISCLAIMER

* **Probabilistic Nature:** Features relying on artificial intelligence, agentic workflows, or automated language models generate responses probabilistically.  
* **User Verification:** AI-generated outputs, summary reports, conversational logs, or automated recommendations are provided for informational assistance only. You are solely responsible for reviewing, auditing, and verifying all AI outputs before relying on them for accounting, tax compliance, business management, or legal decisions.  
* **No Professional Liability:** The Developer disclaims any liability for errors, inaccuracies, or omissions in AI-generated data or decisions made based on such content.

### 9\. ANONYMIZED TELEMETRY & MODEL WEIGHT SHARING

* **App Usage Patterns & Telemetry:** The Application may automatically collect anonymized, non-personally identifiable operational telemetry and usage metrics (such as feature interaction frequency, navigation flows, and crash diagnostics) to optimize application performance, user interface design, and system stability.  
* **Federated Learning & Model Weights:** To improve local AI capabilities across the ecosystem, the Application may compute and upload anonymized local model weight updates or gradient parameters to the Developer's server infrastructure.  
* **Privacy & Data Exclusion:** All telemetry metrics and model weight updates are strictly anonymized and aggregated prior to transmission. Under no circumstances are raw database records (`app.db`, `agent.db`), conversation logs, customer lists, transaction details, or encryption keys included in telemetry or weight contributions.

### 10\. IN-APP COMMUNICATIONS & ANNOUNCEMENTS

* **In-App Banners & Notices:** The Application may display in-app banners, notices, feature highlights, promotional offers, or update announcements within the software interface. These communications serve to inform users about new releases, feature upgrades, partner integrations, system maintenance, or related products offered by the Developer.

### 11\. DYNAMIC WEATHER THEMES & LOCATION DATA

* **Location-Based Customization:** The Application may use your configured business address or general location data to fetch real-time local weather conditions solely for rendering dynamic visual themes and contextual interface styling.  
* **Privacy & Local Fetching:** Location parameters used for weather theme queries are processed locally or via non-identifiable API requests. Location data is strictly used for real-time visual personalization and is never stored, tracked, sold, or tied to personal profiles.

### 12\. REVERSE ENGINEERING & INTELLECTUAL PROPERTY PROTECTION

* **Code Protection:** Except for direct user access to raw database files (`app.db`, `agent.db`), you may not decompile, reverse engineer, disassemble, decrypt, modify, or create derivative works based on the Application’s compiled binary files, source code, or application packages.

### 13\. OPEN SOURCE SOFTWARE (OSS) ATTRIBUTION

* **Third-Party Libraries:** The Application incorporates open-source software components and third-party libraries. Individual open-source licenses, copyright notices, and permission terms are included in the Application’s documentation or bundled license disclosures.

### 14\. EXPORT CONTROL & SANCTIONS COMPLIANCE

* **Sanctions Compliance:** You represent and warrant that you are not located in any country or territory subject to government embargoes or trade sanctions, and that you will comply with all applicable export control laws.

### 15\. FORCE MAJEURE

* **External Disruption:** The Developer shall not be liable for any failure or delay in performance resulting from internet outages, cloud infrastructure failure, third-party API downtime, severe weather, natural disasters, or other events beyond reasonable control.

### 16\. SYSTEM REQUIREMENTS & HARDWARE RESOURCE LIMITATIONS

* **Hardware & OS Dependencies:** The Application relies on local host hardware resources, operating system scheduling, memory allocation (RAM), CPU time, disk I/O, and runtime environments to execute properly.  
* **No Guarantee on Underpowered Hardware:** The Developer shall not be liable for Application failure, sluggish performance, lag, background service termination, process crashes, or data write failures resulting from insufficient system memory, CPU throttling, hardware degradation, or OS-level resource starvation on the user's host machine.

### 17\. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of India. Any dispute arising out of or in connection with this Agreement shall be subject to the exclusive jurisdiction of the courts in West Bengal, India.