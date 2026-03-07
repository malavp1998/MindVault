import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import { listNotes, listTopics, deleteNote } from '../api';
import ReactMarkdown from 'react-markdown';

export default function VaultPage() {
    const [notes, setNotes] = useState([]);
    const [topics, setTopics] = useState([]);
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [selectedLanguage, setSelectedLanguage] = useState('All');
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        loadData();
    }, [selectedTopic]);

    async function loadData() {
        setLoading(true);
        try {
            const params = {};
            if (selectedTopic) params.topic_id = selectedTopic;
            if (selectedLanguage !== 'All') params.language = selectedLanguage;

            const [notesData, topicsData] = await Promise.all([
                listNotes(params),
                listTopics(),
            ]);
            setNotes(notesData);
            setTopics(topicsData);
        } catch (err) {
            console.error('Failed to load vault data:', err);
        } finally {
            setLoading(false);
        }
    }

    const breakpoints = { default: 3, 1200: 2, 800: 1 };

    async function handleDelete(e, id) {
        e.stopPropagation(); // prevent card click navigation
        if (!window.confirm("Are you sure you want to delete this note?")) {
            return;
        }
        try {
            await deleteNote(id);
            // Remove from local state
            setNotes(notes.filter(n => n.id !== id));
        } catch (err) {
            console.error('Failed to delete note:', err);
            alert("Failed to delete note.");
        }
    }

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p style={{ color: 'var(--text-muted)' }}>Loading your vault...</p>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h1>📚 Your Vault</h1>
                <p>{notes.length} notes saved • {topics.length} topics discovered</p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
                <select
                    value={selectedLanguage}
                    onChange={e => setSelectedLanguage(e.target.value)}
                    style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer'
                    }}
                >
                    <option value="All">All Languages 🌐</option>
                    <option value="en">English (en) 🇬🇧</option>
                    <option value="hi">Hindi (hi) 🇮🇳</option>
                    <option value="ta">Tamil (ta) 🇮🇳</option>
                    <option value="te">Telugu (te) 🇮🇳</option>
                    <option value="kn">Kannada (kn) 🇮🇳</option>
                    <option value="bn">Bengali (bn) 🇮🇳</option>
                    <option value="ml">Malayalam (ml) 🇮🇳</option>
                    <option value="gu">Gujarati (gu) 🇮🇳</option>
                    <option value="mr">Marathi (mr) 🇮🇳</option>
                    <option value="pa">Punjabi (pa) 🇮🇳</option>
                    <option value="or">Odia (or) 🇮🇳</option>
                </select>

                {/* Topic filter chips */}
                {topics.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                        <button
                            className={`topic-chip ${!selectedTopic ? 'active' : ''}`}
                            onClick={() => setSelectedTopic(null)}
                        >
                            All Topics <span className="count">{notes.length}</span>
                        </button>
                        {topics.map(topic => (
                            <button
                                key={topic.id}
                                className={`topic-chip ${selectedTopic === topic.id ? 'active' : ''}`}
                                onClick={() => setSelectedTopic(selectedTopic === topic.id ? null : topic.id)}
                            >
                                {topic.name} <span className="count">{topic.note_count}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {
                notes.length === 0 ? (
                    <div className="empty-state">
                        <div className="icon">🧠</div>
                        <h3 style={{ marginBottom: 8 }}>Your vault is empty</h3>
                        <p>Save pages from the Chrome extension or add notes via the API to get started.</p>
                    </div>
                ) : (
                    <Masonry
                        breakpointCols={breakpoints}
                        className="masonry-grid"
                        columnClassName="masonry-grid-column"
                    >
                        {notes.map(note => (
                            <div
                                key={note.id}
                                className="card"
                                onClick={() => navigate(`/note/${note.id}`)}
                                style={{ animationDelay: `${Math.random() * 0.2}s`, animation: 'fadeInUp 0.4s ease both' }}
                            >
                                <div className="card-title">{note.title}</div>
                                {note.summary && (
                                    <div className="card-summary">
                                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                                    </div>
                                )}
                                <div className="card-meta">
                                    <span>{new Date(note.created_at).toLocaleDateString()}</span>
                                    <div>
                                        {!note.is_processed && <span className="processing-badge">Processing</span>}
                                        {note.topic_name && <span className="tag">{note.topic_name}</span>}
                                        {note.language && note.language !== 'en' && <span className="tag">🇮🇳 {note.language.toUpperCase()}</span>}
                                        {note.language === 'en' && <span className="tag">🇬🇧 EN</span>}
                                    </div>
                                </div>
                                {Array.isArray(note.auto_tags) && note.auto_tags.length > 0 && (
                                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {note.auto_tags.slice(0, 3).map(tag => (
                                            <span key={`auto-${tag}`} className="tag" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                                                ✨ {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {Array.isArray(note.user_tags) && note.user_tags.length > 0 && (
                                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {note.user_tags.map(tag => (
                                            <span key={`user-${tag}`} className="tag" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                                🏷️ {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {Array.isArray(note.tags) && note.tags.length > 0 && (!note.auto_tags || note.auto_tags.length === 0) && (!note.user_tags || note.user_tags.length === 0) && (
                                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {note.tags.slice(0, 3).map(tag => (
                                            <span key={tag} className="tag">{tag}</span>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={(e) => handleDelete(e, note.id)}
                                    style={{
                                        position: 'absolute', top: 12, right: 12,
                                        background: 'rgba(239, 68, 68, 0.15)', border: 'none',
                                        color: '#ef4444', width: 28, height: 28, borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 14, cursor: 'pointer', opacity: 0.6,
                                        transition: 'all 0.2s ease',
                                    }}
                                    onMouseOver={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; }}
                                    onMouseOut={(e) => { e.currentTarget.style.opacity = 0.6; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
                                    title="Delete note"
                                >
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </Masonry>
                )
            }
        </div >
    );
}
