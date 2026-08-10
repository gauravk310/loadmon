import React, { useState, useEffect, useRef } from 'react'
import { API as DEFAULT_API } from '../api.js'

function cleanVarKey(key) {

  if (typeof key !== 'string') return key
  return key.replace(/^\[\d+\]\./, '').replace(/\[\d+\]/g, '')
}

// ── Variable Autocomplete Dropdown ─────────────────────────
export function VarDropdown({ suggestions, onSelect, onClose }) {
  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!Array.isArray(suggestions) || !suggestions.length) return null

  // Group suggestions by stepLabel / stepName
  const groupsMap = new Map()

  suggestions.forEach(s => {
    if (!s || typeof s !== 'object') return
    const rawLabel = String(s.stepLabel || s.stepName || (s.stepNum ? `Step ${s.stepNum}` : 'Saved Variables'))
    const labelLower = rawLabel.toLowerCase()
    if (!groupsMap.has(rawLabel)) {
      groupsMap.set(rawLabel, {
        label: rawLabel,
        stepNum: typeof s.stepNum === 'number' ? s.stepNum : 999,
        isCredential: labelLower.includes('credential') || labelLower.includes('initial'),
        items: []
      })
    }
    const cleanItemKey = cleanVarKey(s.key)
    groupsMap.get(rawLabel).items.push({ ...s, key: cleanItemKey })
  })

  const groupList = Array.from(groupsMap.values()).sort((a, b) => a.stepNum - b.stepNum)

  return (
    <div className="var-dropdown" onMouseDown={e => e.stopPropagation()}>
      <div className="var-dropdown-header">💡 Available Saved Variables</div>
      {groupList.map((g, gIdx) => (
        <div key={gIdx} className="var-dropdown-group">
          <div style={{
            padding: '4px 8px',
            fontSize: '0.68rem',
            fontWeight: 700,
            color: g.isCredential ? 'var(--success)' : 'var(--cyan)',
            background: g.isCredential ? 'rgba(16,185,129,0.08)' : 'rgba(34,211,238,0.08)',
            borderTop: gIdx > 0 ? '1px solid var(--border)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>{g.isCredential ? '🔑 ' : '📌 '}{String(g.label).toUpperCase()}</span>
            <span style={{ opacity: 0.7, fontSize: '0.62rem', fontWeight: 500 }}>({g.items.length})</span>
          </div>
          {g.items.map((s, i) => (
            <div
              key={`${gIdx}-${i}`}
              className="var-dropdown-item"
              onMouseDown={() => { onSelect(cleanVarKey(s.key)); onClose() }}
            >
              <span className="var-key" style={{ color: s.isAuth ? 'var(--success)' : 'var(--cyan)' }}>
                {`{{${cleanVarKey(s.key)}}}`}
              </span>
              <span className="var-source">← {g.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Smart Input with {{ autocomplete ──────────────────────
export function SmartInput({ id, value, onChange, placeholder, style, allVarSuggestions, className }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState([])
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    const cursor = e.target.selectionStart
    const textBefore = val.substring(0, cursor)
    const match = textBefore.match(/\{\{([\w.]*)$/)
    if (match) {
      const typed = match[1].toLowerCase()
      const filtered = (allVarSuggestions || []).filter(s => s && s.key && s.key.toLowerCase().includes(typed))
      setFilteredSuggestions(filtered)
      setShowDropdown(filtered.length > 0)
    } else {
      setShowDropdown(false)
    }
  }

  const handleSelect = (key) => {
    if (!inputRef.current) return
    const el = inputRef.current
    const cursor = el.selectionStart
    const textBefore = (value || '').substring(0, cursor)
    const textAfter = (value || '').substring(cursor)
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = (value || '').substring(0, openIdx) + `{{${key}}}` + textAfter
    onChange(newVal)
    setShowDropdown(false)
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        id={id}
        ref={inputRef}
        className={className || 'form-input'}
        value={value || ''}
        onChange={handleChange}
        placeholder={placeholder}
        style={style}
      />
      {showDropdown && (
        <VarDropdown
          suggestions={filteredSuggestions}
          onSelect={handleSelect}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  )
}

// ── Smart Textarea with {{ autocomplete ──────────────────
export function SmartTextarea({ id, value, onChange, placeholder, rows, style, allVarSuggestions, className }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState([])
  const textareaRef = useRef(null)

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    const cursor = e.target.selectionStart
    const textBefore = val.substring(0, cursor)
    const match = textBefore.match(/\{\{([\w.]*)$/)
    if (match) {
      const typed = match[1].toLowerCase()
      const filtered = (allVarSuggestions || []).filter(s => s && s.key && s.key.toLowerCase().includes(typed))
      setFilteredSuggestions(filtered)
      setShowDropdown(filtered.length > 0)
    } else {
      setShowDropdown(false)
    }
  }

  const handleSelect = (key) => {
    if (!textareaRef.current) return
    const el = textareaRef.current
    const cursor = el.selectionStart
    const textBefore = (value || '').substring(0, cursor)
    const textAfter = (value || '').substring(cursor)
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = (value || '').substring(0, openIdx) + `{{${key}}}` + textAfter
    onChange(newVal)
    setShowDropdown(false)
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <textarea
        id={id}
        ref={textareaRef}
        className={className || 'form-input mono'}
        value={value || ''}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows || 4}
        style={style}
      />
      {showDropdown && (
        <VarDropdown
          suggestions={filteredSuggestions}
          onSelect={handleSelect}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  )
}

// ── Form Data Editor (Postman-style multipart/form-data editor) ─
export function FormDataEditor({ params = [], onChange, allVarSuggestions, API }) {
  const [uploadingIdx, setUploadingIdx] = useState(null)

  const updateParam = (index, updates) => {
    const next = [...params]
    next[index] = { ...next[index], ...updates }
    onChange(next)
  }

  const removeParam = (index) => {
    const next = params.filter((_, i) => i !== index)
    onChange(next)
  }

  const addParam = () => {
    onChange([
      ...params,
      {
        id: `fd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        key: '',
        type: 'text',
        value: '',
        files: [],
        enabled: true
      }
    ])
  }

  const handleFileUpload = async (index, fileList) => {
    if (!fileList || fileList.length === 0) return
    setUploadingIdx(index)
    try {
      const formData = new FormData()
      for (let i = 0; i < fileList.length; i++) {
        formData.append('files', fileList[i])
      }
      const apiHost = (API || DEFAULT_API || 'http://localhost:8000/api').replace(/\/+$/, '')
      const res = await fetch(`${apiHost}/upload/api-files`, {

        method: 'POST',
        body: formData
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.files)) {
        const currentFiles = params[index]?.files || []
        updateParam(index, { files: [...currentFiles, ...data.files] })
      } else {
        alert(`File upload failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      alert(`Upload error: ${err.message}`)
    } finally {
      setUploadingIdx(null)
    }
  }

  const removeFile = (paramIdx, fileIdx) => {
    const currentFiles = params[paramIdx]?.files || []
    const nextFiles = currentFiles.filter((_, i) => i !== fileIdx)
    updateParam(paramIdx, { files: nextFiles })
  }

  return (
    <div className="form-data-editor" style={{ marginTop: '0.4rem' }}>
      <div className="form-data-table" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {params.map((p, idx) => (
          <div key={p.id || idx} className={`kv-row form-data-row ${p.enabled === false ? 'disabled-row' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>

            <input
              type="checkbox"
              checked={p.enabled !== false}
              onChange={e => updateParam(idx, { enabled: e.target.checked })}
              title="Enable / disable parameter"
              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
            />

            <SmartInput
              value={p.key}
              onChange={val => updateParam(idx, { key: val })}
              placeholder="Key (e.g. email or snapshots)"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
              allVarSuggestions={allVarSuggestions}
            />

            <select
              className="form-select"
              value={p.type || 'text'}
              onChange={e => updateParam(idx, { type: e.target.value })}
              style={{ width: '95px', fontSize: '0.8rem', padding: '6px 8px', borderRadius: 'var(--radius-sm)' }}
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>

            {p.type === 'file' ? (
              <div className="form-data-file-area" style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-card)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                {(p.files || []).map((f, fIdx) => (
                  <span key={f.id || fIdx} className="file-chip" style={{ background: 'rgba(34,211,238,0.12)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title={`${f.originalName} (${Math.round((f.size || 0)/1024)} KB)`}>
                    📁 {f.originalName || f.filename}
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px' }}
                      onClick={() => removeFile(idx, fIdx)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <label className="btn btn-xs btn-outline" style={{ cursor: 'pointer', margin: 0, padding: '3px 8px', fontSize: '0.75rem' }}>
                  {uploadingIdx === idx ? '⏳ Uploading...' : '+ Attach Files'}
                  <input
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                      handleFileUpload(idx, e.target.files)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            ) : (
              <SmartInput
                value={p.value}
                onChange={val => updateParam(idx, { value: val })}
                placeholder="Value (e.g. {{email}})"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                allVarSuggestions={allVarSuggestions}
              />
            )}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)' }}
              onClick={() => removeParam(idx)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs mt-1"
        style={{ color: 'var(--accent-light)', marginTop: '0.4rem' }}
        onClick={addParam}
      >
        + Add Form Data Field
      </button>
    </div>
  )
}

