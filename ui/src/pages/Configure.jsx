import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { SmartInput, SmartTextarea, FormDataEditor } from '../components/SmartInputs.jsx'

function defaultBaseSteps() {
  return [
    {
      id: 'step_1',
      name: 'Sign In',
      method: 'POST',
      endpoint: '/api/auth/signin',
      headersText: '{\n  "Content-Type": "application/json"\n}',
      bodyType: 'json',
      formDataParams: [{ id: 'fd_1', key: '', type: 'text', value: '', files: [], enabled: true }],
      bodyText: '{\n  "email": "{{ email }}",\n  "password": "{{ password }}"\n}',
      think: 1
    },
    {
      id: 'step_2',
      name: 'Get Class',
      method: 'GET',
      endpoint: '/api/class/list',
      headersText: '',
      bodyType: 'json',
      formDataParams: [{ id: 'fd_2', key: '', type: 'text', value: '', files: [], enabled: true }],
      bodyText: '',
      think: 1
    }
  ]
}

function defaultPhases() {
  return [{ duration: 30, arrivalRate: 5, name: 'Quick Test' }]
}

export default function Configure() {
  const { config, saveConfig, baseStatus, runBaseConfig, API } = useApp()
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  const [runningBase, setRunningBase]     = useState(false)
  const [baseRunResult, setBaseRunResult] = useState(null)
  const [baseProgress, setBaseProgress]   = useState(null)


  // Add Application Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newAppName, setNewAppName]         = useState('')
  const [newAppUrl, setNewAppUrl]           = useState('')
  const [newServerUrl, setNewServerUrl]     = useState('')
  const [newHostname, setNewHostname]       = useState('')
  const [addError, setAddError]             = useState(null)

function cleanVarKey(key) {
  if (typeof key !== 'string') return key
  return key.replace(/^\[\d+\]\./, '').replace(/\[\d+\]/g, '')
}

function resolveEndpointPreview(endpointStr, stepResponses) {
  if (!endpointStr || typeof endpointStr !== 'string') return ''
  if (!endpointStr.includes('{{')) return endpointStr

  const ctx = {
    'user.id': '6a7226d7b003b9c339ea7ad2',
    'user_id': '6a7226d7b003b9c339ea7ad2',
    'id': '6a7226d7b003b9c339ea7ad2',
    'email': 'student0001@example.com'
  }

  if (Array.isArray(stepResponses)) {
    stepResponses.forEach(sr => {
      if (sr && sr.responseJson) {
        const item = Array.isArray(sr.responseJson) && sr.responseJson.length > 0
          ? sr.responseJson[0]
          : sr.responseJson
        if (item && typeof item === 'object') {
          Object.entries(item).forEach(([k, v]) => {
            if (v !== undefined && v !== null && typeof v !== 'object') {
              const cleanK = cleanVarKey(k)
              ctx[cleanK] = v
              ctx[k] = v
              ctx[`[0].${cleanK}`] = v
              ctx[`[0].${k}`] = v
            }
          })
          if (item._id) {
            if (!item.testId && (item.testName || item.onlineExamQuestions)) {
              if (!ctx['testId']) ctx['testId'] = item._id
              if (!ctx['test_id']) ctx['test_id'] = item._id
            }
            if (!item.classId && (item.className || item.instructorId)) {
              if (!ctx['classId']) ctx['classId'] = item._id
              if (!ctx['class_id']) ctx['class_id'] = item._id
            }
          }
        }
      }
    })
  }

  return endpointStr.replace(/\{\{\s*([\w.\[\]]+)\s*\}\}/g, (match, key) => {
    if (ctx[key] !== undefined && ctx[key] !== null) return ctx[key]
    const cleanKey = cleanVarKey(key)
    if (ctx[cleanKey] !== undefined && ctx[cleanKey] !== null) return ctx[cleanKey]
    const lastSeg = cleanKey.split('.').pop()
    if (lastSeg && ctx[lastSeg] !== undefined && ctx[lastSeg] !== null) return ctx[lastSeg]
    return match
  })
}

  const stepSavedGroups = useMemo(() => {
    const raw = baseRunResult?.baseStepSavedKeys || baseStatus?.baseStepSavedKeys || config?.baseStepSavedKeys
    if (!Array.isArray(raw)) return []
    return raw.map(grp => {
      if (!grp || typeof grp !== 'object') return grp
      const cleanKeys = Array.from(new Set((grp.keys || []).map(cleanVarKey).filter(Boolean)))
      return { ...grp, keys: cleanKeys }
    })
  }, [baseRunResult?.baseStepSavedKeys, baseStatus?.baseStepSavedKeys, config?.baseStepSavedKeys])

  const stepResponses = useMemo(() => {
    const raw = baseRunResult?.baseStepResponses || baseStatus?.baseStepResponses || config?.baseStepResponses
    return Array.isArray(raw) ? raw : []
  }, [baseRunResult?.baseStepResponses, baseStatus?.baseStepResponses, config?.baseStepResponses])

  const allVarSuggestions = useMemo(() => {
    const defaultKeys = [
      '_id', 'id', 'email', 'password', 'token', 'access_token', 'authorization',
      'authCookie', 'user.id', 'user_id', 'userId', 'studentId', 'classId', 'testId'
    ]
    const serverKeys = (Array.isArray(baseStatus?.baseSavedKeys)
      ? baseStatus.baseSavedKeys
      : Array.isArray(config?.baseSavedKeys)
        ? config.baseSavedKeys
        : []).map(cleanVarKey)

    const suggestions = []
    const seenStepKeyCombo = new Set()

    if (Array.isArray(stepSavedGroups) && stepSavedGroups.length > 0) {
      stepSavedGroups.forEach((grp, idx) => {
        if (!grp || typeof grp !== 'object') return
        const sNum = grp.stepIndex || (idx + 1)
        const sName = String(grp.stepName || `Step ${sNum}`)
        const sLabel = `Step ${sNum}: ${sName}`
        const keysArr = Array.isArray(grp.keys) ? grp.keys : []
        keysArr.forEach(k => {
          if (k) {
            const kStr = cleanVarKey(String(k))
            const combo = `${sNum}:${kStr}`
            if (!seenStepKeyCombo.has(combo)) {
              seenStepKeyCombo.add(combo)
              suggestions.push({
                key: kStr,
                isAuth: /token|cookie|auth/i.test(kStr),
                stepNum: sNum,
                stepName: sName,
                stepLabel: sLabel
              })
            }
          }
        })
      })
    }

    const allKnownKeys = Array.from(new Set([...defaultKeys, ...serverKeys].map(cleanVarKey)))
    allKnownKeys.forEach(kStr => {
      if (!kStr) return
      const hasKeyInSteps = suggestions.some(s => s.key === kStr)
      if (!hasKeyInSteps) {
        suggestions.push({
          key: kStr,
          isAuth: /token|cookie|auth/i.test(kStr),
          stepNum: 0,
          stepName: 'User Credential / Variable',
          stepLabel: 'User Credential / Variable'
        })
      }
    })

    return suggestions
  }, [stepSavedGroups, baseStatus?.baseSavedKeys, config?.baseSavedKeys])

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
        bodyType:        config.bodyType || 'json',
        formDataParams:  config.formDataParams || [{ id: 'fd_cfg_1', key: '', type: 'text', value: '', files: [], enabled: true }],
        bodyText:        typeof config.body === 'string' ? config.body : JSON.stringify(config.body || { email: '{{ email }}', password: '{{ password }}' }, null, 2),
        httpTimeout:     config.httpTimeout || 30,
        maxSockets:      config.maxSockets || 5000,
        randomIp:        config.randomIp ?? false,
        arrivalMode:     config.arrivalMode || 'arrivalRate',
        phases:          config.phases || defaultPhases(),
        useBaseConfig:   config.useBaseConfig ?? false,
        baseNumUsers:    config.baseNumUsers || 10,
        baseArrivalRate: config.baseArrivalRate || 10,
        baseSteps:       (config.baseSteps && config.baseSteps.length > 0)
          ? config.baseSteps.map((s, idx) => ({
              id: s.id || `base_step_${idx}`,
              name: s.name || `Step ${idx + 1}`,
              method: s.method || 'GET',
              endpoint: s.endpoint || '/api/',
              headersText: typeof s.headers === 'string' ? s.headers : JSON.stringify(s.headers || {}, null, 2),
              bodyType: s.bodyType || 'json',
              formDataParams: s.formDataParams || [{ id: `fd_${idx}_1`, key: '', type: 'text', value: '', files: [], enabled: true }],
              bodyText: typeof s.body === 'string' ? s.body : (s.body ? JSON.stringify(s.body, null, 2) : ''),
              think: s.think ?? 1
            }))
          : defaultBaseSteps(),
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

  const handleToggleArrivalMode = (mode) => {
    setForm(f => {
      const updatedPhases = (f.phases || []).map(p => {
        if (mode === 'arrivalCount') {
          const countVal = p.arrivalCount || (p.arrivalRate ? p.arrivalRate * (p.duration || 30) : 50)
          const copy = { ...p, arrivalCount: countVal }
          delete copy.arrivalRate
          return copy
        } else {
          const rateVal = p.arrivalRate || (p.arrivalCount ? Math.max(1, Math.round(p.arrivalCount / (p.duration || 30))) : 5)
          const copy = { ...p, arrivalRate: rateVal }
          delete copy.arrivalCount
          return copy
        }
      })
      return { ...f, arrivalMode: mode, phases: updatedPhases }
    })
  }

  const addPhase = () => {
    const isCount = form?.arrivalMode === 'arrivalCount'
    const newPhase = isCount
      ? { duration: 30, arrivalCount: 50, name: '' }
      : { duration: 30, arrivalRate: 5, name: '' }
    set('phases', [...form.phases, newPhase])
  }
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

  const addBaseStep = () => {
    const idx = (form.baseSteps || []).length
    const nStep = {
      id: `base_step_${Date.now()}_${idx}`,
      name: `Step ${idx + 1}`,
      method: idx === 0 ? 'POST' : 'GET',
      endpoint: '/api/',
      headersText: idx === 0 ? '{\n  "Content-Type": "application/json"\n}' : '',
      bodyText: '',
      think: 1
    }
    set('baseSteps', [...(form.baseSteps || []), nStep])
  }

  const updateBaseStep = (index, field, val) => {
    const steps = [...(form.baseSteps || [])]
    steps[index] = { ...steps[index], [field]: val }
    set('baseSteps', steps)
  }

  const removeBaseStep = (index) => {
    set('baseSteps', (form.baseSteps || []).filter((_, i) => i !== index))
  }

  const handleRunBaseConfig = async () => {
    const totalU = Number(form.baseNumUsers) || 10
    const arrR = Number(form.baseArrivalRate) || 10
    setRunningBase(true)
    setBaseRunResult(null)
    setError(null)
    setBaseProgress({
      running: true,
      totalUsers: totalU,
      completedUsers: 0,
      successCount: 0,
      failedCount: 0,
      percent: 0,
      currentStep: 'Starting pre-authentication...'
    })

    const preparedBaseSteps = (form.baseSteps || []).map(s => {
      let h = {}
      try { h = JSON.parse(s.headersText || '{}') } catch { h = s.headersText }
      let b = null
      if (['POST', 'PUT', 'PATCH'].includes((s.method || 'GET').toUpperCase()) && s.bodyText) {
        try { b = JSON.parse(s.bodyText) } catch { b = s.bodyText }
      }
      return {
        id: s.id,
        name: s.name,
        method: s.method,
        endpoint: s.endpoint,
        headers: h,
        headersText: s.headersText,
        bodyType: s.bodyType || 'json',
        formDataParams: s.formDataParams || [],
        body: b,
        bodyText: s.bodyText,
        think: s.think
      }
    })

    const pollInterval = setInterval(async () => {
      try {
        const pRes = await fetch(`${API}/config/base-progress`)
        const pData = await pRes.json()
        if (pData.success && pData.progress) {
          setBaseProgress(pData.progress)
        }
      } catch {}
    }, 200)

    try {
      const res = await runBaseConfig({
        baseNumUsers: totalU,
        baseArrivalRate: arrR,
        baseSteps: preparedBaseSteps
      })
      setBaseRunResult(res)
    } catch (e) {
      setBaseRunResult({ success: false, error: e.message })
    } finally {
      clearInterval(pollInterval)
      setRunningBase(false)
    }
  }

  // ── Prepare configuration for saving ──────────────────
  const prepareSaveData = () => {
    let headers = {}
    try { headers = JSON.parse(form.headersText) } catch { headers = form.headersText }
    let body = {}
    try { body = JSON.parse(form.bodyText) } catch { body = form.bodyText }

    const preparedBaseSteps = (form.baseSteps || []).map(s => {
      let h = {}
      try { h = JSON.parse(s.headersText || '{}') } catch { h = s.headersText }
      let b = null
      if (['POST', 'PUT', 'PATCH'].includes((s.method || 'GET').toUpperCase()) && s.bodyText) {
        try { b = JSON.parse(s.bodyText) } catch { b = s.bodyText }
      }
      return {
        id: s.id,
        name: s.name,
        method: s.method,
        endpoint: s.endpoint,
        headers: h,
        headersText: s.headersText,
        bodyType: s.bodyType || 'json',
        formDataParams: s.formDataParams || [],
        body: b,
        bodyText: s.bodyText,
        think: s.think
      }
    })


    return {
      ...form,
      headers,
      body,
      baseSteps: preparedBaseSteps,
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

        {/* ── Base API Configuration Chain ───────────────── */}
        <div className="card card-p" style={{ borderColor: 'var(--accent-glow)', background: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div>
              <h3 style={{ color: 'var(--accent-light)' }}>🔗 Base API Configuration Chain</h3>
              <p className="text-sm text-muted">
                Define prerequisite API steps (Sign In, Get Class ID, Get Test ID) to pre-authenticate multiple users and save response variables for load testing.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--accent-light)', borderColor: 'var(--border)' }}
              onClick={addBaseStep}
            >
              ➕ Add Step
            </button>
          </div>

          {/* Top of Card: Save Number of Users & Arrival Rate */}
          <div className="card card-p mb-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="form-group mb-0" style={{ flex: 1, minWidth: '180px' }}>
                <label className="form-label" htmlFor="input-base-num-users" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  👥 Save Number of Users
                </label>
                <input
                  id="input-base-num-users"
                  type="number"
                  className="form-input"
                  min={1}
                  max={100000}
                  value={form.baseNumUsers || 10}
                  onChange={e => set('baseNumUsers', Math.max(1, Number(e.target.value) || 1))}
                  placeholder="e.g. 10"
                />
                <span className="text-sm text-muted">Number of user accounts to run through the Base API chain.</span>
              </div>

              <div className="form-group mb-0" style={{ flex: 1, minWidth: '180px' }}>
                <label className="form-label" htmlFor="input-base-arrival-rate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  ⚡ Arrival Rate (/s)
                </label>
                <input
                  id="input-base-arrival-rate"
                  type="number"
                  className="form-input"
                  min={1}
                  max={100000}
                  value={form.baseArrivalRate || 10}
                  onChange={e => set('baseArrivalRate', Math.max(1, Number(e.target.value) || 1))}
                  placeholder="e.g. 10"
                />
                <span className="text-sm text-muted">Authentications per second for Base API chain.</span>
              </div>

              <div className="flex items-center gap-2" style={{ alignSelf: 'flex-end', marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRunBaseConfig}
                  disabled={runningBase || !(form.baseSteps && form.baseSteps.length > 0)}
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  {runningBase ? `⏳ Running for ${form.baseNumUsers} Users (${form.baseArrivalRate || 10}/s)…` : `⚡ Run & Save Data for ${form.baseNumUsers} Users (${form.baseArrivalRate || 10}/s)`}
                </button>
              </div>
            </div>

            {/* Live Progress Loader when running */}
            {runningBase && (
              <div className="mt-3 p-4 rounded-lg animate-fade-in" style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))',
                border: '1px solid rgba(139,92,246,0.4)',
                boxShadow: '0 4px 20px rgba(99,102,241,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem'
              }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="spin text-lg" style={{ display: 'inline-block' }}>⚡</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                      Authenticating Users ({baseProgress?.completedUsers || 0} / {form.baseNumUsers} Users)
                    </span>
                  </div>
                  <div style={{ fontWeight: 800, color: '#a78bfa', fontSize: '1.05rem', fontFamily: 'var(--font-mono)' }}>
                    {baseProgress?.percent || 0}%
                  </div>
                </div>

                {/* Animated Progress Bar */}
                <div style={{
                  width: '100%',
                  height: '10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <div style={{
                    width: `${Math.min(100, Math.max(0, baseProgress?.percent || 0))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899)',
                    borderRadius: '6px',
                    transition: 'width 0.2s ease-out',
                    boxShadow: '0 0 12px rgba(139, 92, 246, 0.6)'
                  }} />
                </div>

                <div className="flex items-center justify-between text-xs text-muted" style={{ fontWeight: 500 }}>
                  <span>
                    Running {form.baseSteps?.length || 0} base chain steps @ {form.baseArrivalRate || 10} arrivals/s
                  </span>
                  <span>
                    <span style={{ color: 'var(--success)', fontWeight: 700 }}>✅ {baseProgress?.successCount || 0} Passed</span>
                    {(baseProgress?.failedCount || 0) > 0 && (
                      <span style={{ color: 'var(--danger)', fontWeight: 700, marginLeft: '0.6rem' }}>❌ {baseProgress.failedCount} Failed</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Prepared Status Summary */}
            {baseStatus?.preparedCount > 0 && (
              <div className="mt-3 p-3 rounded" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.9rem' }}>
                    ✅ {baseStatus.preparedCount} User Sessions Authenticated &amp; Saved
                    {baseStatus.preparedAt && <span className="text-muted" style={{ fontSize: '0.78rem', marginLeft: '0.5rem', fontWeight: 400 }}>({new Date(baseStatus.preparedAt).toLocaleTimeString()})</span>}
                  </div>
                  {Array.isArray(stepSavedGroups) && stepSavedGroups.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <span className="text-sm text-muted" style={{ fontWeight: 600 }}>Available Variables (Grouped by Step):</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {stepSavedGroups.map((grp, gIdx) => (
                          <div key={gIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px' }}>
                            <span className="text-xs font-semibold" style={{ color: 'var(--cyan)', minWidth: '160px' }}>
                              Step {grp?.stepIndex || (gIdx + 1)} ({String(grp?.stepName || `Step ${gIdx + 1}`)}):
                            </span>
                            {Array.isArray(grp?.keys) && grp.keys.length > 0 ? (
                              grp.keys.map((k, i) => (
                                <span key={i} className="badge badge-accent mono" style={{ fontSize: '0.72rem' }}>
                                  {`{{${k}}}`}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-muted">No variables captured</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : Array.isArray(baseStatus?.baseSavedKeys) && baseStatus.baseSavedKeys.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span className="text-sm text-muted" style={{ fontWeight: 600 }}>Available Variables:</span>
                      {baseStatus.baseSavedKeys.slice(0, 10).map((k, i) => (
                        <span key={i} className="badge badge-accent mono" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                          {`{{${k}}}`}
                        </span>
                      ))}
                      {baseStatus.baseSavedKeys.length > 10 && (
                        <span className="text-sm text-muted">+{baseStatus.baseSavedKeys.length - 10} more</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Execution Result Box */}
            {baseRunResult && (
              <div className="mt-3 card card-p" style={{
                borderColor: baseRunResult.success ? 'var(--success)' : 'var(--danger)',
                background: baseRunResult.success ? 'rgba(16,185,129,0.06)' : 'var(--danger-dim)',
                overflowWrap: 'break-word',
                wordBreak: 'break-word'
              }}>
                <div style={{ fontWeight: 700, color: baseRunResult.success ? 'var(--success)' : 'var(--danger)', marginBottom: '0.25rem' }}>
                  {baseRunResult.success ? '✅ Base Config Chain Execution Completed' : '❌ Base Config Execution Failed'}
                </div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {baseRunResult.message || baseRunResult.error}
                </div>
                {Array.isArray(baseRunResult.savedKeys) && baseRunResult.savedKeys.length > 0 && (
                  <div className="mt-2 text-sm" style={{ wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
                      Saved Variables ({baseRunResult.savedKeys.length}) Grouped by Step:
                    </div>
                    {Array.isArray(baseRunResult.baseStepSavedKeys) && baseRunResult.baseStepSavedKeys.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {baseRunResult.baseStepSavedKeys.map((grp, idx) => (
                          <div key={idx} className="p-2 rounded" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 600, color: 'var(--cyan)', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                              Step {grp?.stepIndex || (idx + 1)} ({String(grp?.stepName || `Step ${idx + 1}`)}) — {Array.isArray(grp?.keys) ? grp.keys.length : 0} variable{Array.isArray(grp?.keys) && grp.keys.length !== 1 ? 's' : ''}:
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {Array.isArray(grp?.keys) && grp.keys.length > 0 ? (
                                grp.keys.map(k => (
                                  <span key={k} className="badge badge-accent mono" style={{ fontSize: '0.72rem' }}>
                                    {`{{${k}}}`}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted">No response variables</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="mono" style={{ color: 'var(--cyan)' }}>
                        {baseRunResult.savedKeys.map(k => `{{${k}}}`).join(', ')}
                      </span>
                    )}
                  </div>
                )}
                {baseRunResult.errorDetails && baseRunResult.errorDetails.length > 0 && (
                  <div className="mt-2 text-sm" style={{ color: 'var(--danger)', wordBreak: 'break-word' }}>
                    <strong>Errors:</strong>
                    <ul>
                      {baseRunResult.errorDetails.map((errStr, idx) => (
                        <li key={idx}>{errStr}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Steps List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {(form.baseSteps || []).map((step, sIdx) => (
              <div key={step.id || sIdx} className="card card-p" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-accent" style={{ fontWeight: 700 }}>Step {sIdx + 1}</span>
                    <input
                      className="form-input"
                      style={{ fontWeight: 600, padding: '0.2rem 0.5rem', width: '200px' }}
                      value={step.name || ''}
                      onChange={e => updateBaseStep(sIdx, 'name', e.target.value)}
                      placeholder={`Step ${sIdx + 1} Name`}
                    />
                  </div>
                  {form.baseSteps.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => removeBaseStep(sIdx)}
                    >
                      ✕ Remove Step
                    </button>
                  )}
                </div>

                <div className="grid-3 mb-2">
                  <div className="form-group">
                    <label className="form-label">HTTP Method</label>
                    <select
                      className="form-select"
                      value={step.method || 'GET'}
                      onChange={e => updateBaseStep(sIdx, 'method', e.target.value)}
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Endpoint Path</label>
                    <SmartInput
                      value={step.endpoint || ''}
                      onChange={val => updateBaseStep(sIdx, 'endpoint', val)}
                      placeholder="/api/enrollment/get-all/student/{{user.id}}"
                      allVarSuggestions={allVarSuggestions}
                    />
                    {step.endpoint && step.endpoint.includes('{{') && (
                      <div style={{ marginTop: '5px', fontSize: '0.74rem', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>🔗 Resolved Endpoint:</span>
                        <span style={{ color: 'var(--cyan)', background: 'rgba(34,211,238,0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(34,211,238,0.2)' }}>
                          {resolveEndpointPreview(step.endpoint, stepResponses)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Headers (JSON)</label>
                    <SmartTextarea
                      rows={3}
                      style={{ fontSize: '0.8rem' }}
                      value={step.headersText || ''}
                      onChange={val => updateBaseStep(sIdx, 'headersText', val)}
                      placeholder='{\n  "Content-Type": "application/json"\n}'
                      allVarSuggestions={allVarSuggestions}
                    />
                  </div>

                  {['POST', 'PUT', 'PATCH'].includes((step.method || 'GET').toUpperCase()) ? (
                    <div className="form-group">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>Request Body</label>
                        <div style={{ display: 'flex', gap: '0.3rem', background: 'var(--bg-card)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                          <button
                            type="button"
                            className={`btn btn-xs ${step.bodyType !== 'formData' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => updateBaseStep(sIdx, 'bodyType', 'json')}
                            style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                          >
                            JSON
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs ${step.bodyType === 'formData' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => {
                              updateBaseStep(sIdx, 'bodyType', 'formData')
                              if (!step.formDataParams || step.formDataParams.length === 0) {
                                updateBaseStep(sIdx, 'formDataParams', [{ id: `fd_${sIdx}_1`, key: '', type: 'text', value: '', files: [], enabled: true }])
                              }
                            }}
                            style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                          >
                            Form Data
                          </button>
                        </div>
                      </div>

                      {step.bodyType === 'formData' ? (
                        <FormDataEditor
                          params={step.formDataParams || []}
                          onChange={params => updateBaseStep(sIdx, 'formDataParams', params)}
                          allVarSuggestions={allVarSuggestions}
                          API={API}
                        />
                      ) : (
                        <SmartTextarea
                          rows={3}
                          style={{ fontSize: '0.8rem' }}
                          value={step.bodyText || ''}
                          onChange={val => updateBaseStep(sIdx, 'bodyText', val)}
                          placeholder='{\n  "email": "{{ email }}",\n  "password": "{{ password }}"\n}'
                          allVarSuggestions={allVarSuggestions}
                        />
                      )}
                    </div>
                  ) : (

                    <div className="form-group">
                      <label className="form-label">Think Time (seconds)</label>
                      <input
                        type="number"
                        className="form-input"
                        min={0}
                        max={30}
                        value={step.think ?? 1}
                        onChange={e => updateBaseStep(sIdx, 'think', Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>

                {/* Response Panel for Base Step */}
                {(() => {
                  const stepResp = stepResponses[sIdx]
                  if (!stepResp) return null
                  const isSuccess = stepResp.success !== false
                  return (
                    <div
                      className="chain-response-panel mt-3"
                      style={{
                        border: `1px solid ${isSuccess ? 'var(--success)' : 'var(--danger)'}`,
                        borderRadius: 'var(--radius-md)',
                        background: isSuccess ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.9rem',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        flexWrap: 'wrap',
                      }}>
                        <span style={{
                          padding: '2px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem',
                          background: isSuccess ? 'var(--success)' : 'var(--danger)',
                          color: '#fff',
                        }}>
                          {stepResp.status ? `${stepResp.status} ${stepResp.statusText || ''}` : (isSuccess ? '200 OK' : 'ERR')}
                        </span>
                        {stepResp.resolvedEndpoint && (
                          <code style={{ fontSize: '0.72rem', color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>
                            {stepResp.resolvedEndpoint}
                          </code>
                        )}
                        {stepResp.duration != null && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            ⏱ {stepResp.duration} ms
                          </span>
                        )}
                      </div>

                      <div style={{ padding: '0.75rem 0.9rem' }}>
                        {stepResp.error && (
                          <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                            ❌ {stepResp.error}
                          </div>
                        )}

                        {(stepResp.capturedCookies || (stepResp.capturedTokens && (stepResp.capturedTokens.authorization || stepResp.capturedTokens.token || stepResp.capturedTokens.access_token))) && (
                          <div style={{
                            marginBottom: '0.85rem',
                            padding: '0.65rem 0.85rem',
                            borderRadius: 'var(--radius-sm)',
                            background: 'rgba(16,185,129,0.08)',
                            border: '1px solid rgba(16,185,129,0.25)',
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700, marginBottom: '0.4rem' }}>
                              🔒 Captured Session Data (Sample User 1)
                            </div>
                            {stepResp.capturedCookies && (
                              <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🍪 Cookie Header: </span>
                                <code style={{ color: 'var(--success)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem' }}>
                                  {stepResp.capturedCookies}
                                </code>
                              </div>
                            )}
                            {(stepResp.capturedTokens?.authorization || stepResp.capturedTokens?.token || stepResp.capturedTokens?.access_token) && (
                              <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🔑 Bearer / Auth Token: </span>
                                <code style={{ color: 'var(--cyan)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem' }}>
                                  {stepResp.capturedTokens.authorization || `Bearer ${stepResp.capturedTokens.token || stepResp.capturedTokens.access_token}`}
                                </code>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                          RESPONSE BODY (USER 1 SAMPLE)
                        </div>
                        <pre className="chain-response-json" style={{
                          maxHeight: 240, overflowY: 'auto', margin: 0, fontSize: '0.78rem',
                          color: isSuccess ? 'var(--text-primary)' : 'var(--danger)',
                        }}>
                          {stepResp.responseJson
                            ? JSON.stringify(stepResp.responseJson, null, 2)
                            : stepResp.responseBody || '(no response body)'}
                        </pre>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addBaseStep}>
              ➕ Add Prerequisite API Step
            </button>
          </div>
        </div>

        {/* ── Single Request Target Configuration ────────── */}
        <div className="card card-p">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div>
              <h3 style={{ color: 'var(--text-secondary)' }}>🎯 Default Single Request Configuration</h3>
              <p className="text-sm text-muted">
                This endpoint request will be executed for all users during load tests when <strong>None (Single Request)</strong> is selected on the Dashboard.
              </p>
            </div>
          </div>

          {/* Toggle: Use Base Config */}
          <label className="form-switch-row mb-3" htmlFor="input-use-base-config" style={{ padding: '0.75rem 1rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.92rem' }}>
                🔗 Use Base Config Response Variables
              </div>
              <div className="text-sm text-muted mt-1">
                {form.useBaseConfig
                  ? 'ON — Uses pre-authenticated user sessions & saved response variables (e.g. {{classId}}, {{testId}}, {{token}}) during load testing.'
                  : 'OFF (Default) — Uses standard single request without Base Config session variables.'}
              </div>
            </div>
            <div className="switch">
              <input
                id="input-use-base-config"
                type="checkbox"
                checked={!!form.useBaseConfig}
                onChange={e => set('useBaseConfig', e.target.checked)}
              />
              <span className="slider" />
            </div>
          </label>

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
              <SmartInput
                id="input-endpoint"
                value={form.targetEndpoint || ''}
                onChange={val => set('targetEndpoint', val)}
                placeholder="/api/auth/signin or /api/test/{{testId}}"
                allVarSuggestions={allVarSuggestions}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="textarea-headers">Request Headers (JSON)</label>
              <SmartTextarea
                id="textarea-headers"
                rows={5}
                value={form.headersText || ''}
                onChange={val => set('headersText', val)}
                placeholder='{\n  "Content-Type": "application/json"\n}'
                allVarSuggestions={allVarSuggestions}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <label className="form-label" htmlFor="textarea-body" style={{ marginBottom: 0 }}>Request Body</label>
                <div style={{ display: 'flex', gap: '0.3rem', background: 'var(--bg-card)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${form.bodyType !== 'formData' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => set('bodyType', 'json')}
                    style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${form.bodyType === 'formData' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => {
                      set('bodyType', 'formData')
                      if (!form.formDataParams || form.formDataParams.length === 0) {
                        set('formDataParams', [{ id: 'fd_cfg_1', key: '', type: 'text', value: '', files: [], enabled: true }])
                      }
                    }}
                    style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                  >
                    Form Data
                  </button>
                </div>
              </div>

              {form.bodyType === 'formData' ? (
                <FormDataEditor
                  params={form.formDataParams || []}
                  onChange={params => set('formDataParams', params)}
                  allVarSuggestions={allVarSuggestions}
                  API={API}
                />
              ) : (
                <SmartTextarea
                  id="textarea-body"
                  rows={5}
                  value={form.bodyText || ''}
                  onChange={val => set('bodyText', val)}
                  placeholder='{\n  "email": "{{ email }}",\n  "password": "{{ password }}",\n  "classId": "{{ classId }}"\n}'
                  allVarSuggestions={allVarSuggestions}
                />
              )}
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
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div>
              <h3 style={{ color: 'var(--text-secondary)' }}>🚀 Default Phase Configuration</h3>
              <p className="text-sm text-muted mb-0">
                These phases are used when starting a load test with "Default Config" preset on the Dashboard.
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={addPhase}>+ Add Phase</button>
          </div>

          {/* Metric Switch */}
          <div className="flex items-center justify-between gap-3 mb-3 mt-2 flex-wrap" style={{ background: 'var(--bg-overlay)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '1.1rem' }}>🎛️</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Arrival Load Metric</div>
                <div className="text-sm text-muted" style={{ fontSize: '0.75rem' }}>Select whether to configure load using rate per second or total count</div>
              </div>
            </div>
            <div className="flex items-center gap-1" style={{ background: 'var(--bg-card)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <button
                type="button"
                className={`btn btn-xs ${form.arrivalMode !== 'arrivalCount' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleToggleArrivalMode('arrivalRate')}
                style={{ padding: '4px 12px', fontSize: '0.78rem' }}
              >
                📈 Rate (arrivalRate /s)
              </button>
              <button
                type="button"
                className={`btn btn-xs ${form.arrivalMode === 'arrivalCount' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleToggleArrivalMode('arrivalCount')}
                style={{ padding: '4px 12px', fontSize: '0.78rem' }}
              >
                ⚡ Count (arrivalCount VUs)
              </button>
            </div>
          </div>

          {form.phases.map((phase, i) => (
            <div key={i} className="phase-row" style={{ marginBottom: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Duration (s)</label>
                <input type="number" className="form-input" value={phase.duration || ''}
                  onChange={e => setPhase(i, 'duration', e.target.value)} min={5} />
              </div>
              {form.arrivalMode === 'arrivalCount' ? (
                <div className="form-group">
                  <label className="form-label">Arrival Count (VUs)</label>
                  <input type="number" className="form-input" value={phase.arrivalCount || ''}
                    onChange={e => setPhase(i, 'arrivalCount', e.target.value)} min={1} placeholder="e.g. 50" />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Arrival Rate /s</label>
                  <input type="number" className="form-input" value={phase.arrivalRate || ''}
                    onChange={e => setPhase(i, 'arrivalRate', e.target.value)} min={1} placeholder="e.g. 5" />
                </div>
              )}
              {form.arrivalMode !== 'arrivalCount' && (
                <div className="form-group">
                  <label className="form-label">Ramp To /s (opt)</label>
                  <input type="number" className="form-input" value={phase.rampTo || ''}
                    onChange={e => setPhase(i, 'rampTo', e.target.value)} min={0} placeholder="—" />
                </div>
              )}
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
