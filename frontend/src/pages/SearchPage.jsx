import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchNotes } from '../api';

export default function SearchPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [synthesize, setSynthesize] = useState(true);
    const navigate = useNavigate();

    const handleSearch = useCallback(async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        try {
            const data = await searchNotes(query, { topK: 10, synthesize });
            setResults(data);
        } catch (err) {
            console.error('Search failed:', err);
            const msg = err.code === 'ECONNABORTED'
                ? 'Search timed out — the AI is under heavy load. Try again or uncheck the AI answer option.'
                : err.response?.data?.detail || 'Search failed. Please try again.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [query, synthesize]);

    return (
        <div>
            <div className="page-header">
                <h1>🔍 Semantic Search</h1>
                <p>Search your vault using natural language — powered by AI embeddings</p>
            </div>

            {/* Search input */}
            <form onSubmit={handleSearch}>
                <div className="search-container">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Ask anything about your saved knowledge..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={synthesize}
                            onChange={e => setSynthesize(e.target.checked)}
                            style={{ accentColor: 'var(--accent)' }}
                        />
                        ✨ Generate AI answer (RAG)
                    </label>
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        style={{
                            padding: '10px 24px',
                            background: 'var(--gradient-primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: 'pointer',
                            opacity: loading || !query.trim() ? 0.5 : 1,
                        }}
                    >
                        {loading ? '⏳ Searching...' : 'Search'}
                    </button>
                </div>
            </form>

            {/* Error */}
            {error && (
                <div className="card" style={{ borderLeft: '4px solid #ef4444', background: 'rgba(239,68,68,0.08)', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>⚠️</span>
                        <span style={{ color: '#ef4444', fontSize: 14 }}>{error}</span>
                    </div>
                </div>
            )}

            {/* RAG Answer */}
            {results?.rag && (
                <div className="rag-answer" style={{ animation: 'fadeInUp 0.4s ease' }}>
                    <div className="rag-answer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <span>✨</span> AI-Synthesized Answer
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 'normal', opacity: 0.7 }}>
                            {['hi', 'ta', 'te', 'kn', 'bn', 'ml', 'gu', 'mr', 'pa', 'or'].includes(results.query_language)
                                ? "Answered by Sarvam AI 🇮🇳"
                                : "Answered by Groq 🇬🇧"}
                        </div>
                    </div>
                    <div className="rag-answer-text">{results.rag.answer}</div>
                </div>
            )}

            {/* Results */}
            {results && (
                <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>
                        {results.results.length} results found
                    </h3>

                    {results.results.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">🔍</div>
                            <h3>No results found</h3>
                            <p>Try a different query or save more notes to your vault.</p>
                        </div>
                    ) : (
                        results.results.map((result, i) => (
                            <div
                                key={result.note.id}
                                className="card"
                                onClick={() => navigate(`/note/${result.note.id}`)}
                                style={{
                                    marginBottom: 12,
                                    animation: `fadeInUp ${0.3 + i * 0.05}s ease both`,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">{result.note.title}</div>
                                        {result.note.summary && (
                                            <div className="card-summary">{result.note.summary}</div>
                                        )}
                                    </div>
                                    <span className="similarity-badge" style={{ marginLeft: 12, flexShrink: 0 }}>
                                        {(result.similarity * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <div className="card-meta">
                                    <span>{new Date(result.note.created_at).toLocaleDateString()}</span>
                                    <div>
                                        {result.note.topic_name && <span className="tag">{result.note.topic_name}</span>}
                                        {result.note.language && result.note.language !== 'en' && <span className="tag">🇮🇳 {result.note.language.toUpperCase()}</span>}
                                        {result.note.source_url && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>🔗 Has source</span>}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Initial state */}
            {!results && !loading && (
                <div className="empty-state">
                    <div className="icon">🧠</div>
                    <h3>Search your second brain</h3>
                    <p>Type a question or topic to find semantically similar notes, with optional AI-powered answers.</p>
                </div>
            )}
        </div>
    );
}
