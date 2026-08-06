import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext.jsx'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Configure from './pages/Configure.jsx'
import DataManager from './pages/DataManager.jsx'
import Reports from './pages/Reports.jsx'
import ChainBuilder from './pages/ChainBuilder.jsx'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="app-layout">
          <div className="bg-mesh" />
          <Sidebar />
          <main className="main-content">
            <Routes>
              <Route path="/"             element={<Dashboard />} />
              <Route path="/configure"    element={<Configure />} />
              <Route path="/chain-builder" element={<ChainBuilder />} />
              <Route path="/data"         element={<DataManager />} />
              <Route path="/reports"      element={<Reports />} />
              <Route path="*"             element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppProvider>
  )
}
