import React, { useState, useEffect, useRef } from 'react'

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
