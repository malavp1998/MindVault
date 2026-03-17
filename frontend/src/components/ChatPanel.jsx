import { useState, useEffect, useRef } from "react"
import { api, submitVote } from "../api"
import ConfirmationCard from "./ConfirmationCard"
import ReactMarkdown from 'react-markdown'
import { Send, FileText, ThumbsUp, ThumbsDown, Brain } from 'lucide-react'

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
        } catch (err) { console.error('Failed to submit vote:', err) }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 8 }}>
            <div className={isUser ? "chat-message-user" : "chat-message-ai"}>
                {message.type === "pending_confirmation" && message.pendingAction ? (
                    <ConfirmationCard
                        action={message.pendingAction}
                        onResolved={(approved, msg) => {
                            setMessages(prev => [...prev, {
                                id: "sys-" + Date.now(), role: "system",
                                content: msg, type: "answer",
                                created_at: new Date().toISOString()
                            }])
                        }}
                    />
                ) : (
                    <div className={!isUser ? "prose-content" : ""} style={isUser ? { margin: 0 } : {}}>
                        {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
                    </div>
                )}

                {!isUser && citedNotes.length > 0 && (
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Sources
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {citedNotes.map(note => (
                                <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <a href={`/note/${note.id}`} className="source-chip" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                                        <FileText size={12} stroke="var(--accent)" strokeWidth={2} />
                                        <span style={{ fontWeight: 500, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {note.title || "Untitled"}
                                        </span>
                                    </a>
                                    <div style={{ display: 'flex', gap: 4, marginLeft: 2 }}>
                                        <button
                                            onClick={(e) => handleVote(e, note.id, 1)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: votes[note.id] === 1 ? '#22c55e' : 'var(--text-muted)' }}
                                            title="Upvote source"
                                        >
                                            <ThumbsUp size={14} fill={votes[note.id] === 1 ? '#22c55e' : 'none'} />
                                        </button>
                                        <button
                                            onClick={(e) => handleVote(e, note.id, -1)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: votes[note.id] === -1 ? '#ef4444' : 'var(--text-muted)' }}
                                            title="Downvote source"
                                        >
                                            <ThumbsDown size={14} fill={votes[note.id] === -1 ? '#ef4444' : 'none'} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function ChatPanel({ noteContext }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [sessionId, setSessionId] = useState(null)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    // Reset chat when note changes
    useEffect(() => {
        setMessages([])
        setSessionId(null)
        setInput("")
    }, [noteContext?.id])

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
            const MAX_HISTORY_TURNS = 10
            const history = messages
                .filter(m => m.role !== 'system')
                .slice(-MAX_HISTORY_TURNS)
                .map(m => ({ role: m.role, content: m.content }))

            // Prepend note context to the message so the AI knows which note it's about
            const contextPrefix = noteContext
                ? `[Context: The user is viewing a note titled "${noteContext.title}" (ID: ${noteContext.id}). Focus your answer on this note's content when relevant.]\n\n`
                : ""

            const res = await api.post("/agent/chat", {
                message: contextPrefix + userMessage,
                conversation_history: history,
                ...(sessionId ? { session_id: sessionId } : {})
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

            if (session_id && sessionId !== session_id) {
                setSessionId(session_id)
            }
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

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            background: "#fff",
            overflow: "hidden",
            position: "relative"
        }}>
            {/* Header */}
            <div style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexShrink: 0,
            }}>
                <div style={{ color: 'var(--accent)' }}>
                    <Brain size={24} />
                </div>
                <div>
                    <h3 style={{
                        fontSize: "0.875rem", fontWeight: 600,
                        color: "var(--text-primary)", margin: 0,
                    }}>Ask about this note</h3>
                    <p style={{
                        fontSize: "0.75rem", color: "var(--text-muted)", margin: 0,
                    }}>Powered by your vault</p>
                </div>
                {messages.length > 0 && (
                    <button
                        onClick={() => { setMessages([]); setSessionId(null); setInput("") }}
                        style={{
                            marginLeft: "auto",
                            background: "var(--bg)", border: "none",
                            color: "var(--text-muted)", cursor: "pointer",
                            fontSize: "0.75rem", padding: "6px 12px",
                            borderRadius: "16px",
                            transition: "all 0.15s",
                            fontWeight: 500
                        }}
                    >Clear</button>
                )}
            </div>

            {/* Messages */}
            <div style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px",
            }}>
                {messages.length === 0 && (
                    <div style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        height: "100%", textAlign: "center",
                    }}>
                        <div style={{ marginBottom: "16px", color: 'var(--accent)', opacity: 0.5 }}>
                            <Brain size={48} />
                        </div>
                        <p style={{
                            fontSize: "0.875rem", color: "var(--text-muted)",
                            maxWidth: "280px", lineHeight: 1.5, marginBottom: "24px"
                        }}>
                            Ask questions about this note or anything in your vault.
                        </p>
                        {noteContext && (
                            <div style={{
                                display: "flex", flexDirection: "column", gap: "8px",
                                width: "100%",
                            }}>
                                {[
                                    `Summarize "${noteContext.title?.slice(0, 30)}..."`,
                                    "What are the key takeaways?",
                                    "Find related notes",
                                ].map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setInput(s); inputRef.current?.focus() }}
                                        className="note-card"
                                        style={{
                                            padding: "12px 16px",
                                            textAlign: "left",
                                            fontSize: "0.8125rem",
                                            color: "var(--text-secondary)",
                                        }}
                                    >{s}</button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    {messages.map((msg, idx) => (
                        <MessageBubble
                            key={msg.id}
                            message={msg}
                            setMessages={setMessages}
                            prevMessage={idx > 0 ? messages[idx - 1] : null}
                        />
                    ))}
                </div>

                {/* Typing indicator */}
                {loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginTop: 24 }}>
                        <div className="chat-message-ai">
                            <div style={{ display: 'flex', gap: 4, padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 20 }}>
                                {[0, 150, 300].map(d => (
                                    <span key={d} style={{
                                        width: 6, height: 6, background: 'var(--accent)', borderRadius: '50%',
                                        animation: 'bounce 1.4s infinite', animationDelay: `${d}ms`
                                    }} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div ref={bottomRef} style={{ height: 20 }} />
            </div>

            {/* Input Container Overlay */}
            <div className="chat-input-container" style={{ padding: '0 24px 24px' }}>
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
                        placeholder="Ask about this note..."
                        rows={1}
                        className="chat-input-field"
                        style={{ minHeight: '44px', padding: '12px 12px 12px 20px', fontSize: '0.875rem' }}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={loading || !input.trim()}
                        className="chat-send-btn"
                        style={{ width: '36px', height: '36px', marginBottom: '8px', marginRight: '8px' }}
                    >
                        <Send size={16} strokeWidth={2} />
                    </button>
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
