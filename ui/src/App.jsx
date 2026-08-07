import React, { Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext.jsx'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Configure from './pages/Configure.jsx'
import DataManager from './pages/DataManager.jsx'
import Reports from './pages/Reports.jsx'
import ChainTesting from './pages/ChainTesting.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI Rendering Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 8, margin: '2rem' }}>
          <h2>⚠ UI Rendering Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.toString()}
          </pre>
          <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: '1rem' }}>
            🔄 Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <div className="app-layout">
            <div className="bg-mesh" />
            <Sidebar />
            <main className="main-content">
              <ErrorBoundary>
                <Routes>
                  <Route path="/"             element={<Dashboard />} />
                  <Route path="/configure"    element={<Configure />} />
                  <Route path="/chain-testing" element={<ChainTesting />} />
                  <Route path="/chain-builder" element={<Navigate to="/chain-testing" replace />} />
                  <Route path="/data"         element={<DataManager />} />
                  <Route path="/reports"      element={<Reports />} />
                  <Route path="*"             element={<Navigate to="/" replace />} />
                </Routes>
              </ErrorBoundary>
            </main>
          </div>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  )
}

