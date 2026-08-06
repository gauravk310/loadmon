import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext.jsx'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function defaultPhases() {
  return [{ duration: 30, arrivalRate: 5, name: 'Quick Test' }]
}

const STUDENT_FLOW_STEPS = [
  {
    id: 'step_1',
    name: 'Student Login',
    method: 'POST',
    endpoint: '/api/auth/signin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '{{ email }}', password: '{{ password }}' }, null, 2),
    capture: [
      { header: 'set-cookie', as: 'authCookie' },
      { json: '$.user.id', as: 'studentId' }
    ],
    think: 1
  },
  {
    id: 'step_2',
    name: 'Get Enrollments',
    method: 'GET',
    endpoint: '/api/enrollment/get-all/student/{{ studentId }}',
    headers: { Cookie: '{{ authCookie }}' },
    body: '',
    capture: [
      { json: '$[0].classId', as: 'classId' }
    ],
    think: 1
  },
  {
    id: 'step_3',
    name: 'Open Selected Class',
    method: 'GET',
    endpoint: '/api/class/get/{{ classId }}',
    headers: { Cookie: '{{ authCookie }}' },
    body: '',
    capture: [],
    think: 1
  },
  {
    id: 'step_4',
    name: 'Get Class Tests',
    method: 'GET',
    endpoint: '/api/test/get-all/{{ classId }}',
    headers: { Cookie: '{{ authCookie }}' },
    body: '',
    capture: [],
    think: 1
  }
]


export default function Configure() {
  const { config, saveConfig } = useApp()
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)
  const [expandedStepId, setExpandedStepId] = useState(null)

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
          appUrl: config.appUrl || 'http://localhost:4000',
          serverUrl: config.serverUrl || 'http://localhost:5000',
          hostname: config.hostname || 'localhost:5000'
        }
      ]
      const applications = (config.applications && config.applications.length > 0)
        ? config.applications
        : defaultApps

      const selectedAppId = (config.selectedAppId && applications.some(a => a.id === config.selectedAppId))
        ? config.selectedAppId
        : applications[0].id

      const activeApp = applications.find(a => a.id === selectedAppId) || applications[0]

      // Extract or convert steps
      let steps = []
      if (config.steps && Array.isArray(config.steps) && config.steps.length > 0) {
        steps = config.steps.map((s, idx) => ({
          id: s.id || `step_${idx + 1}`,
          name: s.name || `Step ${idx + 1}`,
          method: s.method || 'GET',
          endpoint: s.endpoint || '/api',
          headers: s.headers || {},
          body: typeof s.body === 'object' ? JSON.stringify(s.body, null, 2) : (s.body || ''),
          capture: s.capture || [],
          think: s.think ?? 1
        }))
      } else {
        // Fallback single endpoint to step 1
        steps = [
          {
            id: 'step_1',
            name: 'Target Endpoint',
            method: config.method || 'POST',
            endpoint: config.targetEndpoint || '/api/auth/signin',
            headers: config.headers || { 'Content-Type': 'application/json' },
            body: typeof config.body === 'object' ? JSON.stringify(config.body, null, 2) : (config.body || ''),
            capture: [],
            think: 1
          }
        ]
      }

      setForm({
        applications,
        selectedAppId,
        appUrl:          activeApp.appUrl || '',
        serverUrl:       activeApp.serverUrl || '',
        hostname:        activeApp.hostname || '',
        scenarioName:    config.scenarioName || 'Student Test Access Flow',
        steps,
        httpTimeout:     config.httpTimeout || 30,
        maxSockets:      config.maxSockets || 5000,
        randomIp:        config.randomIp ?? false,
        phases:          config.phases || defaultPhases(),
      })

      setExpandedStepId(steps[0]?.id || null)
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
        customClass: {
          popup: 'swal2-dark-popup'
        }
      }).then((result) => {
        if (result.isConfirmed) {
          onConfirm()
        }
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
      return {
        ...f,
        [key]: val,
        applications: updatedApps
      }
    })
  }

  const handleAddNewApp = (e) => {
    e.preventDefault()
    if (!newAppName.trim()) {
      setAddError('Application Name is required')
      return
    }

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
    setNewAppName('')
    setNewAppUrl('')
    setNewServerUrl('')
    setNewHostname('')
    setAddError(null)
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

  // ── Step Chain Helpers ─────────────────────────────────
  const updateStep = (index, field, value) => {
    setForm(f => {
      const updatedSteps = [...f.steps]
      updatedSteps[index] = { ...updatedSteps[index], [field]: value }
      return { ...f, steps: updatedSteps }
    })
  }

  const moveStep = (index, direction) => {
    const targetIdx = index + direction
    if (targetIdx < 0 || targetIdx >= form.steps.length) return
    setForm(f => {
      const newSteps = [...f.steps]
      const temp = newSteps[index]
      newSteps[index] = newSteps[targetIdx]
      newSteps[targetIdx] = temp
      return { ...f, steps: newSteps }
    })
  }

  const addStep = () => {
    const newStep = {
      id: `step_${Date.now()}`,
      name: `Step ${form.steps.length + 1}`,
      method: 'GET',
      endpoint: '/api/resource',
      headers: {},
      body: '',
      capture: [],
      think: 1
    }
    setForm(f => ({ ...f, steps: [...f.steps, newStep] }))
    setExpandedStepId(newStep.id)
  }

  const duplicateStep = (index) => {
    const src = form.steps[index]
    const dupStep = {
      ...JSON.parse(JSON.stringify(src)),
      id: `step_${Date.now()}`,
      name: `${src.name} (Copy)`
    }
    setForm(f => {
      const newSteps = [...f.steps]
      newSteps.splice(index + 1, 0, dupStep)
      return { ...f, steps: newSteps }
    })
    setExpandedStepId(dupStep.id)
  }

  const removeStep = (index) => {
    if (form.steps.length <= 1) return
    confirmDelete({
      title: 'Delete Step?',
      text: `Are you sure you want to remove Step ${index + 1} ("${form.steps[index]?.name}")?`,
      onConfirm: () => {
        setForm(f => {
          const filtered = f.steps.filter((_, idx) => idx !== index)
          return { ...f, steps: filtered }
        })
      }
    })
  }

  const loadStudentFlowPreset = () => {
    confirmDelete({
      title: 'Load Student Flow Preset?',
      text: 'This will replace your current steps with the 3-step Student User Flow (Login -> Enrollments -> Tests).',
      onConfirm: () => {
        setForm(f => ({
          ...f,
          scenarioName: 'Student Test Access Flow',
          steps: STUDENT_FLOW_STEPS.map(s => ({ ...s, id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 6)}` }))
        }))
        setExpandedStepId(null)
      }
    })
  }

  // ── Step Headers & Capture Helpers ────────────────────
  const setStepHeader = (stepIdx, headerIdx, key, val) => {
    const step = form.steps[stepIdx]
    const entries = Object.entries(step.headers || {})
    entries[headerIdx] = [key, val]
    updateStep(stepIdx, 'headers', Object.fromEntries(entries))
  }

  const addStepHeader = (stepIdx) => {
    const step = form.steps[stepIdx]
    updateStep(stepIdx, 'headers', { ...(step.headers || {}), '': '' })
  }

  const removeStepHeader = (stepIdx, headerIdx) => {
    const step = form.steps[stepIdx]
    const entries = Object.entries(step.headers || {}).filter((_, idx) => idx !== headerIdx)
    updateStep(stepIdx, 'headers', Object.fromEntries(entries))
  }

  const addCaptureRule = (stepIdx) => {
    const step = form.steps[stepIdx]
    const capture = [...(step.capture || []), { json: '$.data.id', as: 'newVar' }]
    updateStep(stepIdx, 'capture', capture)
  }

  const updateCaptureRule = (stepIdx, capIdx, field, val) => {
    const step = form.steps[stepIdx]
    const capture = [...(step.capture || [])]
    const cur = capture[capIdx] || {}

    if (field === 'type') {
      if (val === 'json') {
        capture[capIdx] = { json: cur.header || '$.token', as: cur.as || 'token' }
      } else {
        capture[capIdx] = { header: cur.json || 'Authorization', as: cur.as || 'token' }
      }
    } else {
      capture[capIdx] = { ...cur, [field]: val }
    }
    updateStep(stepIdx, 'capture', capture)
  }

  const removeCaptureRule = (stepIdx, capIdx) => {
    const step = form.steps[stepIdx]
    const capture = (step.capture || []).filter((_, idx) => idx !== capIdx)
    updateStep(stepIdx, 'capture', capture)
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
    const cleanSteps = form.steps.map(s => {
      let bodyParsed = s.body
      if (typeof s.body === 'string' && s.body.trim()) {
        try { bodyParsed = JSON.parse(s.body) } catch {}
      }
      return {
        ...s,
        body: bodyParsed
      }
    })

    const firstStep = cleanSteps[0] || {}

    return {
      ...form,
      steps: cleanSteps,
      // Backward compatibility top-level properties
      targetEndpoint: firstStep.endpoint || '/api',
      method: firstStep.method || 'GET',
      body: firstStep.body || {},
      headers: firstStep.headers || {}
    }
  }

  // ── Save ──────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
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
          <h1 className="page-title">Configure Scenario</h1>
          <p className="page-subtitle">Build sequential multi-step API chains, dynamic variable captures, and load phases</p>
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
                >
                  ✕
                </button>
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

        {/* ── Multi-Step Chain Builder ────────────────────── */}
        <div className="card card-p">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 style={{ color: 'var(--text-secondary)' }}>🔗 Visual Chain Builder</h3>
              <p className="text-sm text-muted">Configure sequential request steps with variable extraction &amp; per-VU context</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--cyan)' }}
                onClick={loadStudentFlowPreset}
              >
                🎓 Load Student Flow Preset
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={addStep}
              >
                ➕ Add Step
              </button>
            </div>
          </div>

          <div className="form-group mb-3">
            <label className="form-label" htmlFor="input-scenario-name">Scenario Name</label>
            <input
              id="input-scenario-name"
              className="form-input"
              value={form.scenarioName || ''}
              onChange={e => set('scenarioName', e.target.value)}
              placeholder="e.g. Student Test Access Flow"
              style={{ fontWeight: 600, fontSize: '0.95rem' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {form.steps.map((step, idx) => {
              const isExpanded = expandedStepId === step.id
              const methodClass = `method-${step.method.toLowerCase()}`

              return (
                <div key={step.id} className={`step-card ${isExpanded ? 'expanded active-step' : ''}`}>
                  {/* Step Header Bar */}
                  <div
                    className="step-header"
                    onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                  >
                    <div className="step-title-group">
                      <span className="step-num">Step {idx + 1}</span>
                      <span className={`method-badge ${methodClass}`}>{step.method}</span>
                      <span className="step-endpoint-preview">{step.endpoint}</span>
                      <span className="step-name-preview">— {step.name}</span>
                    </div>

                    <div className="step-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={idx === 0}
                        onClick={() => moveStep(idx, -1)}
                        title="Move Up"
                      >
                        ⬆
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={idx === form.steps.length - 1}
                        onClick={() => moveStep(idx, 1)}
                        title="Move Down"
                      >
                        ⬇
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => duplicateStep(idx)}
                        title="Duplicate Step"
                      >
                        📋
                      </button>
                      {form.steps.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => removeStep(idx)}
                          title="Delete Step"
                        >
                          ✕
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>

                  {/* Step Form Body */}
                  {isExpanded && (
                    <div className="step-body-content">
                      <div className="grid-2" style={{ gap: '1rem' }}>
                        <div className="form-group">
                          <label className="form-label">Step Name</label>
                          <input
                            className="form-input"
                            value={step.name}
                            onChange={e => updateStep(idx, 'name', e.target.value)}
                            placeholder="e.g. Student Login"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Think Time (Seconds delay after request)</label>
                          <input
                            type="number"
                            className="form-input"
                            value={step.think ?? 1}
                            onChange={e => updateStep(idx, 'think', Number(e.target.value))}
                            min={0}
                            max={60}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2" style={{ alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ minWidth: 130 }}>
                          <label className="form-label">Method</label>
                          <select
                            className="form-select"
                            value={step.method}
                            onChange={e => updateStep(idx, 'method', e.target.value)}
                          >
                            {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="form-group flex-1">
                          <label className="form-label">Endpoint Path (supports <code style={{ color: 'var(--accent-light)' }}>{'{{ varName }}'}</code>)</label>
                          <input
                            className="form-input"
                            value={step.endpoint}
                            onChange={e => updateStep(idx, 'endpoint', e.target.value)}
                            placeholder="/api/enrollments/{{ enrollmentId }}/tests"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                      </div>

                      {/* Step Headers */}
                      <div>
                        <div className="flex gap-1 mb-2" style={{ alignItems: 'center' }}>
                          <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flex: 1 }}>Step Headers</h4>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => addStepHeader(idx)}
                          >
                            + Add Header
                          </button>
                        </div>
                        {Object.entries(step.headers || {}).map(([k, v], hIdx) => (
                          <div key={hIdx} className="kv-row mb-1">
                            <input
                              className="form-input"
                              placeholder="Header-Name"
                              value={k}
                              onChange={e => setStepHeader(idx, hIdx, e.target.value, v)}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                            />
                            <input
                              className="form-input"
                              placeholder="Header Value (e.g. Bearer {{ authToken }})"
                              value={v}
                              onChange={e => setStepHeader(idx, hIdx, k, e.target.value)}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => removeStepHeader(idx, hIdx)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Step Body (JSON) */}
                      {['POST', 'PUT', 'PATCH'].includes(step.method) && (
                        <div className="form-group">
                          <label className="form-label">
                            JSON Body Payload (supports <code style={{ color: 'var(--accent-light)' }}>{'{{ varName }}'}</code>)
                          </label>
                          <textarea
                            className="form-textarea"
                            value={step.body}
                            onChange={e => updateStep(idx, 'body', e.target.value)}
                            rows={4}
                            placeholder={'{\n  "email": "{{ email }}",\n  "password": "{{ password }}"\n}'}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                          />
                        </div>
                      )}

                      {/* Response Variable Capture Panel */}
                      <div className="capture-section">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 600 }}>
                              📥 Response Variable Extraction (<code className="mono" style={{ color: 'var(--cyan)' }}>capture</code>)
                            </h4>
                            <p className="text-xs text-muted">Extract JSON response values or headers to variables for subsequent steps</p>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--cyan)', borderColor: 'var(--border)' }}
                            onClick={() => addCaptureRule(idx)}
                          >
                            + Add Variable Capture
                          </button>
                        </div>

                        {(step.capture || []).length === 0 ? (
                          <div className="text-xs text-muted" style={{ fontStyle: 'italic', padding: '0.25rem 0' }}>
                            No variables captured in this step.
                          </div>
                        ) : (
                          (step.capture || []).map((cRule, cIdx) => {
                            const isHeader = !!cRule.header
                            return (
                              <div key={cIdx} className="capture-row">
                                <select
                                  className="form-select"
                                  value={isHeader ? 'header' : 'json'}
                                  onChange={e => updateCaptureRule(idx, cIdx, 'type', e.target.value)}
                                  style={{ fontSize: '0.78rem' }}
                                >
                                  <option value="json">JSON Path</option>
                                  <option value="header">Header</option>
                                </select>

                                <input
                                  className="form-input"
                                  placeholder={isHeader ? 'Set-Cookie' : '$.token'}
                                  value={isHeader ? (cRule.header || '') : (cRule.json || '')}
                                  onChange={e => updateCaptureRule(idx, cIdx, isHeader ? 'header' : 'json', e.target.value)}
                                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                                />

                                <div className="flex items-center gap-1">
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>as</span>
                                  <input
                                    className="form-input"
                                    placeholder="varName (e.g. authToken)"
                                    value={cRule.as || ''}
                                    onChange={e => updateCaptureRule(idx, cIdx, 'as', e.target.value)}
                                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                                  />
                                </div>

                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ color: 'var(--danger)' }}
                                  onClick={() => removeCaptureRule(idx, cIdx)}
                                >
                                  ✕
                                </button>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
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

        {/* ── Custom Phases ──────────────────────────── */}
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
                  onChange={e => setPhase(i, 'rampTo', e.target.value)} min={0}
                  placeholder="—" />
              </div>
              <div className="form-group">
                <label className="form-label">Phase Name</label>
                <input className="form-input" value={phase.name || ''}
                  onChange={e => setPhase(i, 'name', e.target.value)} placeholder="e.g. Warm Up" />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const phaseTitle = phase.name ? `"${phase.name}"` : `Phase #${i + 1}`
                confirmDelete({
                  title: 'Remove Phase?',
                  text: `Are you sure you want to remove ${phaseTitle}?`,
                  onConfirm: () => removePhase(i)
                })
              }}
                style={{ color: 'var(--danger)', alignSelf: 'flex-end' }}>✕</button>
            </div>
          ))}
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
              >
                ✕
              </button>
            </div>

            {addError && (
              <div className="text-sm" style={{ color: 'var(--danger)', background: 'var(--danger-dim)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>
                ⚠️ {addError}
              </div>
            )}

            <form onSubmit={handleAddNewApp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-app-name">Application Name *</label>
                <input
                  id="new-app-name"
                  className="form-input"
                  value={newAppName}
                  onChange={e => setNewAppName(e.target.value)}
                  placeholder="e.g. AssessQ Backend"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-app-url">App URL (Origin)</label>
                <input
                  id="new-app-url"
                  className="form-input"
                  value={newAppUrl}
                  onChange={e => setNewAppUrl(e.target.value)}
                  placeholder="http://localhost:4000"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-server-url">Server URL (Target)</label>
                <input
                  id="new-server-url"
                  className="form-input"
                  value={newServerUrl}
                  onChange={e => setNewServerUrl(e.target.value)}
                  placeholder="http://localhost:5000"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-hostname">Hostname</label>
                <input
                  id="new-hostname"
                  className="form-input"
                  value={newHostname}
                  onChange={e => setNewHostname(e.target.value)}
                  placeholder="localhost:5000"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

