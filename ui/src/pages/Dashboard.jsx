import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { useApp } from '../context/AppContext.jsx'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
)

const CHART_OPTIONS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'top',
      labels: { color: '#64748b', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } }
    },
    tooltip: {
      backgroundColor: 'rgba(13,17,23,0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      padding: 12,
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#475569', maxTicksLimit: 10, font: { size: 10 } }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#475569', font: { size: 10 } },
      beginAtZero: true
    }
  }
}

const PRESET_PHASES = {
  quick:    [{ duration: 30,  arrivalRate: 5,    name: 'Quick Validation' }],
  moderate: [{ duration: 120, arrivalRate: 10,   name: 'Moderate Load' }],
  heavy: [
    { duration: 30, arrivalRate: 50,  rampTo: 300, name: 'Ramp Up' },
    { duration: 60, arrivalRate: 300, name: 'Peak Load' },
    { duration: 15, arrivalRate: 300, rampTo: 10,  name: 'Cool Down' },
  ],
  stress: [
    { duration: 30,  arrivalRate: 100,  rampTo: 1000, name: 'Aggressive Ramp' },
    { duration: 60,  arrivalRate: 1000, name: 'Stress Test' },
    { duration: 15,  arrivalRate: 1000, rampTo: 10,   name: 'Cool Down' },
  ],
}

function fmt(v) { return v !== undefined && v !== null ? Math.round(v) : '—' }

// ── Log classifier ──────────────────────────────────────────
function classifyLog(text) {
  if (!text) return 'default'
  const t = text.trim()
  if (/^-{3,}/.test(t))                              return 'sep'
  if (/Metrics for period/i.test(t))                 return 'metric'
  if (/Phase started|phase complete/i.test(t))       return 'phase'
  if (/All VUs finished|Test run complete|done/i.test(t)) return 'phase'
  if (/error|fail|ERR/i.test(t))                    return 'error'
  if (/warning|WARN/i.test(t))                       return 'warn'
  if (/Progress:|✅|✓|100\.0%/i.test(t))             return 'success'
  if (/http\.|vusers\.|p\d{2}:|mean:|min:|max:/i.test(t)) return 'info'
  return 'default'
}

// Split raw log text blocks into individual lines
function splitLogText(text) {
  return text.split('\n').filter(l => l.trim())
}

export default function Dashboard() {
  const { testStatus, liveMetrics, logs, startTest, stopTest, config } = useApp()
  const [selectedPreset, setSelectedPreset] = useState('default')
  const [starting, setStopping] = useState(false)
  const [error, setError]       = useState(null)
  const logRef = useRef(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // ── Derived metrics from latest SSE data ──────────────────
  const agg = useMemo(() => {
    if (!liveMetrics.length) return {}
    const counters  = {}
    const summaries = {}
    liveMetrics.forEach(m => {
      if (m.counters)  Object.entries(m.counters).forEach(([k,v])  => { counters[k]  = (counters[k] || 0) + v })
      if (m.summaries) Object.entries(m.summaries).forEach(([k,v]) => { summaries[k] = v })
    })
    return { counters, summaries }
  }, [liveMetrics])

  const totalReq   = agg.counters?.['http.requests']  || 0
  const success2xx = Object.entries(agg.counters || {})
    .filter(([k]) => k.match(/^http\.codes\.2/))
    .reduce((s,[,v]) => s + v, 0)
  const failed     = totalReq - success2xx
  const successRate = totalReq > 0 ? ((success2xx / totalReq) * 100).toFixed(1) : '—'
  const rt = agg.summaries?.['http.response_time'] || {}

  // ── Chart data ────────────────────────────────────────────
  const timeLabels = liveMetrics.map(m => {
    const d = new Date(m._ts)
    return `${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
  })

  const rtChartData = {
    labels: timeLabels,
    datasets: [
      {
        label: 'Mean RT',
        data: liveMetrics.map(m => m.summaries?.['http.response_time']?.mean != null
          ? Math.round(m.summaries['http.response_time'].mean) : null),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2,
      },
      {
        label: 'P95 RT',
        data: liveMetrics.map(m => m.summaries?.['http.response_time']?.p95 != null
          ? Math.round(m.summaries['http.response_time'].p95) : null),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderDash: [4, 3], tension: 0.4, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2,
      },
    ]
  }

  const throughputChartData = {
    labels: timeLabels,
    datasets: [
      {
        label: 'Success',
        data: liveMetrics.map(m => {
          const c = m.counters || {}
          return Object.entries(c).filter(([k]) => k.match(/^http\.codes\.2/)).reduce((s,[,v]) => s+v, 0)
        }),
        backgroundColor: 'rgba(16,185,129,0.75)',
        borderRadius: 4,
      },
      {
        label: 'Failed',
        data: liveMetrics.map(m => (m.counters?.['vusers.failed'] || 0)),
        backgroundColor: 'rgba(239,68,68,0.75)',
        borderRadius: 4,
      },
    ]
  }

  const rtOptions = {
    ...CHART_OPTIONS_BASE,
    scales: {
      ...CHART_OPTIONS_BASE.scales,
      y: { ...CHART_OPTIONS_BASE.scales.y, ticks: { ...CHART_OPTIONS_BASE.scales.y.ticks, callback: v => v + ' ms' } }
    }
  }

  // ── Flatten log entries ───────────────────────────────────
  const logEntries = useMemo(() => {
    const entries = []
    logs.forEach(log => {
      const lines = splitLogText(log.text || '')
      lines.forEach(line => {
        entries.push({ text: line, time: log.time, level: log.level })
      })
    })
    return entries.slice(-300)
  }, [logs])

  // ── Active Phases ──────────────────────────────────────────
  const activePhases = useMemo(() => {
    if (selectedPreset === 'default') {
      return config?.phases && config.phases.length > 0
        ? config.phases
        : [{ duration: 30, arrivalRate: 5, name: 'Default Test' }]
    }
    return PRESET_PHASES[selectedPreset] || [{ duration: 30, arrivalRate: 5, name: 'Default Test' }]
  }, [selectedPreset, config?.phases])

  // ── Handlers ──────────────────────────────────────────────
  const handleStart = async () => {
    setError(null)
    setStopping(true)
    const result = await startTest({ environment: 'custom', phases: activePhases })
    setStopping(false)
    if (!result.success) setError(result.error)
  }

  const handleStop = async () => {
    setStopping(true)
    await stopTest()
    setStopping(false)
  }

  return (
    <div className="page-wrapper animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time load test monitoring &amp; control</p>
        </div>

        <div className="flex items-center gap-2">
          {!testStatus.running && (
            <select
              id="preset-select"
              value={selectedPreset}
              onChange={e => setSelectedPreset(e.target.value)}
              className="form-select"
              style={{ width: 'auto' }}
            >
              <option value="default">⚙️ Default Config</option>
              <option value="quick">⚡ Quick (30s)</option>
              <option value="moderate">🚀 Moderate (2m)</option>
              <option value="heavy">🔥 Heavy (~2k VUs)</option>
              <option value="stress">💀 Stress (3k+ VUs)</option>
            </select>
          )}

          {testStatus.running ? (
            <button id="btn-stop" className="btn btn-danger btn-lg" onClick={handleStop} disabled={starting}>
              ⏹ Stop Test
            </button>
          ) : (
            <button id="btn-start" className="btn btn-success btn-lg" onClick={handleStart} disabled={starting}>
              {starting ? '⏳ Starting…' : '▶ Start Test'}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="card card-p mb-2" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)' }}>
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>❌ {error}</span>
        </div>
      )}

      {/* Status bar */}
      <div className="card card-p mb-2 flex items-center gap-2" style={{ padding: '0.75rem 1.25rem' }}>
        <span className={`status-dot ${testStatus.running ? 'running' : 'idle'}`} />
        <span className="text-sm" style={{ color: testStatus.running ? 'var(--success)' : 'var(--text-muted)' }}>
          {testStatus.running
            ? `Running since ${new Date(testStatus.startedAt).toLocaleTimeString()}`
            : 'No active test'}
        </span>
        {config && (
          <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
            Target: <code className="mono" style={{ color: 'var(--accent-light)', fontSize: '0.8rem' }}>{config.serverUrl}{config.targetEndpoint}</code>
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="metric-grid mb-3 stagger">
        <MetricCard label="Total Requests" value={totalReq.toLocaleString()} color="default" icon="📤" />
        <MetricCard label="Success Rate"
          value={successRate === '—' ? '—' : `${successRate}%`}
          color={successRate === '—' ? 'default' : parseFloat(successRate) >= 95 ? 'success' : parseFloat(successRate) >= 50 ? 'warning' : 'danger'}
          icon="✅" />
        <MetricCard label="Successful"   value={success2xx.toLocaleString()} color="success" icon="✓" />
        <MetricCard label="Failed"       value={failed.toLocaleString()} color={failed > 0 ? 'danger' : 'default'} icon="✗" />
        <MetricCard label="Mean RT"      value={fmt(rt.mean)} unit="ms" color="accent" icon="⚡" />
        <MetricCard label="P95 RT"       value={fmt(rt.p95)}  unit="ms" color="warning" icon="📈" />
      </div>

      {/* Charts */}
      <div className="grid-2 mb-3">
        <div className="card" style={{ padding: '1.25rem' }}>
          <div className="section-title mb-2">Response Times (ms)</div>
          <div style={{ height: 200 }}>
            {liveMetrics.length > 0
              ? <Line data={rtChartData} options={rtOptions} />
              : <EmptyChart label="Charts appear after the first metric period (~10s)" />}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div className="section-title mb-2">Throughput (req/window)</div>
          <div style={{ height: 200 }}>
            {liveMetrics.length > 0
              ? <Bar data={throughputChartData} options={{
                  ...CHART_OPTIONS_BASE,
                  scales: {
                    ...CHART_OPTIONS_BASE.scales,
                    x: { ...CHART_OPTIONS_BASE.scales.x, stacked: true },
                    y: { ...CHART_OPTIONS_BASE.scales.y, stacked: true }
                  }
                }} />
              : <EmptyChart label="Charts appear after the first metric period (~10s)" />}
          </div>
        </div>
      </div>

      {/* Phase Timeline */}
      {selectedPreset && !testStatus.running && (
        <div className="card card-p mb-3">
          <div className="section-title mb-2">
            Selected Phase Plan — {selectedPreset === 'default' ? 'Default Config' : selectedPreset}
          </div>
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {activePhases.map((p, i) => (
              <PhaseChip key={i} phase={p} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* ── Artillery Terminal Console ── */}
      <div className="terminal-wrap">
        {/* macOS-style title bar */}
        <div className="terminal-titlebar" style={{ position: 'relative' }}>
          <div className="terminal-dots">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
          </div>
          <span className="terminal-title">artillery — load test output</span>
          <span className="terminal-badge">{logEntries.length} lines</span>
        </div>

        {/* Log body */}
        <div className="log-console" ref={logRef}>
          {logEntries.length === 0 ? (
            <div className="terminal-empty">
              <div style={{ fontSize: '1.4rem', opacity: 0.3 }}>⬛</div>
              <div className="terminal-prompt">
                <span className="prompt-symbol">$ </span>
                <span className="prompt-cmd">artillery run --environment custom runtime-test.yml</span>
              </div>
              <div style={{ color: '#1e293b', fontSize: '0.7rem' }}>Waiting for test to start…</div>
            </div>
          ) : (
            logEntries.map((entry, i) => {
              const type  = entry.level === 'warn' ? 'warn' : classifyLog(entry.text)
              const isLast = i === logEntries.length - 1 && testStatus.running
              return (
                <div key={i} className={`log-entry log-${type}${isLast ? ' log-cursor' : ''}`}>
                  <span className="log-ts">
                    {new Date(entry.time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="log-text">{entry.text.trim()}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, color = 'default', icon }) {
  return (
    <div className={`metric-card animate-fade-up ${color}`}>
      <div className="metric-label">{icon} {label}</div>
      <div className={`metric-value ${color}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
    </div>
  )
}

function PhaseChip({ phase, index }) {
  return (
    <div style={{
      background: 'var(--bg-overlay)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '0.5rem 0.85rem',
      fontSize: '0.78rem',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: 2 }}>Phase {index + 1}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{phase.name || 'Unnamed'}</div>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginTop: 2 }}>
        {phase.duration}s · {phase.arrivalRate}/s{phase.rampTo ? ` → ${phase.rampTo}/s` : ''}
      </div>
    </div>
  )
}

function EmptyChart({ label }) {
  return (
    <div className="empty-state" style={{ padding: '2rem' }}>
      <div style={{ fontSize: '1.8rem', opacity: 0.3, marginBottom: '0.5rem' }}>📊</div>
      <div className="empty-desc" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{label}</div>
    </div>
  )
}
