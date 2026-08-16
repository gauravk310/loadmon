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
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
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

// ── API Test Files Upload (Multipart / Form-Data assets) ──
const apiFilesDir = path.join(uploadsDir, 'api_files');
if (!fs.existsSync(apiFilesDir)) fs.mkdirSync(apiFilesDir, { recursive: true });

const apiFileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, apiFilesDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1E6);
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
    cb(null, `${base}_${uniqueSuffix}${ext}`);
  }
});

const uploadApiFiles = multer({
  storage: apiFileStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB per file
});

// ── POST /api/upload/api-files ───────────────────────────
router.post('/api-files', uploadApiFiles.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'No files uploaded' });
  }

  try {
    const uploadedFiles = req.files.map(f => ({
      id: f.filename,
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      relativePath: path.join('uploads', 'api_files', f.filename).replace(/\\/g, '/')
    }));

    res.json({
      success: true,
      files: uploadedFiles,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/upload/api-files ────────────────────────────
router.get('/api-files', (req, res) => {
  try {
    if (!fs.existsSync(apiFilesDir)) {
      return res.json({ success: true, files: [] });
    }
    const files = fs.readdirSync(apiFilesDir).map(fn => {
      const fp = path.join(apiFilesDir, fn);
      const stat = fs.statSync(fp);
      return {
        id: fn,
        filename: fn,
        originalName: fn.replace(/^.*?_\d+_\d+/, ''),
        size: stat.size,
        relativePath: path.join('uploads', 'api_files', fn).replace(/\\/g, '/')
      };
    });
    res.json({ success: true, files });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/upload/api-files/:filename ───────────────
router.delete('/api-files/:filename', (req, res) => {
  try {
    const filePath = path.join(apiFilesDir, path.basename(req.params.filename));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true, message: 'File deleted' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

