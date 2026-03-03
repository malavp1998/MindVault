import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import VaultPage from './pages/VaultPage';
import TopicsPage from './pages/TopicsPage';
import NotePage from './pages/NotePage';
import SearchPage from './pages/SearchPage';

function Sidebar() {
    const { user, logout } = useAuth();

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
            {/* User info at bottom */}
            <div className="sidebar-user">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="sidebar-user-name">@{user?.username}</span>
                    <span className="sidebar-user-email" style={{ fontSize: '0.75rem', color: '#888' }}>{user?.email}</span>
                </div>
                <button onClick={logout} className="sidebar-logout-btn">
                    Logout
                </button>
            </div>
        </nav>
    );
}

function AuthenticatedLayout() {
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

export default function App() {
    return (
        <AuthProvider>
            <Routes>
                {/* Public */}
                <Route path="/login" element={<LoginPage />} />

                {/* Protected — everything else requires auth */}
                <Route
                    path="/*"
                    element={
                        <ProtectedRoute>
                            <AuthenticatedLayout />
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </AuthProvider>
    );
}
