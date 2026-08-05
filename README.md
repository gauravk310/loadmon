# 🚀 GradeMeAI — Load Testing Suite

Comprehensive load & stress testing framework for the **GradeMeAI** backend authentication services, powered by **[Artillery](https://artillery.io)** and Node.js.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Project Architecture](#-project-architecture)
- [Prerequisites](#-prerequisites)
- [Setup & Environment Configuration](#-setup--environment-configuration)
- [Data Preparation](#-data-preparation)
- [Running Load Tests](#-running-load-tests)
  - [Available Test Profiles](#available-test-profiles)
  - [CLI Test Commands](#cli-test-commands)
  - [Custom Load Testing Script](#custom-load-testing-script)
- [Generating HTML Reports](#-generating-html-reports)
- [Troubleshooting & Tips](#-troubleshooting--tips)

---

## 🔍 Overview

This repository measures performance, latency, throughput, and error rates of the GradeMeAI backend during peak user traffic (e.g. concurrent student logins during exam sessions).

**Key Features:**
- ⚡ **Multi-Profile Load Testing**: Preset profiles ranging from quick sanity checks to extreme 3,000+ concurrent Virtual Users (VUs).
- 🔄 **Dynamic User Allocation**: Reads student credentials from dataset files (`studentData.json` / `.xlsx`) and cycles VUs through distinct student logins.
- 📊 **Interactive HTML Dashboards**: Rich performance reports featuring real-time latency distributions (p95, p99), throughput graphs, status code breakdowns, and detailed error logs.

---

## 📂 Project Architecture

```
grademeai-load-testing/
├── .env                  # Environment configuration (Target Backend & Frontend URLs)
├── package.json          # Test runner scripts & dependencies
├── README.md             # Project documentation & instructions
└── Login/
    ├── convert.js            # Utility to convert studentData.xlsx → studentData.json
    ├── generate-report.js    # Custom HTML report generator (processes results.json)
    ├── login-test.yml        # Main Artillery scenario specification & environment configurations
    ├── processor.js          # Custom JS hook for VU credential assignment & metric logging
    ├── studentData.json      # JSON array of test student credentials
    ├── studentData.xlsx      # Original Excel spreadsheet of test accounts
    ├── ultimate-load-test.js # Standalone Node.js HTTPS load testing engine
    ├── error-logs.json       # Generated log file capturing detailed login failures
    ├── results.json          # Generated raw Artillery metric results
    └── results.html          # Generated interactive HTML report
```

---

## 🛠️ Prerequisites

- **Node.js**: `v16.x` or higher
- **npm**: `v8.x` or higher
- **Target Backend Server**: Active local or remote instance of GradeMeAI server running and accessible.

---

## ⚙️ Setup & Environment Configuration

1. **Install Dependencies**
   ```bash
   npm i
   ```

2. **Configure `.env` File**
   Ensure your `.env` file in the root directory points to the target environment you wish to test:

   ```env
   # Local Environment Example
   APP_URL=http://localhost:4000/
   SERVER_URL=http://localhost:5000
   HOSTNAME=localhost:5000

   # QA / Staging Environment Example
   # APP_URL=https://grademeai-qafe.onrender.com
   # SERVER_URL=https://grademeai-qabe.onrender.com
   # HOSTNAME=grademeai-qabe.onrender.com

   # Production Environment Example
   # APP_URL=https://dashboard.grademe-ai.com
   # SERVER_URL=https://api.grademe-ai.com
   # HOSTNAME=api.grademe-ai.com
   ```

---

## 📊 Data Preparation

If you modify or update the student list in `Login/studentData.xlsx`, compile it into `studentData.json` before running tests:

```bash
npm run convert
```

> **Note**: During tests, `Login/processor.js` dynamically picks credentials from `studentData.json`. If the number of Virtual Users exceeds the number of records in the dataset, VUs will automatically cycle through the users safely.

---

## 🧪 Running Load Tests

### Available Test Profiles

| Command | Environment Profile | Target Concurrent Load | Scenario / Phase Description |
| :--- | :--- | :--- | :--- |
| `npm run test:quick` | `quick` | ~50 requests total | Sanity check (2 VUs/sec for 50 sec) |
| `npm run test:moderate` | `moderate` | ~100 concurrent VUs | Sustained load (3 VUs/sec for 200 sec) |
| `npm run test:heavy` | `heavy` | ~2,000 concurrent VUs | Ramp up to 500/sec, peak load for 60 sec, cooldown |
| `npm run test:stress` | `stress` | ~3,000+ concurrent VUs | Aggressive ramp to 1000/sec, peak stress for 60 sec, cooldown |

### CLI Test Commands

1. **Quick Test (Sanity Check)**
   ```bash
   npm run test:quick
   ```

2. **Moderate Load Test**
   ```bash
   npm run test:moderate
   ```

3. **Heavy Load Test**
   ```bash
   npm run test:heavy
   ```

4. **Stress Test**
   ```bash
   npm run test:stress
   ```

5. **Custom Artillery Command**
   You can also execute Artillery directly with custom options:
   ```bash
   npx artillery run --dotenv .env Login/login-test.yml -e heavy -o Login/results.json
   ```

### Custom Load Testing Script

For headless environments or testing without Artillery CLI wrappers, run the standalone custom Node.js HTTPS engine:

```bash
node Login/ultimate-load-test.js
```

---

## 📈 Generating HTML Reports

After running any load test, generate a comprehensive visual HTML report:

```bash
npm run report
```

This generates `Login/results.html`. 

### Opening the Report

- **Windows (PowerShell)**:
  ```powershell
  Start-Process Login/results.html
  ```
- **macOS**:
  ```bash
  open Login/results.html
  ```
- **Linux**:
  ```bash
  xdg-open Login/results.html
  ```

### What the HTML Report Contains:
- **KPI Summary Cards**: Total requests, success rate %, mean response time, total VUs created/completed/failed.
- **Response Time Percentiles**: Min, Median, Mean, P75, P90, P95, P99, and Max latency values.
- **Interactive Visual Charts**:
  - Response time distribution bar chart.
  - Success vs. failure doughnut chart.
  - Response time over time trend line (Mean & P95).
  - Throughput over time bar chart (requests/10s window).
- **Endpoint & Status Code Breakdowns**: Detailed statistics on HTTP 2xx, 4xx, 5xx responses.
- **Failed Request Audit Log**: Detailed log table capturing timestamps, user emails, status codes, and exact response bodies for all failed requests.

---

## 💡 Troubleshooting & Tips

- **Connection Refused / Network Error**: Verify that the target backend server (`SERVER_URL` in `.env`) is running and accepting incoming network requests.
- **Socket / File Descriptor Limits (`EMFILE`)**: When running Heavy or Stress profiles (`test:heavy`, `test:stress`), ensure your OS socket limit permits high concurrency (`ulimit -n 65536` on macOS/Linux).
- **High Concurrency in Windows**: Adjust `maxSockets` in `Login/login-test.yml` if network buffer limits are reached during high VU throughput.