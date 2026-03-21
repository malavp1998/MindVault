import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import SettingsModal from './components/SettingsModal';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import VaultPage from './pages/VaultPage';
import TopicsPage from './pages/TopicsPage';
import NotePage from './pages/NotePage';
import SearchPage from './pages/SearchPage';
import ChatPage from './pages/ChatPage';
import RevisionPage from './pages/RevisionPage';
import AIStorePage from './pages/AIStorePage';
import api from './api';

import { Database, BookOpen, Network, Search, MessageCircle, ShoppingBag } from 'lucide-react';
import logo from './assets/logo.png';

function Sidebar() {
    const { user, logout } = useAuth();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [dueCount, setDueCount] = useState(0);

    useEffect(() => {
        if (!user) return;
        const timer = setTimeout(() => {
            api.get("/revision/stats")
                .then(res => setDueCount(res.data.notes_due_today))
                .catch(() => {});
        }, 2000); // wait 2s after page load
        return () => clearTimeout(timer);
    }, [user]);

    const navItems = [
        { to: "/", end: true, icon: <Database size={18} strokeWidth={1.5} />, label: "Vault" },
        { to: "/revision", icon: <BookOpen size={18} strokeWidth={1.5} />, label: "Revision" },
        { to: "/topics", icon: <Network size={18} strokeWidth={1.5} />, label: "Knowledge Graph" },
        { to: "/search", icon: <Search size={18} strokeWidth={1.5} />, label: "Search" },
        { to: "/chat", icon: <MessageCircle size={18} strokeWidth={1.5} />, label: "Chat" },
    ];

    return (
        <nav className="sidebar">
            <div style={{ padding: '24px' }}>
                <img src={logo} alt="MindVault Logo" style={{ height: 42, display: 'block' }} />
            </div>

            <div style={{ padding: "0 10px", flex: 1 }}>
                {navItems.map(({ to, end, icon, label }) => (
                    <NavLink key={to} to={to} end={end}
                        className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                        <span className="nav-link-icon">{icon}</span>
                        {label}
                        {label === "Revision" && dueCount > 0 && (
                            <span style={{ fontSize: '10px', background: 'var(--accent)', color: 'white', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>
                                {dueCount}
                            </span>
                        )}
                    </NavLink>
                ))}
            </div>

            <div style={{ padding: "0 10px", marginBottom: 12 }}>
                <NavLink to="/ai-store"
                    className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                    <span className="nav-link-icon"><ShoppingBag size={18} strokeWidth={1.5} /></span>
                    AI Store
                </NavLink>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", padding: "12px 10px" }}>
                <button onClick={() => setSettingsOpen(true)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: "0.875rem", flexShrink: 0 }}>
                        {user?.username?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 500, fontSize: "0.875rem", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0, lineHeight: 1.2 }}>{user?.username || "User"}</p>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, marginTop: 4, lineHeight: 1 }}>{user?.email || "user@example.com"}</p>
                    </div>
                </button>
                {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
                    <Route path="/revision" element={<RevisionPage />} />
                    <Route path="/topics" element={<TopicsPage />} />
                    <Route path="/note/:id" element={<NotePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/chat" element={<ChatPage />} />
                    <Route path="/ai-store" element={<AIStorePage />} />
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
