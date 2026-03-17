import { useState } from "react";
import { auth } from "../firebase";
import { sendPasswordResetEmail } from "firebase/auth";

export default function SettingsModal({ onClose }) {
    const [tab, setTab] = useState("general");
    const [apiKeys, setApiKeys] = useState(() => {
        try { return JSON.parse(localStorage.getItem("mv_api_keys") || "{}"); } catch { return {}; }
    });
    const [saved, setSaved] = useState(false);
    const user = auth.currentUser;

    const saveKeys = () => {
        localStorage.setItem("mv_api_keys", JSON.stringify(apiKeys));
        setSaved(true); setTimeout(() => setSaved(false), 2000);
    };

    const resetPassword = async () => {
        if (user?.email) { await sendPasswordResetEmail(auth, user.email); alert("Reset email sent to " + user.email); }
    };

    const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, fontFamily: "Inter,sans-serif" };
    const modal = { background: "#fff", borderRadius: 20, width: "90%", maxWidth: 660, minHeight: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", display: "flex", overflow: "hidden" };
    const navBtn = active => ({ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 12px", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 500, background: active ? "#EDE9FE" : "transparent", color: active ? "#7C3AED" : "#1A1A2E", marginBottom: 2 });
    const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid #F0F0F5", fontSize: 14, color: "#1A1A2E" };
    const inp = { width: "100%", padding: "10px 13px", border: "1px solid #E5E5EA", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit", background: "#FAFAFA", color: "#1A1A2E" };

    return (
        <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={modal}>
                <div style={{ width: 190, padding: 18, borderRight: "1px solid #F0F0F5", flexShrink: 0, display: "flex", flexDirection: "column" }}>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#A0A0B0", marginBottom: 18, display: "block", textAlign: "left" }}>✕</button>
                    <button style={navBtn(tab === "general")} onClick={() => setTab("general")}>⚙️ General</button>
                    <button style={navBtn(tab === "api")} onClick={() => setTab("api")}>🔑 API</button>
                    
                    <div style={{ marginTop: "auto" }}>
                        <button 
                            onClick={async () => {
                                try {
                                    await auth.signOut();
                                    onClose();
                                } catch (err) {
                                    console.error("Logout failed:", err);
                                }
                            }}
                            style={{ 
                                ...navBtn(false), 
                                color: "#EF4444", 
                                marginTop: 12,
                                border: "1px solid rgba(239, 68, 68, 0.2)"
                            }}
                        >
                            🚪 Sign Out
                        </button>
                    </div>
                </div>
                <div style={{ flex: 1, padding: 28, overflowY: "auto" }}>
                    {tab === "general" && <>
                        <h2 style={{ fontWeight: 700, fontSize: 20, color: "#1A1A2E", marginBottom: 20 }}>General</h2>
                        <div style={row}><span style={{ color: "#6B6B80" }}>Name</span><span style={{ fontWeight: 500 }}>{user?.displayName || "User"}</span></div>
                        <div style={row}><span style={{ color: "#6B6B80" }}>Email</span><span style={{ fontWeight: 500 }}>{user?.email}</span></div>
                        <div style={row}><span style={{ color: "#6B6B80" }}>Username</span><span style={{ fontWeight: 500 }}><span style={{ color: "#A0A0B0" }}>@ </span>{user?.displayName || "user"}</span></div>
                        <div style={row}>
                            <span style={{ color: "#6B6B80" }}>Password</span>
                            <span><span style={{ letterSpacing: 3, color: "#A0A0B0" }}>••••••••</span>
                                <button onClick={resetPassword} style={{ marginLeft: 10, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Reset</button>
                            </span>
                        </div>
                    </>}
                    {tab === "api" && <>
                        <h2 style={{ fontWeight: 700, fontSize: 20, color: "#1A1A2E", marginBottom: 6 }}>API Configuration</h2>
                        <p style={{ color: "#6B6B80", fontSize: 13, marginBottom: 22 }}>Configure your custom provider keys.</p>
                        {[
                            { label: "Groq", key: "groq", ph: "gsk_..." },
                            { label: "Sarvam", key: "sarvam", ph: "sk_live_..." },
                            { label: "Jina AI", key: "jina", ph: "jina_..." },
                        ].map(({ label, key, ph }) => (
                            <div key={key} style={{ marginBottom: 16 }}>
                                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 5, color: "#1A1A2E" }}>{label}</label>
                                <input style={inp} type="password" placeholder={ph}
                                    value={apiKeys[key] || ""} onChange={e => setApiKeys(k => ({ ...k, [key]: e.target.value }))} />
                            </div>
                        ))}
                        <button onClick={saveKeys}
                            style={{ padding: "10px 24px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
                            {saved ? "✓ Saved!" : "Save Changes"}
                        </button>
                    </>}
                </div>
            </div>
        </div>
    );
}
