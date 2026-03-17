import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchNotes, submitVote } from '../api'
import ReactMarkdown from 'react-markdown'
import { Search, Sparkles, ArrowRight, AlertCircle, ThumbsUp, ThumbsDown } from 'lucide-react'

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
        <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
            {/* Header */}
            <div style={{ padding: "24px 24px 16px", flexShrink: 0 }}>
                <form onSubmit={handleSearch} className="search-box-wrap" style={{ maxWidth: '100%' }}>
                    <input
                        type="text"
                        className="search-box-input"
                        placeholder="Search your vault..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                    <button type="submit" className="search-box-btn" disabled={loading || !query.trim()}>
                        {loading ? <div className="spinner-sm" style={{ borderColor: 'white', borderTopColor: 'transparent' }} /> : <ArrowRight size={20} />}
                    </button>
                </form>
                <label className="search-ai-toggle" style={{ justifyContent: 'flex-start', marginTop: 12, marginLeft: 8 }}>
                    <input
                        type="checkbox"
                        checked={synthesize}
                        onChange={e => setSynthesize(e.target.checked)}
                    />
                    <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                    Generate AI answer
                </label>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
                {error && (
                    <div className="alert alert-error" style={{ marginBottom: "16px" }}>
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                {/* RAG Answer */}
                {results?.rag && (
                    <div className="rag-answer" style={{ marginBottom: "24px", padding: "20px" }}>
                        <div className="rag-answer-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Sparkles size={16} /> AI-Synthesized Answer
                            </div>
                        </div>
                        <div className="rag-answer-text" style={{ fontSize: '0.9375rem' }}>
                            <ReactMarkdown>{results.rag.answer}</ReactMarkdown>
                        </div>
                    </div>
                )}

                {/* Search Results */}
                {results && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                            <h3 style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                                {results.results.length} results found
                            </h3>
                        </div>
                        {results.results.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                                No results found
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {results.results.map((result, i) => (
                                    <div
                                        key={result.note.id}
                                        className="note-card"
                                        onClick={() => navigate(`/note/${result.note.id}`)}
                                        style={{ 
                                            display: 'flex', flexDirection: 'column', padding: 16, cursor: 'pointer',
                                            animation: `fadeInUp ${0.3 + i * 0.05}s ease both`
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <span className="note-topic-badge" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
                                                    {result.note.topic_name || "Uncategorized"}
                                                </span>
                                            </div>
                                            <span className="note-meta-badge" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.75rem' }}>
                                                {(result.similarity * 100).toFixed(0)}% Match
                                            </span>
                                        </div>

                                        <h2 className="note-card-title" style={{ fontSize: '1rem', marginBottom: 8 }}>{result.note.title}</h2>
                                        
                                        {result.note.summary && (
                                            <div className="note-summary-text" style={{ fontSize: '0.8125rem', marginBottom: 12 }}>
                                                <ReactMarkdown>{result.note.summary}</ReactMarkdown>
                                            </div>
                                        )}

                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span className="note-date" style={{ fontSize: '0.75rem' }}>
                                                {new Date(result.note.created_at).toLocaleDateString()}
                                            </span>
                                            
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button 
                                                    onClick={(e) => handleVote(e, result.note.id, 1)}
                                                    className="vote-btn"
                                                    style={{ 
                                                        color: votes[result.note.id] === 1 ? '#22c55e' : 'var(--text-muted)',
                                                        opacity: votes[result.note.id] === undefined || votes[result.note.id] === 1 ? 1 : 0.3,
                                                        padding: 4
                                                    }}
                                                >
                                                    <ThumbsUp size={14} fill={votes[result.note.id] === 1 ? 'currentColor' : 'none'} />
                                                </button>
                                                <button 
                                                    onClick={(e) => handleVote(e, result.note.id, -1)}
                                                    className="vote-btn"
                                                    style={{ 
                                                        color: votes[result.note.id] === -1 ? '#ef4444' : 'var(--text-muted)',
                                                        opacity: votes[result.note.id] === undefined || votes[result.note.id] === -1 ? 1 : 0.3,
                                                        padding: 4
                                                    }}
                                                >
                                                    <ThumbsDown size={14} fill={votes[result.note.id] === -1 ? 'currentColor' : 'none'} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Empty state */}
                {!results && !loading && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", padding: "40px 16px" }}>
                        <Search size={48} color="var(--border)" style={{ marginBottom: 16 }} />
                        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", maxWidth: "240px", lineHeight: 1.5 }}>
                            Search your vault using natural language — powered by AI embeddings.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
