import React from 'react';
import { useNavigate } from 'react-router-dom';

const RevisionComplete = ({ streak, total, counts }) => {
    const navigate = useNavigate();

    return (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 48, textAlign: 'center', maxWidth: 600, margin: '32px auto', boxShadow: 'var(--shadow-md)', animation: 'fadeInUp 0.4s ease' }}>
            <div style={{ fontSize: 64, marginBottom: 24, display: 'inline-block' }}>🎉</div>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, letterSpacing: '-0.5px' }}>All done!</h2>
            <p style={{ fontSize: 18, color: 'var(--text-secondary)', marginBottom: 32 }}>
                You reviewed {total} notes today. Excellent work!
            </p>

            {streak > 0 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--gradient-primary)', color: 'white', padding: '12px 24px', borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(124, 58, 237, 0.3)', marginBottom: 40, width: '100%', maxWidth: 300 }}>
                    <span style={{ fontSize: 32 }}>🔥</span>
                    <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Streak</div>
                        <div style={{ fontSize: 24, fontWeight: 800 }}>{streak} {streak === 1 ? 'Day' : 'Days'}</div>
                    </div>
                </div>
            )}

            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 16 }}>Today's Results</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
                <div style={{ background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: 16, borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 24, marginBottom: 4, color: 'var(--accent)', fontWeight: 800 }}>{counts.easy}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-light)' }}>Easy</div>
                </div>
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: 16, borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 24, marginBottom: 4, color: '#10b981', fontWeight: 800 }}>{counts.good}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#34d399' }}>Good</div>
                </div>
                <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: 16, borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 24, marginBottom: 4, color: '#f59e0b', fontWeight: 800 }}>{counts.hard}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24' }}>Hard</div>
                </div>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: 16, borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 24, marginBottom: 4, color: '#ef4444', fontWeight: 800 }}>{counts.forgot}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171' }}>Forgot</div>
                </div>
            </div>

            <p style={{ color: 'var(--text-muted)', fontWeight: 500, marginBottom: 32 }}>
                Come back tomorrow for your next {total} notes!
            </p>

            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <button
                    onClick={() => navigate('/vault')}
                    style={{ padding: '12px 24px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', flex: 1, maxWidth: 160 }}
                >
                    Go to Vault
                </button>
                <button
                    onClick={() => navigate('/chat')}
                    style={{ padding: '12px 24px', background: 'var(--accent)', border: 'none', color: 'white', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', flex: 1, maxWidth: 160 }}
                >
                    Start Chat
                </button>
            </div>
        </div>
    );
};

export default RevisionComplete;
