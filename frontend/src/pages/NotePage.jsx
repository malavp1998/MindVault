import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNote, processNote } from '../api';

export default function NotePage() {
    const { id } = useParams();
    const [note, setNote] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        loadNote();
    }, [id]);

    async function loadNote() {
        setLoading(true);
        try {
            const data = await getNote(id);
            setNote(data);
        } catch (err) {
            console.error('Failed to load note:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleReprocess() {
        setProcessing(true);
        try {
            await processNote(id);
            // Poll for completion
            setTimeout(loadNote, 3000);
        } catch (err) {
            console.error('Processing failed:', err);
        } finally {
            setProcessing(false);
        }
    }

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p style={{ color: 'var(--text-muted)' }}>Loading note...</p>
            </div>
        );
    }

    if (!note) {
        return (
            <div className="empty-state">
                <div className="icon">❌</div>
                <h3>Note not found</h3>
                <p><a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>Back to vault</a></p>
            </div>
        );
    }

    return (
        <div className="note-detail">
            {/* Header */}
            <div className="note-detail-header">
                <button
                    onClick={() => navigate(-1)}
                    style={{
                        background: 'none', border: 'none', color: 'var(--accent-light)',
                        fontSize: 14, cursor: 'pointer', marginBottom: 16, display: 'block',
                    }}
                >
                    ← Back
                </button>

                <h1 className="note-detail-title">{note.title}</h1>

                <div className="note-detail-meta">
                    <span>📅 {new Date(note.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    {note.source_url && (
                        <a href={note.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                            🔗 Source
                        </a>
                    )}
                    {note.topic_name && <span className="tag">{note.topic_name}</span>}
                    {!note.is_processed && <span className="processing-badge">Processing</span>}
                    <button
                        onClick={handleReprocess}
                        disabled={processing}
                        style={{
                            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                            color: 'var(--text-secondary)', padding: '4px 12px', borderRadius: 6,
                            fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        {processing ? '⏳ Processing...' : '🔄 Reprocess'}
                    </button>
                </div>
            </div>

            {/* Tags */}
            {note.tags && note.tags.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    {note.tags.map(tag => (
                        <span key={tag} className="tag">{tag}</span>
                    ))}
                </div>
            )}

            {/* AI Summary */}
            {note.summary && (
                <div className="note-section">
                    <h3 className="note-section-title">✨ AI Summary</h3>
                    <div className="note-summary-box">{note.summary}</div>
                </div>
            )}

            {/* Key Concepts */}
            {note.key_concepts && note.key_concepts.length > 0 && (
                <div className="note-section">
                    <h3 className="note-section-title">🔑 Key Concepts</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {note.key_concepts.map((concept, i) => (
                            <span key={i} className="tag">{concept}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="note-section">
                <h3 className="note-section-title">📄 Content</h3>
                <div className="note-detail-content">{note.content}</div>
            </div>

            {/* Backlinks */}
            {note.backlinks && note.backlinks.length > 0 && (
                <div className="note-section">
                    <h3 className="note-section-title">🔗 Linked Notes ({note.backlinks.length})</h3>
                    {note.backlinks.map(link => (
                        <div
                            key={link.id}
                            className="backlink-card"
                            onClick={() => navigate(`/note/${link.note_id}`)}
                        >
                            <span style={{ fontWeight: 500, fontSize: 14 }}>{link.title}</span>
                            <span className="similarity-badge">{(link.similarity_score * 100).toFixed(0)}% match</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
