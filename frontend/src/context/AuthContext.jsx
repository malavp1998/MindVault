import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem("mv_token"));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) {
            const API = import.meta.env.VITE_API_URL || '';
            // Verify token is still valid
            fetch(`${API}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (data) setUser(data);
                    else logout();
                })
                .catch(() => logout())
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);

    const login = (newToken, userData) => {
        localStorage.setItem("mv_token", newToken);
        setToken(newToken);
        setUser(userData);

        // Sync token to chrome extension storage
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.set({
                mv_token: newToken,
                mv_user: JSON.stringify(userData),
            });
        }
    };

    const logout = () => {
        localStorage.removeItem("mv_token");
        setToken(null);
        setUser(null);

        // Clear extension storage on logout
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.remove(["mv_token", "mv_user"]);
        }
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
