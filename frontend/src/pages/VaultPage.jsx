import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import { listNotes, listTopics, deleteNote, createNote, createAudioNote } from '../api';
import ReactMarkdown from 'react-markdown';
import RichTextEditor from '../components/RichTextEditor';

export default function VaultPage() {
    const [notes, setNotes] = useState([]);
    const [topics, setTopics] = useState([]);
    const [selectedTopics, setSelectedTopics] = useState([]);
    const [selectedLanguages, setSelectedLanguages] = useState([]);
    const [keywordSearch, setKeywordSearch] = useState('');
    const [sortBy, setSortBy] = useState('newest');
    const [viewDensity, setViewDensity] = useState('comfortable');
    const [groupBy, setGroupBy] = useState(null);
    const [cardPrefs, setCardPrefs] = useState({
        showSummary: true,
        showAutoTags: true,
        showLanguage: true,
        showWordCount: false,
        showBacklinkCount: false,
        highlightKeyword: true
    });
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);
    const filtersRef = useRef(null);
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
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filtersRef.current && !filtersRef.current.contains(event.target)) {
                // If clicking outside the filter panel, close it
                setIsFiltersOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [notesData, topicsData] = await Promise.all([
                listNotes(), // fetch all notes for client-side filtering
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
        // Strip out empty tags that might be added by Tiptap (e.g., <p></p>)
        const isEmpty = !newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === '');
        if (isEmpty) return;

        setIsSaving(true);
        try {
            const newNote = await createNote({
                title: newNoteTitle.trim() || "Untitled Note",
                content: newNoteContent,
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

    // ─── DERIVED STATE & FILTERING ───

    let filteredNotes = notes.filter(note => {
        // Topics (OR within, AND between)
        const matchTopic = selectedTopics.length === 0 || selectedTopics.includes(note.topic_id);
        
        // Languages
        const matchLanguage = selectedLanguages.length === 0 || selectedLanguages.includes(note.language) || (selectedLanguages.includes('en') && (!note.language || note.language === 'en'));
        
        // Keyword Search (case insensitive over title and content)
        const lowerKeyword = keywordSearch.toLowerCase();
        const matchKeyword = !keywordSearch || 
            (note.title && note.title.toLowerCase().includes(lowerKeyword)) || 
            (note.content && note.content.toLowerCase().includes(lowerKeyword));

        return matchTopic && matchLanguage && matchKeyword;
    });

    // ─── SORTING ───
    filteredNotes.sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at);
        if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
        if (sortBy === 'updated') return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
        if (sortBy === 'viewed') return (b.view_count || 0) - (a.view_count || 0);
        if (sortBy === 'connected') return (b.backlink_count || 0) - (a.backlink_count || 0);
        if (sortBy === 'longest') return (b.content?.length || 0) - (a.content?.length || 0);
        if (sortBy === 'tagged') {
            const tagsA = (a.auto_tags?.length || 0) + (a.user_tags?.length || 0);
            const tagsB = (b.auto_tags?.length || 0) + (b.user_tags?.length || 0);
            return tagsB - tagsA;
        }
        return 0;
    });

    // ─── GROUPING ───
    let groupedNotes = { "All Notes": filteredNotes };
    if (groupBy === 'topic') {
        groupedNotes = {};
        for (const note of filteredNotes) {
            const topicName = note.topic_name || topics.find(t => t.id === note.topic_id)?.name || 'Uncategorized';
            if (!groupedNotes[topicName]) groupedNotes[topicName] = [];
            groupedNotes[topicName].push(note);
        }
    } else if (groupBy === 'language') {
        groupedNotes = {};
        for (const note of filteredNotes) {
            const langCode = note.language || 'en';
            // eslint-disable-next-line
            const langLabel = ALL_LANGUAGES.find(l => l.code === langCode)?.label || langCode;
            if (!groupedNotes[langLabel]) groupedNotes[langLabel] = [];
            groupedNotes[langLabel].push(note);
        }
    } else if (groupBy === 'week') {
        groupedNotes = {};
        for (const note of filteredNotes) {
            const d = new Date(note.created_at);
            d.setHours(0,0,0,0);
            const day = d.getDay(); 
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const weekStart = new Date(d.setDate(diff));
            const weekKey = `Week of ${weekStart.toLocaleDateString()}`;
            if (!groupedNotes[weekKey]) groupedNotes[weekKey] = [];
            groupedNotes[weekKey].push(note);
        }
    } else if (groupBy === 'confidence') {
        groupedNotes = { "High Confidence (>70%)": [], "Medium Confidence (40-70%)": [], "Low/Unknown Confidence": [] };
        for (const note of filteredNotes) {
            const conf = note.estimated_retention || 0;
            if (conf >= 0.7) groupedNotes["High Confidence (>70%)"].push(note);
            else if (conf >= 0.4) groupedNotes["Medium Confidence (40-70%)"].push(note);
            else groupedNotes["Low/Unknown Confidence"].push(note);
        }
        Object.keys(groupedNotes).forEach(k => { if(groupedNotes[k].length === 0) delete groupedNotes[k]; });
    }

    const activeFilterCount = selectedTopics.length + selectedLanguages.length + (sortBy !== 'newest' ? 1 : 0) + (groupBy ? 1 : 0) + (viewDensity !== 'comfortable' ? 1 : 0);

    const ALL_LANGUAGES = [
        { code: 'en', label: 'English (en) 🇬🇧' },
        { code: 'hi', label: 'Hindi (hi) 🇮🇳' },
        { code: 'ta', label: 'Tamil (ta) 🇮🇳' },
        { code: 'te', label: 'Telugu (te) 🇮🇳' },
        { code: 'kn', label: 'Kannada (kn) 🇮🇳' },
        { code: 'bn', label: 'Bengali (bn) 🇮🇳' },
        { code: 'ml', label: 'Malayalam (ml) 🇮🇳' },
        { code: 'gu', label: 'Gujarati (gu) 🇮🇳' },
        { code: 'mr', label: 'Marathi (mr) 🇮🇳' },
        { code: 'pa', label: 'Punjabi (pa) 🇮🇳' },
        { code: 'or', label: 'Odia (or) 🇮🇳' },
    ];

    const removeFilter = (type, value) => {
        if (type === 'topic') setSelectedTopics(prev => prev.filter(t => t !== value));
        if (type === 'language') setSelectedLanguages(prev => prev.filter(l => l !== value));
    };

    const clearAllFilters = () => {
        setSelectedTopics([]);
        setSelectedLanguages([]);
        setSortBy('newest');
        setGroupBy(null);
        setViewDensity('comfortable');
    };

    const highlightText = (text, highlight) => {
        if (!highlight || !cardPrefs.highlightKeyword) return text;
        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return parts.map((part, i) => 
            part.toLowerCase() === highlight.toLowerCase() ? 
            <mark key={i} style={{ backgroundColor: 'rgba(251, 191, 36, 0.4)', color: 'inherit', borderRadius: 2, padding: '0 2px' }}>{part}</mark> : part
        );
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

            {/* Redesigned Filter & Search Bar */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center', position: 'relative' }}>
                
                {/* Left: Filters Button */}
                <div ref={filtersRef} style={{ position: 'relative' }}>
                    <button
                        onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                        style={{
                            padding: '0 16px',
                            height: 36,
                            borderRadius: 18,
                            border: `1px solid ${isFiltersOpen || activeFilterCount > 0 ? 'var(--accent)' : 'var(--border-color)'}`,
                            background: isFiltersOpen || activeFilterCount > 0 ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-secondary)',
                            color: isFiltersOpen || activeFilterCount > 0 ? 'var(--accent)' : 'var(--text-primary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 14,
                            fontWeight: 500,
                            transition: 'all 0.2s ease',
                            flexShrink: 0
                        }}
                    >
                        ⚙ Filters {activeFilterCount > 0 && <span style={{ background: 'var(--accent)', color: '#fff', padding: '2px 6px', borderRadius: 10, fontSize: 12, lineHeight: 1 }}>{activeFilterCount}</span>}
                        <span style={{ fontSize: 10, transform: isFiltersOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                    </button>

                    {/* Filter Dropdown Panel */}
                    {isFiltersOpen && (
                        <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 8px)',
                            left: 0,
                            width: 320,
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 12,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                            zIndex: 100,
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 20,
                            maxHeight: '60vh',
                            overflowY: 'auto'
                        }}>
                            {/* Topics Section */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Topics</h4>
                                    <button 
                                        type="button"
                                        onClick={() => setSelectedTopics(selectedTopics.length === topics.length ? [] : topics.map(t => t.id))}
                                        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                                    >
                                        {selectedTopics.length === topics.length ? 'Clear' : 'Select All'}
                                    </button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {topics.map(topic => (
                                        <label key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedTopics.includes(topic.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedTopics(prev => [...prev, topic.id]);
                                                    else setSelectedTopics(prev => prev.filter(t => t !== topic.id));
                                                }}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {topic.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({topic.note_count})</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Languages Section */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Language</h4>
                                    <button 
                                        type="button"
                                        onClick={() => setSelectedLanguages(selectedLanguages.length === ALL_LANGUAGES.length ? [] : ALL_LANGUAGES.map(l => l.code))}
                                        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                                    >
                                        {selectedLanguages.length === ALL_LANGUAGES.length ? 'Clear' : 'Select All'}
                                    </button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                                    {ALL_LANGUAGES.map(lang => (
                                        <label key={lang.code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedLanguages.includes(lang.code)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedLanguages(prev => [...prev, lang.code]);
                                                    else setSelectedLanguages(prev => prev.filter(l => l !== lang.code));
                                                }}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {lang.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Sort By Section */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                                <h4 style={{ margin: 0, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sort By</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {[
                                        { id: 'newest', label: 'Newest First' },
                                        { id: 'oldest', label: 'Oldest First' },
                                        { id: 'updated', label: 'Most Recently Updated' },
                                        { id: 'viewed', label: 'Most Viewed' },
                                        { id: 'connected', label: 'Most Connected' },
                                        { id: 'longest', label: 'Longest Note' },
                                        { id: 'tagged', label: 'Most Tagged' }
                                    ].map(opt => (
                                        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="radio" 
                                                name="sortBy"
                                                checked={sortBy === opt.id}
                                                onChange={() => setSortBy(opt.id)}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* View Density Section */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                                <h4 style={{ margin: 0, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>View Density</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {[
                                        { id: 'comfortable', label: 'Comfortable' },
                                        { id: 'compact', label: 'Compact' },
                                        { id: 'list', label: 'List View' }
                                    ].map(opt => (
                                        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="radio" 
                                                name="viewDensity"
                                                checked={viewDensity === opt.id}
                                                onChange={() => setViewDensity(opt.id)}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Group By Section */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                                <h4 style={{ margin: 0, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Group By</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {[
                                        { id: null, label: 'No Grouping' },
                                        { id: 'topic', label: 'By Topic Cluster' },
                                        { id: 'language', label: 'By Language' },
                                        { id: 'week', label: 'By Week Saved' },
                                        { id: 'confidence', label: 'By AI Confidence Score' }
                                    ].map(opt => (
                                        <label key={String(opt.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="radio" 
                                                name="groupBy"
                                                checked={groupBy === opt.id}
                                                onChange={() => setGroupBy(opt.id)}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Show/Hide Toggles */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                                <h4 style={{ margin: 0, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Show / Hide</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {[
                                        { key: 'showSummary', label: 'Show AI Summary on cards' },
                                        { key: 'showAutoTags', label: 'Show Auto Tags on cards' },
                                        { key: 'showLanguage', label: 'Show Language Badge' },
                                        { key: 'showWordCount', label: 'Show Word Count' },
                                        { key: 'showBacklinkCount', label: 'Show Backlink Count' },
                                        { key: 'highlightKeyword', label: 'Highlight keyword matches in cards' }
                                    ].map(opt => (
                                        <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={cardPrefs[opt.key]}
                                                onChange={(e) => setCardPrefs(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                                                style={{ accentColor: 'var(--accent)' }}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => setIsFiltersOpen(false)}
                                style={{
                                    marginTop: 8,
                                    padding: '10px 0',
                                    background: 'var(--gradient-primary, linear-gradient(135deg, #6366F1, #8B5CF6))',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 8,
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                Apply Filters
                            </button>
                        </div>
                    )}
                </div>

                {/* Middle: Active Filter Chips */}
                <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                    {selectedTopics.slice(0, 5).map(topicId => {
                        const t = topics.find(tp => tp.id === topicId);
                        return t ? (
                            <span key={`t-${topicId}`} className="active-filter-chip">
                                🗺 {t.name} <button onClick={() => removeFilter('topic', topicId)}>✕</button>
                            </span>
                        ) : null;
                    })}
                    {selectedLanguages.slice(0, 5).map(code => {
                        const l = ALL_LANGUAGES.find(lang => lang.code === code);
                        return l ? (
                            <span key={`l-${code}`} className="active-filter-chip">
                                🌐 {l.label.split(' ')[0]} <button onClick={() => removeFilter('language', code)}>✕</button>
                            </span>
                        ) : null;
                    })}
                    {sortBy !== 'newest' && (
                        <span className="active-filter-chip">
                            ⇅ {sortBy === 'oldest' ? 'Oldest First' : sortBy === 'updated' ? 'Recently Updated' : sortBy === 'viewed' ? 'Most Viewed' : sortBy === 'connected' ? 'Most Connected' : sortBy === 'longest' ? 'Longest Note' : 'Most Tagged'}
                            <button onClick={() => setSortBy('newest')}>✕</button>
                        </span>
                    )}
                    {groupBy && (
                        <span className="active-filter-chip">
                            🗂 {groupBy === 'topic' ? 'By Topic' : groupBy === 'language' ? 'By Language' : groupBy === 'week' ? 'By Week' : 'By AI Confidence'}
                            <button onClick={() => setGroupBy(null)}>✕</button>
                        </span>
                    )}
                    {viewDensity !== 'comfortable' && (
                        <span className="active-filter-chip">
                            👁 {viewDensity === 'compact' ? 'Compact View' : 'List View'}
                            <button onClick={() => setViewDensity('comfortable')}>✕</button>
                        </span>
                    )}
                    
                    {activeFilterCount > 5 && (
                        <span className="active-filter-chip" onClick={() => setIsFiltersOpen(true)} style={{ cursor: 'pointer' }}>
                            +{activeFilterCount - 5} more
                        </span>
                    )}

                    {activeFilterCount > 0 && (
                        <button 
                            type="button" 
                            onClick={clearAllFilters}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 8 }}
                        >
                            Clear All
                        </button>
                    )}
                </div>

                {/* Right: Keyword Search Bar */}
                <div style={{ position: 'relative', width: 240, flexShrink: 0 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)' }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Search memories..."
                        value={keywordSearch}
                        onChange={(e) => setKeywordSearch(e.target.value)}
                        style={{
                            width: '100%',
                            height: 36,
                            padding: '0 32px 0 36px',
                            borderRadius: 18,
                            border: `1px solid ${keywordSearch ? 'var(--accent)' : 'var(--border-color)'}`,
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            fontSize: 14,
                            outline: 'none',
                            transition: 'all 0.2s ease',
                        }}
                    />
                    {keywordSearch && (
                        <button
                            onClick={() => setKeywordSearch('')}
                            style={{
                                position: 'absolute',
                                right: 8,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                fontSize: 12,
                                padding: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            ✕
                        </button>
                    )}
                </div>
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
                    <div style={{ marginBottom: 16 }}>
                        <RichTextEditor
                            content={newNoteContent + (interimTranscript ? (newNoteContent.endsWith(' ') || newNoteContent.length === 0 ? '' : ' ') + interimTranscript : '')}
                            onChange={(html) => {
                                setNewNoteContent(html);
                                // Optional hashtag styling parsing if desired
                                const textContent = html.replace(/<[^>]*>?/gm, ''); // primitive text strip for hashtags
                                const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
                                const tags = [];
                                let match;
                                while ((match = hashtagRegex.exec(textContent)) !== null) {
                                    if (!tags.includes(match[1].toLowerCase())) {
                                        tags.push(match[1].toLowerCase());
                                    }
                                }
                                setExtractedTags(tags);
                            }}
                            placeholder="Write your note here... Use #hashtags to automatically tag it!"
                        />
                    </div>

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
                                disabled={isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === ''))}
                                style={{
                                    background: isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === ''))
                                        ? 'var(--bg-secondary)'
                                        : 'linear-gradient(135deg, #10B981, #059669)',
                                    color: isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === '')) ? 'var(--text-muted)' : '#fff',
                                    border: isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === '')) ? '1px solid var(--border-color)' : 'none',
                                    padding: '10px 24px',
                                    borderRadius: 10,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    boxShadow: isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === '')) ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.25)',
                                    cursor: isSaving || (!newNoteTitle.trim() && (!newNoteContent || newNoteContent === '<p></p>' || newNoteContent.trim() === '')) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    transition: 'all 0.2s ease',
                                    transform: isSaving ? 'scale(0.98)' : 'scale(1)'
                                }}
                                onMouseOver={(e) => {
                                    if (!isSaving && (newNoteTitle.trim() || (newNoteContent && newNoteContent !== '<p></p>'))) {
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.35)';
                                    }
                                }}
                                onMouseOut={(e) => {
                                    if (!isSaving && (newNoteTitle.trim() || (newNoteContent && newNoteContent !== '<p></p>'))) {
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
                filteredNotes.length === 0 ? (
                    <div className="empty-state">
                        <div className="icon">🧠</div>
                        <h3 style={{ marginBottom: 8 }}>{notes.length === 0 ? 'Your vault is empty' : 'No notes match your filters'}</h3>
                        <p>{notes.length === 0 ? 'Save pages from the Chrome extension or add notes via the API to get started.' : 'Try adjusting your search or clearing some filters.'}</p>
                        {notes.length > 0 && (
                            <button 
                                onClick={() => { clearAllFilters(); setKeywordSearch(''); }}
                                style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
                            >
                                Clear All Filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                        {Object.entries(groupedNotes).map(([groupName, groupNotes]) => (
                            <div key={groupName}>
                                {groupBy && (
                                    <h3 style={{ 
                                        margin: '0 0 16px 0', 
                                        paddingBottom: 8, 
                                        borderBottom: '1px solid var(--border-color)',
                                        color: 'var(--text-primary)',
                                        fontSize: 16,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        {groupName} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{groupNotes.length} notes</span>
                                    </h3>
                                )}
                                <Masonry
                                    breakpointCols={viewDensity === 'list' ? 1 : breakpoints}
                                    className="masonry-grid"
                                    columnClassName="masonry-grid-column"
                                >
                                    {groupNotes.map(note => (
                                        <div
                                            key={note.id}
                                            className="card"
                                            onClick={() => navigate(`/note/${note.id}`)}
                                            style={{ 
                                                animationDelay: `${Math.random() * 0.2}s`, 
                                                animation: 'fadeInUp 0.4s ease both',
                                                padding: viewDensity === 'compact' ? '12px 16px' : '20px',
                                                gap: viewDensity === 'compact' ? 8 : 12,
                                                display: viewDensity === 'list' ? 'flex' : 'flex',
                                                flexDirection: viewDensity === 'list' ? 'row' : 'column',
                                                alignItems: viewDensity === 'list' ? 'center' : 'stretch',
                                                justifyContent: viewDensity === 'list' ? 'space-between' : 'flex-start'
                                            }}
                                        >
                                            <div style={{ flex: viewDensity === 'list' ? 1 : 'unset' }}>
                                                <div className="card-title" style={{ fontSize: viewDensity === 'compact' ? 16 : 18, marginBottom: viewDensity === 'list' ? 4 : 8, paddingRight: 32 }}>
                                                    {highlightText(note.title, keywordSearch)}
                                                </div>
                                                
                                                {cardPrefs.showSummary && note.summary && viewDensity !== 'list' && (
                                                    <div className="card-summary" style={{ fontSize: viewDensity === 'compact' ? 13 : 14, marginBottom: viewDensity === 'compact' ? 8 : 12 }}>
                                                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                                                    </div>
                                                )}

                                                <div className="card-meta" style={{ marginTop: viewDensity === 'list' ? 0 : 'auto', fontSize: viewDensity === 'compact' ? 11 : 12 }}>
                                                    <span>{new Date(note.created_at).toLocaleDateString()}</span>
                                                    {cardPrefs.showWordCount && note.content && <span> • {note.content.split(/\s+/).length} words</span>}
                                                    {cardPrefs.showBacklinkCount && <span> • {note.backlink_count || 0} links</span>}
                                                    <div style={{ display: viewDensity === 'list' ? 'inline-flex' : 'flex', marginLeft: viewDensity === 'list' ? 12 : 0 }}>
                                                        {!note.is_processed && <span className="processing-badge">Processing</span>}
                                                        {note.topic_name && <span className="tag">{note.topic_name}</span>}
                                                        {cardPrefs.showLanguage && note.language && note.language !== 'en' && <span className="tag">🇮🇳 {note.language.toUpperCase()}</span>}
                                                        {cardPrefs.showLanguage && note.language === 'en' && <span className="tag">🇬🇧 EN</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            {viewDensity !== 'list' && (
                                                <>
                                                    {cardPrefs.showAutoTags && Array.isArray(note.auto_tags) && note.auto_tags.length > 0 && (
                                                        <div style={{ marginTop: viewDensity === 'compact' ? 6 : 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                            {note.auto_tags.slice(0, 3).map(tag => (
                                                                <span key={`auto-${tag}`} className="tag" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                                                                    ✨ {highlightText(tag, keywordSearch)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {Array.isArray(note.user_tags) && note.user_tags.length > 0 && (
                                                        <div style={{ marginTop: viewDensity === 'compact' ? 4 : 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                            {note.user_tags.map(tag => (
                                                                <span key={`user-${tag}`} className="tag" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                                                    🏷️ {highlightText(tag, keywordSearch)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {Array.isArray(note.tags) && note.tags.length > 0 && (!note.auto_tags || note.auto_tags.length === 0) && (!note.user_tags || note.user_tags.length === 0) && (
                                                        <div style={{ marginTop: viewDensity === 'compact' ? 4 : 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                            {note.tags.slice(0, 3).map(tag => (
                                                                <span key={tag} className="tag">{highlightText(tag, keywordSearch)}</span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {note.estimated_retention !== undefined && note.estimated_retention !== null && viewDensity !== 'compact' && (
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
                                                </>
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
                            </div>
                        ))}
                    </div>
                )
            }
        </div >
    );
}
