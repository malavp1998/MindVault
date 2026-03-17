import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNote, updateNote, processNote, deleteNote, api } from '../api';
import ReactMarkdown from 'react-markdown';
import RichTextEditor from '../components/RichTextEditor';
import ChatPanel from '../components/ChatPanel';
import SearchPanel from '../components/SearchPanel';
import { ArrowLeft, Calendar, ExternalLink, PenLine, RefreshCw, Trash2, Tag as TagIcon, Sparkles, Info, Brain, Search, X } from 'lucide-react';

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
    const [sidebarTab, setSidebarTab] = useState('chat');

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
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            {/* Left: Note detail */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '64px 80px', background: '#fff' }}>
                {/* Header */}
                <button 
                    onClick={() => navigate(-1)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', marginBottom: 40, padding: 0 }}
                >
                    <ArrowLeft size={16} strokeWidth={2} /> Back to Vault
                </button>

                <div style={{ marginBottom: 48 }}>
                    {isEditing ? (
                        <input
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            style={{ width: '100%', fontSize: '3.125rem', fontWeight: 700, margin: 0, lineHeight: 1.2, background: 'var(--bg)', color: 'var(--text-dark)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 16px', outline: 'none' }}
                        />
                    ) : (
                        <h1 style={{ fontSize: '3.125rem', fontWeight: 700, color: 'var(--text-dark)', margin: 0, lineHeight: 1.2 }}>
                            {note.title}
                        </h1>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 24, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            <Calendar size={16} strokeWidth={2} /> 
                            {new Date(note.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                        
                        {note.source_url && (
                            <a href={note.source_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
                                <ExternalLink size={16} strokeWidth={2} /> Source
                            </a>
                        )}

                        <div style={{ display: 'flex', gap: 8 }}>
                            {!isEditing && (
                                <button
                                    onClick={handleStartEdit}
                                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 16px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dark)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                    <PenLine size={14} strokeWidth={2} /> Edit Note
                                </button>
                            )}
                            
                            <button
                                onClick={handleReprocess}
                                disabled={processing || (note && !note.is_processed)}
                                style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 16px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dark)', cursor: processing || (note && !note.is_processed) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: processing || (note && !note.is_processed) ? 0.6 : 1 }}
                            >
                                <RefreshCw size={14} strokeWidth={2} className={processing || (note && !note.is_processed) ? "animate-spin" : ""} /> Reprocess
                            </button>
                            
                            <button
                                onClick={handleDelete}
                                disabled={isDeleting || isSaving}
                                style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: 20, padding: '6px 16px', fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', cursor: isDeleting || isSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: isDeleting || isSaving ? 0.6 : 1 }}
                            >
                                <Trash2 size={14} strokeWidth={2} /> Delete
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tags Area */}
                <div style={{ background: 'var(--bg)', borderRadius: 24, padding: 32, marginBottom: 48, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TagIcon size={14} strokeWidth={2} /> Tags & Context
                        </h3>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            {showTagInput ? (
                                <input
                                    autoFocus
                                    type="text"
                                    value={newTag}
                                    onChange={e => setNewTag(e.target.value)}
                                    onKeyDown={handleAddTag}
                                    onBlur={() => setShowTagInput(false)}
                                    placeholder="Type and press Enter..."
                                    style={{ background: '#fff', border: '1px solid var(--border)', color: 'var(--text-dark)', padding: '4px 8px', borderRadius: 6, fontSize: '0.75rem', outline: 'none', width: 140 }}
                                />
                            ) : (
                                <button
                                    onClick={() => setShowTagInput(!showTagInput)}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    + Add Tag
                                </button>
                            )}
                            <button
                                onClick={handleSuggestTags}
                                disabled={suggestingTags}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, cursor: suggestingTags ? 'not-allowed' : 'pointer' }}
                            >
                                {suggestingTags ? 'Thinking...' : 'Suggest ✨'}
                            </button>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {suggestedTags.length > 0 && suggestedTags.map(tag => (
                            <button
                                key={`suggested-${tag}`}
                                onClick={() => acceptSuggestedTag(tag)}
                                style={{ background: 'rgba(148, 78, 135, 0.05)', border: '1px dashed rgba(148, 78, 135, 0.3)', borderRadius: 20, padding: '5px 13px', fontSize: '0.875rem', fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                + {tag}
                            </button>
                        ))}
                        {Array.from(new Set([...(note.user_tags || []), ...(note.auto_tags || []), ...(note.tags || [])])).map(tag => (
                            <span key={tag} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 14px', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {tag}
                                <X size={14} strokeWidth={2} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => handleRemoveTag(tag)} />
                            </span>
                        ))}
                        {Array.from(new Set([...(note.user_tags || []), ...(note.auto_tags || []), ...(note.tags || [])])).length === 0 && suggestedTags.length === 0 && (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No tags yet.</span>
                        )}
                    </div>
                </div>

                {/* Key Concepts */}
                {Array.isArray(note.key_concepts) && note.key_concepts.length > 0 && (
                    <div style={{ background: 'var(--bg)', borderRadius: 24, padding: 32, marginBottom: 48, border: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Sparkles size={14} strokeWidth={2} /> Key Concepts
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {note.key_concepts.map((concept, i) => (
                                <span key={i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 14px', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-dark)' }}>
                                    {concept}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* AI Summary */}
                {note.summary && (
                    <div style={{ marginBottom: 48 }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-dark)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Sparkles size={20} strokeWidth={2} color="var(--accent)" /> AI Summary
                        </h3>
                        <div style={{ background: 'var(--bg)', padding: 32, borderRadius: 24, fontSize: '1.05rem', lineHeight: 1.7, color: 'var(--text-dark)', border: '1px solid var(--border)' }}>
                            <div className="prose-content">
                                <ReactMarkdown>{note.summary}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )}

                {/* Full Content */}
                <div style={{ marginBottom: 48 }}>
                    <div 
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 16 }}
                        onClick={() => setShowContent(!showContent)}
                    >
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-dark)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Info size={20} strokeWidth={2} color="var(--text-muted)" /> Full Content
                        </h3>
                        {!isEditing && (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                {showContent ? 'Hide' : 'Show'}
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
                                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={handleSaveEdit}
                                        disabled={isSaving}
                                        style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                                    >
                                        {isSaving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        disabled={isSaving}
                                        style={{ background: '#fff', color: 'var(--text-dark)', border: '1px solid var(--border)', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="prose-content" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: note.content }} />
                        )
                    )}
                </div>

                {/* Linked Notes */}
                {note.backlinks && note.backlinks.length > 0 && (
                    <div style={{ marginBottom: 48 }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-dark)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ExternalLink size={20} strokeWidth={2} color="var(--text-muted)" /> Linked Notes ({note.backlinks.length})
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {note.backlinks.map(link => (
                                <div
                                    key={link.id}
                                    onClick={() => navigate(`/note/${link.note_id}`)}
                                    style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'border-color 0.2s' }}
                                    onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                                >
                                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-dark)' }}>{link.title}</span>
                                    <span style={{ background: 'var(--bg)', padding: '4px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                                        {(link.similarity_score * 100).toFixed(0)}% match
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Sidebar with Tabs */}
            <div style={{ width: 440, borderLeft: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', padding: 16, gap: 8, background: '#fff', borderBottom: '1px solid var(--border)' }}>
                    <button 
                        onClick={() => setSidebarTab('chat')}
                        style={{ flex: 1, padding: 10, borderRadius: 12, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, transition: '0.1s',
                            ...(sidebarTab === 'chat' ? { background: 'var(--accent-light)', color: 'var(--accent)' } : { background: 'transparent', color: 'var(--text-muted)' })
                        }}
                    >
                        <Brain size={18} strokeWidth={2} /> Chat
                    </button>
                    <button 
                        onClick={() => setSidebarTab('search')}
                        style={{ flex: 1, padding: 10, borderRadius: 12, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, transition: '0.1s',
                            ...(sidebarTab === 'search' ? { background: 'var(--accent-light)', color: 'var(--accent)' } : { background: 'transparent', color: 'var(--text-muted)' })
                        }}
                    >
                        <Search size={18} strokeWidth={2} /> Search
                    </button>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {sidebarTab === 'chat' && (
                        <ChatPanel noteContext={{ id: note.id, title: note.title }} />
                    )}
                    {sidebarTab === 'search' && (
                        <SearchPanel />
                    )}
                </div>
            </div>
        </div>
    );
}
