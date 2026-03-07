import React from 'react';

const RevisionProgress = ({ streak, current, total, ratings }) => {
    const progressPercent = Math.min(((current) / total) * 100, 100);

    return (
        <div style={{ marginBottom: 40, width: '100%', marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, padding: '0 4px' }}>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 12, letterSpacing: '-0.5px' }}>
                    <span style={{ fontSize: 28 }}>📚</span> Daily Revision
                    {streak > 0 && (
                        <span style={{ fontSize: 13, fontWeight: 700, background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', padding: '4px 12px', borderRadius: 20, marginLeft: 8 }}>
                            🔥 {streak} Day Streak
                        </span>
                    )}
                </h2>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {Math.min(current, total)} / {total} done
                </span>
            </div>

            <div style={{ height: 16, width: '100%', background: 'var(--bg-card)', borderRadius: 20, overflow: 'hidden', display: 'flex', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)', border: '1px solid var(--border)' }}>
                <div
                    style={{ height: '100%', background: 'var(--gradient-primary)', transition: 'all 0.7s ease-out', width: `${progressPercent}%` }}
                />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, height: 12, padding: '0 4px' }}>
                {ratings.map((rating, idx) => {
                    let bg = 'rgba(229, 231, 235, 1)';
                    if (rating === 'forgot') bg = '#ef4444';
                    if (rating === 'hard') bg = '#f59e0b';
                    if (rating === 'good') bg = '#10b981';
                    if (rating === 'easy') bg = '#8b5cf6';

                    return (
                        <div
                            key={idx}
                            style={{ width: 12, height: 12, borderRadius: '50%', background: bg, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}
                            title={rating}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default RevisionProgress;
