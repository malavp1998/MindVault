import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import logo from "../assets/logo.png";

const GOOGLE_SVG = (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
);

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

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'rgb(255, 255, 255)', overflow: 'hidden' }}>
            
            {/* LEFT AREA: Form */}
            <div style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column', padding: '40px 60px', position: 'relative' }}>
                <div style={{ marginBottom: 32, height: 40 }}></div>
                <div style={{ maxWidth: 400, width: '100%', margin: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    
                    {/* Headers */}
                    {tab === "signin" ? (
                        <>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-dark)', marginBottom: 4 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', fontWeight: 500 }}>Welcome back to,</span>
                                    <img alt="MindVault" src={logo} style={{ height: '2.5em', alignSelf: 'flex-start', marginLeft: -4 }} />
                                </div>
                            </h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: 24 }}>Welcome back to your second brain.</p>
                        </>
                    ) : (
                        <>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-dark)', marginBottom: 4 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                                    Join 
                                    <img alt="MindVault" src={logo} style={{ height: '2.5em', verticalAlign: 'middle' }} />
                                </span>
                            </h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: 24 }}>Start building your digital memory today.</p>
                        </>
                    )}

                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: 24, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
                        <button 
                            onClick={() => { setTab("signin"); setError(""); }}
                            style={{ 
                                paddingBottom: 12, background: 'none', borderTop: 'none', borderRight: 'none', 
                                borderBottom: tab === 'signin' ? '2px solid var(--accent)' : '2px solid transparent', 
                                borderLeft: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, 
                                textTransform: 'uppercase', letterSpacing: '0.05em', 
                                color: tab === 'signin' ? 'var(--accent)' : 'var(--text-muted)', 
                                marginBottom: -1, transition: '0.2s' 
                            }}>
                            Sign In
                        </button>
                        <button 
                            onClick={() => { setTab("signup"); setError(""); }}
                            style={{ 
                                paddingBottom: 12, background: 'none', borderTop: 'none', borderRight: 'none', 
                                borderBottom: tab === 'signup' ? '2px solid var(--accent)' : '2px solid transparent', 
                                borderLeft: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, 
                                textTransform: 'uppercase', letterSpacing: '0.05em', 
                                color: tab === 'signup' ? 'var(--accent)' : 'var(--text-muted)', 
                                marginBottom: -1, transition: '0.2s' 
                            }}>
                            Sign Up
                        </button>
                    </div>

                    {/* Form Input Container */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {tab === 'signup' && (
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Username</label>
                                <input 
                                    placeholder="e.g. archivist" 
                                    value={form.username}
                                    onChange={upd('username')}
                                    style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, outline: 'none', background: 'rgb(249, 249, 249)', color: 'var(--text-dark)', transition: '0.2s' }} 
                                />
                            </div>
                        )}
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Email Address</label>
                            <input 
                                placeholder="you@example.com" type="email" 
                                value={form.email}
                                onChange={upd('email')}
                                style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, outline: 'none', background: 'rgb(249, 249, 249)', color: 'var(--text-dark)', transition: '0.2s' }} 
                            />
                        </div>
                        
                        {tab === 'signin' ? (
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Password</label>
                                <input 
                                    placeholder="••••••••" type="password" 
                                    value={form.password}
                                    onChange={upd('password')}
                                    style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, outline: 'none', background: 'rgb(249, 249, 249)', color: 'var(--text-dark)', transition: '0.2s' }} 
                                />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ flex: '1 1 0%' }}>
                                    <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Password</label>
                                    <input 
                                        placeholder="••••••••" type="password" 
                                        value={form.password}
                                        onChange={upd('password')}
                                        style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, outline: 'none', background: 'rgb(249, 249, 249)', color: 'var(--text-dark)', transition: '0.2s' }} 
                                    />
                                </div>
                                <div style={{ flex: '1 1 0%' }}>
                                    <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Confirm Password</label>
                                    <input 
                                        placeholder="••••••••" type="password" 
                                        value={form.confirm}
                                        onChange={upd('confirm')}
                                        style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, outline: 'none', background: 'rgb(249, 249, 249)', color: 'var(--text-dark)', transition: '0.2s' }} 
                                    />
                                </div>
                            </div>
                        )}

                        {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 12, padding: "12px 16px", fontSize: 13 }}>{error}</div>}

                        <button onClick={submit} disabled={loading} style={{ padding: '16px', background: 'var(--accent)', color: 'rgb(255, 255, 255)', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 12, boxShadow: '0 8px 24px var(--accent-light)', transition: 'transform 0.2s', opacity: loading ? 0.7 : 1 }}>
                            {loading ? "Please wait..." : tab === 'signin' ? "Sign In" : "Create Account"}
                        </button>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '12px 0px' }}>
                            <div style={{ flex: '1 1 0%', height: 1, background: 'var(--border)' }}></div>
                            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>OR</span>
                            <div style={{ flex: '1 1 0%', height: 1, background: 'var(--border)' }}></div>
                        </div>
                        
                        <button onClick={googleAuth} disabled={loading} style={{ padding: '12px', background: 'rgb(255, 255, 255)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-dark)', transition: 'background 0.2s', opacity: loading ? 0.7 : 1 }}>
                            {GOOGLE_SVG} {tab === 'signin' ? "Sign in with Google" : "Sign up with Google"}
                        </button>
                    </div>
                    
                    <div style={{ marginTop: 24, color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
                        By continuing, you agree to our Terms and Privacy Policy.
                    </div>
                </div>
            </div>

            {/* RIGHT AREA: Illustration panel */}
            <div style={{ flex: '1.2 1 0%', background: 'var(--accent)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, position: 'relative', overflow: 'hidden' }}>
                <img alt="MindVault" src={logo} style={{ position: 'absolute', top: 40, right: 40, height: 64, filter: 'brightness(0) invert(1)', zIndex: 10, opacity: 0.9 }} />
                
                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'radial-gradient(rgb(255, 255, 255) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
                <div style={{ position: 'absolute', top: '10%', right: '10%', width: 150, height: 150, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.1)', filter: 'blur(40px)' }}></div>
                <div style={{ position: 'absolute', bottom: '15%', left: '5%', width: 200, height: 200, borderRadius: '50%', background: 'rgba(0, 0, 0, 0.1)', filter: 'blur(60px)' }}></div>
                
                <div style={{ position: 'relative', width: '100%', maxWidth: 360, transform: 'rotate(-2deg)' }}>
                    <div style={{ background: 'rgb(255, 255, 255)', borderRadius: 24, padding: 32, boxShadow: 'rgba(0, 0, 0, 0.2) 0px 40px 80px', position: 'relative', zIndex: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgb(255, 95, 86)' }}></div>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgb(255, 189, 46)' }}></div>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgb(39, 201, 63)' }}></div>
                        </div>
                        <div style={{ padding: '16px 0px', borderBottom: '1px solid rgb(240, 240, 240)' }}>
                            <span style={{ background: 'rgb(245, 243, 255)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, letterSpacing: '0.02em' }}>PHILOSOPHY</span>
                            <h4 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-dark)', marginTop: 10, marginBottom: 4 }}>Notes on Stoicism</h4>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>Focus on what you can control. The rest is noise.</p>
                        </div>
                        <div style={{ padding: '16px 0px', borderBottom: '1px solid rgb(240, 240, 240)' }}>
                            <span style={{ background: 'rgb(239, 246, 255)', color: 'rgb(37, 99, 235)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, letterSpacing: '0.02em' }}>ENGINEERING</span>
                            <h4 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-dark)', marginTop: 10, marginBottom: 4 }}>React Performance</h4>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>Understanding the virtual DOM and reconciliation...</p>
                        </div>
                        <div style={{ padding: '16px 0px', borderBottom: 'none' }}>
                            <span style={{ background: 'rgb(236, 253, 245)', color: 'rgb(5, 150, 105)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, letterSpacing: '0.02em' }}>IDEAS</span>
                            <h4 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-dark)', marginTop: 10, marginBottom: 4 }}>Future Projects</h4>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>Exploring zero-knowledge proofs for data privacy.</p>
                        </div>
                    </div>
                    {/* Fake cards behind for a 3D effect stack */}
                    <div style={{ position: 'absolute', inset: '15px -15px -15px 15px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: 24, zIndex: 2 }}></div>
                    <div style={{ position: 'absolute', inset: '30px -30px -30px 30px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 24, zIndex: 1 }}></div>
                </div>

                <div style={{ textAlign: 'center', marginTop: 40, zIndex: 4 }}>
                    <h2 style={{ color: 'rgb(255, 255, 255)', fontSize: '2.2rem', fontWeight: 700, marginBottom: 12, lineHeight: 1.2 }}>Forget forgetting.</h2>
                    <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '1rem', maxWidth: 340, lineHeight: 1.6, margin: '0px auto' }}>MindVault uses active recall and AI synthesis to make sure you never lose an idea again.</p>
                </div>
            </div>
        </div>
    );
}

