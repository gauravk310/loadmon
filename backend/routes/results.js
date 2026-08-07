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
const sendTimestampLogPath = path.join(artilleryDir, 'send-timestamps.log');

// ── GET /api/results/timestamps ───────────────────────────
router.get('/timestamps', (req, res) => {
  if (!fs.existsSync(sendTimestampLogPath)) {
    return res.json({ success: true, timestamps: [], spreadMs: 0 });
  }

  try {
    const raw = fs.readFileSync(sendTimestampLogPath, 'utf8').trim();
    if (!raw) return res.json({ success: true, timestamps: [], spreadMs: 0 });

    const lines = raw.split('\n').filter(Boolean);
    const timestamps = lines.map(line => {
      const parts = line.split(' - ');
      const isoTs = parts[0];
      const vu = parts[1] || '';
      const reqInfo = parts.slice(2).join(' - ') || '';
      const dateObj = new Date(isoTs);
      return {
        raw: line,
        timestamp: isoTs,
        timeMs: dateObj.getTime(),
        vu,
        request: reqInfo
      };
    });

    const validTimes = timestamps.map(t => t.timeMs).filter(t => !isNaN(t));
    let minTime = validTimes.length > 0 ? Math.min(...validTimes) : 0;
    let maxTime = validTimes.length > 0 ? Math.max(...validTimes) : 0;
    let spreadMs = maxTime - minTime;

    res.json({
      success: true,
      count: timestamps.length,
      spreadMs,
      firstTimestamp: timestamps[0]?.timestamp || null,
      lastTimestamp: timestamps[timestamps.length - 1]?.timestamp || null,
      timestamps
    });
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
