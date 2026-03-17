import { useState, useEffect, useRef } from "react"
import { api, submitVote } from "../api"
import ConfirmationCard from "../components/ConfirmationCard"
import ReactMarkdown from 'react-markdown'
import { Plus, X, MessageSquare, Send, Brain, Trash2, Search, ThumbsUp, ThumbsDown, FileText, Sparkles, MoreVertical, Share, Pencil, Pin, Archive, PinOff } from 'lucide-react'

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
    const [menuConfig, setMenuConfig] = useState(null) // { id, x, y, session }
    const [renamingSessionId, setRenamingSessionId] = useState(null)
    const [renameValue, setRenameValue] = useState("")
    const bottomRef = useRef(null)
    const inputRef = useRef(null)
    const tabsContainerRef = useRef(null)

    useEffect(() => {
        const handleClickOutside = () => setMenuConfig(null);
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const scrollTabs = (direction) => {
        if (tabsContainerRef.current) {
            const scrollAmount = direction === 'left' ? -200 : 200;
            tabsContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
    }

    useEffect(() => { loadSessions(); loadSuggestions() }, [])
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    const loadSessions = async () => {
        try {
            const res = await api.get("/agent/sessions")
            const sortedSessions = res.data.sort((a, b) => {
                if (a.is_pinned !== b.is_pinned) return (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
            setSessions(sortedSessions)
            if (sortedSessions.length > 0 && !activeSession) {
                loadSession(sortedSessions[0].id)
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
        setMenuConfig(null)
        try {
            await api.delete(`/agent/sessions/${sessionId}`)
            if (activeSession === sessionId) {
                setActiveSession(null)
                setMessages([])
            }
            loadSessions()
        } catch (e) { console.error(e) }
    }

    const startRenaming = (sessionId, currentTitle, e) => {
        e.stopPropagation();
        setMenuConfig(null);
        setRenamingSessionId(sessionId);
        setRenameValue(currentTitle || "New Chat");
    };

    const finishRenaming = async () => {
        if (!renamingSessionId) return;
        const newTitle = renameValue.trim();
        const sessionId = renamingSessionId;
        setRenamingSessionId(null); // Close input immediately
        
        const currentSession = sessions.find(s => s.id === sessionId);
        if (newTitle && newTitle !== currentSession?.title) {
            try {
                // Optimistic update
                setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
                await api.patch(`/agent/sessions/${sessionId}`, { title: newTitle });
            } catch (err) {
                console.error("Failed to rename", err);
                loadSessions(); // Revert
            }
        }
    };

    const togglePinChat = async (sessionId, currentPinned, e) => {
        e.stopPropagation();
        setMenuConfig(null);
        try {
            await api.patch(`/agent/sessions/${sessionId}`, { is_pinned: !currentPinned });
            loadSessions();
        } catch (err) { console.error("Failed to pin/unpin", err); }
    };

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
        <div className="chat-layout">
            
            {/* Browser Tabs Header */}
            <div className="chat-header-bar">
                <div ref={tabsContainerRef} className="no-scrollbar" style={{ display: 'flex', overflowX: 'auto', flex: 1, height: '100%', alignItems: 'flex-end', padding: '0 4px', scrollBehavior: 'smooth' }}>
                    {sessions.map(s => (
                        <div
                            key={s.id}
                            className={`chat-tab ${activeSession === s.id ? 'active' : ''}`}
                            onClick={() => loadSession(s.id)}
                            style={{ position: 'relative' }}
                        >
                            <div className="tab-icon">
                                {s.is_pinned ? <Pin size={12} fill="currentColor" style={{ opacity: 0.8 }} /> : <Brain size={14} />}
                            </div>
                            {renamingSessionId === s.id ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={finishRenaming}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') finishRenaming();
                                        if (e.key === 'Escape') setRenamingSessionId(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        border: '1px solid var(--accent)',
                                        background: 'transparent',
                                        color: 'var(--text-dark)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        width: '80px',
                                        padding: '2px 4px',
                                        outline: 'none',
                                        borderRadius: '4px',
                                        flex: 1
                                    }}
                                />
                            ) : (
                                <span className="tab-title">
                                    {s.title || "New Chat"}
                                </span>
                            )}
                            <button 
                                className="tab-close-btn" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (menuConfig?.id === s.id) {
                                        setMenuConfig(null);
                                    } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setMenuConfig({ id: s.id, x: rect.left, y: rect.bottom + 4, session: s });
                                    }
                                }}
                            >
                                <MoreVertical strokeWidth={2.5} size={14} />
                            </button>
                        </div>
                    ))}
                </div>
                
                {/* Scroll controls (optional visual only for matching HTML) */}
                <div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 8, zIndex: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg)', borderRadius: 20, padding: 2, border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <button onClick={() => scrollTabs('left')} title="Scroll Left" style={{ border: 'none', background: 'transparent', width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f6368', transition: '0.1s' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
                        </button>
                        <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }}></div>
                        <button onClick={() => scrollTabs('right')} title="Scroll Right" style={{ border: 'none', background: 'transparent', width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f6368', transition: '0.1s' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 12, paddingRight: 8, background: 'var(--bg)', zIndex: 5 }}>
                    <button className="new-chat-btn-header" onClick={startNewSession}>
                        <Plus strokeWidth={3} size={14} />
                        New Chat
                    </button>
                </div>
            </div>

            {/* Menu Dropdown - Rendered fixed to avoid overflow clipping */}
            {menuConfig && (
                <div style={{
                    position: 'fixed',
                    top: menuConfig.y,
                    left: menuConfig.x,
                    width: 180,
                    background: '#ffffff',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    zIndex: 9999,
                    padding: '8px 0',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setMenuConfig(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
                    >
                        <Share size={14} /> Share
                    </button>
                    <button 
                        onClick={(e) => startRenaming(menuConfig.id, menuConfig.session.title, e)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
                    >
                        <Pencil size={14} /> Rename
                    </button>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}></div>
                    <button 
                        onClick={(e) => togglePinChat(menuConfig.id, menuConfig.session.is_pinned, e)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
                    >
                        {menuConfig.session.is_pinned ? <PinOff size={14} /> : <Pin size={14} />} {menuConfig.session.is_pinned ? "Unpin chat" : "Pin chat"}
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setMenuConfig(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
                    >
                        <Archive size={14} /> Archive
                    </button>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}></div>
                    <button 
                        onClick={(e) => deleteSession(menuConfig.id, e)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: '13px', color: '#dc2626' }}
                    >
                        <Trash2 size={14} color="#dc2626" /> Delete
                    </button>
                </div>
            )}

            {/* Main Chat Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", position: 'relative', background: 'var(--bg)', minHeight: 0 }}>
                
                <div style={{ flex: 1, overflowY: "auto", padding: "40px 0", scrollBehavior: 'smooth', minHeight: 0 }}>
                    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                            
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
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
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
                            <Send size={20} strokeWidth={2} />
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
        <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 8 }}>
                <div className={isUser ? "chat-message-user" : "chat-message-ai"}>
                    <div className={!isUser ? "prose-content" : ""}>
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
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Sources
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {citedNotes.map(note => (
                                <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <a href={`/note/${note.id}`} className="source-chip">
                                        <FileText size={14} stroke="var(--accent)" strokeWidth={2} />
                                        <span style={{ fontWeight: 500 }}>
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
        </>
    )
}
