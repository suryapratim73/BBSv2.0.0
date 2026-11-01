# Contributing to BBSv2

Thank you for inspecting and helping improve BBSv2! We welcome bug reports, performance optimization suggestions, and security audits from the community.

## Terms of Usage & Contributions

Please note that this repository is governed by the [BBSv2 End User License Agreement (EULA)](./LICENSE). By submitting pull requests or issue reports:
1. You acknowledge that the underlying application, code, and architecture remain the intellectual property of the Developer.
2. The software is free to use and distribute in unmodified forms, but unauthorized commercial resale or fee-based distribution is strictly prohibited.

---

## Local Development Setup

### Prerequisites
* **Node.js**: v18.x or higher
* **npm**: v9.x or higher
* **Python**: 3.10+ (for embedded sidecar runtime)
* **Native Build Tools**: `python3`, `make`, `g++`, or Visual Studio C++ Build Tools (required for local `SQLCipher` / `better-sqlite3` native compilation).

### Running Locally

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/suryapratim73/BBSv2.0.0.git](https://github.com/suryapratim73/BBSv2.0.0.git)
   cd BBSv2.0.0
