import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import { listNotes, listTopics, deleteNote, createNote, createAudioNote } from '../api';
import ReactMarkdown from 'react-markdown';

export default function VaultPage() {
    const [notes, setNotes] = useState([]);
    const [topics, setTopics] = useState([]);
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [selectedLanguage, setSelectedLanguage] = useState('All');
    const [loading, setLoading] = useState(true);
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    const [newNoteTitle, setNewNoteTitle] = useState('');
    const [newNoteContent, setNewNoteContent] = useState('');
    const [extractedTags, setExtractedTags] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recognitionRef = useRef(null);
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

    const handleContentChange = (e) => {
        const text = e.target.value;
        setNewNoteContent(text);

        // Extract hashtags regex (matches #tag but not # just standing alone)
        const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
        const tags = [];
        let match;
        while ((match = hashtagRegex.exec(text)) !== null) {
            if (!tags.includes(match[1].toLowerCase())) {
                tags.push(match[1].toLowerCase());
            }
        }
        setExtractedTags(tags);
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = handleStopRecording;

            // Initialize Speech Recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = selectedLanguage === 'All' ? 'en-US' : selectedLanguage; // Default to English or selected language

                recognition.onresult = (event) => {
                    let interimResult = '';
                    let finalResult = '';

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalResult += event.results[i][0].transcript + ' ';
                        } else {
                            interimResult += event.results[i][0].transcript;
                        }
                    }

                    if (finalResult) {
                        setNewNoteContent(prev => prev + (prev.endsWith(' ') || prev.length === 0 ? '' : ' ') + finalResult);
                    }
                    setInterimTranscript(interimResult);
                };

                recognition.onerror = (event) => {
                    console.error("Speech recognition error", event.error);
                };

                recognitionRef.current = recognition;
                recognition.start();
            } else {
                console.warn("Speech recognition not supported in this browser.");
            }

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Microphone access denied or error:", err);
            alert("Could not access microphone. Please allow permissions.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            setIsRecording(false);
        }
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setInterimTranscript('');
        }
    };

    const handleStopRecording = async () => {
        setIsSaving(true);
        try {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('title', newNoteTitle.trim());
            formData.append('user_tags', JSON.stringify(extractedTags));

            const newNote = await createAudioNote(formData);

            setNotes([newNote, ...notes]);

            setIsCreatingNote(false);
            setNewNoteTitle('');
            setExtractedTags([]);
            setInterimTranscript('');
        } catch (err) {
            console.error("Failed to upload audio note:", err);
            alert("Failed to save voice note. Please try again.");
        } finally {
            setIsSaving(false);
            audioChunksRef.current = [];
            setInterimTranscript('');
        }
    };

    const handleCreateNote = async () => {
        if (!newNoteContent.trim() && !newNoteTitle.trim()) return;

        setIsSaving(true);
        try {
            const newNote = await createNote({
                title: newNoteTitle.trim() || "Untitled Note",
                content: newNoteContent.trim(),
                user_tags: extractedTags,
                source_url: `MindVault Web (${Date.now()})`
            });

            // Add new note to the top of the local state array
            setNotes([newNote, ...notes]);
        } catch (err) {
            console.error("Failed to create note:", err);
            alert("Failed to save note. Please try again.");
        } finally {
            // Reset form UI regardless of success or failure
            setIsCreatingNote(false);
            setNewNoteTitle('');
            setNewNoteContent('');
            setExtractedTags([]);
            setIsSaving(false);
        }
    };

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
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1>📚 Your Vault</h1>
                    <p>{notes.length} notes saved • {topics.length} topics discovered</p>
                </div>
                <button
                    onClick={() => setIsCreatingNote(!isCreatingNote)}
                    style={{
                        background: isCreatingNote ? 'rgba(239, 68, 68, 0.1)' : 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                        color: isCreatingNote ? '#ef4444' : '#fff',
                        border: isCreatingNote ? '1px solid rgba(239, 68, 68, 0.3)' : 'none',
                        padding: '10px 18px',
                        borderRadius: 10,
                        fontWeight: 600,
                        fontSize: 14,
                        boxShadow: isCreatingNote ? 'none' : '0 4px 12px rgba(139, 92, 246, 0.25)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                    }}
                    onMouseOver={(e) => {
                        if (!isCreatingNote) {
                            e.currentTarget.style.opacity = '0.9';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 6px 16px rgba(139, 92, 246, 0.35)';
                        }
                    }}
                    onMouseOut={(e) => {
                        if (!isCreatingNote) {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.25)';
                        }
                    }}
                >
                    {isCreatingNote ? "✕ Cancel" : "✨ Create New Note"}
                </button>
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
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flex: 1 }}>
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

            {/* Create Note Inline Form */}
            {isCreatingNote && (
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 16,
                    padding: 20,
                    marginBottom: 24,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                    animation: 'fadeInUp 0.3s ease'
                }}>
                    <input
                        type="text"
                        placeholder="Note Title (Optional)"
                        value={newNoteTitle}
                        onChange={e => setNewNoteTitle(e.target.value)}
                        style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: 18,
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            padding: '8px 0',
                            marginBottom: 16,
                            outline: 'none'
                        }}
                    />
                    <textarea
                        placeholder="Write your note here... Use #hashtags to automatically tag it!"
                        value={newNoteContent + (interimTranscript ? (newNoteContent.endsWith(' ') || newNoteContent.length === 0 ? '' : ' ') + interimTranscript : '')}
                        onChange={handleContentChange}
                        style={{
                            width: '100%',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 12,
                            minHeight: 120,
                            padding: 16,
                            fontSize: 14,
                            color: interimTranscript ? 'var(--text-muted)' : 'var(--text-primary)',
                            resize: 'vertical',
                            outline: 'none',
                            fontFamily: 'Inter, sans-serif'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {extractedTags.map(tag => (
                                <span key={tag} className="tag" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                    🏷️ {tag}
                                </span>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                            {isRecording ? (
                                <button
                                    onClick={stopRecording}
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        color: '#ef4444',
                                        border: '1px solid currentColor',
                                        padding: '10px 20px',
                                        borderRadius: 10,
                                        fontWeight: 600,
                                        fontSize: 14,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        animation: 'pulse 1.5s infinite'
                                    }}
                                >
                                    ⏹️ Stop Recording
                                </button>
                            ) : (
                                <button
                                    onClick={startRecording}
                                    disabled={isSaving}
                                    style={{
                                        background: 'transparent',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-color)',
                                        padding: '10px 20px',
                                        borderRadius: 10,
                                        fontWeight: 600,
                                        fontSize: 14,
                                        cursor: isSaving ? 'not-allowed' : 'pointer',
                                        opacity: isSaving ? 0.5 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    🎤 Record Voice
                                </button>
                            )}

                            <button
                                onClick={handleCreateNote}
                                disabled={isSaving || (!newNoteTitle.trim() && !newNoteContent.trim())}
                                style={{
                                    background: isSaving || (!newNoteTitle.trim() && !newNoteContent.trim())
                                        ? 'var(--bg-secondary)'
                                        : 'linear-gradient(135deg, #10B981, #059669)',
                                    color: isSaving || (!newNoteTitle.trim() && !newNoteContent.trim()) ? 'var(--text-muted)' : '#fff',
                                    border: isSaving || (!newNoteTitle.trim() && !newNoteContent.trim()) ? '1px solid var(--border-color)' : 'none',
                                    padding: '10px 24px',
                                    borderRadius: 10,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    boxShadow: isSaving || (!newNoteTitle.trim() && !newNoteContent.trim()) ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.25)',
                                    cursor: isSaving || (!newNoteTitle.trim() && !newNoteContent.trim()) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    transition: 'all 0.2s ease',
                                    transform: isSaving ? 'scale(0.98)' : 'scale(1)'
                                }}
                                onMouseOver={(e) => {
                                    if (!isSaving && (newNoteTitle.trim() || newNoteContent.trim())) {
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.35)';
                                    }
                                }}
                                onMouseOut={(e) => {
                                    if (!isSaving && (newNoteTitle.trim() || newNoteContent.trim())) {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.25)';
                                    }
                                }}
                            >
                                {isSaving ? "⏳ Saving..." : "💾 Save Note"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

                                {note.estimated_retention !== undefined && note.estimated_retention !== null && (
                                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Memory Retention</span>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: note.estimated_retention >= 0.70 ? '#10B981' : note.estimated_retention >= 0.40 ? '#F59E0B' : '#EF4444' }}>
                                                {Math.round(note.estimated_retention * 100)}%
                                            </span>
                                        </div>
                                        <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${Math.round(note.estimated_retention * 100)}%`,
                                                background: note.estimated_retention >= 0.70 ? '#10B981' : note.estimated_retention >= 0.40 ? '#F59E0B' : '#EF4444',
                                                transition: 'width 0.5s ease'
                                            }} />
                                        </div>
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
