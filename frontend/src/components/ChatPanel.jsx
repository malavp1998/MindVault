import { useState, useEffect, useRef } from "react"
import { api, submitVote } from "../api"
import ConfirmationCard from "./ConfirmationCard"

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
        <div style={{
            display: "flex", gap: "10px",
            flexDirection: isUser ? "row-reverse" : "row",
        }}>
            <div style={{
                width: "28px", height: "28px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "12px", flexShrink: 0,
                background: isUser ? "var(--border)" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
            }}>{isUser ? "👤" : "🧠"}</div>

            <div style={{
                maxWidth: "100%", display: "flex", flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start", gap: "4px",
            }}>
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
                    <div style={{
                        padding: "10px 14px",
                        borderRadius: isUser ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                        fontSize: "12px", lineHeight: 1.6, whiteSpace: "pre-wrap",
                        background: isUser ? "#7c3aed" : "var(--bg-card-hover)",
                        color: isUser ? "white" : "var(--text-primary)",
                    }}>{message.content}</div>
                )}

                {!isUser && citedNotes.length > 0 && (
                    <div>
                        <p style={{ fontSize: "9px", color: "var(--text-muted)", margin: "0 0 3px 4px" }}>Sources:</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {citedNotes.map(note => (
                                <a key={note.id} href={`/note/${note.id}`} style={{
                                    background: "var(--bg-card)", border: "1px solid var(--border)",
                                    borderRadius: "6px", padding: "3px 8px", fontSize: "10px",
                                    color: "var(--text-secondary)", textDecoration: "none",
                                    display: "flex", alignItems: "center", gap: "4px",
                                    transition: "border-color 0.15s",
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#7c3aed" }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)" }}
                                >
                                    <span>📄</span>
                                    <span style={{
                                        maxWidth: "100px", overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{note.title || "Untitled"}</span>
                                    {note.similarity != null && (
                                        <span style={{ color: "#7c3aed", fontWeight: 600 }}>
                                            {Math.round(note.similarity * 100)}%
                                        </span>
                                    )}
                                    <div style={{ display: 'flex', gap: '2px', marginLeft: 'auto', paddingLeft: '4px', borderLeft: '1px solid var(--border)' }}>
                                        <button onClick={(e) => handleVote(e, note.id, 1)} style={{
                                            background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px',
                                            opacity: votes[note.id] === undefined || votes[note.id] === 1 ? 1 : 0.3,
                                            filter: votes[note.id] === 1 ? 'drop-shadow(0 0 2px rgba(74,222,128,0.5))' : 'grayscale(1)',
                                            fontSize: '10px', transition: 'all 0.2s'
                                        }} title="Relevant">👍</button>
                                        <button onClick={(e) => handleVote(e, note.id, -1)} style={{
                                            background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px',
                                            opacity: votes[note.id] === undefined || votes[note.id] === -1 ? 1 : 0.3,
                                            filter: votes[note.id] === -1 ? 'drop-shadow(0 0 2px rgba(248,113,113,0.5))' : 'grayscale(1)',
                                            fontSize: '10px', transition: 'all 0.2s'
                                        }} title="Not relevant">👎</button>
                                    </div>
                                </a>
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
            background: "var(--bg-secondary)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            overflow: "hidden",
        }}>
            {/* Header */}
            <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "var(--bg-secondary)",
                flexShrink: 0,
            }}>
                <span style={{ fontSize: "16px" }}>🧠</span>
                <div>
                    <h3 style={{
                        fontSize: "13px", fontWeight: 600,
                        color: "var(--text-primary)", margin: 0,
                    }}>Ask about this note</h3>
                    <p style={{
                        fontSize: "10px", color: "var(--text-muted)", margin: 0,
                    }}>Powered by your vault</p>
                </div>
                {messages.length > 0 && (
                    <button
                        onClick={() => { setMessages([]); setSessionId(null) }}
                        style={{
                            marginLeft: "auto",
                            background: "none", border: "none",
                            color: "var(--text-muted)", cursor: "pointer",
                            fontSize: "10px", padding: "4px 8px",
                            borderRadius: "6px",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#ef4444" }}
                        onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)" }}
                    >🧹 Clear</button>
                )}
            </div>

            {/* Messages */}
            <div style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px",
            }}>
                {messages.length === 0 && (
                    <div style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        height: "100%", textAlign: "center",
                        padding: "24px 16px",
                    }}>
                        <div style={{ fontSize: "32px", marginBottom: "12px" }}>💬</div>
                        <p style={{
                            fontSize: "12px", color: "var(--text-muted)",
                            maxWidth: "280px", lineHeight: 1.5,
                        }}>
                            Ask questions about this note or anything in your vault.
                        </p>
                        {noteContext && (
                            <div style={{
                                marginTop: "12px",
                                display: "flex", flexDirection: "column", gap: "6px",
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
                                        style={{
                                            background: "var(--bg-card-hover)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "8px",
                                            padding: "8px 12px",
                                            textAlign: "left",
                                            color: "var(--text-secondary)",
                                            fontSize: "11px",
                                            cursor: "pointer",
                                            transition: "all 0.15s",
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.borderColor = "#7c3aed"
                                            e.currentTarget.style.color = "var(--text-primary)"
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.borderColor = "var(--border)"
                                            e.currentTarget.style.color = "var(--text-secondary)"
                                        }}
                                    >{s}</button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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
                    <div style={{
                        display: "flex", gap: "8px", marginTop: "14px",
                    }}>
                        <div style={{
                            width: "28px", height: "28px", borderRadius: "50%",
                            background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                            display: "flex", alignItems: "center",
                            justifyContent: "center", fontSize: "12px",
                            flexShrink: 0,
                        }}>🧠</div>
                        <div style={{
                            background: "var(--bg-card-hover)",
                            borderRadius: "14px 14px 14px 4px",
                            padding: "10px 14px",
                            display: "flex", gap: "4px", alignItems: "center",
                        }}>
                            {[0, 150, 300].map(d => (
                                <span key={d} style={{
                                    width: "5px", height: "5px",
                                    background: "var(--text-muted)",
                                    borderRadius: "50%",
                                    animation: "chatPanelBounce 1.4s infinite",
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
                padding: "10px 12px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                flexShrink: 0,
            }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
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
                        style={{
                            flex: 1,
                            background: "var(--bg-card-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: "10px",
                            padding: "10px 12px",
                            color: "var(--text-primary)",
                            fontSize: "12px",
                            resize: "none",
                            outline: "none",
                            minHeight: "38px",
                            maxHeight: "80px",
                            fontFamily: "inherit",
                        }}
                        onFocus={e => e.target.style.borderColor = "#7c3aed"}
                        onBlur={e => e.target.style.borderColor = "var(--border)"}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={loading || !input.trim()}
                        style={{
                            background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "10px",
                            padding: "10px 14px",
                            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                            opacity: loading || !input.trim() ? 0.4 : 1,
                            fontSize: "14px",
                            flexShrink: 0,
                            transition: "opacity 0.15s",
                        }}
                    >↑</button>
                </div>
            </div>

            <style>{`
                @keyframes chatPanelBounce {
                    0%, 80%, 100% { transform: translateY(0); }
                    40% { transform: translateY(-5px); }
                }
            `}</style>
        </div>
    )
}
