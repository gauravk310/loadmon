'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, file.originalname)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.json'].includes(ext)) return cb(null, true);
    cb(new Error('Only .xlsx, .xls, or .json files are allowed'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const userDataPath = path.join(uploadsDir, 'userData.json');

// ── POST /api/upload/excel ────────────────────────────────
router.post('/excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!data.length) {
      return res.status(400).json({ success: false, error: 'Excel file is empty or has no data rows' });
    }

    fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2));

    const preview = data.slice(0, 10);
    const columns = Object.keys(data[0]);

    res.json({
      success: true,
      message: `Converted ${data.length} rows from Excel`,
      rowCount: data.length,
      columns,
      preview
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/upload/json ─────────────────────────────────
router.post('/json', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  try {
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : [data];

    if (!arr.length) {
      return res.status(400).json({ success: false, error: 'JSON file is empty' });
    }

    fs.writeFileSync(userDataPath, JSON.stringify(arr, null, 2));

    const preview = arr.slice(0, 10);
    const columns = Object.keys(arr[0]);

    res.json({
      success: true,
      message: `Loaded ${arr.length} rows from JSON`,
      rowCount: arr.length,
      columns,
      preview
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/upload/preview ───────────────────────────────
router.get('/preview', (req, res) => {
  if (!fs.existsSync(userDataPath)) {
    return res.json({ success: false, exists: false, error: 'No data uploaded yet' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    const preview = data.slice(0, 20);
    const columns = data.length > 0 ? Object.keys(data[0]) : [];

    res.json({
      success: true,
      exists: true,
      rowCount: data.length,
      columns,
      preview
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/upload/raw ──────────────────────────────────
router.get('/raw', (req, res) => {
  if (!fs.existsSync(userDataPath)) {
    return res.json({ success: false, exists: false, error: 'No data uploaded yet' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    res.json({
      success: true,
      exists: true,
      rowCount: data.length,
      data
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/upload/clear ──────────────────────────────
router.delete('/clear', (req, res) => {
  if (fs.existsSync(userDataPath)) fs.unlinkSync(userDataPath);
  res.json({ success: true, message: 'Data cleared' });
});

module.exports = router;
