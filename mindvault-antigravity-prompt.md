# MindVault — Antigravity Prompt
## Full Firebase Migration + Light Theme UI Redesign

---

> **Scope:** Replace JWT auth with Firebase Auth (frontend + backend) + redesign frontend from dark to light theme.
> **Do NOT touch:** AI pipeline, embeddings, RAG, clustering, MCP server, database schema (except adding `firebase_uid`).

---

## Firebase Config (already live)
```
Project ID:    mindvault-1
Auth domain:   mindvault-1.firebaseapp.com
API key:       ***REMOVED***
App ID:        1:927591646375:web:34c3cdbf8772ab92be8782
```

---

# BACKEND CHANGES

## B1 — Install firebase-admin
Add to `backend/requirements.txt` and `backend/requirements-local.txt`:
```
firebase-admin>=6.5.0
```
Also **remove** `python-jose` from requirements (JWT no longer used).

## B2 — Service Account Setup
- Developer downloads service account JSON from:
  Firebase Console → Project Settings → Service Accounts → Generate new private key
- Place file at: `backend/firebase-service-account.json`
- Add to `backend/.env`:
  ```
  FIREBASE_PROJECT_ID=mindvault-1
  ```

## B3 — REPLACE backend/middleware/auth.py
```python
from __future__ import annotations
"""Firebase authentication middleware — verifies Firebase ID tokens."""

import uuid, os, logging, pathlib
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

from database import get_db
from models import User

logger = logging.getLogger(__name__)
security = HTTPBearer()

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized or firebase_admin._DEFAULT_APP_NAME in firebase_admin._apps:
        _firebase_initialized = True
        return
    sa_path = pathlib.Path(__file__).parent.parent / "firebase-service-account.json"
    cred = credentials.Certificate(str(sa_path)) if sa_path.exists() else credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": os.getenv("FIREBASE_PROJECT_ID", "mindvault-1")})
    _firebase_initialized = True
    logger.info("✅ Firebase Admin SDK initialized")

_init_firebase()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    id_token = credentials.credentials
    try:
        decoded = firebase_auth.verify_id_token(id_token)
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firebase token expired")
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Firebase token")
    except Exception as e:
        logger.warning(f"Firebase token verification failed: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token verification failed")

    firebase_uid: str = decoded["uid"]
    email: str = decoded.get("email", "")
    display_name: str = decoded.get("name", "") or decoded.get("display_name", "")

    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user:
        username = display_name or (email.split("@")[0] if email else firebase_uid[:12])
        base_username = username
        suffix = 1
        while True:
            existing = await db.execute(select(User).where(User.username == username))
            if not existing.scalar_one_or_none():
                break
            username = f"{base_username}{suffix}"
            suffix += 1
        user = User(firebase_uid=firebase_uid, username=username, email=email or None)
        db.add(user)
        await db.flush()
        await db.refresh(user)
        logger.info(f"Auto-provisioned new user: {username} (uid={firebase_uid})")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled")

    return user


CurrentUser = Depends(get_current_user)
```

## B4 — ADD firebase_uid to backend/models.py
Inside the `User` class, after `hashed_password`:
```python
firebase_uid: Mapped[Optional[str]] = mapped_column(
    VARCHAR(128), unique=True, nullable=True, index=True
)
```

In `database.py` inside `init_db()`, after existing table creation:
```python
await conn.execute(text(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) UNIQUE"
))
```

## B5 — REPLACE backend/routes/auth.py
```python
from __future__ import annotations
"""Auth routes — Firebase handles login/register. Only /me and /logout remain."""

from fastapi import APIRouter
from middleware.auth import CurrentUser
from models import User
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


@router.get("/me")
async def get_me(current_user: User = CurrentUser):
    return {
        "id": str(current_user.id),
        "firebase_uid": current_user.firebase_uid,
        "username": current_user.username,
        "email": current_user.email,
        "created_at": str(current_user.created_at),
        "last_login": str(current_user.last_login) if current_user.last_login else None,
    }

@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}
```

## B6 — CLEAN backend/services/auth.py
Remove: `create_access_token`, `decode_token`, and their imports (`from jose import JWTError, jwt`).
Keep: `hash_password`, `verify_password`, `validate_password_strength`, all user CRUD functions.

## B7 — CLEAN backend/config.py
Remove from `Settings` class:
- `jwt_secret_key`
- `jwt_algorithm`
- `jwt_access_token_expire_minutes`

Add:
```python
firebase_project_id: str = "mindvault-1"
```

---

# FRONTEND CHANGES

## F1 — Install Firebase
```bash
npm install firebase
```

## F2 — CREATE src/firebase.js
```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "***REMOVED***",
  authDomain: "mindvault-1.firebaseapp.com",
  databaseURL: "https://mindvault-1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mindvault-1",
  storageBucket: "mindvault-1.firebasestorage.app",
  messagingSenderId: "927591646375",
  appId: "1:927591646375:web:34c3cdbf8772ab92be8782",
  measurementId: "G-7PHBNGKBGX"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export default app;
```

## F3 — REPLACE src/context/AuthContext.jsx
```jsx
import { createContext, useContext, useState, useEffect } from "react";
import { auth } from "../firebase";
import {
  onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, updateProfile
} from "firebase/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [token, setToken]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const idToken = await firebaseUser.getIdToken();
        const userData = {
          id: firebaseUser.uid,
          username: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "user",
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
        };
        setToken(idToken);
        setUser(userData);
        if (typeof chrome !== "undefined" && chrome.storage)
          chrome.storage.local.set({ mv_token: idToken, mv_user: JSON.stringify(userData) });
      } else {
        setUser(null); setToken(null);
        if (typeof chrome !== "undefined" && chrome.storage)
          chrome.storage.local.remove(["mv_token", "mv_user"]);
      }
      setLoading(false);
    });
  }, []);

  // Refresh token every 50 min (expires at 60 min)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (auth.currentUser) {
        const newToken = await auth.currentUser.getIdToken(true);
        setToken(newToken);
        if (typeof chrome !== "undefined" && chrome.storage)
          chrome.storage.local.set({ mv_token: newToken });
      }
    }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const loginWithCredentials   = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const loginWithGoogle        = () => signInWithPopup(auth, new GoogleAuthProvider());
  const registerWithCredentials = async (username, email, password) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: username });
    return result.user;
  };
  const logout = () => {
    signOut(auth);
    if (typeof chrome !== "undefined" && chrome.storage)
      chrome.storage.local.remove(["mv_token", "mv_user"]);
  };
  const login = () => {}; // legacy shim

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, loginWithCredentials, registerWithCredentials, loginWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

## F4 — REPLACE src/api.js
```js
import axios from "axios";
import { auth } from "./firebase";

const API_URL = import.meta.env.VITE_API_URL || "";
export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use(async (config) => {
  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

---

# UI REDESIGN — LIGHT THEME

## F5 — UPDATE src/index.css variables
Replace the `:root` block and update these class rules:
```css
:root {
  --bg-primary: #F5F5F7;
  --bg-secondary: #FFFFFF;
  --bg-card: #FFFFFF;
  --bg-card-hover: #F9F9FB;
  --border: #E5E5EA;
  --border-hover: rgba(124, 58, 237, 0.3);
  --text-primary: #1A1A2E;
  --text-secondary: #6B6B80;
  --text-muted: #A0A0B0;
  --accent: #7C3AED;
  --accent-light: #8B5CF6;
  --accent-hover: #6D28D9;
  --accent-glow: rgba(124, 58, 237, 0.10);
  --gradient-primary: linear-gradient(135deg, #7C3AED, #A855F7);
  --radius: 14px;
  --radius-sm: 10px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.07);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.07);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.09);
}
body { background: var(--bg-primary); color: var(--text-primary); }
.app-sidebar { background: #FFFFFF; border-right: 1px solid var(--border); }
.nav-link { color: var(--text-secondary); }
.nav-link:hover { background: rgba(0,0,0,0.03); color: var(--text-primary); }
.nav-link.active { background: #EDE9FE; color: #7C3AED; border-left: 3px solid #7C3AED; }
.card { background: #FFFFFF; border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
.card:hover { background: #FAFAFA; border-color: var(--border-hover); box-shadow: var(--shadow-md); }
.sidebar-logo h1 { background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.app-main { background: var(--bg-primary); }
```

## F6 — REPLACE src/pages/LoginPage.jsx
Two-column layout. Left = form with Sign In / Sign Up tabs + Google OAuth. Right = purple panel with decorative note cards.

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const GOOGLE_SVG = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
);

const SAMPLE_NOTES = [
  { topic:"PHILOSOPHY", tc:"#EDE9FE", tt:"#7C3AED", title:"Notes on Stoicism",       excerpt:"A brief introduction to the principles of control and..." },
  { topic:"ENGINEERING", tc:"#DBEAFE", tt:"#2563EB", title:"React Performance Tips",  excerpt:"Minimizing re-renders, using useMemo efficiently..." },
  { topic:"WORK",        tc:"#D1FAE5", tt:"#065F46", title:"Q1 Marketing Strategy",   excerpt:"Focusing on inbound leads across channels." },
];

export default function LoginPage() {
  const [tab, setTab] = useState("signin");
  const [form, setForm] = useState({ username:"", email:"", password:"", confirm:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { loginWithCredentials, registerWithCredentials, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const upd   = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const clean = msg => msg?.replace("Firebase: ","").replace(/\(auth\/[^)]+\)/,"").trim();

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
    } catch(e) { setError(clean(e.message)); }
    finally { setLoading(false); }
  };

  const googleAuth = async () => {
    setError("");
    try { await loginWithGoogle(); navigate("/vault"); }
    catch(e) { setError(clean(e.message)); }
  };

  const inp = { width:"100%", padding:"12px 14px", border:"1px solid #E5E5EA", borderRadius:10, fontSize:14, outline:"none", fontFamily:"inherit", background:"#fff", color:"#1A1A2E", transition:"border 0.2s" };
  const focus = e => e.target.style.borderColor = "#7C3AED";
  const blur  = e => e.target.style.borderColor = "#E5E5EA";

  return (
    <div style={{ display:"flex", minHeight:"100vh", fontFamily:"Inter,sans-serif" }}>
      {/* LEFT */}
      <div style={{ flex:1, background:"#fff", display:"flex", flexDirection:"column", padding:"36px 48px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:40 }}>
          <span style={{ fontSize:22 }}>🧠</span>
          <span style={{ fontWeight:800, fontSize:18, color:"#1A1A2E" }}>MindVault</span>
        </div>
        <div style={{ maxWidth:400, width:"100%", margin:"auto" }}>
          <h2 style={{ fontWeight:700, fontSize:26, color:"#1A1A2E", marginBottom:4 }}>
            {tab==="signin" ? "Welcome back" : "Create account"}
          </h2>
          <p style={{ color:"#6B6B80", fontSize:13, marginBottom:24 }}>Sign up to start your journey with MindVault!</p>

          <div style={{ display:"flex", borderBottom:"2px solid #E5E5EA", marginBottom:24 }}>
            {[["signin","Sign In"],["signup","Sign Up"]].map(([k,l]) => (
              <button key={k} onClick={() => { setTab(k); setError(""); }}
                style={{ flex:1, paddingBottom:10, background:"none", border:"none", cursor:"pointer", fontWeight:600, fontSize:14,
                  color:tab===k?"#7C3AED":"#A0A0B0", borderBottom:tab===k?"2px solid #7C3AED":"2px solid transparent", marginBottom:-2 }}>
                {l}
              </button>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {tab==="signup" && (
              <div>
                <label style={{ fontSize:13, fontWeight:500, display:"block", marginBottom:5, color:"#1A1A2E" }}>Username</label>
                <input style={inp} placeholder="e.g. mindhacker" value={form.username} onChange={upd("username")} onFocus={focus} onBlur={blur} />
              </div>
            )}
            <div>
              <label style={{ fontSize:13, fontWeight:500, display:"block", marginBottom:5, color:"#1A1A2E" }}>Email</label>
              <input style={inp} type="email" placeholder="you@example.com" value={form.email} onChange={upd("email")} onFocus={focus} onBlur={blur} />
            </div>
            <div>
              <label style={{ fontSize:13, fontWeight:500, display:"block", marginBottom:5, color:"#1A1A2E" }}>Password</label>
              <input style={inp} type="password" placeholder="At least 8 characters" value={form.password} onChange={upd("password")} onFocus={focus} onBlur={blur} />
            </div>
            {tab==="signup" && (
              <div>
                <label style={{ fontSize:13, fontWeight:500, display:"block", marginBottom:5, color:"#1A1A2E" }}>Confirm Password</label>
                <input style={inp} type="password" placeholder="Confirm your password" value={form.confirm} onChange={upd("confirm")} onFocus={focus} onBlur={blur} />
              </div>
            )}

            {error && <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", borderRadius:10, padding:"10px 14px", fontSize:13 }}>{error}</div>}

            <button onClick={submit} disabled={loading}
              style={{ padding:"13px", background:"#7C3AED", color:"#fff", border:"none", borderRadius:12, fontSize:15, fontWeight:600, cursor:"pointer", opacity:loading?0.7:1 }}>
              {loading ? "Please wait..." : tab==="signin" ? "Sign In" : "Sign Up"}
            </button>

            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ flex:1, height:1, background:"#E5E5EA" }} />
              <span style={{ color:"#A0A0B0", fontSize:13 }}>OR</span>
              <div style={{ flex:1, height:1, background:"#E5E5EA" }} />
            </div>

            <button onClick={googleAuth}
              style={{ padding:"12px", background:"#fff", border:"1px solid #E5E5EA", borderRadius:12, fontSize:14, fontWeight:500, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, color:"#1A1A2E" }}>
              {GOOGLE_SVG} {tab==="signin" ? "Sign In with Google" : "Sign Up with Google"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ flex:1, background:"#7C3AED", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:48, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(rgba(255,255,255,0.15) 1px,transparent 1px)", backgroundSize:"28px 28px" }} />
        <div style={{ background:"#fff", borderRadius:20, padding:24, width:"100%", maxWidth:300, boxShadow:"0 20px 60px rgba(0,0,0,0.2)", position:"relative", zIndex:1, marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
            <span style={{ fontSize:16 }}>🧠</span>
            <span style={{ fontWeight:700, fontSize:14, color:"#1A1A2E" }}>MindVault</span>
          </div>
          {SAMPLE_NOTES.map((n,i) => (
            <div key={i} style={{ padding:"10px 0", borderBottom:i<2?"1px solid #F0F0F5":"none" }}>
              <span style={{ background:n.tc, color:n.tt, fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:20, letterSpacing:0.5 }}>{n.topic}</span>
              <p style={{ fontWeight:600, fontSize:12, color:"#1A1A2E", marginTop:5 }}>{n.title}</p>
              <p style={{ fontSize:11, color:"#6B6B80", marginTop:2 }}>{n.excerpt}</p>
            </div>
          ))}
        </div>
        <h2 style={{ color:"#fff", fontSize:26, fontWeight:800, textAlign:"center", lineHeight:1.3, zIndex:1, marginBottom:10 }}>All your knowledge<br/>in one place</h2>
        <p style={{ color:"rgba(255,255,255,0.75)", fontSize:14, textAlign:"center", zIndex:1, maxWidth:260, lineHeight:1.6 }}>Save articles, notes, and ideas. MindVault organizes everything and helps you think better.</p>
        <div style={{ display:"flex", gap:6, marginTop:18, zIndex:1 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:i===0?20:6, height:6, borderRadius:3, background:i===0?"#fff":"rgba(255,255,255,0.4)" }} />)}
        </div>
      </div>
    </div>
  );
}
```

## F7 — UPDATE src/App.jsx — Sidebar
Add imports at top:
```jsx
import { useState } from 'react';
import SettingsModal from './components/SettingsModal';
```

Replace the `Sidebar` function entirely:
```jsx
function Sidebar() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const navItems = [
    { to:"/",       end:true,  icon:"📚", label:"Vault"  },
    { to:"/topics",            icon:"🗺️", label:"Topics" },
    { to:"/search",            icon:"🔍", label:"Search" },
    { to:"/chat",              icon:"💬", label:"Chat"   },
  ];

  return (
    <nav style={{ width:220, background:"#fff", borderRight:"1px solid #E5E5EA", padding:"20px 0", position:"fixed", top:0, left:0, height:"100vh", display:"flex", flexDirection:"column", zIndex:100, fontFamily:"Inter,sans-serif" }}>
      <div style={{ padding:"0 20px 20px", borderBottom:"1px solid #E5E5EA", marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:20 }}>🧠</span>
          <div>
            <div style={{ fontWeight:800, fontSize:16, background:"linear-gradient(135deg,#7C3AED,#A855F7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>MindVault</div>
            <div style={{ fontSize:10, color:"#A0A0B0", letterSpacing:1, textTransform:"uppercase" }}>AI Second Brain</div>
          </div>
        </div>
      </div>

      <div style={{ padding:"0 10px", flex:1 }}>
        {navItems.map(({ to, end, icon, label }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `nav-link ${isActive?"active":""}`}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, marginBottom:2, fontSize:14, fontWeight:500, textDecoration:"none", transition:"all 0.15s" }}>
            <span style={{ fontSize:16, width:20, textAlign:"center" }}>{icon}</span> {label}
          </NavLink>
        ))}
      </div>

      <div style={{ position:"relative" }}>
        {menuOpen && (
          <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:10, right:10, background:"#fff", border:"1px solid #E5E5EA", borderRadius:14, boxShadow:"0 8px 24px rgba(0,0,0,0.10)", overflow:"hidden", zIndex:200 }}>
            <div style={{ padding:"10px 14px", borderBottom:"1px solid #F0F0F5" }}>
              <p style={{ fontSize:12, color:"#6B6B80", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.email}</p>
            </div>
            <button onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
              style={{ width:"100%", padding:"11px 14px", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontSize:14, color:"#1A1A2E", textAlign:"left" }}>
              ⚙️ Settings
            </button>
            <button onClick={() => { logout(); setMenuOpen(false); }}
              style={{ width:"100%", padding:"11px 14px", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontSize:14, color:"#DC2626", textAlign:"left" }}>
              → Log out
            </button>
          </div>
        )}
        <button onClick={() => setMenuOpen(o => !o)}
          style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"14px 16px", background:"none", border:"none", borderTop:"1px solid #F0F0F5", cursor:"pointer" }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:"#1A1A2E", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, flexShrink:0 }}>
            {user?.username?.[0]?.toUpperCase() || "U"}
          </div>
          <div style={{ flex:1, textAlign:"left", minWidth:0 }}>
            <p style={{ fontWeight:600, fontSize:13, color:"#1A1A2E", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.username}</p>
            <p style={{ fontSize:11, color:"#A0A0B0" }}>@{user?.username}</p>
          </div>
          <span style={{ color:"#A0A0B0", fontSize:12 }}>⇕</span>
        </button>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    </nav>
  );
}
```
Also update `.app-main` margin to `marginLeft: 220px`.

## F8 — CREATE src/components/SettingsModal.jsx
```jsx
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

  const overlay = { position:"fixed", inset:0, background:"rgba(0,0,0,0.25)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, fontFamily:"Inter,sans-serif" };
  const modal   = { background:"#fff", borderRadius:20, width:"90%", maxWidth:660, minHeight:360, boxShadow:"0 20px 60px rgba(0,0,0,0.15)", display:"flex", overflow:"hidden" };
  const navBtn  = active => ({ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"10px 12px", border:"none", borderRadius:10, cursor:"pointer", fontSize:14, fontWeight:500, background:active?"#EDE9FE":"transparent", color:active?"#7C3AED":"#1A1A2E", marginBottom:2 });
  const row     = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"13px 0", borderBottom:"1px solid #F0F0F5", fontSize:14, color:"#1A1A2E" };
  const inp     = { width:"100%", padding:"10px 13px", border:"1px solid #E5E5EA", borderRadius:10, fontSize:14, outline:"none", fontFamily:"inherit", background:"#FAFAFA", color:"#1A1A2E" };

  return (
    <div style={overlay} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ width:190, padding:18, borderRight:"1px solid #F0F0F5", flexShrink:0 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#A0A0B0", marginBottom:18, display:"block" }}>✕</button>
          <button style={navBtn(tab==="general")} onClick={() => setTab("general")}>⚙️ General</button>
          <button style={navBtn(tab==="api")}     onClick={() => setTab("api")}>🔑 API</button>
        </div>
        <div style={{ flex:1, padding:28, overflowY:"auto" }}>
          {tab==="general" && <>
            <h2 style={{ fontWeight:700, fontSize:20, color:"#1A1A2E", marginBottom:20 }}>General</h2>
            <div style={row}><span style={{ color:"#6B6B80" }}>Name</span><span style={{ fontWeight:500 }}>{user?.displayName || "User"}</span></div>
            <div style={row}><span style={{ color:"#6B6B80" }}>Email</span><span style={{ fontWeight:500 }}>{user?.email}</span></div>
            <div style={row}><span style={{ color:"#6B6B80" }}>Username</span><span style={{ fontWeight:500 }}><span style={{ color:"#A0A0B0" }}>@ </span>{user?.displayName || "user"}</span></div>
            <div style={row}>
              <span style={{ color:"#6B6B80" }}>Password</span>
              <span><span style={{ letterSpacing:3, color:"#A0A0B0" }}>••••••••</span>
                <button onClick={resetPassword} style={{ marginLeft:10, color:"#7C3AED", background:"none", border:"none", cursor:"pointer", fontWeight:600, fontSize:13 }}>Reset</button>
              </span>
            </div>
          </>}
          {tab==="api" && <>
            <h2 style={{ fontWeight:700, fontSize:20, color:"#1A1A2E", marginBottom:6 }}>API Configuration</h2>
            <p style={{ color:"#6B6B80", fontSize:13, marginBottom:22 }}>Configure your custom provider keys.</p>
            {[
              { label:"Groq",    key:"groq",   ph:"gsk_..."     },
              { label:"Sarvam",  key:"sarvam", ph:"sk_live_..." },
              { label:"Jina AI", key:"jina",   ph:"jina_..."    },
            ].map(({ label, key, ph }) => (
              <div key={key} style={{ marginBottom:16 }}>
                <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:5, color:"#1A1A2E" }}>{label}</label>
                <input style={inp} type="password" placeholder={ph}
                  value={apiKeys[key]||""} onChange={e => setApiKeys(k=>({...k,[key]:e.target.value}))} />
              </div>
            ))}
            <button onClick={saveKeys}
              style={{ padding:"10px 24px", background:"#7C3AED", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:600, cursor:"pointer", marginTop:6 }}>
              {saved ? "✓ Saved!" : "Save Changes"}
            </button>
          </>}
        </div>
      </div>
    </div>
  );
}
```

## F9 — RE-SKIN remaining pages (visual only, no logic changes)

**VaultPage:** White cards, `#E5E5EA` border, light shadow. "+ Add Note" = black pill button. Filter dropdown = white bg.

**SearchPage:** Large white search input, purple focus ring. "Search" button = `#F0F0F0` bg (NOT purple). Results = white cards.

**ChatPage:** Session sidebar = white bg. "+ New Chat" = `#7C3AED` bg. Main area bg = `#F5F5F7`. Suggestion pills = white bg, `#E5E5EA` border. Send button = purple circle.

**TopicsPage:** Controls/side panel = white bg, `#E5E5EA` border. Keep force-graph canvas colors unchanged.

**NotePage:** White card bg, `#E5E5EA` borders. Tags = `#EDE9FE` bg, `#7C3AED` text.

---

# FINAL CHECKLIST

### Backend
- [ ] `firebase-admin>=6.5.0` added to requirements, `python-jose` removed
- [ ] `backend/firebase-service-account.json` placed by developer
- [ ] `FIREBASE_PROJECT_ID=mindvault-1` added to `.env`
- [ ] `backend/middleware/auth.py` fully replaced
- [ ] `firebase_uid VARCHAR(128)` column added to User model + migration in `init_db()`
- [ ] `backend/routes/auth.py` simplified (only `/me` + `/logout`)
- [ ] JWT functions removed from `backend/services/auth.py`
- [ ] JWT settings removed from `backend/config.py`

### Frontend
- [ ] `npm install firebase` run
- [ ] `src/firebase.js` created
- [ ] `src/context/AuthContext.jsx` replaced
- [ ] `src/api.js` replaced
- [ ] `src/index.css` variables updated to light theme
- [ ] `src/pages/LoginPage.jsx` replaced
- [ ] `src/App.jsx` Sidebar replaced + SettingsModal imported
- [ ] `src/components/SettingsModal.jsx` created
- [ ] VaultPage, SearchPage, ChatPage, TopicsPage, NotePage re-skinned

### ⚠️ Important Notes
1. Existing users won't have `firebase_uid` set — they auto-link on next login
2. Firebase Email/Password sign-in must be enabled in Firebase Console → Authentication → Sign-in methods
3. Google sign-in must be enabled in Firebase Console → Authentication → Sign-in methods
4. Add your production domain to Firebase Console → Authentication → Authorized domains
