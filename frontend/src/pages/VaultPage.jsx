import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import { listNotes, listTopics } from '../api';

export default function VaultPage() {
    const [notes, setNotes] = useState([]);
    const [topics, setTopics] = useState([]);
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        loadData();
    }, [selectedTopic]);

    async function loadData() {
        setLoading(true);
        try {
            const [notesData, topicsData] = await Promise.all([
                listNotes(selectedTopic ? { topic_id: selectedTopic } : {}),
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

            {/* Topic filter chips */}
            {topics.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    <button
                        className={`topic-chip ${!selectedTopic ? 'active' : ''}`}
                        onClick={() => setSelectedTopic(null)}
                    >
                        All <span className="count">{notes.length}</span>
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

            {notes.length === 0 ? (
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
                            {note.summary && <div className="card-summary">{note.summary}</div>}
                            <div className="card-meta">
                                <span>{new Date(note.created_at).toLocaleDateString()}</span>
                                <div>
                                    {!note.is_processed && <span className="processing-badge">Processing</span>}
                                    {note.topic_name && <span className="tag">{note.topic_name}</span>}
                                </div>
                            </div>
                            {note.tags && note.tags.length > 0 && (
                                <div style={{ marginTop: 10 }}>
                                    {note.tags.slice(0, 3).map(tag => (
                                        <span key={tag} className="tag">{tag}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </Masonry>
            )}
        </div>
    );
}
