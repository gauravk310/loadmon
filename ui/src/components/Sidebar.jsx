import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import './Sidebar.css'

const NAV_ITEMS = [
  { to: '/',             icon: '⚡', label: 'Dashboard'     },
  { to: '/chain-testing', icon: '🔗', label: 'Chain Testing' },
  { to: '/configure',    icon: '⚙️', label: 'Configure'     },
  { to: '/data',         icon: '📂', label: 'Data Manager'  },
  { to: '/reports',      icon: '📊', label: 'Reports'       },
]

export default function Sidebar() {
  const { testStatus } = useApp()

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">⚡</div>
        <div>
          <div className="logo-name">LoadMon</div>
          <div className="logo-tagline">Load Testing</div>
        </div>
      </div>

      {/* Status indicator */}
      <div className="sidebar-status">
        <span className={`status-dot ${testStatus.running ? 'running' : 'idle'}`} />
        <span className="status-text">
          {testStatus.running ? 'Test running…' : 'Idle'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'nav-item--active' : ''}`
            }
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <span className="sidebar-version">v1.0.0</span>
        <a
          href="https://artillery.io/docs"
          target="_blank"
          rel="noreferrer"
          className="sidebar-link"
        >
          Artillery Docs ↗
        </a>
      </div>
    </aside>
  )
}
