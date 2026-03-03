import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import '../index.css'

const API = import.meta.env.VITE_API_URL || ''

export default function LoginPage() {
    const [tab, setTab] = useState("login")   // login | register
    const [form, setForm] = useState({ username: "", email: "", password: "" })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const { login } = useAuth()
    const navigate = useNavigate()

    const update = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

    const handleSubmit = async () => {
        setLoading(true)
        setError("")
        const endpoint = tab === "login" ? "/auth/login" : "/auth/register"
        const body = tab === "login"
            ? { username: form.username, password: form.password }
            : { username: form.username, email: form.email, password: form.password }

        try {
            const res = await fetch(`${API}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.detail || "Something went wrong")
            login(data.access_token, data.user)
            navigate("/vault")
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md shadow-xl">

                {/* Logo */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">🧠 MindVault</h1>
                    <p className="text-gray-400 text-sm">
                        Your AI-powered second brain
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex bg-gray-800 rounded-lg p-1 mb-8">
                    {["login", "register"].map(t => (
                        <button key={t}
                            onClick={() => { setTab(t); setError("") }}
                            className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all
                                ${tab === t
                                    ? "bg-purple-600 text-white shadow"
                                    : "text-gray-400 hover:text-gray-200"}`}>
                            {t === "login" ? "Login" : "Register"}
                        </button>
                    ))}
                </div>

                <div className="space-y-5">
                    {/* Username */}
                    <div>
                        <label className="text-gray-300 text-sm block mb-2 font-medium">
                            Username
                        </label>
                        <input
                            type="text"
                            placeholder="yourname"
                            value={form.username}
                            onChange={update("username")}
                            className="w-full bg-gray-950 border border-gray-700 rounded-lg
                                       px-4 py-3 text-white placeholder-gray-600 text-sm
                                       focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                        />
                    </div>

                    {/* Email — only on register */}
                    {tab === "register" && (
                        <div>
                            <label className="text-gray-300 text-sm block mb-2 font-medium">
                                Email
                            </label>
                            <input
                                type="email"
                                placeholder="you@example.com"
                                value={form.email}
                                onChange={update("email")}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg
                                           px-4 py-3 text-white placeholder-gray-600 text-sm
                                           focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                            />
                        </div>
                    )}

                    {/* Password */}
                    <div>
                        <label className="text-gray-300 text-sm block mb-2 font-medium">
                            Password
                        </label>
                        <input
                            type="password"
                            placeholder={tab === "register"
                                ? "Min 4 chars"
                                : "Your password"}
                            value={form.password}
                            onChange={update("password")}
                            className="w-full bg-gray-950 border border-gray-700 rounded-lg
                                       px-4 py-3 text-white placeholder-gray-600 text-sm
                                       focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                        />
                        {tab === "register" && (
                            <p className="text-gray-500 text-xs mt-2">
                                Min 4 characters
                            </p>
                        )}
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
                            <p className="text-red-400 text-sm text-center">
                                {error}
                            </p>
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={loading || !form.username || !form.password || (tab === 'register' && !form.email)}
                        className="w-full bg-purple-600 hover:bg-purple-500 active:bg-purple-700
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   text-white font-medium py-3 rounded-lg transition-all mt-4 shadow-lg shadow-purple-900/20"
                    >
                        {loading
                            ? (tab === "login" ? "Logging in..." : "Creating account...")
                            : (tab === "login" ? "Login" : "Create Account")}
                    </button>
                </div>
            </div>
        </div>
    )
}
