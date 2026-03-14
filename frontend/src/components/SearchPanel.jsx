import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchNotes, submitVote } from '../api'
import ReactMarkdown from 'react-markdown'

export default function SearchPanel() {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [synthesize, setSynthesize] = useState(false)
    const [votes, setVotes] = useState({})
    const navigate = useNavigate()

    const handleVote = async (e, noteId, voteValue) => {
        e.stopPropagation()
        if (votes[noteId]) return
        try {
            await submitVote(query, noteId, voteValue)
            setVotes(prev => ({ ...prev, [noteId]: voteValue }))
        } catch (err) { console.error('Failed to submit vote:', err) }
    }

    const handleSearch = useCallback(async (e) => {
        e?.preventDefault()
        if (!query.trim()) return
        setLoading(true)
        setError(null)
        try {
            const data = await searchNotes(query, { topK: 8, synthesize })
            setResults(data)
        } catch (err) {
            const msg = err.code === 'ECONNABORTED'
                ? 'Search timed out. Try again.'
                : err.response?.data?.detail || 'Search failed.'
            setError(msg)
        } finally { setLoading(false) }
    }, [query, synthesize])

    return (
        <div style={{
            display: "flex", flexDirection: "column", height: "100%",
            background: "var(--bg-secondary)", borderRadius: "12px",
            border: "1px solid var(--border-color)", overflow: "hidden",
        }}>
            {/* Header */}
            <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
            }}>
                <form onSubmit={handleSearch} style={{ display: "flex", gap: "6px" }}>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search your vault..."
                        autoFocus
                        style={{
                            flex: 1, background: "var(--bg-card-hover)",
                            border: "1px solid var(--border)", borderRadius: "8px",
                            padding: "8px 12px", color: "var(--text-primary)",
                            fontSize: "12px", outline: "none", fontFamily: "inherit",
                        }}
                        onFocus={e => e.target.style.borderColor = "#7c3aed"}
                        onBlur={e => e.target.style.borderColor = "var(--border)"}
                    />
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        style={{
                            background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                            color: "#fff", border: "none", borderRadius: "8px",
                            padding: "8px 14px", fontSize: "12px", fontWeight: 600,
                            cursor: loading || !query.trim() ? "not-allowed" : "pointer",
                            opacity: loading || !query.trim() ? 0.4 : 1,
                            flexShrink: 0,
                        }}
                    >{loading ? "⏳" : "🔍"}</button>
                </form>
                <label style={{
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 10, color: "var(--text-muted)",
                    marginTop: 6, cursor: "pointer",
                }}>
                    <input
                        type="checkbox" checked={synthesize}
                        onChange={e => setSynthesize(e.target.checked)}
                        style={{ accentColor: "#7c3aed", width: 12, height: 12 }}
                    />
                    ✨ AI answer (RAG)
                </label>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                {error && (
                    <div style={{
                        padding: "8px 12px", borderRadius: "8px", fontSize: "11px",
                        background: "rgba(239,68,68,0.1)", color: "#ef4444",
                        border: "1px solid rgba(239,68,68,0.2)", marginBottom: "8px",
                    }}>⚠️ {error}</div>
                )}

                {/* RAG Answer */}
                {results?.rag && (
                    <div style={{
                        padding: "12px", borderRadius: "10px", marginBottom: "12px",
                        background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(109,40,217,0.04))",
                        border: "1px solid rgba(124,58,237,0.2)",
                    }}>
                        <div style={{
                            fontSize: "10px", fontWeight: 600, color: "#a78bfa",
                            marginBottom: "6px",
                        }}>✨ AI Answer</div>
                        <div style={{
                            fontSize: "12px", lineHeight: 1.6,
                            color: "var(--text-primary)",
                        }}>
                            <ReactMarkdown>{results.rag.answer}</ReactMarkdown>
                        </div>
                    </div>
                )}

                {/* Search Results */}
                {results && (
                    <div>
                        <div style={{
                            fontSize: "10px", fontWeight: 600, color: "var(--text-muted)",
                            textTransform: "uppercase", letterSpacing: "0.5px",
                            marginBottom: "8px",
                        }}>
                            {results.results.length} results
                        </div>
                        {results.results.length === 0 ? (
                            <div style={{
                                textAlign: "center", padding: "24px",
                                color: "var(--text-muted)", fontSize: "12px",
                            }}>No results found</div>
                        ) : (
                            results.results.map((result, i) => (
                                <div
                                    key={result.note.id}
                                    onClick={() => navigate(`/note/${result.note.id}`)}
                                    style={{
                                        padding: "10px 12px", borderRadius: "8px",
                                        border: "1px solid var(--border)",
                                        background: "var(--bg-card)",
                                        marginBottom: "6px", cursor: "pointer",
                                        transition: "all 0.15s",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = "#7c3aed"
                                        e.currentTarget.style.background = "var(--bg-card-hover)"
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = "var(--border)"
                                        e.currentTarget.style.background = "var(--bg-card)"
                                    }}
                                >
                                    <div style={{
                                        display: "flex", justifyContent: "space-between",
                                        alignItems: "flex-start", gap: "8px",
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: "12px", fontWeight: 600,
                                                color: "var(--text-primary)",
                                                whiteSpace: "nowrap", overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}>{result.note.title}</div>
                                            {result.note.summary && (
                                                <div style={{
                                                    fontSize: "11px", color: "var(--text-muted)",
                                                    marginTop: "4px", lineHeight: 1.4,
                                                    display: "-webkit-box", WebkitLineClamp: 2,
                                                    WebkitBoxOrient: "vertical", overflow: "hidden",
                                                }}>{result.note.summary.slice(0, 120)}...</div>
                                            )}
                                        </div>
                                        <div style={{
                                            display: "flex", flexDirection: "column",
                                            alignItems: "flex-end", gap: "4px", flexShrink: 0,
                                        }}>
                                            <span style={{
                                                background: "rgba(124,58,237,0.15)",
                                                color: "#a78bfa", padding: "2px 8px",
                                                borderRadius: "12px", fontSize: "10px",
                                                fontWeight: 600,
                                            }}>{(result.similarity * 100).toFixed(0)}%</span>
                                            <div style={{ display: 'flex', gap: '2px' }}>
                                                <button onClick={(e) => handleVote(e, result.note.id, 1)} style={{
                                                    background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px',
                                                    opacity: votes[result.note.id] === undefined || votes[result.note.id] === 1 ? 1 : 0.3,
                                                    filter: votes[result.note.id] === 1 ? 'drop-shadow(0 0 2px rgba(74,222,128,0.5))' : 'grayscale(1)',
                                                    fontSize: '10px', transition: 'all 0.2s',
                                                }} title="Relevant">👍</button>
                                                <button onClick={(e) => handleVote(e, result.note.id, -1)} style={{
                                                    background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px',
                                                    opacity: votes[result.note.id] === undefined || votes[result.note.id] === -1 ? 1 : 0.3,
                                                    filter: votes[result.note.id] === -1 ? 'drop-shadow(0 0 2px rgba(248,113,113,0.5))' : 'grayscale(1)',
                                                    fontSize: '10px', transition: 'all 0.2s',
                                                }} title="Not relevant">👎</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        display: "flex", gap: "4px", marginTop: "6px",
                                        flexWrap: "wrap",
                                    }}>
                                        {result.note.topic_name && (
                                            <span style={{
                                                fontSize: "9px", padding: "1px 6px",
                                                borderRadius: "4px",
                                                background: "rgba(124,58,237,0.1)",
                                                color: "#a78bfa",
                                            }}>{result.note.topic_name}</span>
                                        )}
                                        <span style={{
                                            fontSize: "9px", color: "var(--text-muted)",
                                        }}>{new Date(result.note.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Empty state */}
                {!results && !loading && (
                    <div style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        height: "100%", textAlign: "center",
                        padding: "24px 16px",
                    }}>
                        <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
                        <p style={{
                            fontSize: "12px", color: "var(--text-muted)",
                            maxWidth: "280px", lineHeight: 1.5,
                        }}>
                            Search your vault using natural language — powered by AI embeddings.
                        </p>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div style={{
                        display: "flex", justifyContent: "center",
                        padding: "40px",
                    }}>
                        <div className="loader" />
                    </div>
                )}
            </div>
        </div>
    )
}
