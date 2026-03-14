import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNote, updateNote, processNote, deleteNote, api } from '../api';
import ReactMarkdown from 'react-markdown';
import RichTextEditor from '../components/RichTextEditor';
import ChatPanel from '../components/ChatPanel';

export default function NotePage() {
    const { id } = useParams();
    const [note, setNote] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Edit state
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Tag management state
    const [showTagInput, setShowTagInput] = useState(false);
    const [newTag, setNewTag] = useState('');
    const [suggestingTags, setSuggestingTags] = useState(false);
    const [suggestedTags, setSuggestedTags] = useState([]);

    // UI state
    const [showContent, setShowContent] = useState(false);
    const [showChat, setShowChat] = useState(true);

    const navigate = useNavigate();

    useEffect(() => {
        loadNote();
    }, [id]);

    async function loadNote() {
        setLoading(!note); // only show full loading overlay if we don't have the note yet
        try {
            const data = await getNote(id);
            setNote(data);
            
            // Default content to hidden if we already have a generated summary
            if (data.summary) {
                setShowContent(false);
            } else {
                setShowContent(true);
            }
        } catch (err) {
            console.error('Failed to load note:', err);
        } finally {
            setLoading(false);
        }
    }

    // Poll if note is currently being processed
    useEffect(() => {
        let timer;
        if (note && note.is_processed === false) {
            timer = setTimeout(loadNote, 3000);
        }
        return () => clearTimeout(timer);
    }, [note?.is_processed, id]);

    async function handleReprocess() {
        setProcessing(true);
        try {
            await processNote(id);
            // Fetch immediately to get the updated is_processed=False state
            await loadNote();
        } catch (err) {
            console.error('Processing failed:', err);
        } finally {
            setProcessing(false);
        }
    }

    async function handleDelete() {
        if (!window.confirm("Are you sure you want to delete this note? This cannot be undone.")) {
            return;
        }

        setIsDeleting(true);
        try {
            await deleteNote(id);
            navigate('/', { replace: true });
        } catch (err) {
            console.error('Failed to delete note:', err);
            alert("Failed to delete note. Please try again.");
            setIsDeleting(false);
        }
    }

    // --- Edit handlers ---
    function handleStartEdit() {
        setEditTitle(note.title);
        setEditContent(note.content);
        setIsEditing(true);
    }

    async function handleSaveEdit() {
        setIsSaving(true);
        try {
            const updated = await updateNote(id, { title: editTitle, content: editContent });
            setNote(updated);
            setIsEditing(false);
        } catch (err) {
            console.error('Failed to update note:', err);
            alert("Failed to save changes. Please try again.");
        } finally {
            setIsSaving(false);
        }
    }

    // --- Tagging handlers ---
    async function handleAddTag(e) {
        if (e.key === 'Enter' && newTag.trim()) {
            const tag = newTag.trim().toLowerCase();
            const currentTags = note.user_tags || [];
            if (!currentTags.includes(tag)) {
                try {
                    const updatedNote = await api.patch(`/notes/${id}/tags`, { tags: [...currentTags, tag] }).then(r => r.data);
                    setNote(updatedNote);
                } catch (err) {
                    console.error("Failed to add tag", err);
                }
            }
            setNewTag('');
            setShowTagInput(false);
        }
    }

    async function handleRemoveTag(tagToRemove) {
        const currentTags = note.user_tags || [];
        const newTags = currentTags.filter(t => t !== tagToRemove);
        try {
            const updatedNote = await api.patch(`/notes/${id}/tags`, { tags: newTags }).then(r => r.data);
            setNote(updatedNote);
        } catch (err) {
            console.error("Failed to remove tag", err);
        }
    }

    async function handleSuggestTags() {
        setSuggestingTags(true);
        try {
            const res = await api.post(`/notes/${id}/suggest-tags`).then(r => r.data);
            setSuggestedTags(res.suggested_tags || []);
        } catch (err) {
            console.error("Failed to suggest tags", err);
        } finally {
            setSuggestingTags(false);
        }
    }

    async function acceptSuggestedTag(tag) {
        const currentTags = note.user_tags || [];
        if (!currentTags.includes(tag)) {
            try {
                const updatedNote = await api.patch(`/notes/${id}/tags`, { tags: [...currentTags, tag] }).then(r => r.data);
                setNote(updatedNote);
                // Remove from suggestions array safely
                setSuggestedTags(prev => prev.filter(t => t !== tag));
            } catch (err) {
                console.error("Failed to accept suggested tag", err);
            }
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
        <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', minHeight: 'calc(100vh - 100px)' }}>
            {/* Left: Note detail */}
            <div className="note-detail" style={{ flex: 1, minWidth: 0 }}>
            {/* Header */}
            <div className="note-detail-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'none', border: 'none', color: 'var(--accent-light)',
                            fontSize: 14, cursor: 'pointer', marginBottom: 16, display: 'block',
                        }}
                    >
                        ← Back
                    </button>
                    <button
                        onClick={() => setShowChat(!showChat)}
                        style={{
                            background: showChat ? 'rgba(124, 58, 237, 0.15)' : 'var(--bg-card-hover)',
                            border: showChat ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid var(--border)',
                            color: showChat ? '#a78bfa' : 'var(--text-secondary)',
                            padding: '4px 12px', borderRadius: 6,
                            fontSize: 12, cursor: 'pointer',
                            transition: 'all 0.15s',
                            marginBottom: 16,
                        }}
                    >
                        {showChat ? '🧠 Hide Chat' : '🧠 Chat'}
                    </button>
                </div>

                {isEditing ? (
                    <input
                        className="note-title-input"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        style={{ width: '100%', fontSize: '2em', fontWeight: 'bold', marginBottom: '8px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px' }}
                    />
                ) : (
                    <h1 className="note-detail-title">{note.title}</h1>
                )}

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
                        disabled={processing || (note && !note.is_processed)}
                        style={{
                            background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
                            color: 'var(--text-secondary)', padding: '4px 12px', borderRadius: 6,
                            fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        {processing || (note && !note.is_processed) ? '⏳ Processing...' : '🔄 Reprocess'}
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting || isSaving}
                        style={{
                            background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.5)',
                            color: '#ef4444', padding: '4px 12px', borderRadius: 6,
                            marginLeft: 8, fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        {isDeleting ? '⏳ Deleting...' : '🗑️ Delete'}
                    </button>
                    {!isEditing && (
                        <button
                            onClick={handleStartEdit}
                            style={{
                                background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
                                color: 'var(--text-primary)', padding: '4px 12px', borderRadius: 6,
                                marginLeft: 8, fontSize: 12, cursor: 'pointer',
                            }}
                        >
                            ✏️ Edit
                        </button>
                    )}
                </div>
            </div>

            {/* Tags Area */}
            <div style={{ marginBottom: 24, padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>

                {/* Auto Tags (AI Generated) */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>✨ AI Generated Tags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Array.isArray(note.auto_tags) && note.auto_tags.length > 0 ? (
                            note.auto_tags.map(tag => (
                                <span key={`auto-${tag}`} className="tag" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                                    {tag}
                                </span>
                            ))
                        ) : (
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No tags generated yet.</span>
                        )}
                    </div>
                </div>

                {/* User Tags (Manual) */}
                <div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>🏷️ Custom Tags</span>
                        <div>
                            <button
                                onClick={() => setShowTagInput(!showTagInput)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, marginRight: 12 }}
                            >
                                + Add Tag
                            </button>
                            <button
                                onClick={handleSuggestTags}
                                disabled={suggestingTags}
                                style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 12 }}
                            >
                                {suggestingTags ? '⏳ Thinking...' : '🪄 Suggest'}
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {Array.isArray(note.user_tags) && note.user_tags.map(tag => (
                            <span key={`user-${tag}`} className="tag" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {tag}
                                <button onClick={() => handleRemoveTag(tag)} style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', padding: 0, fontSize: 12, opacity: 0.7 }}>×</button>
                            </span>
                        ))}

                        {/* Legacy tags fallback */}
                        {Array.isArray(note.tags) && note.tags.length > 0 && (!note.auto_tags || note.auto_tags.length === 0) && (!note.user_tags || note.user_tags.length === 0) && (
                            note.tags.map(tag => (
                                <span key={`legacy-${tag}`} className="tag">{tag}</span>
                            ))
                        )}

                        {showTagInput && (
                            <input
                                autoFocus
                                type="text"
                                value={newTag}
                                onChange={e => setNewTag(e.target.value)}
                                onKeyDown={handleAddTag}
                                onBlur={() => setShowTagInput(false)}
                                placeholder="Type and press Enter..."
                                style={{
                                    background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)',
                                    padding: '4px 8px', borderRadius: '6px', fontSize: 13, outline: 'none', width: 140
                                }}
                            />
                        )}
                    </div>

                    {/* Pending Suggestions */}
                    {suggestedTags.length > 0 && (
                        <div style={{ marginTop: 12, padding: 12, background: 'rgba(59, 130, 246, 0.05)', borderRadius: 8, border: '1px dashed rgba(59, 130, 246, 0.2)' }}>
                            <div style={{ fontSize: 12, color: '#60a5fa', marginBottom: 8 }}>Suggested by AI (Click to accept):</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {suggestedTags.map(tag => (
                                    <button
                                        key={`suggested-${tag}`}
                                        onClick={() => acceptSuggestedTag(tag)}
                                        className="tag"
                                        style={{ background: 'transparent', color: 'var(--text-primary)', borderColor: 'var(--border-color)', cursor: 'pointer', transition: 'all 0.2s' }}
                                        onMouseOver={e => e.currentTarget.style.borderColor = '#60a5fa'}
                                        onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* AI Summary */}
            {note.summary && (
                <div className="note-section">
                    <h3 className="note-section-title">✨ AI Summary</h3>
                    <div className="note-summary-box">
                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Key Concepts */}
            {Array.isArray(note.key_concepts) && note.key_concepts.length > 0 && (
                <div className="note-section">
                    <h3 className="note-section-title">🔑 Key Concepts</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {note.key_concepts.map((concept, i) => (
                            <span key={i} className="tag">{concept}</span>
                        ))}
                    </div>
                </div>
            )
            }

            {/* Content */}
            <div className="note-section">
                <div 
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginBottom: showContent || isEditing ? 12 : 0 }}
                    onClick={() => setShowContent(!showContent)}
                >
                    <h3 className="note-section-title" style={{ margin: 0 }}>📄 Content</h3>
                    {!isEditing && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                            {showContent ? '▼ Hide' : '▶ Show'}
                        </span>
                    )}
                </div>

                {(showContent || isEditing) && (
                    isEditing ? (
                        <div style={{ marginBottom: 16, marginTop: 12 }}>
                            <div style={{ position: 'relative' }}>
                                <RichTextEditor 
                                    content={editContent} 
                                    onChange={setEditContent} 
                                />
                            </div>
                            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isSaving}
                                    style={{
                                        background: 'var(--accent)', color: '#fff', border: 'none',
                                        padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                >
                                    {isSaving ? 'Saving...' : '💾 Save Changes'}
                                </button>
                                <button
                                    onClick={() => setIsEditing(false)}
                                    disabled={isSaving}
                                    style={{
                                        background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
                                        padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="note-detail-content tiptap-render" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: note.content }} />
                    )
                )}
            </div>

            {/* Backlinks */}
            {
                note.backlinks && note.backlinks.length > 0 && (
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
                )
            }
        </div>

            {/* Right: Chat Panel */}
            {showChat && (
                <div style={{
                    width: '380px',
                    minWidth: '380px',
                    height: 'calc(100vh - 100px)',
                    position: 'sticky',
                    top: '80px',
                    marginLeft: '16px',
                }}>
                    <ChatPanel noteContext={{ id: note.id, title: note.title }} />
                </div>
            )}
        </div>
    );
}
