import { Routes, Route, NavLink } from 'react-router-dom';
import VaultPage from './pages/VaultPage';
import TopicsPage from './pages/TopicsPage';
import NotePage from './pages/NotePage';
import SearchPage from './pages/SearchPage';

function Sidebar() {
    return (
        <nav className="app-sidebar">
            <div className="sidebar-logo">
                <h1>🧠 MindVault</h1>
                <p>AI Second Brain</p>
            </div>
            <div className="sidebar-nav">
                <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <span className="icon">📚</span> Vault
                </NavLink>
                <NavLink to="/topics" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <span className="icon">🗺️</span> Topics
                </NavLink>
                <NavLink to="/search" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <span className="icon">🔍</span> Search
                </NavLink>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)' }}>
                MindVault v1.0
            </div>
        </nav>
    );
}

export default function App() {
    return (
        <div className="app-layout">
            <Sidebar />
            <main className="app-main">
                <Routes>
                    <Route path="/" element={<VaultPage />} />
                    <Route path="/vault" element={<VaultPage />} />
                    <Route path="/topics" element={<TopicsPage />} />
                    <Route path="/note/:id" element={<NotePage />} />
                    <Route path="/search" element={<SearchPage />} />
                </Routes>
            </main>
        </div>
    );
}
