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

function splitLogText(text) {
  return text.split('\n').filter(l => l.trim())
}

// Extract the actual path from a full URL for display
function extractPath(urlStr) {
  if (!urlStr) return ''
  try {
    const u = new URL(urlStr)
    return u.pathname + u.search
  } catch {
    return urlStr
  }
}

export default function Dashboard() {
  const {
    testStatus, liveMetrics, logs, stepLogs, setStepLogs,
    startTest, stopTest, config, API,
    chains, selectedChainId, setSelectedChainId
  } = useApp()

  const [selectedPreset, setSelectedPreset] = useState('default')
  const [starting, setStopping] = useState(false)
  const [error, setError] = useState(null)
  // Custom phase overrides when chain is selected
  const [chainDuration, setChainDuration] = useState(10)
  const [chainArrivalRate, setChainArrivalRate] = useState(2)

  const logRef = useRef(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // ── Derived metrics ────────────────────────────────────────
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

  // ── Chart data ─────────────────────────────────────────────
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

  // ── Selected chain object ─────────────────────────────────
  const selectedChain = useMemo(() => {
    if (!selectedChainId) return null
    return chains.find(c => c.id === selectedChainId) || null
  }, [chains, selectedChainId])

  // ── Active Phases ──────────────────────────────────────────
  const activePhases = useMemo(() => {
    if (selectedChainId) {
      // Chain mode: use custom duration/arrivalRate
      return [{ duration: chainDuration, arrivalRate: chainArrivalRate, name: 'Chain Load Test' }]
    }
    if (selectedPreset === 'default') {
      return config?.phases && config.phases.length > 0
        ? config.phases
        : [{ duration: 30, arrivalRate: 5, name: 'Default Test' }]
    }
    return PRESET_PHASES[selectedPreset] || [{ duration: 30, arrivalRate: 5, name: 'Default Test' }]
  }, [selectedPreset, config?.phases, selectedChainId, chainDuration, chainArrivalRate])

  // ── Handlers ──────────────────────────────────────────────
  const handleStart = async () => {
    setError(null)
    setStopping(true)
    const result = await startTest({
      environment: 'custom',
      phases: activePhases,
      chain: selectedChain || null
    })
    setStopping(false)
    if (!result.success) setError(result.error)
  }

  const handleStop = async () => {
    setStopping(true)
    await stopTest()
    setStopping(false)
  }

  const isChainMode = !!selectedChainId

  return (
    <div className="page-wrapper animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time load test monitoring &amp; control</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!testStatus.running && (
            <>
              {/* Chain selector */}
              <div className="flex items-center gap-1.5" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.2rem 0.5rem', background: 'var(--bg-overlay)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🔗 Chain:</span>
                <select
                  id="chain-select"
                  className="form-select"
                  style={{ width: 'auto', minWidth: 160, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                  value={selectedChainId || ''}
                  onChange={e => setSelectedChainId(e.target.value || null)}
                >
                  <option value="" style={{ background: '#161b27', color: '#f1f5f9' }}>None ({config?.scenarioName || 'Single Endpoint'})</option>
                  {chains.map(c => (
                    <option key={c.id} value={c.id} style={{ background: '#161b27', color: '#f1f5f9' }}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Phase preset or chain config */}
              {!isChainMode ? (
                <select
                  id="preset-select"
                  value={selectedPreset}
                  onChange={e => setSelectedPreset(e.target.value)}
                  className="form-select"
                  style={{ width: 'auto', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                >
                  <option value="default" style={{ background: '#161b27', color: '#f1f5f9' }}>⚙️ Default Config</option>
                  <option value="quick" style={{ background: '#161b27', color: '#f1f5f9' }}>⚡ Quick (30s)</option>
                  <option value="moderate" style={{ background: '#161b27', color: '#f1f5f9' }}>🚀 Moderate (2m)</option>
                  <option value="heavy" style={{ background: '#161b27', color: '#f1f5f9' }}>🔥 Heavy (~2k VUs)</option>
                  <option value="stress" style={{ background: '#161b27', color: '#f1f5f9' }}>💀 Stress (3k+ VUs)</option>
                </select>
              ) : (
                <div className="flex items-center gap-1" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.25rem 0.5rem', background: 'var(--bg-overlay)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>⏱</span>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 60, padding: '0.2rem 0.4rem', fontSize: '0.82rem' }}
                    value={chainDuration}
                    onChange={e => setChainDuration(Number(e.target.value))}
                    min={5}
                    title="Duration (seconds)"
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>s</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 4px' }}>·</span>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 60, padding: '0.2rem 0.4rem', fontSize: '0.82rem' }}
                    value={chainArrivalRate}
                    onChange={e => setChainArrivalRate(Number(e.target.value))}
                    min={1}
                    title="Arrival Rate per second"
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>/s</span>
                </div>
              )}
            </>
          )}

          {testStatus.running ? (
            <button id="btn-stop" className="btn btn-danger btn-lg" onClick={handleStop} disabled={starting}>
              ⏹ Stop Test
            </button>
          ) : (
            <button
              id="btn-start"
              className={`btn btn-lg ${isChainMode ? 'btn-accent' : 'btn-success'}`}
              onClick={handleStart}
              disabled={starting}
            >
              {starting ? '⏳ Starting…' : isChainMode ? `🔗 Start Chain Test` : '▶ Start Test'}
            </button>
          )}
        </div>
      </div>

      {/* Chain banner when chain is selected */}
      {isChainMode && selectedChain && !testStatus.running && (
        <div className="card card-p mb-2" style={{ borderColor: 'var(--accent)', background: 'rgba(99,102,241,0.07)', padding: '0.75rem 1.25rem' }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '1.2rem' }}>🔗</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--accent-light)', fontSize: '0.9rem' }}>
                Chain: {selectedChain.name}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {selectedChain.steps?.length} steps · {chainArrivalRate} users/s for {chainDuration}s
                · Target: <code style={{ color: 'var(--cyan)', fontSize: '0.76rem' }}>{selectedChain.serverUrl}</code>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              {(selectedChain.steps || []).map((s, i) => (
                <span key={i} style={{
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 8px',
                  fontSize: '0.72rem',
                  color: 'var(--text-secondary)'
                }}>
                  {i + 1}. {s.method} {s.endpoint.substring(0, 25)}{s.endpoint.length > 25 ? '…' : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Single Request banner when no chain is selected */}
      {!isChainMode && !testStatus.running && (
        <div className="card card-p mb-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-overlay)', padding: '0.6rem 1.25rem' }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '1.1rem' }}>🎯</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Single Request Target:
              </span>
              <span className="badge badge-accent" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                {config?.method || 'POST'}
              </span>
              <code style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>
                {config?.targetEndpoint || '/api/auth/signin'}
              </code>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.5rem' }}>
                (Configured in Configure page · Runs for all VUsers when no chain is selected)
              </span>
            </div>
          </div>
        </div>
      )}

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
            {isChainMode && selectedChain ? (
              <span>Chain: <code className="mono" style={{ color: 'var(--accent-light)', fontSize: '0.8rem' }}>{selectedChain.name}</code> ({selectedChain.steps?.length} steps)</span>
            ) : config.steps && config.steps.length > 0 ? (
              <span>Scenario: <code className="mono" style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>{config.scenarioName || 'Chain Load Test'}</code> ({config.steps.length} {config.steps.length === 1 ? 'step' : 'steps'})</span>
            ) : (
              <span>Target: <code className="mono" style={{ color: 'var(--accent-light)', fontSize: '0.8rem' }}>{config.serverUrl}{config.targetEndpoint}</code></span>
            )}
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
      {!testStatus.running && (
        <div className="card card-p mb-3">
          <div className="section-title mb-2">
            Selected Phase Plan — {isChainMode ? `Chain: ${selectedChain?.name || ''}` : (selectedPreset === 'default' ? 'Default Config' : selectedPreset)}
          </div>
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {activePhases.map((p, i) => (
              <PhaseChip key={i} phase={p} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* ── Live Progress Ticker ── */}
      <div className="card card-p mb-3">
        <LiveProgressTicker
          stepLogs={stepLogs}
          testStatus={testStatus}
          isChainMode={isChainMode}
          selectedChain={selectedChain}
        />
      </div>

      {/* ── Artillery Terminal Console ── */}
      <div className="terminal-wrap">
        <div className="terminal-titlebar" style={{ position: 'relative' }}>
          <div className="terminal-dots">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
          </div>
          <span className="terminal-title">artillery — load test output</span>
          <span className="terminal-badge">{logEntries.length} lines</span>
        </div>

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

      {/* ── Step Execution Matrix Table ── */}
      <div className="card card-p style-glass" style={{ marginTop: '1.5rem' }}>
        <RealtimeUserStepTable
          config={config}
          stepLogs={stepLogs}
          setStepLogs={setStepLogs}
          testStatus={testStatus}
          API={API}
          selectedChain={selectedChain}
        />
      </div>
    </div>
  )
}

// ── Live Progress Ticker ──────────────────────────────────────
function LiveProgressTicker({ stepLogs, testStatus, isChainMode, selectedChain }) {
  // Show last 50 events for the ticker
  const recentLogs = useMemo(() => {
    return [...stepLogs].reverse().slice(0, 50)
  }, [stepLogs])

  const isEmpty = stepLogs.length === 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {isChainMode ? '🔗' : '⚡'} Live Progress
          </h2>
          {testStatus.running ? (
            <span className="badge badge-success flex items-center gap-1" style={{ fontSize: '0.7rem' }}>
              <span className="status-dot running" style={{ width: 6, height: 6 }} /> LIVE
            </span>
          ) : (
            <span className="badge" style={{ fontSize: '0.7rem', background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
              {isEmpty ? 'IDLE' : 'COMPLETED'}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stepLogs.length} events</span>
      </div>

      {isEmpty ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <div style={{ fontSize: '1.5rem', opacity: 0.3, marginBottom: '0.5rem' }}>📡</div>
          {testStatus.running
            ? 'Waiting for first request to complete…'
            : 'Start a test to see live progress here'}
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.6fr 0.7fr',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '0.25rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}>
            <span>👤 User</span>
            <span>🌐 API Endpoint</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>

          {recentLogs.map((log, i) => {
            const isSuccess = log.success
            const path = log.url ? extractPath(log.url) : (log.endpoint || '')
            const student = log.student || log.studentDetails?.email || log.vuId || 'Unknown User'

            return (
              <div
                key={i}
                className="progress-ticker-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.6fr 0.7fr',
                  gap: '0.5rem',
                  padding: '0.45rem 0.75rem',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.78rem',
                  animation: i === 0 && testStatus.running ? 'fadeInSlide 0.3s ease' : undefined,
                }}
              >
                {/* User */}
                <div style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {student}
                </div>

                {/* API */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.url || path}>
                  <span style={{
                    display: 'inline-block',
                    marginRight: '0.35rem',
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    background: log.method === 'POST' ? 'rgba(245,158,11,0.2)' : log.method === 'GET' ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)',
                    color: log.method === 'POST' ? '#f59e0b' : log.method === 'GET' ? '#10b981' : '#818cf8',
                  }}>
                    {log.method || 'GET'}
                  </span>
                  {path || log.url || '—'}
                </div>

                {/* Status */}
                <div style={{ textAlign: 'right' }}>
                  {isSuccess ? (
                    <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                      ✅ {log.status || '200'}
                    </span>
                  ) : log.success === null || log.success === undefined ? (
                    <span className="badge badge-accent animate-pulse" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                      ⏳
                    </span>
                  ) : (
                    <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                      ❌ {log.status || 'ERR'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Realtime User Step Table ──────────────────────────────────
function RealtimeUserStepTable({ config, stepLogs, setStepLogs, testStatus, API, selectedChain }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    let isMounted = true
    if (!testStatus.running) {
      fetch(`${API}/results/students`)
        .then(r => r.json())
        .then(res => {
          if (isMounted && res.success && Array.isArray(res.rawLogs)) {
            // If in Single Request mode, filter out old default multi-step chain logs
            const oldChainStepNames = ['Student Login', 'Get Enrollments', 'Open Selected Class', 'Get Class Tests']
            const filtered = (!selectedChain)
              ? res.rawLogs.filter(l => !oldChainStepNames.includes(l.stepName))
              : res.rawLogs
            setStepLogs(filtered)
          }
        })
        .catch(() => {})
    }
    return () => { isMounted = false }
  }, [API, testStatus.running, setStepLogs, selectedChain])

  // Derive step columns
  const stepColumns = useMemo(() => {
    // Prefer chain steps if a chain is selected
    if (selectedChain?.steps?.length > 0) {
      return selectedChain.steps.map((s, idx) => ({
        id: s.name || `Step ${idx + 1}`,
        name: s.name || `Step ${idx + 1}`,
        method: (s.method || 'GET').toUpperCase(),
        endpoint: s.endpoint || ''
      }))
    }

    // Single Request mode — strictly 1 column
    const method = (config?.method || 'POST').toUpperCase()
    const endpoint = config?.targetEndpoint || '/api'
    return [{
      id: config?.scenarioName || `${method} ${endpoint}`,
      name: config?.scenarioName || `${method} ${endpoint}`,
      method,
      endpoint
    }]
  }, [config, selectedChain])

  // Group by user
  const userMap = useMemo(() => {
    const map = {}
    stepLogs.forEach(log => {
      const userKey = log.student || log.vuId || 'Unknown VU'
      if (!map[userKey]) {
        map[userKey] = {
          student: userKey,
          vuId: log.vuId,
          studentDetails: log.studentDetails || {},
          steps: {},
          totalDurationMs: 0,
          hasFailure: false,
          executedCount: 0,
          lastTimestamp: log.timestamp
        }
      }
      map[userKey].steps[log.stepName] = log
      map[userKey].totalDurationMs += (log.durationMs || 0)
      map[userKey].executedCount++
      if (!log.success) map[userKey].hasFailure = true
      if (log.timestamp > map[userKey].lastTimestamp) map[userKey].lastTimestamp = log.timestamp
    })
    return map
  }, [stepLogs])

  const userList = useMemo(() => {
    let list = Object.values(userMap)
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      list = list.filter(u => u.student.toLowerCase().includes(term) || (u.vuId && u.vuId.toLowerCase().includes(term)))
    }
    if (statusFilter === 'FAILED') list = list.filter(u => u.hasFailure)
    else if (statusFilter === 'SUCCESS') list = list.filter(u => !u.hasFailure && u.executedCount > 0)
    return list
  }, [userMap, searchTerm, statusFilter])

  const totalUsers = Object.keys(userMap).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 className="section-title" style={{ margin: 0 }}>👥 User &amp; Step Execution Matrix</h2>
            {testStatus.running ? (
              <span className="badge badge-success flex items-center gap-1" style={{ fontSize: '0.7rem' }}>
                <span className="status-dot running" style={{ width: 6, height: 6 }} /> LIVE STREAMING
              </span>
            ) : (
              <span className="badge" style={{ fontSize: '0.7rem', background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                IDLE / COMPLETED
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 2 }}>
            Step-by-step user execution times and real-time pass/fail status
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="text"
            className="form-input"
            placeholder="🔍 Search email / VU..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: 210, fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          />
          <select
            className="form-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ width: 'auto', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          >
            <option value="ALL">All Users ({totalUsers})</option>
            <option value="SUCCESS">✅ Passed Only</option>
            <option value="FAILED">❌ Failed Only</option>
          </select>
          <span className="badge badge-accent" style={{ fontSize: '0.75rem' }}>
            {stepLogs.length} step logs
          </span>
        </div>
      </div>

      {userList.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '1.8rem', opacity: 0.3, marginBottom: '0.5rem' }}>⚡</div>
          <div className="empty-desc" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {stepLogs.length === 0
              ? 'No real-time user step executions recorded yet. Click "Start Test" above to begin streaming.'
              : 'No virtual users match your search or filter.'}
          </div>
        </div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.65rem 1rem', textAlign: 'left', minWidth: 200, position: 'sticky', left: 0, background: 'var(--bg-elevated)', zIndex: 2 }}>
                  Virtual User / Student
                </th>
                {stepColumns.map((col, idx) => (
                  <th key={idx} style={{ padding: '0.65rem 1rem', textAlign: 'center', minWidth: 160 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Step {idx + 1}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--accent-light)', fontWeight: 500 }}>
                      <span style={{ fontSize: '0.62rem', padding: '1px 4px', borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginRight: 4 }}>{col.method}</span>
                      {col.endpoint.substring(0, 22)}{col.endpoint.length > 22 ? '…' : ''}
                    </div>
                  </th>
                ))}
                <th style={{ padding: '0.65rem 1rem', textAlign: 'center', minWidth: 130 }}>Total / Status</th>
              </tr>
            </thead>
            <tbody>
              {userList.map((u, rIdx) => {
                const totalSteps = stepColumns.length
                const completedSteps = Object.keys(u.steps).length
                const isComplete = completedSteps >= totalSteps

                return (
                  <tr
                    key={rIdx}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: u.hasFailure ? 'rgba(239, 68, 68, 0.04)' : undefined
                    }}
                  >
                    <td style={{ padding: '0.65rem 1rem', position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>👤</span> {u.student}
                      </div>
                      {u.vuId && (
                        <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {u.vuId.substring(0, 14)}
                        </div>
                      )}
                    </td>

                    {stepColumns.map((col, cIdx) => {
                      const stepData = u.steps[col.name] || u.steps[col.id] || Object.values(u.steps).find(s => {
                        if (s.stepName === col.name || s.stepName === col.id) return true
                        if (!s.url) return false
                        const sPath = extractPath(s.url)
                        if (col.endpoint && sPath.includes(col.endpoint)) return true
                        if (col.endpoint && col.endpoint.includes('{{')) {
                          const pattern = col.endpoint.replace(/\{\{[^}]+\}\}/g, '[^/?#]+')
                          try { return new RegExp(pattern).test(sPath) } catch { return false }
                        }
                        return false
                      })

                      if (stepData) {
                        const resolvedPath = stepData.url ? extractPath(stepData.url) : (stepData.endpoint || col.endpoint)
                        if (stepData.success) {
                          return (
                            <td key={cIdx} style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                              <div>
                                <span
                                  className="badge badge-success"
                                  style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 600 }}
                                  title={`${resolvedPath} — ${stepData.durationMs}ms (HTTP ${stepData.status})`}
                                >
                                  ✅ {stepData.durationMs} ms
                                </span>
                              </div>
                              {resolvedPath && (
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={resolvedPath}>
                                  {resolvedPath}
                                </div>
                              )}
                            </td>
                          )
                        } else {
                          return (
                            <td key={cIdx} style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                              <span
                                className="badge badge-danger"
                                style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 600 }}
                                title={stepData.error || `Failed HTTP ${stepData.status}`}
                              >
                                ❌ Failed {stepData.status ? `(${stepData.status})` : ''}
                              </span>
                            </td>
                          )
                        }
                      } else {
                        return (
                          <td key={cIdx} style={{ padding: '0.65rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                            {testStatus.running && cIdx === completedSteps ? (
                              <span className="badge badge-accent animate-pulse" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                                ⏳ Pending
                              </span>
                            ) : (
                              <span style={{ opacity: 0.4 }}>— Not Executed</span>
                            )}
                          </td>
                        )
                      }
                    })}

                    <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                      <div className="mono" style={{ fontWeight: 700, fontSize: '0.78rem' }}>
                        {u.totalDurationMs} ms
                      </div>
                      <div style={{ marginTop: 2 }}>
                        {u.hasFailure ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>FAILED</span>
                        ) : isComplete ? (
                          <span className="badge badge-success" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>PASSED</span>
                        ) : (
                          <span className="badge" style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'var(--bg-overlay)' }}>IN PROGRESS</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
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
