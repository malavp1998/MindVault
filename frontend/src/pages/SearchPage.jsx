import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchNotes, submitVote } from '../api';
import ReactMarkdown from 'react-markdown';
import { Search, Sparkles, ArrowRight, AlertCircle, ThumbsUp, ThumbsDown } from 'lucide-react';

export default function SearchPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [synthesize, setSynthesize] = useState(false);
    const [votes, setVotes] = useState({});
    const navigate = useNavigate();

    const handleVote = async (e, noteId, voteValue) => {
        e.stopPropagation();
        if (votes[noteId]) return;
        
        try {
            await submitVote(query, noteId, voteValue);
            setVotes(prev => ({ ...prev, [noteId]: voteValue }));
        } catch (err) {
            console.error('Failed to submit vote:', err);
        }
    };

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
                ? 'Search timed out — please try again.'
                : err.response?.data?.detail || 'Search failed. Please try again.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [query, synthesize]);

    return (
        <div className="search-page">
            {!results && !loading ? (
                /* Hero Initial State */
                <div className="search-hero">
                    <div className="search-hero-title">
                        <span className="page-header-serif">search</span> <span className="page-header-title">vault</span>
                    </div>
                    
                    <form onSubmit={handleSearch} className="search-box-wrap">
                        <input
                            type="text"
                            className="search-box-input"
                            placeholder="Ask anything about your saved knowledge..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            autoFocus
                        />
                        <button type="submit" className="search-box-btn" disabled={loading || !query.trim()}>
                            {loading ? <div className="spinner-sm" /> : <ArrowRight size={20} />}
                        </button>
                    </form>

                    <label className="search-ai-toggle">
                        <input
                            type="checkbox"
                            checked={synthesize}
                            onChange={e => setSynthesize(e.target.checked)}
                        />
                        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                        Generate AI answer
                    </label>
                </div>
            ) : (
                /* Results State */
                <div style={{ paddingBottom: 60 }}>
                    <div className="page-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 48 }}>
                        <div className="search-hero-title" style={{ marginBottom: 24, transform: 'scale(0.8)' }}>
                            <span className="page-header-serif">search</span> <span className="page-header-title">vault</span>
                        </div>
                        
                        <form onSubmit={handleSearch} className="search-box-wrap" style={{ maxWidth: 540 }}>
                            <input
                                type="text"
                                className="search-box-input"
                                placeholder="Ask anything about your saved knowledge..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                            />
                            <button type="submit" className="search-box-btn" disabled={loading || !query.trim()}>
                                {loading ? <div className="spinner-sm" style={{ borderColor: 'white', borderTopColor: 'transparent' }} /> : <ArrowRight size={20} />}
                            </button>
                        </form>

                        <label className="search-ai-toggle">
                            <input
                                type="checkbox"
                                checked={synthesize}
                                onChange={e => setSynthesize(e.target.checked)}
                            />
                            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                            Generate AI answer
                        </label>
                    </div>

                    {error && (
                        <div className="alert alert-error" style={{ maxWidth: 600, margin: '0 auto 24px' }}>
                            <AlertCircle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* RAG Answer */}
                    {results?.rag && (
                        <div className="rag-answer" style={{ maxWidth: 720, margin: '0 auto 48px' }}>
                            <div className="rag-answer-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Sparkles size={16} /> AI-Synthesized Answer
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 'normal', opacity: 0.6 }}>
                                    {['hi', 'ta', 'te', 'kn', 'bn', 'ml', 'gu', 'mr', 'pa', 'or'].includes(results.query_language)
                                        ? "Sarvam AI" : "Groq AI"}
                                </div>
                            </div>
                            <div className="rag-answer-text">
                                <ReactMarkdown>{results.rag.answer}</ReactMarkdown>
                            </div>
                        </div>
                    )}

                    {/* Search Results */}
                    {results && (
                        <div style={{ maxWidth: 800, margin: '0 auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
                                <h3 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                                    {results.results.length} results found
                                </h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {results.results.map((result, i) => (
                                    <div
                                        key={result.note.id}
                                        className="note-card"
                                        onClick={() => navigate(`/note/${result.note.id}`)}
                                        style={{ 
                                            display: 'flex', flexDirection: 'column', padding: 20, cursor: 'pointer',
                                            animation: `fadeInUp ${0.3 + i * 0.05}s ease both`
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <span className="note-topic-badge">{result.note.topic_name || "Uncategorized"}</span>
                                            </div>
                                            <span className="note-meta-badge" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                                {(result.similarity * 100).toFixed(0)}% Match
                                            </span>
                                        </div>

                                        <h2 className="note-card-title">{result.note.title}</h2>
                                        
                                        {result.note.summary && (
                                            <div className="note-summary-text" style={{ marginBottom: 16 }}>
                                                <ReactMarkdown>{result.note.summary}</ReactMarkdown>
                                            </div>
                                        )}

                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span className="note-date">
                                                {new Date(result.note.created_at).toLocaleDateString()}
                                            </span>
                                            
                                            <div style={{ display: 'flex', gap: 12 }}>
                                                <button 
                                                    onClick={(e) => handleVote(e, result.note.id, 1)}
                                                    className="vote-btn"
                                                    style={{ 
                                                        color: votes[result.note.id] === 1 ? '#22c55e' : 'var(--text-muted)',
                                                        opacity: votes[result.note.id] === undefined || votes[result.note.id] === 1 ? 1 : 0.3
                                                    }}
                                                >
                                                    <ThumbsUp size={16} fill={votes[result.note.id] === 1 ? 'currentColor' : 'none'} />
                                                </button>
                                                <button 
                                                    onClick={(e) => handleVote(e, result.note.id, -1)}
                                                    className="vote-btn"
                                                    style={{ 
                                                        color: votes[result.note.id] === -1 ? '#ef4444' : 'var(--text-muted)',
                                                        opacity: votes[result.note.id] === undefined || votes[result.note.id] === -1 ? 1 : 0.3
                                                    }}
                                                >
                                                    <ThumbsDown size={16} fill={votes[result.note.id] === -1 ? 'currentColor' : 'none'} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
