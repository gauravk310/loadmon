'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8000'],
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
    appUrl: 'http://localhost:4000',
    serverUrl: 'http://localhost:5000',
    hostname: 'localhost:5000',
    targetEndpoint: '/api/auth/signin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: '{{ email }}', password: '{{ password }}' },
    httpTimeout: 30,
    maxSockets: 5000,
    fieldMapping: { email: 'email', password: 'password' }
  }, null, 2));
}

// ── Routes ────────────────────────────────────────────────
app.use('/api/config',  require('./routes/config'));
app.use('/api/tests',   require('./routes/tests'));
app.use('/api/upload',  require('./routes/upload'));
app.use('/api/results', require('./routes/results'));

// ── Serve built UI in production ─────────────────────────
const uiDist = path.join(__dirname, '..', 'ui', 'dist');
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get('*', (req, res) => res.sendFile(path.join(uiDist, 'index.html')));
}

// ── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  🚀 LoadMon Backend running             ║`);
  console.log(`║  http://localhost:${PORT}                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});

module.exports = app;
