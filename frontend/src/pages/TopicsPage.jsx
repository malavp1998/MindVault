import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTopics, listNotes } from '../api';

export default function TopicsPage() {
    const [topics, setTopics] = useState([]);
    const [notes, setNotes] = useState([]);
    const [graphData, setGraphData] = useState({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const [ForceGraph, setForceGraph] = useState(null);
    const navigate = useNavigate();
    const graphRef = useRef();

    useEffect(() => {
        // Dynamically import react-force-graph-2d
        import('react-force-graph-2d').then(mod => {
            setForceGraph(() => mod.default);
        }).catch(() => {
            console.warn('react-force-graph-2d not available');
        });

        loadData();
    }, []);

    async function loadData() {
        try {
            const [topicsData, notesData] = await Promise.all([
                listTopics(),
                listNotes({ limit: 200 }),
            ]);
            setTopics(topicsData);
            setNotes(notesData);
            buildGraph(topicsData, notesData);
        } catch (err) {
            console.error('Failed to load topics:', err);
        } finally {
            setLoading(false);
        }
    }

    function buildGraph(topics, notes) {
        const nodes = [];
        const links = [];

        // Add topic nodes (larger)
        topics.forEach(topic => {
            nodes.push({
                id: `topic-${topic.id}`,
                label: topic.name,
                type: 'topic',
                noteCount: topic.note_count,
                val: 20 + topic.note_count * 3,
                color: '#8b5cf6',
            });
        });

        // Add note nodes and link to topics
        notes.forEach(note => {
            nodes.push({
                id: `note-${note.id}`,
                label: note.title.length > 30 ? note.title.substring(0, 30) + '...' : note.title,
                type: 'note',
                noteId: note.id,
                val: 8,
                color: note.topic_id ? '#6366f1' : '#4b5563',
            });

            if (note.topic_id) {
                links.push({
                    source: `topic-${note.topic_id}`,
                    target: `note-${note.id}`,
                    color: 'rgba(139, 92, 246, 0.15)',
                });
            }
        });

        setGraphData({ nodes, links });
    }

    const handleNodeClick = useCallback((node) => {
        if (node.type === 'note' && node.noteId) {
            navigate(`/note/${node.noteId}`);
        }
    }, [navigate]);

    const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
        const label = node.label;
        const fontSize = node.type === 'topic' ? 14 / globalScale : 10 / globalScale;
        ctx.font = `${node.type === 'topic' ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;

        // Draw node circle
        const radius = node.type === 'topic' ? 8 : 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = node.color;
        ctx.fill();

        if (node.type === 'topic') {
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw label
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = node.type === 'topic' ? '#e0e0f5' : '#888899';
        ctx.fillText(label, node.x, node.y + radius + 3);
    }, []);

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p style={{ color: 'var(--text-muted)' }}>Loading knowledge graph...</p>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h1>🗺️ Topic Map</h1>
                <p>Explore how your knowledge connects • {topics.length} topics • {notes.length} notes</p>
            </div>

            {/* Topic list */}
            <div style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap' }}>
                {topics.map(topic => (
                    <div
                        key={topic.id}
                        className="topic-chip"
                        onClick={() => navigate(`/?topic_id=${topic.id}`)}
                    >
                        {topic.name}
                        <span className="count">{topic.note_count}</span>
                    </div>
                ))}
            </div>

            {/* Force-directed graph */}
            <div className="graph-container">
                {ForceGraph && graphData.nodes.length > 0 ? (
                    <ForceGraph
                        ref={graphRef}
                        graphData={graphData}
                        nodeCanvasObject={nodeCanvasObject}
                        onNodeClick={handleNodeClick}
                        nodePointerAreaPaint={(node, color, ctx) => {
                            const r = node.type === 'topic' ? 10 : 6;
                            ctx.fillStyle = color;
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                            ctx.fill();
                        }}
                        linkColor={() => 'rgba(139, 92, 246, 0.12)'}
                        backgroundColor="#16162a"
                        width={undefined}
                        height={600}
                        cooldownTicks={100}
                        d3AlphaMin={0.01}
                    />
                ) : (
                    <div className="empty-state">
                        <div className="icon">🕸️</div>
                        <h3>No topics yet</h3>
                        <p>Save more notes and let the AI discover patterns in your knowledge.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
