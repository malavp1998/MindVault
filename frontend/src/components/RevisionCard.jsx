import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const RevisionCard = ({ note, total, currentIdx, onRate, onSkip, rateResult }) => {
    const [revealed, setRevealed] = useState(false);
    const [rated, setRated] = useState(false);
    const [ratingVal, setRatingVal] = useState(null);

    const getRetentionColor = (pct) => {
        if (pct >= 0.70) return 'bg-green-500';
        if (pct >= 0.40) return 'bg-orange-500';
        return 'bg-red-500';
    };

    const retentionPct = Math.round(note.estimated_retention * 100);
    const retentionColor = getRetentionColor(note.estimated_retention);

    const handleRateClick = (val) => {
        setRated(true);
        setRatingVal(val);
        onRate(note.id, val);
    };

    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 32,
            boxShadow: 'var(--shadow-lg)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            minHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Top Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div style={{ flex: 1, paddingRight: 24 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8, display: 'block' }}>
                        Note {currentIdx + 1} of {total}
                    </span>
                    <h3 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, lineHeight: 1.3, letterSpacing: '-0.5px' }}>
                        {note.title}
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
                        {Array.from(new Set([...(note.user_tags || []), ...(note.auto_tags || [])])).slice(0, 5).map(t => (
                            <span key={t} className="tag" style={{ border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                                #{t}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Retention Badge */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-primary)',
                    border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 24, flexShrink: 0
                }} title={`Estimated memory retention: ${retentionPct}%`}>
                    <div className={retentionColor} style={{ width: 8, height: 8, borderRadius: '50%' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {retentionPct}%
                    </span>
                </div>
            </div>

            {!revealed && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginTop: 40, marginBottom: 20 }}>
                    <button
                        onClick={() => setRevealed(true)}
                        style={{
                            background: 'var(--gradient-primary)',
                            color: 'white',
                            border: 'none',
                            padding: '12px 28px',
                            borderRadius: 'var(--radius)',
                            fontWeight: 600,
                            fontSize: 15,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(124, 58, 237, 0.3)',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(124, 58, 237, 0.4)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(124, 58, 237, 0.3)'; }}
                    >
                        <span style={{ fontSize: 18 }}>👁️</span>
                        Reveal Summary
                    </button>
                    <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500 }}>Try to recall the contents before revealing.</p>
                </div>
            )}

            {revealed && (
                <div style={{ marginTop: 20, paddingTop: 24, borderTop: '1px solid var(--border)', flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeInUp 0.4s ease' }}>
                    <div style={{ marginBottom: 32 }}>
                        <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>AI Insight</h4>
                        <div className="rag-answer" style={{ marginBottom: 0, padding: 20 }}>
                            <div className="rag-answer-text">
                                <ReactMarkdown>{note.summary || "No summary available for this note."}</ReactMarkdown>
                            </div>
                        </div>
                    </div>

                    <div style={{ mt: 'auto' }}>
                        {!rated ? (
                            <div style={{ animation: 'fadeInUp 0.4s ease', background: 'var(--bg-card)' }}>
                                <p style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20, fontSize: 15 }}>
                                    How easily did you recall this?
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, maxWidth: 640, margin: '0 auto' }}>
                                    {[
                                        { id: 'forgot', icon: '😰', label: 'Forgot', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)' },
                                        { id: 'hard', icon: '😐', label: 'Hard', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)' },
                                        { id: 'good', icon: '🙂', label: 'Good', color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)' },
                                        { id: 'easy', icon: '😎', label: 'Easy', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)' }
                                    ].map(btn => (
                                        <button
                                            key={btn.id}
                                            onClick={() => handleRateClick(btn.id)}
                                            style={{
                                                padding: '20px 10px',
                                                borderRadius: 'var(--radius)',
                                                border: `1px solid ${btn.color}40`,
                                                background: 'var(--bg-secondary)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: 8
                                            }}
                                            onMouseOver={(e) => { e.currentTarget.style.background = btn.bg; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = btn.color; }}
                                            onMouseOut={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = `${btn.color}40`; }}
                                        >
                                            <div style={{ fontSize: 32 }}>{btn.icon}</div>
                                            <div style={{ fontWeight: 700, color: btn.color, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{btn.label}</div>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                                    <button
                                        onClick={() => onSkip(note.id)}
                                        style={{
                                            background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)',
                                            cursor: 'pointer', padding: '8px 16px', borderRadius: 8, transition: 'all 0.2s'
                                        }}
                                        onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-primary)'; }}
                                        onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
                                    >
                                        Skip for now
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '30px 0', animation: 'fadeInUp 0.3s ease' }}>
                                <div style={{ fontSize: 48, marginBottom: 16 }}>
                                    {ratingVal === 'forgot' && '😰'}
                                    {ratingVal === 'hard' && '😐'}
                                    {ratingVal === 'good' && '🙂'}
                                    {ratingVal === 'easy' && '😎'}
                                </div>

                                {rateResult ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
                                            {rateResult.message}
                                        </p>
                                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
                                            Next review in {rateResult.new_interval} days
                                        </p>
                                        {rateResult.is_mastered && (
                                            <div style={{ marginTop: 8 }}>
                                                <span style={{ display: 'inline-block', padding: '4px 12px', background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', borderRadius: 20, fontWeight: 700, fontSize: 13 }}>
                                                    🏆 Mastered!
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                                        <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RevisionCard;
