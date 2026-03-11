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

function Sidebar() {
    const { user, logout } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [dueCount, setDueCount] = useState(0);

    useEffect(() => {
        if (!user) return;
        api.get("/revision/stats")
            .then(res => setDueCount(res.data.notes_due_today))
            .catch(() => { });
    }, [user]);

    const navItems = [
        { to: "/", end: true, icon: "📚", label: "Vault" },
        { to: "/revision", icon: "📖", label: "Revision", badge: dueCount },
        { to: "/topics", icon: "🗺️", label: "Knowledge Graph" },
        { to: "/search", icon: "🔍", label: "Search" },
        { to: "/chat", icon: "💬", label: "Chat" },
    ];

    return (
        <nav style={{ width: 220, background: "#fff", borderRight: "1px solid #E5E5EA", padding: "20px 0", position: "fixed", top: 0, left: 0, height: "100vh", display: "flex", flexDirection: "column", zIndex: 100, fontFamily: "Inter,sans-serif" }}>
            <div style={{ padding: "0 20px 20px", borderBottom: "1px solid #E5E5EA", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 20 }}>🧠</span>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: 16, background: "linear-gradient(135deg,#7C3AED,#A855F7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>MindVault</div>
                        <div style={{ fontSize: 10, color: "#A0A0B0", letterSpacing: 1, textTransform: "uppercase" }}>AI Second Brain</div>
                    </div>
                </div>
            </div>

            <div style={{ padding: "0 10px", flex: 1 }}>
                {navItems.map(({ to, end, icon, label, badge }) => (
                    <NavLink key={to} to={to} end={end}
                        className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, marginBottom: 2, fontSize: 14, fontWeight: 500, textDecoration: "none", transition: "all 0.15s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{icon}</span> {label}
                        </div>
                        {badge > 0 && (
                            <span style={{ background: "#EF4444", color: "white", fontSize: 11, fontWeight: "bold", padding: "2px 6px", borderRadius: 10 }}>
                                {badge}
                            </span>
                        )}
                    </NavLink>
                ))}
            </div>

            {/* Coming Soon Banner & Divider */}
            <div>
                <NavLink to="/ai-store" style={{ textDecoration: 'none' }}>
                    <div style={{
                        margin: "0 10px 8px 10px",
                        padding: "10px 14px",
                        background: "linear-gradient(135deg, #F5F3FF, #FAF5FF)",
                        border: "1px solid rgba(124,58,237,0.2)",
                        borderRadius: 12,
                        cursor: "pointer",
                        position: "relative"
                    }}>
                        {/* Pulsing Dot */}
                        <div style={{
                            width: 8, height: 8, borderRadius: "50%", background: "#7C3AED",
                            position: "absolute", top: 8, right: 8,
                            animation: "pulse 2s infinite"
                        }} />
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>AI Store</div>
                        <div style={{ fontSize: 11, color: "#A78BFA", marginTop: 2 }}>Agents & tools for your brain</div>
                        <style>
                            {`@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.4); } 100% { transform: scale(1); } }`}
                        </style>
                    </div>
                </NavLink>
                <div style={{ margin: "10px 14px", borderTop: "1px solid #E5E5EA" }} />
            </div>

            <div style={{ position: "relative" }}>
                {menuOpen && (
                    <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 10, right: 10, background: "#fff", border: "1px solid #E5E5EA", borderRadius: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", overflow: "hidden", zIndex: 200 }}>
                        <div style={{ padding: "10px 14px", borderBottom: "1px solid #F0F0F5" }}>
                            <p style={{ fontSize: 12, color: "#6B6B80", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</p>
                        </div>
                        <button onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
                            style={{ width: "100%", padding: "11px 14px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#1A1A2E", textAlign: "left" }}>
                            ⚙️ Settings
                        </button>
                        <button onClick={() => { logout(); setMenuOpen(false); }}
                            style={{ width: "100%", padding: "11px 14px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#DC2626", textAlign: "left" }}>
                            → Log out
                        </button>
                    </div>
                )}
                <button onClick={() => setMenuOpen(o => !o)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "none", border: "none", borderTop: "1px solid #F0F0F5", cursor: "pointer" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1A1A2E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                        {user?.username?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: 13, color: "#1A1A2E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.username}</p>
                        <p style={{ fontSize: 11, color: "#A0A0B0" }}>@{user?.username}</p>
                    </div>
                    <span style={{ color: "#A0A0B0", fontSize: 12 }}>⇕</span>
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
