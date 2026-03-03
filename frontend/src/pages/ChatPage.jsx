import { useState, useEffect, useRef } from "react"
import api from "../api"

export default function ChatPage() {
    const [sessions, setSessions] = useState([])
    const [activeSession, setActiveSession] = useState(null)
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    useEffect(() => { loadSessions() }, [])
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    const loadSessions = async () => {
        try {
            const res = await api.get("/chat/sessions")
            setSessions(res.data)
        } catch (e) { console.error("Failed to load sessions", e) }
    }

    const loadSession = async (sessionId) => {
        setLoadingHistory(true)
        setActiveSession(sessionId)
        try {
            const res = await api.get(`/chat/sessions/${sessionId}/messages`)
            setMessages(res.data)
        } catch (e) { console.error(e) }
        setLoadingHistory(false)
        inputRef.current?.focus()
    }

    const startNewSession = () => {
        setActiveSession(null)
        setMessages([])
        inputRef.current?.focus()
    }

    const deleteSession = async (sessionId, e) => {
        e.stopPropagation()
        try {
            await api.delete(`/chat/sessions/${sessionId}`)
            if (activeSession === sessionId) {
                setActiveSession(null)
                setMessages([])
            }
            loadSessions()
        } catch (e) { console.error(e) }
    }

    const sendMessage = async () => {
        if (!input.trim() || loading) return
        const userMessage = input.trim()
        setInput("")
        setLoading(true)

        const tempUserMsg = {
            id: "temp-" + Date.now(),
            role: "user",
            content: userMessage,
            created_at: new Date().toISOString()
        }
        setMessages(prev => [...prev, tempUserMsg])

        try {
            const res = await api.post("/chat/message", {
                message: userMessage,
                session_id: activeSession
            })
            const { session_id, answer, cited_notes } = res.data

            if (!activeSession) {
                setActiveSession(session_id)
            }

            setMessages(prev => [...prev, {
                id: "ai-" + Date.now(),
                role: "assistant",
                content: answer,
                cited_notes: cited_notes,
                created_at: new Date().toISOString()
            }])
            loadSessions()
        } catch (err) {
            setMessages(prev => [...prev, {
                id: "err-" + Date.now(),
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
                created_at: new Date().toISOString()
            }])
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    const suggestions = [
        "What did I learn about transformers?",
        "Summarize my machine learning notes",
        "What YouTube videos have I saved?",
        "What are my notes on React hooks?"
    ]

    return (
        <div style={{
            display: "flex",
            height: "calc(100vh - 0px)",
            background: "#0a0a0f",
            color: "#fff",
            marginLeft: "-2rem",
            marginTop: "-2rem",
            width: "calc(100% + 4rem)",
            height: "calc(100% + 4rem)",
        }}>
            {/* Session Sidebar */}
            <div style={{
                width: sidebarOpen ? "260px" : "0px",
                minWidth: sidebarOpen ? "260px" : "0px",
                background: "#111118",
                borderRight: "1px solid #1e1e2e",
                display: "flex",
                flexDirection: "column",
                transition: "all 0.2s ease",
                overflow: "hidden",
            }}>
                <div style={{ padding: "16px", borderBottom: "1px solid #1e1e2e" }}>
                    <button onClick={startNewSession} style={{
                        width: "100%",
                        background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "10px",
                        padding: "10px 16px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                    }}>
                        <span style={{ fontSize: "16px" }}>+</span> New Chat
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                    {sessions.length === 0 && (
                        <p style={{
                            color: "#444",
                            fontSize: "11px",
                            textAlign: "center",
                            marginTop: "32px",
                            padding: "0 16px",
                        }}>No chats yet. Start a conversation.</p>
                    )}
                    {sessions.map(s => (
                        <div
                            key={s.id}
                            onClick={() => loadSession(s.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 12px",
                                borderRadius: "8px",
                                cursor: "pointer",
                                marginBottom: "2px",
                                background: activeSession === s.id ? "#1e1e2e" : "transparent",
                                transition: "background 0.15s",
                            }}
                            onMouseEnter={e => {
                                if (activeSession !== s.id) e.currentTarget.style.background = "#16161e"
                            }}
                            onMouseLeave={e => {
                                if (activeSession !== s.id) e.currentTarget.style.background = "transparent"
                            }}
                        >
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{
                                    fontSize: "12px",
                                    fontWeight: 500,
                                    color: activeSession === s.id ? "#fff" : "#999",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    margin: 0,
                                }}>{s.title || "New Chat"}</p>
                                <p style={{
                                    fontSize: "10px",
                                    color: "#555",
                                    margin: "2px 0 0 0",
                                }}>{s.message_count || 0} messages</p>
                            </div>
                            <button
                                onClick={e => deleteSession(s.id, e)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "#555",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    padding: "2px 4px",
                                    opacity: 0,
                                    transition: "opacity 0.15s",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = "#ef4444" }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = 0; e.currentTarget.style.color = "#555" }}
                            >×</button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

                {/* Header */}
                <div style={{
                    padding: "14px 24px",
                    borderBottom: "1px solid #1e1e2e",
                    background: "#111118",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                }}>
                    <button
                        onClick={() => setSidebarOpen(p => !p)}
                        style={{
                            background: "none", border: "none",
                            color: "#888", cursor: "pointer", fontSize: "18px",
                        }}
                    >{sidebarOpen ? "◀" : "▶"}</button>
                    <span style={{ fontSize: "20px" }}>🧠</span>
                    <div>
                        <h1 style={{
                            fontSize: "14px", fontWeight: 600,
                            color: "#fff", margin: 0,
                        }}>Chat with your Vault</h1>
                        <p style={{
                            fontSize: "11px", color: "#666", margin: 0,
                        }}>Ask anything — answers grounded in your notes</p>
                    </div>
                </div>

                {/* Messages */}
                <div style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "24px 24px",
                }}>

                    {/* Empty state */}
                    {messages.length === 0 && !loadingHistory && (
                        <div style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            height: "100%",
                            textAlign: "center",
                        }}>
                            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🧠</div>
                            <h2 style={{
                                fontSize: "18px", fontWeight: 600,
                                color: "#fff", marginBottom: "8px",
                            }}>Chat with your Knowledge Vault</h2>
                            <p style={{
                                fontSize: "13px", color: "#666",
                                maxWidth: "400px", marginBottom: "32px",
                            }}>
                                Ask questions about anything you've saved.
                                MindVault will answer using your own notes.
                            </p>
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: "10px",
                                maxWidth: "500px",
                                width: "100%",
                            }}>
                                {suggestions.map(s => (
                                    <button
                                        key={s}
                                        onClick={() => { setInput(s); inputRef.current?.focus() }}
                                        style={{
                                            background: "#16161e",
                                            border: "1px solid #1e1e2e",
                                            borderRadius: "12px",
                                            padding: "12px 14px",
                                            textAlign: "left",
                                            color: "#aaa",
                                            fontSize: "12px",
                                            cursor: "pointer",
                                            transition: "all 0.15s",
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.borderColor = "#7c3aed"
                                            e.currentTarget.style.color = "#ddd"
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.borderColor = "#1e1e2e"
                                            e.currentTarget.style.color = "#aaa"
                                        }}
                                    >{s}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    {loadingHistory && (
                        <div style={{
                            display: "flex",
                            justifyContent: "center",
                            padding: "40px",
                        }}>
                            <div className="loader" />
                        </div>
                    )}

                    {/* Message bubbles */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        {messages.map(msg => (
                            <MessageBubble key={msg.id} message={msg} />
                        ))}
                    </div>

                    {/* Typing indicator */}
                    {loading && (
                        <div style={{
                            display: "flex", gap: "12px",
                            marginTop: "20px",
                        }}>
                            <div style={{
                                width: "32px", height: "32px",
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                                display: "flex", alignItems: "center",
                                justifyContent: "center", fontSize: "14px",
                                flexShrink: 0,
                            }}>🧠</div>
                            <div style={{
                                background: "#16161e",
                                borderRadius: "16px 16px 16px 4px",
                                padding: "12px 16px",
                                display: "flex", gap: "4px",
                                alignItems: "center",
                            }}>
                                {[0, 150, 300].map(d => (
                                    <span key={d} style={{
                                        width: "6px", height: "6px",
                                        background: "#555",
                                        borderRadius: "50%",
                                        animation: "bounce 1.4s infinite",
                                        animationDelay: `${d}ms`,
                                    }} />
                                ))}
                            </div>
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div style={{
                    padding: "16px 24px",
                    borderTop: "1px solid #1e1e2e",
                    background: "#111118",
                }}>
                    <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    sendMessage()
                                }
                            }}
                            placeholder="Ask anything about your notes... (Enter to send)"
                            rows={1}
                            style={{
                                flex: 1,
                                background: "#16161e",
                                border: "1px solid #1e1e2e",
                                borderRadius: "12px",
                                padding: "12px 16px",
                                color: "#fff",
                                fontSize: "13px",
                                resize: "none",
                                outline: "none",
                                minHeight: "44px",
                                maxHeight: "120px",
                                fontFamily: "inherit",
                            }}
                            onFocus={e => e.target.style.borderColor = "#7c3aed"}
                            onBlur={e => e.target.style.borderColor = "#1e1e2e"}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={loading || !input.trim()}
                            style={{
                                background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                                color: "#fff",
                                border: "none",
                                borderRadius: "12px",
                                padding: "12px 16px",
                                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                                opacity: loading || !input.trim() ? 0.4 : 1,
                                fontSize: "16px",
                                flexShrink: 0,
                                transition: "opacity 0.15s",
                            }}
                        >↑</button>
                    </div>
                    <p style={{
                        fontSize: "10px", color: "#444",
                        textAlign: "center", margin: "8px 0 0 0",
                    }}>Shift+Enter for new line · Enter to send</p>
                </div>
            </div>

            {/* Bounce animation */}
            <style>{`
                @keyframes bounce {
                    0%, 80%, 100% { transform: translateY(0); }
                    40% { transform: translateY(-6px); }
                }
            `}</style>
        </div>
    )
}


function MessageBubble({ message }) {
    const isUser = message.role === "user"
    const citedNotes = message.cited_notes?.filter(Boolean) || []

    return (
        <div style={{
            display: "flex",
            gap: "12px",
            flexDirection: isUser ? "row-reverse" : "row",
        }}>
            {/* Avatar */}
            <div style={{
                width: "32px", height: "32px",
                borderRadius: "50%",
                display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: "14px",
                flexShrink: 0,
                background: isUser
                    ? "#1e1e2e"
                    : "linear-gradient(135deg, #7c3aed, #6d28d9)",
            }}>
                {isUser ? "👤" : "🧠"}
            </div>

            <div style={{
                maxWidth: "680px",
                display: "flex",
                flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start",
                gap: "6px",
            }}>
                {/* Bubble */}
                <div style={{
                    padding: "12px 16px",
                    borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
                    fontSize: "13px",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    background: isUser ? "#7c3aed" : "#16161e",
                    color: isUser ? "#fff" : "#ddd",
                }}>
                    {message.content}
                </div>

                {/* Cited notes */}
                {!isUser && citedNotes.length > 0 && (
                    <div>
                        <p style={{
                            fontSize: "10px", color: "#555",
                            margin: "0 0 4px 4px",
                        }}>Sources from your vault:</p>
                        <div style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                        }}>
                            {citedNotes.map(note => (
                                <a
                                    key={note.id}
                                    href={`/note/${note.id}`}
                                    style={{
                                        background: "#0d0d14",
                                        border: "1px solid #1e1e2e",
                                        borderRadius: "8px",
                                        padding: "5px 10px",
                                        fontSize: "11px",
                                        color: "#888",
                                        textDecoration: "none",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "5px",
                                        transition: "border-color 0.15s",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = "#7c3aed"
                                        e.currentTarget.style.color = "#c4b5fd"
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = "#1e1e2e"
                                        e.currentTarget.style.color = "#888"
                                    }}
                                >
                                    <span>📄</span>
                                    <span style={{
                                        maxWidth: "140px",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}>{note.title || "Untitled"}</span>
                                    {note.similarity != null && (
                                        <span style={{ color: "#7c3aed", fontWeight: 600 }}>
                                            {Math.round(note.similarity * 100)}%
                                        </span>
                                    )}
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
