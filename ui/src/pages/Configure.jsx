import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext.jsx'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function defaultPhases() {
  return [{ duration: 30, arrivalRate: 5, name: 'Quick Test' }]
}

export default function Configure() {
  const { config, saveConfig } = useApp()
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  // Seed form when config loads
  useEffect(() => {
    if (config && !form) {
      setForm({
        appUrl:          config.appUrl || '',
        serverUrl:       config.serverUrl || '',
        hostname:        config.hostname || '',
        targetEndpoint:  config.targetEndpoint || '/api/auth/signin',
        method:          config.method || 'POST',
        body:            typeof config.body === 'object'
                           ? JSON.stringify(config.body, null, 2)
                           : config.body || '',
        httpTimeout:     config.httpTimeout || 30,
        maxSockets:      config.maxSockets || 5000,
        headers:         config.headers || { 'Content-Type': 'application/json' },
        phases:          config.phases || defaultPhases(),
        fieldMapping:    config.fieldMapping || { email: 'email', password: 'password' },
      })
    }
  }, [config, form])

  if (!form) {
    return (
      <div className="page-wrapper">
        <div className="empty-state">
          <div className="empty-icon">⚙️</div>
          <div className="empty-title">Loading configuration…</div>
        </div>
      </div>
    )
  }

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  // ── Headers helpers ───────────────────────────────────
  const headerKeys   = Object.keys(form.headers)
  const headerValues = Object.values(form.headers)

  const setHeader = (i, k, v) => {
    const entries = Object.entries(form.headers)
    entries[i] = [k, v]
    set('headers', Object.fromEntries(entries))
  }

  const addHeader = () => set('headers', { ...form.headers, '': '' })
  const removeHeader = (i) => {
    const entries = Object.entries(form.headers).filter((_, idx) => idx !== i)
    set('headers', Object.fromEntries(entries))
  }

  // ── Phases helpers ────────────────────────────────────
  const setPhase = (i, key, val) => {
    const phases = [...form.phases]
    phases[i] = { ...phases[i], [key]: key === 'name' ? val : Number(val) || undefined }
    if (val === '' || val === undefined) delete phases[i][key]
    set('phases', phases)
  }

  const addPhase = () => set('phases', [...form.phases, { duration: 30, arrivalRate: 5, name: '' }])
  const removePhase = (i) => set('phases', form.phases.filter((_, idx) => idx !== i))

  // ── Save ──────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      let bodyParsed = form.body
      try { bodyParsed = JSON.parse(form.body) } catch {}
      const result = await saveConfig({ ...form, body: bodyParsed })
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(result.error)
      }
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="page-wrapper animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configure</h1>
          <p className="page-subtitle">Set target URLs, request settings, and load phases</p>
        </div>
        <button id="btn-save-config" className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Configuration'}
        </button>
      </div>

      {error && (
        <div className="card card-p mb-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)' }}>
          ❌ {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── URLs Section ───────────────────────────── */}
        <div className="card card-p">
          <h3 className="mb-2" style={{ color: 'var(--text-secondary)' }}>🌐 Environment URLs</h3>
          <div className="grid-3" style={{ gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="input-app-url">App URL (Origin)</label>
              <input id="input-app-url" className="form-input" value={form.appUrl}
                onChange={e => set('appUrl', e.target.value)}
                placeholder="http://localhost:4000" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="input-server-url">Server URL (Target)</label>
              <input id="input-server-url" className="form-input" value={form.serverUrl}
                onChange={e => set('serverUrl', e.target.value)}
                placeholder="http://localhost:5000" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="input-hostname">Hostname</label>
              <input id="input-hostname" className="form-input" value={form.hostname}
                onChange={e => set('hostname', e.target.value)}
                placeholder="localhost:5000" />
            </div>
          </div>
        </div>

        {/* ── Target API ─────────────────────────────── */}
        <div className="card card-p">
          <h3 className="mb-2" style={{ color: 'var(--text-secondary)' }}>🎯 Target API Endpoint</h3>
          <div className="flex gap-1 mb-2" style={{ alignItems: 'flex-end' }}>
            <div className="form-group" style={{ minWidth: 120 }}>
              <label className="form-label" htmlFor="input-method">Method</label>
              <select id="input-method" className="form-select" value={form.method}
                onChange={e => set('method', e.target.value)} style={{ minWidth: 100 }}>
                {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group flex-1">
              <label className="form-label" htmlFor="input-endpoint">Endpoint Path</label>
              <input id="input-endpoint" className="form-input" value={form.targetEndpoint}
                onChange={e => set('targetEndpoint', e.target.value)}
                placeholder="/api/auth/signin" style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          <div className="flex gap-1" style={{ marginBottom: '0.5rem', alignItems: 'center' }}>
            <h4 style={{ color: 'var(--text-secondary)', flex: 1 }}>Custom Headers</h4>
            <button className="btn btn-ghost btn-sm" onClick={addHeader}>+ Add Header</button>
          </div>
          {Object.entries(form.headers).map(([k, v], i) => (
            <div key={i} className="kv-row">
              <input className="form-input" placeholder="Header-Name" value={k}
                onChange={e => setHeader(i, e.target.value, v)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }} />
              <input className="form-input" placeholder="value" value={v}
                onChange={e => setHeader(i, k, e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }} />
              <button className="btn btn-ghost btn-sm" onClick={() => removeHeader(i)}
                style={{ color: 'var(--danger)', minWidth: 32 }}>✕</button>
            </div>
          ))}

          {['POST', 'PUT', 'PATCH'].includes(form.method) && (
            <div className="form-group mt-2">
              <label className="form-label" htmlFor="input-body">
                Request Body (JSON — use <code style={{ color: 'var(--accent-light)' }}>{'{{ varName }}'}</code> for data fields)
              </label>
              <textarea id="input-body" className="form-textarea" value={form.body}
                onChange={e => set('body', e.target.value)} rows={5} />
            </div>
          )}
        </div>

        {/* ── Field Mapping ──────────────────────────── */}
        <div className="card card-p">
          <h3 className="mb-2" style={{ color: 'var(--text-secondary)' }}>🔗 Data Field Mapping</h3>
          <p className="text-sm text-muted mb-2">
            Map template variable names to columns in your uploaded data file.
          </p>
          {Object.entries(form.fieldMapping).map(([varName, colName], i) => (
            <div key={i} className="kv-row">
              <div style={{ position: 'relative' }}>
                <input className="form-input" placeholder="Template var (e.g. email)" value={varName}
                  onChange={e => {
                    const entries = Object.entries(form.fieldMapping).filter(([k]) => k !== varName)
                    entries.splice(i, 0, [e.target.value, colName])
                    set('fieldMapping', Object.fromEntries(entries))
                  }}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', paddingLeft: '1.75rem' }} />
                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-light)', fontSize: '0.75rem' }}>{'{'}</span>
              </div>
              <input className="form-input" placeholder="Column name in data file" value={colName}
                onChange={e => set('fieldMapping', { ...form.fieldMapping, [varName]: e.target.value })}
                style={{ fontSize: '0.82rem' }} />
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const m = { ...form.fieldMapping }
                delete m[varName]
                set('fieldMapping', m)
              }} style={{ color: 'var(--danger)' }}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm mt-1" onClick={() => set('fieldMapping', { ...form.fieldMapping, '': '' })}>
            + Add Field
          </button>
        </div>

        {/* ── HTTP Settings ──────────────────────────── */}
        <div className="card card-p">
          <h3 className="mb-2" style={{ color: 'var(--text-secondary)' }}>⚡ HTTP Engine</h3>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="input-timeout">Request Timeout (seconds)</label>
              <input id="input-timeout" type="number" className="form-input" value={form.httpTimeout}
                onChange={e => set('httpTimeout', Number(e.target.value))} min={5} max={120} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="input-sockets">Max Sockets (concurrent TCP)</label>
              <input id="input-sockets" type="number" className="form-input" value={form.maxSockets}
                onChange={e => set('maxSockets', Number(e.target.value))} min={100} max={50000} step={100} />
            </div>
          </div>
        </div>

        {/* ── Custom Phases ──────────────────────────── */}
        <div className="card card-p">
          <div className="flex items-center justify-between mb-2">
            <h3 style={{ color: 'var(--text-secondary)' }}>🚀 Default Phase Configuration</h3>
            <button className="btn btn-ghost btn-sm" onClick={addPhase}>+ Add Phase</button>
          </div>
          <p className="text-sm text-muted mb-2">
            These phases are used when starting a test from the Dashboard with "Custom" preset.
            Quick/Moderate/Heavy/Stress presets override this.
          </p>

          {form.phases.map((phase, i) => (
            <div key={i} className="phase-row" style={{ marginBottom: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Duration (s)</label>
                <input type="number" className="form-input" value={phase.duration || ''}
                  onChange={e => setPhase(i, 'duration', e.target.value)} min={5} />
              </div>
              <div className="form-group">
                <label className="form-label">Arrival Rate /s</label>
                <input type="number" className="form-input" value={phase.arrivalRate || ''}
                  onChange={e => setPhase(i, 'arrivalRate', e.target.value)} min={1} />
              </div>
              <div className="form-group">
                <label className="form-label">Ramp To /s (opt)</label>
                <input type="number" className="form-input" value={phase.rampTo || ''}
                  onChange={e => setPhase(i, 'rampTo', e.target.value)} min={0}
                  placeholder="—" />
              </div>
              <div className="form-group">
                <label className="form-label">Phase Name</label>
                <input className="form-input" value={phase.name || ''}
                  onChange={e => setPhase(i, 'name', e.target.value)} placeholder="e.g. Warm Up" />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => removePhase(i)}
                style={{ color: 'var(--danger)', alignSelf: 'flex-end' }}>✕</button>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
