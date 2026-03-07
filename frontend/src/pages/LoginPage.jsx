import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const GOOGLE_SVG = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
);

const SAMPLE_NOTES = [
    { topic: "PHILOSOPHY", tc: "#EDE9FE", tt: "#7C3AED", title: "Notes on Stoicism", excerpt: "A brief introduction to the principles of control and..." },
    { topic: "ENGINEERING", tc: "#DBEAFE", tt: "#2563EB", title: "React Performance Tips", excerpt: "Minimizing re-renders, using useMemo efficiently..." },
    { topic: "WORK", tc: "#D1FAE5", tt: "#065F46", title: "Q1 Marketing Strategy", excerpt: "Focusing on inbound leads across channels." },
];

export default function LoginPage() {
    const [tab, setTab] = useState("signin");
    const [form, setForm] = useState({ username: "", email: "", password: "", confirm: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { loginWithCredentials, registerWithCredentials, loginWithGoogle } = useAuth();
    const navigate = useNavigate();

    const upd = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
    const clean = msg => msg?.replace("Firebase: ", "").replace(/\(auth\/[^)]+\)/, "").trim();

    const submit = async () => {
        setLoading(true); setError("");
        try {
            if (tab === "signin") {
                await loginWithCredentials(form.email, form.password);
            } else {
                if (form.password !== form.confirm) throw new Error("Passwords do not match");
                if (!form.username.trim()) throw new Error("Username is required");
                await registerWithCredentials(form.username.trim(), form.email, form.password);
            }
            navigate("/vault");
        } catch (e) { setError(clean(e.message)); }
        finally { setLoading(false); }
    };

    const googleAuth = async () => {
        setError("");
        try { await loginWithGoogle(); navigate("/vault"); }
        catch (e) { setError(clean(e.message)); }
    };

    const inp = { width: "100%", padding: "12px 14px", border: "1px solid #E5E5EA", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit", background: "#fff", color: "#1A1A2E", transition: "border 0.2s" };
    const focus = e => e.target.style.borderColor = "#7C3AED";
    const blur = e => e.target.style.borderColor = "#E5E5EA";

    return (
        <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter,sans-serif" }}>
            {/* LEFT */}
            <div style={{ flex: 1, background: "#fff", display: "flex", flexDirection: "column", padding: "36px 48px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 40 }}>
                    <span style={{ fontSize: 22 }}>🧠</span>
                    <span style={{ fontWeight: 800, fontSize: 18, color: "#1A1A2E" }}>MindVault</span>
                </div>
                <div style={{ maxWidth: 400, width: "100%", margin: "auto" }}>
                    <h2 style={{ fontWeight: 700, fontSize: 26, color: "#1A1A2E", marginBottom: 4 }}>
                        {tab === "signin" ? "Welcome back" : "Create account"}
                    </h2>
                    <p style={{ color: "#6B6B80", fontSize: 13, marginBottom: 24 }}>Sign up to start your journey with MindVault!</p>

                    <div style={{ display: "flex", borderBottom: "2px solid #E5E5EA", marginBottom: 24 }}>
                        {[["signin", "Sign In"], ["signup", "Sign Up"]].map(([k, l]) => (
                            <button key={k} onClick={() => { setTab(k); setError(""); }}
                                style={{
                                    flex: 1, paddingBottom: 10, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
                                    color: tab === k ? "#7C3AED" : "#A0A0B0", borderBottom: tab === k ? "2px solid #7C3AED" : "2px solid transparent", marginBottom: -2
                                }}>
                                {l}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {tab === "signup" && (
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 5, color: "#1A1A2E" }}>Username</label>
                                <input style={inp} placeholder="e.g. mindhacker" value={form.username} onChange={upd("username")} onFocus={focus} onBlur={blur} />
                            </div>
                        )}
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 5, color: "#1A1A2E" }}>Email</label>
                            <input style={inp} type="email" placeholder="you@example.com" value={form.email} onChange={upd("email")} onFocus={focus} onBlur={blur} />
                        </div>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 5, color: "#1A1A2E" }}>Password</label>
                            <input style={inp} type="password" placeholder="At least 8 characters" value={form.password} onChange={upd("password")} onFocus={focus} onBlur={blur} />
                        </div>
                        {tab === "signup" && (
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 5, color: "#1A1A2E" }}>Confirm Password</label>
                                <input style={inp} type="password" placeholder="Confirm your password" value={form.confirm} onChange={upd("confirm")} onFocus={focus} onBlur={blur} />
                            </div>
                        )}

                        {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{error}</div>}

                        <button onClick={submit} disabled={loading}
                            style={{ padding: "13px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
                            {loading ? "Please wait..." : tab === "signin" ? "Sign In" : "Sign Up"}
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ flex: 1, height: 1, background: "#E5E5EA" }} />
                            <span style={{ color: "#A0A0B0", fontSize: 13 }}>OR</span>
                            <div style={{ flex: 1, height: 1, background: "#E5E5EA" }} />
                        </div>

                        <button onClick={googleAuth}
                            style={{ padding: "12px", background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#1A1A2E" }}>
                            {GOOGLE_SVG} {tab === "signin" ? "Sign In with Google" : "Sign Up with Google"}
                        </button>
                    </div>
                </div>
            </div>

            {/* RIGHT */}
            <div style={{ flex: 1, background: "#7C3AED", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.15) 1px,transparent 1px)", backgroundSize: "28px 28px" }} />
                <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 300, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", position: "relative", zIndex: 1, marginBottom: 28 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ fontSize: 16 }}>🧠</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#1A1A2E" }}>MindVault</span>
                    </div>
                    {SAMPLE_NOTES.map((n, i) => (
                        <div key={i} style={{ padding: "10px 0", borderBottom: i < 2 ? "1px solid #F0F0F5" : "none" }}>
                            <span style={{ background: n.tc, color: n.tt, fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, letterSpacing: 0.5 }}>{n.topic}</span>
                            <p style={{ fontWeight: 600, fontSize: 12, color: "#1A1A2E", marginTop: 5 }}>{n.title}</p>
                            <p style={{ fontSize: 11, color: "#6B6B80", marginTop: 2 }}>{n.excerpt}</p>
                        </div>
                    ))}
                </div>
                <h2 style={{ color: "#fff", fontSize: 26, fontWeight: 800, textAlign: "center", lineHeight: 1.3, zIndex: 1, marginBottom: 10 }}>All your knowledge<br />in one place</h2>
                <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center", zIndex: 1, maxWidth: 260, lineHeight: 1.6 }}>Save articles, notes, and ideas. MindVault organizes everything and helps you think better.</p>
                <div style={{ display: "flex", gap: 6, marginTop: 18, zIndex: 1 }}>
                    {[0, 1, 2].map(i => <div key={i} style={{ width: i === 0 ? 20 : 6, height: 6, borderRadius: 3, background: i === 0 ? "#fff" : "rgba(255,255,255,0.4)" }} />)}
                </div>
            </div>
        </div>
    );
}
