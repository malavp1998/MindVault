import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Eye, Frown, Meh, Smile, Sun } from 'lucide-react';

const RevisionCard = ({ note, total, currentIdx, onRate, onSkip, rateResult }) => {
    const [revealed, setRevealed] = useState(false);
    const [rated, setRated] = useState(false);
    const [ratingVal, setRatingVal] = useState(null);

    const getRetentionColor = (pct) => {
        if (pct >= 0.70) return '#10B981'; // green
        if (pct >= 0.40) return '#F59E0B'; // orange
        return '#EF4444'; // red
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
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 40,
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            minHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            width: '100%',
            fontFamily: 'var(--font)'
        }}>
            {/* Top Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Revision {currentIdx + 1} of {total}
                </span>

                {/* Retention Badge */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)',
                    border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 24
                }}>
                    <div style={{ background: retentionColor, width: 6, height: 6, borderRadius: '50%' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dark)' }}>
                        {retentionPct}% Retention
                    </span>
                </div>
            </div>

            <h3 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-dark)', margin: '0 0 32px 0' }}>
                {note.title}
            </h3>

            {!revealed && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '48px 0' }}>
                    <button
                        onClick={() => setRevealed(true)}
                        style={{
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            padding: '12px 28px',
                            borderRadius: 24,
                            fontWeight: 600,
                            fontSize: 15,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            cursor: 'pointer',
                            transition: 'opacity 0.2sease',
                        }}
                        onMouseOver={(e) => e.currentTarget.style.opacity = 0.9}
                        onMouseOut={(e) => e.currentTarget.style.opacity = 1}
                    >
                        <Eye size={18} strokeWidth={2} />
                        Reveal Summary
                    </button>
                    <p style={{ marginTop: 20, color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>
                        Think back to what this note was about.
                    </p>
                </div>
            )}

            {revealed && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ marginBottom: 40, background: 'var(--bg)', borderRadius: 16, padding: '32px 32px' }}>
                        <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, margin: 0 }}>
                            Summary Insight
                        </h4>
                        <div style={{ 
                            fontSize: 14, 
                            lineHeight: 1.6, 
                            color: 'var(--text-dark)',
                            marginTop: 16
                        }}>
                            <ReactMarkdown>{note.summary || "No summary available for this note."}</ReactMarkdown>
                        </div>
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                        {!rated ? (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <p style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-dark)', marginBottom: 24, fontSize: 16 }}>
                                    How was the recall?
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, maxWidth: 500, margin: '0 auto' }}>
                                    {[
                                        { id: 'forgot', icon: <Frown size={28} strokeWidth={1.5} />, label: 'Forgot', color: '#EF4444' },
                                        { id: 'hard', icon: <Meh size={28} strokeWidth={1.5} />, label: 'Hard', color: '#F59E0B' },
                                        { id: 'good', icon: <Smile size={28} strokeWidth={1.5} />, label: 'Good', color: '#10B981' },
                                        { id: 'easy', icon: <Sun size={28} strokeWidth={1.5} />, label: 'Easy', color: '#EC4899' }
                                    ].map(btn => (
                                        <button
                                            key={btn.id}
                                            onClick={() => handleRateClick(btn.id)}
                                            style={{
                                                padding: '20px 10px',
                                                borderRadius: 16,
                                                border: `1px solid ${btn.color}40`,
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: 12,
                                                color: btn.color
                                            }}
                                            onMouseOver={(e) => { e.currentTarget.style.background = `${btn.color}10`; }}
                                            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <div>{btn.icon}</div>
                                            <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{btn.label}</div>
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
                                    <button
                                        onClick={() => onSkip(note.id)}
                                        style={{
                                            background: 'none', border: 'none', fontSize: 13, fontWeight: 500, color: 'var(--text-muted)',
                                            cursor: 'pointer', textDecoration: 'underline'
                                        }}
                                        onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-dark)'; }}
                                        onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                                    >
                                        Skip this for now
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '40px 0', animation: 'fadeIn 0.3s ease' }}>
                                <div style={{ color: 'var(--text-dark)' }}>
                                    {ratingVal === 'forgot' && <Frown size={48} strokeWidth={1.5} color="#EF4444" />}
                                    {ratingVal === 'hard' && <Meh size={48} strokeWidth={1.5} color="#F59E0B" />}
                                    {ratingVal === 'good' && <Smile size={48} strokeWidth={1.5} color="#10B981" />}
                                    {ratingVal === 'easy' && <Sun size={48} strokeWidth={1.5} color="#EC4899" />}
                                </div>

                                {rateResult ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                                        <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-dark)', margin: 0 }}>
                                            {rateResult.message}
                                        </p>
                                        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
                                            Next review in {rateResult.new_interval} days
                                        </p>
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
