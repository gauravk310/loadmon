# LoadMon — API Load Testing Platform

## Setup & Running

### 1. Install Backend Dependencies

```powershell
cd e:\loadmon\backend
npm install
```

### 2. Install UI Dependencies

```powershell
cd e:\loadmon\ui
npm install
```

### 3. Start Backend (Port 4000)

```powershell
cd e:\loadmon\backend
node index.js
```

### 4. Start UI Dev Server (Port 5173)

```powershell
cd e:\loadmon\ui
npm run dev
```

### 5. Open the App

Visit: **http://localhost:5173**

---

## Project Structure

```
e:\loadmon\
├── backend/           # Express API server (port 4000)
│   ├── index.js
│   ├── routes/
│   │   ├── config.js     # Config CRUD
│   │   ├── tests.js      # Artillery orchestration + SSE
│   │   ├── upload.js     # File uploads
│   │   └── results.js    # Results reader
│   ├── artillery/
│   │   ├── processor.js  # Artillery processor
│   │   └── login-test.yml
│   └── uploads/          # Uploaded data files land here
│
└── ui/                # React + Vite frontend (port 5173)
    └── src/
        ├── pages/
        │   ├── Dashboard.jsx   # Live test + charts
        │   ├── Configure.jsx   # All settings
        │   ├── DataManager.jsx # File upload
        │   └── Reports.jsx     # Post-test analysis
        └── components/
            └── Sidebar.jsx
```

## Features

- **Configure** URLs, hostname, endpoint, method, headers, body, HTTP settings
- **Upload** Excel (.xlsx) or JSON files — auto-converted and previewed  
- **Start/Stop** tests with preset profiles (Quick / Moderate / Heavy / Stress)
- **Live metrics** via SSE: KPI cards, response time chart, throughput chart, log console
- **Reports** with full in-app charts, status code breakdown, error logs, JSON download