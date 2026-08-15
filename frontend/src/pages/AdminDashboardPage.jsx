import { useState, useEffect } from 'react';
import { getAdminStats, listAdminUsers, triggerAdminRun } from '../api';
import { ShieldCheck, TrendingUp, TrendingDown, Minus, AlertCircle, ThumbsUp, ThumbsDown, Play, Loader2 } from 'lucide-react';

function Section({ title, subtitle, children }) {
    return (
        <div style={{ marginBottom: 40 }}>
            <h3 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                {title}
            </h3>
            {subtitle && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>{subtitle}</p>
            )}
            {children}
        </div>
    );
}

function Card({ children, style }) {
    return (
        <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 20, ...style,
        }}>
            {children}
        </div>
    );
}

function DeltaBadge({ value, positiveIsGood = true, format = (v) => `${(v * 100).toFixed(1)}pp` }) {
    if (value === null || value === undefined) return null;
    const isFlat = Math.abs(value) < 0.0001;
    const isGood = isFlat ? null : (positiveIsGood ? value > 0 : value < 0);
    const color = isFlat ? 'var(--text-muted)' : isGood ? '#22c55e' : '#ef4444';
    const Icon = isFlat ? Minus : value > 0 ? TrendingUp : TrendingDown;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontSize: 13, fontWeight: 600 }}>
            <Icon size={14} />
            {isFlat ? 'no change' : format(Math.abs(value))}
        </span>
    );
}

function StatBlock({ label, value, delta, positiveIsGood = true, deltaFormat }) {
    return (
        <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{value}</div>
            <DeltaBadge value={delta} positiveIsGood={positiveIsGood} format={deltaFormat} />
        </div>
    );
}

function GatePill({ passed }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: passed ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: passed ? '#16a34a' : '#dc2626',
        }}>
            {passed ? '✅ Gate Passed' : '❌ Gate Failed'}
        </span>
    );
}

// ── Simple inline SVG line chart — no chart library dependency ──
function TrendLine({ points, height = 120, color = 'var(--accent)', formatY = (v) => v.toFixed(2), suffix = '' }) {
    if (!points || points.length === 0) {
        return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No data yet</div>;
    }
    const width = 600;
    const padding = 28;
    const values = points.map(p => p.value).filter(v => v !== null && v !== undefined);
    if (values.length === 0) {
        return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No data yet</div>;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
    const coords = points.map((p, i) => {
        const x = padding + i * stepX;
        const y = p.value === null || p.value === undefined
            ? null
            : padding + (1 - (p.value - min) / range) * (height - padding * 2);
        return { x, y, ...p };
    });

    const validCoords = coords.filter(c => c.y !== null);
    const pathD = validCoords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border)" strokeWidth="1" />
            {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2" />}
            {validCoords.map((c, i) => (
                <g key={i}>
                    <circle cx={c.x} cy={c.y} r="3" fill={color} />
                    <title>{`${c.label}: ${formatY(c.value)}${suffix}`}</title>
                </g>
            ))}
        </svg>
    );
}

function RunEvalPanel({ onRunComplete }) {
    const [users, setUsers] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        listAdminUsers()
            .then(list => {
                setUsers(list);
                if (list.length > 0) setSelectedUserId(list[0].id);
            })
            .catch(() => setError('Failed to load user list.'));
    }, []);

    const handleRun = async () => {
        if (!selectedUserId) return;
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const res = await triggerAdminRun(selectedUserId);
            setResult(res);
            onRunComplete?.();
        } catch (err) {
            setError(err.response?.data?.detail || 'Eval run failed.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <select
                    value={selectedUserId}
                    onChange={(e) => { setSelectedUserId(e.target.value); setResult(null); setError(null); }}
                    disabled={running || users.length === 0}
                    style={{
                        padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                        background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13, minWidth: 240,
                    }}
                >
                    {users.length === 0 && <option value="">No users found</option>}
                    {users.map(u => (
                        <option key={u.id} value={u.id}>
                            {u.email || u.username || u.id} — {u.note_count} notes
                        </option>
                    ))}
                </select>
                <button
                    onClick={handleRun}
                    disabled={running || !selectedUserId}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
                        cursor: running || !selectedUserId ? 'not-allowed' : 'pointer',
                        opacity: running || !selectedUserId ? 0.6 : 1,
                    }}
                >
                    {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    {running ? 'Running…' : 'Run Eval'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Promotes thumbs-up votes into golden queries, then runs Precision@3 against the selected user's notes.
                </span>
            </div>

            {error && (
                <div style={{
                    marginTop: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626',
                }}>
                    {error}
                </div>
            )}

            {result && (
                <div style={{
                    marginTop: 14, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                    borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)',
                }}>
                    Run complete — Precision@3 {result.precision_at_3}, avg similarity {result.avg_similarity}, {result.promoted_from_votes} new golden queries promoted from thumbs-up votes.
                    {' '}{result.gate_passed ? '✅ Gate passed.' : `❌ Gate failed: ${result.gate_reason}`}
                </div>
            )}
        </Card>
    );
}

export default function AdminDashboardPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadStats = () => {
        setLoading(true);
        getAdminStats()
            .then(setStats)
            .catch(err => {
                const msg = err.response?.status === 403
                    ? "You don't have admin access to this dashboard."
                    : 'Failed to load dashboard data.';
                setError(msg);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadStats();
    }, []);

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard…</div>;
    }

    if (error) {
        return (
            <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
                <AlertCircle size={32} style={{ color: '#ef4444', marginBottom: 12 }} />
                <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
            </div>
        );
    }

    const { run_comparison, run_history, daily_logs, low_confidence_queries, votes, most_downvoted, total_golden_queries } = stats;

    const precisionPoints = run_history.map(r => ({ label: new Date(r.created_at).toLocaleDateString(), value: r.precision_at_3 }));
    const similarityPoints = run_history.map(r => ({ label: new Date(r.created_at).toLocaleDateString(), value: r.avg_similarity }));
    const dailyVolumePoints = daily_logs.map(d => ({ label: d.day, value: d.avg_similarity }));

    const totalVotes = votes.thumbs_up + votes.thumbs_down;
    const satisfactionRate = totalVotes > 0 ? (votes.thumbs_up / totalVotes) * 100 : null;

    return (
        <div style={{ paddingBottom: 60, maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <ShieldCheck size={22} style={{ color: 'var(--accent)' }} />
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>RAG Evaluation Dashboard</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0, marginBottom: 24 }}>
                Company-wide retrieval quality — {total_golden_queries} golden queries across all users
            </p>

            <Section title="Run Eval" subtitle="Trigger a new eval run for any user">
                <RunEvalPanel onRunComplete={loadStats} />
            </Section>

            {/* Latest vs Previous Run */}
            <Section title="Latest Eval Run" subtitle="Regression gate compares this run against the last passing run">
                {!run_comparison ? (
                    <Card>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
                            {run_history.length === 0
                                ? 'No eval runs yet. Trigger one from /api/eval/run (or run_eval.py) to populate this dashboard.'
                                : 'Only one run so far — need at least two runs to show a comparison.'}
                        </p>
                    </Card>
                ) : (
                    <Card>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    Run at {new Date(run_comparison.latest.created_at).toLocaleString()}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                    vs previous run at {new Date(run_comparison.previous.created_at).toLocaleString()}
                                </div>
                            </div>
                            <GatePill passed={run_comparison.latest.gate_passed} />
                        </div>

                        {run_comparison.latest.gate_reason && (
                            <div style={{
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#dc2626',
                            }}>
                                {run_comparison.latest.gate_reason}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                            <StatBlock
                                label="Precision@3"
                                value={`${(run_comparison.latest.precision_at_3 * 100).toFixed(0)}%`}
                                delta={run_comparison.precision_at_3_delta}
                                positiveIsGood={true}
                            />
                            <StatBlock
                                label="Avg Similarity"
                                value={run_comparison.latest.avg_similarity.toFixed(3)}
                                delta={run_comparison.avg_similarity_delta}
                                positiveIsGood={true}
                                deltaFormat={(v) => v.toFixed(3)}
                            />
                            <StatBlock
                                label="Zero-Result Rate"
                                value={`${(run_comparison.latest.zero_result_rate * 100).toFixed(0)}%`}
                                delta={run_comparison.zero_result_rate_delta}
                                positiveIsGood={false}
                            />
                        </div>
                    </Card>
                )}
            </Section>

            {/* Trend across runs */}
            {run_history.length > 1 && (
                <Section title="Precision@3 Trend" subtitle={`Across the last ${run_history.length} eval runs`}>
                    <Card>
                        <TrendLine points={precisionPoints} formatY={(v) => `${(v * 100).toFixed(0)}%`} />
                    </Card>
                </Section>
            )}

            {run_history.length > 1 && (
                <Section title="Avg Similarity Trend" subtitle={`Across the last ${run_history.length} eval runs`}>
                    <Card>
                        <TrendLine points={similarityPoints} color="#3b82f6" />
                    </Card>
                </Section>
            )}

            {/* Live retrieval log trend */}
            <Section title="Live Search Quality (30 days)" subtitle="Daily average similarity across all real user searches — not curated, just production traffic">
                <Card>
                    <TrendLine points={dailyVolumePoints} color="#f59e0b" />
                </Card>
            </Section>

            {/* Votes */}
            <Section title="User Feedback" subtitle="Thumbs up / down submitted directly on search results">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                    <Card>
                        <div style={{ display: 'flex', gap: 24, marginBottom: satisfactionRate !== null ? 16 : 0 }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e', fontWeight: 700, fontSize: 22 }}>
                                    <ThumbsUp size={18} /> {votes.thumbs_up}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Upvotes</div>
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontWeight: 700, fontSize: 22 }}>
                                    <ThumbsDown size={18} /> {votes.thumbs_down}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Downvotes</div>
                            </div>
                        </div>
                        {satisfactionRate !== null && (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                {satisfactionRate.toFixed(0)}% satisfaction ({totalVotes} total votes)
                            </div>
                        )}
                    </Card>

                    <Card>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
                            Most Downvoted Results
                        </div>
                        {most_downvoted.length === 0 ? (
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No downvotes yet — nothing flagged.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
                                {most_downvoted.map((d, i) => (
                                    <div key={i} style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>"{d.query_text}"</span>
                                            <span style={{ color: '#ef4444', fontWeight: 600 }}>{d.downvotes}×</span>
                                        </div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>→ {d.note_title || d.note_id}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </Section>

            {/* Low confidence queries */}
            <Section title="Low-Confidence Searches (7 days)" subtitle="Real queries with weak similarity or zero results — candidates for new golden-set entries">
                <Card style={{ padding: 0 }}>
                    {low_confidence_queries.length === 0 ? (
                        <p style={{ margin: 0, padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>None — search has been confident all week.</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Query</th>
                                        <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Similarity</th>
                                        <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Results</th>
                                        <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {low_confidence_queries.map((q, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '10px 16px' }}>{q.query_text}</td>
                                            <td style={{ padding: '10px 16px', color: q.avg_similarity === null ? '#ef4444' : 'inherit' }}>
                                                {q.avg_similarity !== null ? q.avg_similarity.toFixed(3) : '—'}
                                            </td>
                                            <td style={{ padding: '10px 16px' }}>{q.notes_returned}</td>
                                            <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>
                                                {new Date(q.created_at).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </Section>

            {/* Run history table */}
            <Section title="Eval Run History">
                <Card style={{ padding: 0 }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Date</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Queries</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Precision@3</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Sim</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Zero-Result</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Gate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...run_history].reverse().map((r) => (
                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '10px 16px' }}>{new Date(r.created_at).toLocaleString()}</td>
                                        <td style={{ padding: '10px 16px' }}>{r.total_queries}</td>
                                        <td style={{ padding: '10px 16px' }}>{(r.precision_at_3 * 100).toFixed(0)}%</td>
                                        <td style={{ padding: '10px 16px' }}>{r.avg_similarity.toFixed(3)}</td>
                                        <td style={{ padding: '10px 16px' }}>{(r.zero_result_rate * 100).toFixed(0)}%</td>
                                        <td style={{ padding: '10px 16px' }}><GatePill passed={r.gate_passed} /></td>
                                    </tr>
                                ))}
                                {run_history.length === 0 && (
                                    <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No runs yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </Section>
        </div>
    );
}
