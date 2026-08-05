'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

// ── GET /api/config ───────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/config ──────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const updated = { ...existing, ...req.body };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
