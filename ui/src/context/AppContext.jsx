import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const AppContext = createContext(null)

const API = '/api'

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null)
  const [testStatus, setTestStatus] = useState({ running: false })
  const [liveMetrics, setLiveMetrics] = useState([])
  const [logs, setLogs] = useState([])
  const [lastSummary, setLastSummary] = useState(null)
  const sseRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const intentionalClose = useRef(false)

  // ── Load config on mount ──────────────────────────────
  useEffect(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(d => { if (d.success) setConfig(d.config) })
      .catch(console.error)
  }, [])

  // ── SSE connection ────────────────────────────────────
  const connectSSE = useCallback(() => {
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    // Close existing connection
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    intentionalClose.current = false
    const es = new EventSource(`${API}/tests/stream`)
    sseRef.current = es

    es.addEventListener('status', e => {
      const data = JSON.parse(e.data)
      setTestStatus(data)
    })

    es.addEventListener('metrics', e => {
      const data = JSON.parse(e.data)
      setLiveMetrics(prev => [...prev.slice(-120), { ...data, _ts: Date.now() }])
    })

    es.addEventListener('log', e => {
      const data = JSON.parse(e.data)
      setLogs(prev => [...prev.slice(-200), data])
    })

    es.addEventListener('summary', e => {
      const data = JSON.parse(e.data)
      setLastSummary(data)
    })

    es.onerror = () => {
      if (intentionalClose.current) return
      // Only schedule one reconnect at a time
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          connectSSE()
        }, 3000)
      }
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      intentionalClose.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      sseRef.current?.close()
    }
  }, [connectSSE])

  // ── API helpers ───────────────────────────────────────
  const saveConfig = useCallback(async (updates) => {
    const res = await fetch(`${API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    const data = await res.json()
    if (data.success) setConfig(data.config)
    return data
  }, [])

  const startTest = useCallback(async ({ environment = 'custom', phases } = {}) => {
    setLiveMetrics([])
    setLogs([])
    const res = await fetch(`${API}/tests/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, phases })
    })
    return res.json()
  }, [])

  const stopTest = useCallback(async () => {
    const res = await fetch(`${API}/tests/stop`, { method: 'POST' })
    return res.json()
  }, [])

  return (
    <AppContext.Provider value={{
      config, setConfig, saveConfig,
      testStatus, liveMetrics, logs, lastSummary,
      startTest, stopTest,
      API
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
