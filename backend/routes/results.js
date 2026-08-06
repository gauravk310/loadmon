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

const studentLogPath = path.join(artilleryDir, 'student-logs.json');

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

// ── GET /api/results/students ─────────────────────────────
router.get('/students', (req, res) => {
  if (!fs.existsSync(studentLogPath)) {
    return res.json({ success: true, students: [], totalExecutedSteps: 0 });
  }

  try {
    const raw = fs.readFileSync(studentLogPath, 'utf8').trim();
    if (!raw) return res.json({ success: true, students: [], totalExecutedSteps: 0 });

    const logs = raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    // Group logs by student identifier / vuId
    const studentMap = {};

    logs.forEach(log => {
      const key = log.student || log.vuId || 'Unknown Student';
      if (!studentMap[key]) {
        studentMap[key] = {
          student: key,
          studentDetails: log.studentDetails || {},
          vuId: log.vuId,
          steps: [],
          totalDurationMs: 0,
          successCount: 0,
          failedCount: 0,
          status: 'SUCCESS'
        };
      }

      studentMap[key].steps.push(log);
      studentMap[key].totalDurationMs += (log.durationMs || 0);
      if (log.success) {
        studentMap[key].successCount++;
      } else {
        studentMap[key].failedCount++;
        studentMap[key].status = 'FAILED';
      }
    });

    const students = Object.values(studentMap);

    res.json({
      success: true,
      students,
      totalExecutedSteps: logs.length,
      totalStudents: students.length,
      rawLogs: logs
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
