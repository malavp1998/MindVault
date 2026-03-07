import { createContext, useContext, useState, useEffect } from "react";
import { auth } from "../firebase";
import {
    onAuthStateChanged, signOut,
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signInWithPopup, GoogleAuthProvider, updateProfile
} from "firebase/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
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

    const loginWithCredentials = (email, password) => signInWithEmailAndPassword(auth, email, password);
    const loginWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
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
    const login = () => { }; // legacy shim

    return (
        <AuthContext.Provider value={{ user, token, loading, login, logout, loginWithCredentials, registerWithCredentials, loginWithGoogle }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
