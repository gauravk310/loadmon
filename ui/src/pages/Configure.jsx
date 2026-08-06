import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext.jsx'

function defaultPhases() {
  return [{ duration: 30, arrivalRate: 5, name: 'Quick Test' }]
}

export default function Configure() {
  const { config, saveConfig } = useApp()
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  // Add Application Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newAppName, setNewAppName]         = useState('')
  const [newAppUrl, setNewAppUrl]           = useState('')
  const [newServerUrl, setNewServerUrl]     = useState('')
  const [newHostname, setNewHostname]       = useState('')
  const [addError, setAddError]             = useState(null)

  // Seed form when config loads
  useEffect(() => {
    if (config && !form) {
      const defaultApps = [
        {
          id: 'app_default',
          name: 'AssessQ Backend',
          appUrl: config.appUrl || '',
          serverUrl: config.serverUrl || '',
          hostname: config.hostname || ''
        }
      ]
      const applications = (config.applications && config.applications.length > 0)
        ? config.applications
        : defaultApps

      const selectedAppId = (config.selectedAppId && applications.some(a => a.id === config.selectedAppId))
        ? config.selectedAppId
        : applications[0].id

      const activeApp = applications.find(a => a.id === selectedAppId) || applications[0]

      setForm({
        applications,
        selectedAppId,
        appUrl:          activeApp.appUrl || '',
        serverUrl:       activeApp.serverUrl || '',
        hostname:        activeApp.hostname || '',
        scenarioName:    config.scenarioName || 'Single Request Load Test',
        method:          config.method || 'POST',
        targetEndpoint:  config.targetEndpoint || '/api/auth/signin',
        headersText:     typeof config.headers === 'string' ? config.headers : JSON.stringify(config.headers || { 'Content-Type': 'application/json' }, null, 2),
        bodyText:        typeof config.body === 'string' ? config.body : JSON.stringify(config.body || { email: '{{ email }}', password: '{{ password }}' }, null, 2),
        httpTimeout:     config.httpTimeout || 30,
        maxSockets:      config.maxSockets || 5000,
        randomIp:        config.randomIp ?? false,
        phases:          config.phases || defaultPhases(),
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

  // ── Swal Confirmation Helper ───────────────────────────
  const confirmDelete = ({ title, text, onConfirm }) => {
    if (typeof window !== 'undefined' && window.Swal) {
      window.Swal.fire({
        title: title || 'Are you sure?',
        text: text || "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel',
        background: '#161b27',
        color: '#f1f5f9',
        customClass: { popup: 'swal2-dark-popup' }
      }).then((result) => {
        if (result.isConfirmed) onConfirm()
      })
    } else if (window.confirm(`${title}\n${text}`)) {
      onConfirm()
    }
  }

  // ── Application management helpers ─────────────────────
  const handleSelectApp = (appId) => {
    const selectedApp = form.applications.find(a => a.id === appId)
    if (!selectedApp) return
    setForm(f => ({
      ...f,
      selectedAppId: appId,
      appUrl: selectedApp.appUrl || '',
      serverUrl: selectedApp.serverUrl || '',
      hostname: selectedApp.hostname || ''
    }))
  }

  const updateUrlField = (key, val) => {
    setForm(f => {
      const updatedApps = (f.applications || []).map(a =>
        a.id === f.selectedAppId ? { ...a, [key]: val } : a
      )
      return { ...f, [key]: val, applications: updatedApps }
    })
  }

  const handleAddNewApp = (e) => {
    e.preventDefault()
    if (!newAppName.trim()) { setAddError('Application Name is required'); return }

    const newApp = {
      id: `app_${Date.now()}`,
      name: newAppName.trim(),
      appUrl: newAppUrl.trim(),
      serverUrl: newServerUrl.trim(),
      hostname: newHostname.trim()
    }

    setForm(f => ({
      ...f,
      applications: [...(f.applications || []), newApp],
      selectedAppId: newApp.id,
      appUrl: newApp.appUrl,
      serverUrl: newApp.serverUrl,
      hostname: newApp.hostname
    }))

    setIsAddModalOpen(false)
    setNewAppName(''); setNewAppUrl(''); setNewServerUrl(''); setNewHostname(''); setAddError(null)
  }

  const handleDeleteApp = (appId) => {
    if (form.applications.length <= 1) return
    const filtered = form.applications.filter(a => a.id !== appId)
    const nextApp = filtered[0]
    setForm(f => ({
      ...f,
      applications: filtered,
      selectedAppId: nextApp.id,
      appUrl: nextApp.appUrl || '',
      serverUrl: nextApp.serverUrl || '',
      hostname: nextApp.hostname || ''
    }))
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

  // ── Auto-save Random IP toggle ─────────────────────────
  const handleToggleRandomIp = async (checked) => {
    set('randomIp', checked)
    try {
      await saveConfig({ ...prepareSaveData(), randomIp: checked })
    } catch (e) {
      console.error('Failed to save randomIp setting:', e)
    }
  }

  // ── Prepare configuration for saving ──────────────────
  const prepareSaveData = () => {
    let headers = {}
    try { headers = JSON.parse(form.headersText) } catch { headers = form.headersText }
    let body = {}
    try { body = JSON.parse(form.bodyText) } catch { body = form.bodyText }

    return {
      ...form,
      headers,
      body,
      steps: [],
    }
  }

  // ── Save ──────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const saveData = prepareSaveData()
      const result = await saveConfig(saveData)
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
          <h1 className="page-title">Configure Settings</h1>
          <p className="page-subtitle">Manage environment targets, networking settings, and default load phases</p>
        </div>
        <button id="btn-save-config" className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Settings'}
        </button>
      </div>

      {error && (
        <div className="card card-p mb-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)' }}>
          ❌ {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Environment URLs ───────────────────────────── */}
        <div className="card card-p">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 style={{ color: 'var(--text-secondary)' }}>🌐 Environment &amp; Target Applications</h3>
              <p className="text-sm text-muted">Select target application environment or define custom URLs</p>
            </div>
            <button
              type="button"
              id="btn-add-app"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--accent-light)', borderColor: 'var(--border)' }}
              onClick={() => setIsAddModalOpen(true)}
            >
              ➕ Add New Application
            </button>
          </div>

          <div className="form-group mb-3">
            <label className="form-label" htmlFor="select-application">Select Active Application</label>
            <div className="flex gap-2">
              <select
                id="select-application"
                className="form-select flex-1"
                value={form.selectedAppId || ''}
                onChange={e => handleSelectApp(e.target.value)}
                style={{ fontWeight: 600 }}
              >
                {(form.applications || []).map(app => (
                  <option key={app.id} value={app.id}>
                    {app.name} {app.serverUrl ? `(${app.serverUrl})` : ''}
                  </option>
                ))}
              </select>
              {form.applications && form.applications.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--danger)' }}
                  title="Delete current application"
                  onClick={() => {
                    const curApp = form.applications?.find(a => a.id === form.selectedAppId)
                    confirmDelete({
                      title: 'Delete Application?',
                      text: `Are you sure you want to delete application "${curApp?.name || 'this application'}"?`,
                      onConfirm: () => handleDeleteApp(form.selectedAppId)
                    })
                  }}
                >✕</button>
              )}
            </div>
          </div>

          <div className="grid-3" style={{ gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="input-app-url">App Origin URL</label>
              <input id="input-app-url" className="form-input" value={form.appUrl}
                onChange={e => updateUrlField('appUrl', e.target.value)}
                placeholder="http://localhost:4000" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="input-server-url">Target Server URL</label>
              <input id="input-server-url" className="form-input" value={form.serverUrl}
                onChange={e => updateUrlField('serverUrl', e.target.value)}
                placeholder="http://localhost:5000" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="input-hostname">Target Hostname</label>
              <input id="input-hostname" className="form-input" value={form.hostname}
                onChange={e => updateUrlField('hostname', e.target.value)}
                placeholder="localhost:5000" />
            </div>
          </div>
        </div>

        {/* ── Single Request Target Configuration ────────── */}
        <div className="card card-p">
          <h3 className="mb-1" style={{ color: 'var(--text-secondary)' }}>🎯 Default Single Request Configuration</h3>
          <p className="text-sm text-muted mb-3">
            This endpoint request will be executed for all users during load tests when <strong>None (Single Request)</strong> is selected on the Dashboard.
          </p>

          <div className="grid-3 mb-3">
            <div className="form-group">
              <label className="form-label" htmlFor="input-scenario-name">Scenario Name</label>
              <input
                id="input-scenario-name"
                className="form-input"
                value={form.scenarioName || ''}
                onChange={e => set('scenarioName', e.target.value)}
                placeholder="Single Request Load Test"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="select-method">HTTP Method</label>
              <select
                id="select-method"
                className="form-select"
                value={form.method || 'POST'}
                onChange={e => set('method', e.target.value)}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="input-endpoint">Target Endpoint Path</label>
              <input
                id="input-endpoint"
                className="form-input"
                value={form.targetEndpoint || ''}
                onChange={e => set('targetEndpoint', e.target.value)}
                placeholder="/api/auth/signin"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="textarea-headers">Request Headers (JSON)</label>
              <textarea
                id="textarea-headers"
                className="form-input mono"
                rows={5}
                style={{ fontSize: '0.82rem' }}
                value={form.headersText || ''}
                onChange={e => set('headersText', e.target.value)}
                placeholder='{\n  "Content-Type": "application/json"\n}'
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="textarea-body">Request Body (JSON)</label>
              <textarea
                id="textarea-body"
                className="form-input mono"
                rows={5}
                style={{ fontSize: '0.82rem' }}
                value={form.bodyText || ''}
                onChange={e => set('bodyText', e.target.value)}
                placeholder='{\n  "email": "{{ email }}",\n  "password": "{{ password }}"\n}'
              />
            </div>
          </div>
        </div>

        {/* ── HTTP Networking Engine Settings ─────────────── */}
        <div className="card card-p">
          <h3 className="mb-2" style={{ color: 'var(--text-secondary)' }}>⚡ HTTP Engine &amp; Networking</h3>
          <div className="grid-2 mb-3">
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

          <label className="form-switch-row" htmlFor="input-random-ip">
            <div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                🎲 Synthetic Distributed IPs (<code className="mono" style={{ color: 'var(--accent-light)', fontSize: '0.8rem' }}>X-Forwarded-For</code>)
              </div>
              <div className="text-sm text-muted mt-1">
                {form.randomIp
                  ? 'ON — Generates a random IPv4 address header per request step to simulate distributed clients & bypass IP rate limiters.'
                  : 'OFF (Default) — Uses regular host IP without synthetic X-Forwarded-For headers.'}
              </div>
            </div>
            <div className="switch">
              <input
                id="input-random-ip"
                type="checkbox"
                checked={!!form.randomIp}
                onChange={e => handleToggleRandomIp(e.target.checked)}
              />
              <span className="slider" />
            </div>
          </label>
        </div>

        {/* ── Default Phases ──────────────────────────── */}
        <div className="card card-p">
          <div className="flex items-center justify-between mb-2">
            <h3 style={{ color: 'var(--text-secondary)' }}>🚀 Default Phase Configuration</h3>
            <button className="btn btn-ghost btn-sm" onClick={addPhase}>+ Add Phase</button>
          </div>
          <p className="text-sm text-muted mb-2">
            These phases are used when starting a load test with "Default Config" preset on the Dashboard.
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
                  onChange={e => setPhase(i, 'rampTo', e.target.value)} min={0} placeholder="—" />
              </div>
              <div className="form-group">
                <label className="form-label">Phase Name</label>
                <input className="form-input" value={phase.name || ''}
                  onChange={e => setPhase(i, 'name', e.target.value)} placeholder="e.g. Warm Up" />
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const phaseTitle = phase.name ? `"${phase.name}"` : `Phase #${i + 1}`
                  confirmDelete({
                    title: 'Remove Phase?',
                    text: `Are you sure you want to remove ${phaseTitle}?`,
                    onConfirm: () => removePhase(i)
                  })
                }}
                style={{ color: 'var(--danger)', alignSelf: 'flex-end' }}
              >✕</button>
            </div>
          ))}
        </div>

        {/* Info card about chains */}
        <div className="card card-p" style={{ borderColor: 'var(--accent)', background: 'rgba(99,102,241,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>🔗</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--accent-light)', marginBottom: '0.25rem' }}>
                Looking for multi-step API chains?
              </div>
              <div className="text-sm text-muted">
                Chain load testing has been moved to the dedicated <strong style={{ color: 'var(--text-primary)' }}>Chain Builder</strong> page in the sidebar. Build your API chains there with live step testing, variable extraction, and n8n-style variable references.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Add Application Modal ─────────────────────── */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                🚀 Add New Application
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsAddModalOpen(false)}
                style={{ fontSize: '1.1rem' }}
              >✕</button>
            </div>

            {addError && (
              <div className="text-sm" style={{ color: 'var(--danger)', background: 'var(--danger-dim)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>
                ⚠️ {addError}
              </div>
            )}

            <form onSubmit={handleAddNewApp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-app-name">Application Name *</label>
                <input id="new-app-name" className="form-input" value={newAppName}
                  onChange={e => setNewAppName(e.target.value)} placeholder="e.g. AssessQ Backend" autoFocus required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-app-url">App URL (Origin)</label>
                <input id="new-app-url" className="form-input" value={newAppUrl}
                  onChange={e => setNewAppUrl(e.target.value)} placeholder="http://localhost:4000" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-server-url">Server URL (Target)</label>
                <input id="new-server-url" className="form-input" value={newServerUrl}
                  onChange={e => setNewServerUrl(e.target.value)} placeholder="http://localhost:5000" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-hostname">Hostname</label>
                <input id="new-hostname" className="form-input" value={newHostname}
                  onChange={e => setNewHostname(e.target.value)} placeholder="localhost:5000" />
              </div>
              <div className="flex items-center justify-end gap-2 mt-2">
                <button type="button" className="btn btn-ghost" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Application</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
