import { useState, useEffect, useRef } from "react"
import { api, submitVote } from "../api"
import ConfirmationCard from "../components/ConfirmationCard"
import ReactMarkdown from 'react-markdown'
import { Plus, X, MessageSquare, Send, Brain, Trash2, Search, ThumbsUp, ThumbsDown, FileText, Sparkles } from 'lucide-react'

const FALLBACK_SUGGESTIONS = [
    "What have I saved recently?",
    "Summarize my vault",
    "What topics have I studied?",
    "Show me my latest notes",
]

export default function ChatPage() {
    const [sessions, setSessions] = useState([])
    const [activeSession, setActiveSession] = useState(null)
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [suggestions, setSuggestions] = useState([])
    const [suggestionsLoading, setSuggestionsLoading] = useState(true)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    useEffect(() => { loadSessions(); loadSuggestions() }, [])
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    const loadSessions = async () => {
        try {
            const res = await api.get("/agent/sessions")
            setSessions(res.data)
            if (res.data.length > 0 && !activeSession) {
                loadSession(res.data[0].id)
            }
        } catch (e) { console.error("Failed to load sessions", e) }
    }

    const loadSession = async (sessionId) => {
        setLoadingHistory(true)
        setActiveSession(sessionId)
        try {
            const res = await api.get(`/agent/sessions/${sessionId}/messages`)
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
            await api.delete(`/agent/sessions/${sessionId}`)
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
            const MAX_HISTORY_TURNS = 10;
            const history = messages
                .filter(m => m.role !== 'system')
                .slice(-MAX_HISTORY_TURNS)
                .map(m => ({ role: m.role, content: m.content }));

            const res = await api.post("/agent/chat", {
                message: userMessage,
                conversation_history: history,
                ...(activeSession ? { session_id: activeSession } : {})
            })
            
            const { response: answer, type, pending_action, cited_notes, session_id } = res.data

            setMessages(prev => [...prev, {
                id: "ai-" + Date.now(),
                role: "assistant",
                content: answer,
                type: type,
                pendingAction: pending_action,
                cited_notes: cited_notes || [],
                created_at: new Date().toISOString()
            }])
            
            if (session_id && activeSession !== session_id) {
                setActiveSession(session_id)
            }
            loadSessions()
        } catch (err) {
            setMessages(prev => [...prev, {
                id: "err-" + Date.now(),
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
                type: "answer",
                created_at: new Date().toISOString()
            }])
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    const loadSuggestions = async (forceRefresh = false) => {
        setSuggestionsLoading(true)
        try {
            const res = await api.get("/agent/suggestions")
            setSuggestions(res.data.suggestions)
        } catch (e) {
            setSuggestions(FALLBACK_SUGGESTIONS)
        } finally {
            setSuggestionsLoading(false)
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 40px)", background: "var(--bg)" }}>
            
            {/* Browser Tabs Header */}
            <div className="chat-tabs">
                {sessions.map(s => (
                    <div
                        key={s.id}
                        className={`chat-tab-item ${activeSession === s.id ? 'active' : ''}`}
                        onClick={() => loadSession(s.id)}
                    >
                        <Brain size={14} style={{ color: activeSession === s.id ? 'var(--accent)' : 'inherit' }} />
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.title || "New Chat"}
                        </span>
                        <button className="chat-tab-close" onClick={(e) => deleteSession(s.id, e)}>
                            <X size={12} />
                        </button>
                    </div>
                ))}
                <div
                    className="chat-tab-item"
                    onClick={startNewSession}
                    style={{ border: 'none', background: 'transparent' }}
                >
                    <Plus size={16} />
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: 'relative' }}>
                
                <div style={{ flex: 1, overflowY: "auto", padding: "40px 20px" }}>
                    <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
                        
                        {/* Empty state */}
                        {messages.length === 0 && !loadingHistory && (
                            <div style={{ textAlign: 'center', marginTop: '10vh' }}>
                                <div style={{ marginBottom: 24, display: 'inline-flex', padding: 16, background: 'var(--accent-light)', borderRadius: '50%', color: 'var(--accent)' }}>
                                    <Brain size={48} />
                                </div>
                                <h1 className="page-header-title" style={{ marginBottom: 8 }}>Chat with your Knowledge Vault</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: 48 }}>
                                    Ask questions about anything you've saved. Answers are grounded in your notes.
                                </p>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", maxWidth: "600px", margin: "0 auto" }}>
                                    {suggestions.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => { setInput(s); inputRef.current?.focus() }}
                                            className="note-card"
                                            style={{ padding: '16px', textAlign: 'left', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}
                                        >{s}</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {loadingHistory && (
                            <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
                                <div className="spinner-sm" />
                            </div>
                        )}

                        {/* Message list */}
                        {messages.map((msg, idx) => (
                            <MessageBubble 
                                key={msg.id} 
                                message={msg} 
                                setMessages={setMessages}
                                prevMessage={idx > 0 ? messages[idx - 1] : null}
                            />
                        ))}

                        {/* Typing indicator */}
                        {loading && (
                            <div className="chat-message-ai">
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {[0, 150, 300].map(d => (
                                        <span key={d} style={{
                                            width: 6, height: 6, background: 'var(--accent)', borderRadius: '50%',
                                            animation: 'bounce 1.4s infinite', animationDelay: `${d}ms`
                                        }} />
                                    ))}
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </div>

                {/* Centered Input Bar */}
                <div className="chat-input-container">
                    <div className="chat-input-wrap">
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
                            placeholder="Message MindVault..."
                            rows={1}
                            className="chat-input-field"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={loading || !input.trim()}
                            className="chat-send-btn"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes bounce {
                    0%, 80%, 100% { transform: translateY(0); }
                    40% { transform: translateY(-6px); }
                }
            `}</style>
        </div>
    )
}

function MessageBubble({ message, setMessages, prevMessage }) {
    const [votes, setVotes] = useState({})
    const isUser = message.role === "user"
    const citedNotes = message.cited_notes?.filter(Boolean) || []
    const queryText = prevMessage?.role === 'user' ? prevMessage.content : ''

    const handleVote = async (e, noteId, voteValue) => {
        e.preventDefault()
        e.stopPropagation()
        if (votes[noteId] || !queryText) return
        try {
            await submitVote(queryText, noteId, voteValue)
            setVotes(prev => ({ ...prev, [noteId]: voteValue }))
        } catch (err) {
            console.error('Failed to submit vote:', err)
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className={isUser ? "chat-message-user" : "chat-message-ai"}>
                <div style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>

                {message.type === "pending_confirmation" && message.pendingAction && (
                    <div style={{ marginTop: 16 }}>
                        <ConfirmationCard
                            action={message.pendingAction}
                            onResolved={(approved, msg) => {
                                setMessages(prev => [...prev, {
                                    id: "sys-" + Date.now(),
                                    role: "system",
                                    content: msg,
                                    type: "answer",
                                    created_at: new Date().toISOString()
                                }])
                            }}
                        />
                    </div>
                )}
            </div>

            {!isUser && citedNotes.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginLeft: 4 }}>
                        Sources
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {citedNotes.map(note => (
                            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <a href={`/note/${note.id}`} className="chat-source-badge">
                                    <FileText size={12} />
                                    <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {note.title || "Untitled"}
                                    </span>
                                    {note.similarity != null && (
                                        <span style={{ fontWeight: 600, color: 'var(--accent)', marginLeft: 4 }}>
                                            {Math.round(note.similarity * 100)}%
                                        </span>
                                    )}
                                </a>
                                <div style={{ display: 'flex', gap: 4, marginLeft: 2 }}>
                                    <button
                                        onClick={(e) => handleVote(e, note.id, 1)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: votes[note.id] === 1 ? '#22c55e' : 'var(--text-muted)' }}
                                    >
                                        <ThumbsUp size={12} fill={votes[note.id] === 1 ? 'currentColor' : 'none'} />
                                    </button>
                                    <button
                                        onClick={(e) => handleVote(e, note.id, -1)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: votes[note.id] === -1 ? '#ef4444' : 'var(--text-muted)' }}
                                    >
                                        <ThumbsDown size={12} fill={votes[note.id] === -1 ? 'currentColor' : 'none'} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
