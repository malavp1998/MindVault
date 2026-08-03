import { useState, useEffect } from "react";
import { auth } from "../firebase";
import { getMe, linkPhone, unlinkPhone } from "../api";
import { Settings, Key, Shield, LogOut, X, MessageCircle } from "lucide-react";

export default function SettingsModal({ onClose }) {
    const [tab, setTab] = useState("general");
    const [apiKeys, setApiKeys] = useState(() => {
        try { return JSON.parse(localStorage.getItem("mv_api_keys") || "{}"); } catch { return {}; }
    });
    const [saved, setSaved] = useState(false);
    const user = auth.currentUser;

    // WhatsApp linking
    const [phone, setPhone] = useState("");
    const [linkedPhone, setLinkedPhone] = useState(null);
    const [phoneStatus, setPhoneStatus] = useState(null); // { type: "ok"|"error", text }
    const [phoneBusy, setPhoneBusy] = useState(false);

    useEffect(() => {
        getMe()
            .then(data => setLinkedPhone(data.phone_number || null))
            .catch(() => { /* non-fatal — the field just starts empty */ });
    }, []);

    const savePhone = async () => {
        setPhoneBusy(true);
        setPhoneStatus(null);
        try {
            const data = await linkPhone(phone);
            setLinkedPhone(data.phone_number);
            setPhone("");
            setPhoneStatus({ type: "ok", text: "Linked. Message the bot on WhatsApp to start." });
        } catch (err) {
            setPhoneStatus({
                type: "error",
                text: err.response?.data?.detail || "Couldn't link that number.",
            });
        } finally {
            setPhoneBusy(false);
        }
    };

    const removePhone = async () => {
        setPhoneBusy(true);
        setPhoneStatus(null);
        try {
            await unlinkPhone();
            setLinkedPhone(null);
            setPhoneStatus({ type: "ok", text: "Number removed." });
        } catch {
            setPhoneStatus({ type: "error", text: "Couldn't remove that number." });
        } finally {
            setPhoneBusy(false);
        }
    };

    const saveKeys = () => {
        localStorage.setItem("mv_api_keys", JSON.stringify(apiKeys));
        setSaved(true); setTimeout(() => setSaved(false), 2000);
    };

    const overlay = {
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, fontFamily: "var(--font, 'Inter', sans-serif)"
    };
    
    const modal = {
        background: "var(--bg, #f5f4f1)", 
        borderRadius: 20, 
        width: "90%", maxWidth: 640, minHeight: 400, 
        boxShadow: "0 24px 60px rgba(0,0,0,0.15)", 
        display: "flex", overflow: "hidden"
    };

    const navBtn = active => ({
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "10px 16px",
        border: "none", borderRadius: 12,
        cursor: "pointer", fontSize: 13, fontWeight: 500,
        background: active ? "var(--accent-light, rgba(148, 78, 135, 0.08))" : "transparent",
        color: active ? "var(--accent, #944E87)" : "var(--text-muted, #6b6b6b)",
        marginBottom: 6,
        transition: "all 0.2s ease"
    });

    const row = {
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 0", borderBottom: "1px solid var(--border, #e8e5e0)",
        fontSize: 13, color: "var(--text-dark, #1a1a1a)"
    };

    const inpLabel = {
        fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8,
        color: "var(--text-muted, #6b6b6b)", textTransform: "uppercase", letterSpacing: 0.5
    };

    const inp = {
        width: "100%", padding: "12px 16px",
        border: "1px solid var(--border, #e8e5e0)",
        borderRadius: 12, fontSize: 13, outline: "none",
        fontFamily: "inherit", background: "var(--hover-fill, #f0eeeb)",
        color: "var(--text-dark, #1a1a1a)", transition: "all 0.2s ease"
    };

    return (
        <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={modal}>
                {/* Sidebar */}
                <div style={{ width: 220, padding: 24, paddingRight: 16, borderRight: "1px solid var(--border, #e8e5e0)", flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg, #f5f4f1)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dark, #1a1a1a)" }}>Settings</span>
                        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #6b6b6b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <X size={18} strokeWidth={2} />
                        </button>
                    </div>

                    <button style={navBtn(tab === "general")} onClick={() => setTab("general")}>
                        <Settings size={18} strokeWidth={2} /> General
                    </button>
                    <button style={navBtn(tab === "api")} onClick={() => setTab("api")}>
                        <Key size={18} strokeWidth={2} /> API Keys
                    </button>
                    <button style={navBtn(tab === "preferences")} onClick={() => setTab("preferences")}>
                        <Shield size={18} strokeWidth={2} /> Preferences
                    </button>
                    
                    <div style={{ marginTop: "auto" }}>
                        <button 
                            onClick={async () => {
                                try { await auth.signOut(); onClose(); } 
                                catch (err) { console.error("Logout failed:", err); }
                            }}
                            style={{ 
                                ...navBtn(false), 
                                color: "#EF4444", 
                                marginTop: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 12
                            }}
                            onMouseOver={e => e.currentTarget.style.background = "rgba(239, 68, 68, 0.05)"}
                            onMouseOut={e => e.currentTarget.style.background = "transparent"}
                        >
                            <LogOut size={18} strokeWidth={2} /> Sign Out
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div style={{ flex: 1, padding: "40px 48px", overflowY: "auto", background: "var(--card-bg, #ffffff)" }}>
                    {tab === "general" && <>
                        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text-dark, #1a1a1a)", margin: "0 0 6px 0" }}>Account Settings</h2>
                        <p style={{ color: "var(--text-muted, #6b6b6b)", fontSize: 13, marginBottom: 32, margin: 0 }}>Manage your account details and profile.</p>
                        
                        <div style={{ marginTop: 24 }}>
                            <div style={row}>
                                <span style={{ color: "var(--text-muted, #6b6b6b)" }}>Username</span>
                                <span style={{ fontWeight: 600 }}>{user?.displayName || "vinny"}</span>
                            </div>
                            <div style={row}>
                                <span style={{ color: "var(--text-muted, #6b6b6b)" }}>Email</span>
                                <span style={{ fontWeight: 600 }}>{user?.email || "vinny@gmail.com"}</span>
                            </div>
                        </div>

                        {/* WhatsApp linking */}
                        <div style={{ marginTop: 36 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <MessageCircle size={16} strokeWidth={2} style={{ color: "var(--accent, #944E87)" }} />
                                <h3 style={{ fontWeight: 700, fontSize: 14, color: "var(--text-dark, #1a1a1a)", margin: 0 }}>
                                    WhatsApp
                                </h3>
                            </div>
                            <p style={{ color: "var(--text-muted, #6b6b6b)", fontSize: 12, margin: "0 0 16px 0", lineHeight: 1.5 }}>
                                Link your number to save notes and ask questions from WhatsApp.
                            </p>

                            {linkedPhone ? (
                                <div style={{ ...row, borderBottom: "none" }}>
                                    <span style={{ fontWeight: 600 }}>{linkedPhone}</span>
                                    <button
                                        onClick={removePhone}
                                        disabled={phoneBusy}
                                        style={{
                                            background: "none", border: "1px solid var(--border, #e8e5e0)",
                                            borderRadius: 20, padding: "6px 14px", fontSize: 12,
                                            fontWeight: 600, color: "#EF4444",
                                            cursor: phoneBusy ? "default" : "pointer",
                                            opacity: phoneBusy ? 0.6 : 1,
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: "flex", gap: 10 }}>
                                    <input
                                        style={{ ...inp, flex: 1 }}
                                        type="tel"
                                        placeholder="+91 89555 58388"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter" && phone.trim()) savePhone(); }}
                                    />
                                    <button
                                        onClick={savePhone}
                                        disabled={phoneBusy || !phone.trim()}
                                        style={{
                                            padding: "12px 22px",
                                            background: "var(--accent, #944E87)", color: "#fff",
                                            border: "none", borderRadius: 24,
                                            fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                                            cursor: (phoneBusy || !phone.trim()) ? "default" : "pointer",
                                            opacity: (phoneBusy || !phone.trim()) ? 0.5 : 1,
                                        }}
                                    >
                                        {phoneBusy ? "Linking…" : "Link"}
                                    </button>
                                </div>
                            )}

                            {phoneStatus && (
                                <p style={{
                                    fontSize: 12, marginTop: 12, marginBottom: 0,
                                    color: phoneStatus.type === "ok" ? "#16A34A" : "#EF4444",
                                }}>
                                    {phoneStatus.text}
                                </p>
                            )}
                        </div>
                    </>}

                    {tab === "api" && <>
                        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text-dark, #1a1a1a)", margin: "0 0 6px 0" }}>API Configuration</h2>
                        <p style={{ color: "var(--text-muted, #6b6b6b)", fontSize: 13, margin: "0 0 32px 0" }}>Custom provider keys for AI features.</p>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                            {[
                                { label: "GROQ API KEY", key: "groq", ph: "Enter your Groq key" },
                                { label: "SARVAM API KEY", key: "sarvam", ph: "Enter your Sarvam key" },
                                { label: "JINA AI API KEY", key: "jina", ph: "Enter your Jina AI key" },
                            ].map(({ label, key, ph }) => (
                                <div key={key}>
                                    <label style={inpLabel}>{label}</label>
                                    <input 
                                        style={inp} 
                                        type="password" 
                                        placeholder={ph}
                                        value={apiKeys[key] || ""} 
                                        onChange={e => setApiKeys(k => ({ ...k, [key]: e.target.value }))} 
                                    />
                                </div>
                            ))}
                        </div>

                        <button 
                            onClick={saveKeys}
                            style={{ 
                                padding: "12px 24px", 
                                background: "var(--accent, #944E87)", 
                                color: "#fff", 
                                border: "none", 
                                borderRadius: 24, 
                                fontSize: 13, 
                                fontWeight: 600, 
                                cursor: "pointer", 
                                marginTop: 24,
                                transition: "opacity 0.2s"
                            }}
                            onMouseOver={e => e.currentTarget.style.opacity = 0.9}
                            onMouseOut={e => e.currentTarget.style.opacity = 1}
                        >
                            {saved ? "✓ Saved" : "Save Keys"}
                        </button>
                    </>}

                    {tab === "preferences" && <>
                        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text-dark, #1a1a1a)", margin: "0 0 6px 0" }}>Preferences</h2>
                        <p style={{ color: "var(--text-muted, #6b6b6b)", fontSize: 13, margin: "0 0 32px 0" }}>Application settings and customizations.</p>
                        <div style={{ color: "var(--text-muted, #6b6b6b)", fontSize: 13, fontStyle: "italic" }}>
                            Preference options coming soon.
                        </div>
                    </>}
                </div>
            </div>
        </div>
    );
}
