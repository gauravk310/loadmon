'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const artilleryDir = path.join(__dirname, '..', 'artillery');
const resultsPath = path.join(artilleryDir, 'results.json');
const errorLogPath = path.join(artilleryDir, 'error-logs.json');

// ── GET /api/results ──────────────────────────────────────
router.get('/', (req, res) => {
  if (!fs.existsSync(resultsPath)) {
    return res.json({ success: false, exists: false, error: 'No results found. Run a test first.' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    res.json({ success: true, exists: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/results/errors ───────────────────────────────
router.get('/errors', (req, res) => {
  if (!fs.existsSync(errorLogPath)) {
    return res.json({ success: true, errors: [] });
  }

  try {
    const raw = fs.readFileSync(errorLogPath, 'utf8').trim();
    if (!raw) return res.json({ success: true, errors: [] });

    const errors = raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    res.json({ success: true, errors });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
