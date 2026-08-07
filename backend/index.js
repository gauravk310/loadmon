'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? (process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN.split(',').map(s => s.trim()))
    : true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Ensure required directories exist ────────────────────
const dirs = [
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'artillery'),
];
dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Seed default config if not exists ────────────────────
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    applications: [
      {
        id: 'app_default',
        name: 'Default Application',
        appUrl: '',
        serverUrl: '',
        hostname: ''
      }
    ],
    selectedAppId: 'app_default',
    appUrl: '',
    serverUrl: '',
    hostname: '',
    targetEndpoint: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: '{{ email }}', password: '{{ password }}' },
    httpTimeout: 30,
    maxSockets: 5000,
    randomIp: false,
    fieldMapping: { email: 'email', password: 'password' }
  }, null, 2));
}

// ── Seed chains.json if not exists ──────────────────────
const chainsPath = path.join(__dirname, 'chains.json');
if (!fs.existsSync(chainsPath)) {
  fs.writeFileSync(chainsPath, JSON.stringify([], null, 2));
}

// ── Routes ────────────────────────────────────────────────
app.use('/api/config',  require('./routes/config'));
app.use('/api/chains',  require('./routes/chains'));
app.use('/api/tests',   require('./routes/tests'));
app.use('/api/upload',  require('./routes/upload'));
app.use('/api/results', require('./routes/results'));

// ── Serve built UI in production ─────────────────────────
const uiDist = path.join(__dirname, '..', 'ui', 'dist');
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist));
}

// ── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Catch-all handler ───────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.path}` });
  }
  if (fs.existsSync(uiDist)) {
    return res.sendFile(path.join(uiDist, 'index.html'));
  }
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  🚀 LoadMon Backend running             ║`);
  console.log(`║  http://localhost:${PORT}                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});

module.exports = app;
