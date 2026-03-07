import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import GraphView from "../components/GraphView";
import { api } from "../api";
import ReactMarkdown from 'react-markdown';

const API = "/api";

export default function TopicsPage() {
    const [graphData, setGraphData] = useState({ nodes: [], links: [] });
    const [filteredData, setFilteredData] = useState({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const [selectedNode, setSelectedNode] = useState(null);
    const [sidePanel, setSidePanel] = useState(null);
    const [sidePanelLoading, setSidePanelLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState("all");
    const [reclustering, setReclustering] = useState(false);
    const [localMode, setLocalMode] = useState(false);
    const [localDepth, setLocalDepth] = useState(2);
    const [showEdgeTypes, setShowEdgeTypes] = useState({
        topic_link: true,
        semantic_link: true,
        tag_link: false,
        backlink: true,
    });
    const [semanticThreshold, setSemanticThreshold] = useState(75);
    const navigate = useNavigate();

    useEffect(() => {
        loadGraph();
    }, []);

    useEffect(() => {
        applyFilters(searchQuery, filterType);
    }, [graphData, searchQuery, filterType]);

    async function loadGraph() {
        setLoading(true);
        try {
            const res = await api.get(`/graph/data?semantic_threshold=${semanticThreshold / 100}`);
            const data = res.data;
            setGraphData(data);
            setFilteredData(data);
        } catch (err) {
            console.error("Failed to load graph data:", err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const timer = setTimeout(() => loadGraph(), 600);
        return () => clearTimeout(timer);
    }, [semanticThreshold]);

    function applyFilters(query, type) {
        const visibleNodes = graphData.nodes.filter((n) => {
            if (type === "topics" && n.type !== "topic") return false;
            if (type === "notes" && n.type !== "note") return false;
            if (query) return n.label.toLowerCase().includes(query.toLowerCase());
            return true;
        });
        const visibleIds = new Set(visibleNodes.map((n) => n.id));
        const visibleLinks = graphData.links.filter(
            (l) =>
                visibleIds.has(l.source?.id ?? l.source) &&
                visibleIds.has(l.target?.id ?? l.target)
        );
        setFilteredData({ nodes: visibleNodes, links: visibleLinks });
    }

    const handleNodeClick = useCallback(async (node) => {
        setSelectedNode(node);
        setSidePanelLoading(true);
        setSidePanel({ type: node.type, node, data: null });

        try {
            if (node.type === "topic") {
                const topicId = node.id.replace("topic-", "");
                const notesRes = await api.get(`/topics/${topicId}`);
                const topicDetail = notesRes.data;
                setSidePanel({ type: "topic", node, data: topicDetail });
            } else {
                const noteId = node.id.replace("note-", "");
                const noteRes = await api.get(`/notes/${noteId}`);
                const note = noteRes.data;
                setSidePanel({ type: "note", node, data: note });
            }
        } catch (err) {
            console.error("Side panel fetch failed:", err);
        } finally {
            setSidePanelLoading(false);
        }
    }, []);

    async function handleRecluster() {
        setReclustering(true);
        try {
            await api.post("/topics/recluster");
            setTimeout(() => { loadGraph(); setReclustering(false); }, 6000);
        } catch (err) {
            setReclustering(false);
        }
    }

    const topicCount = graphData.nodes.filter((n) => n.type === "topic").length;
    const noteCount = graphData.nodes.filter((n) => n.type === "note").length;

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p style={{ color: "var(--text-muted)", marginTop: 16 }}>
                    Loading Knowledge Graph...
                </p>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", height: "calc(100vh - 0px)", position: "relative" }}>
            {/* ──────────────── Graph Canvas ──────────────── */}
            <div style={{ flex: 1, position: "relative", background: "var(--bg-primary)" }}>

                {/* Top-left controls */}
                <div style={{
                    position: "absolute", top: 16, left: 16, zIndex: 20,
                    display: "flex", gap: 8, alignItems: "center",
                }}>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="🔍 Search nodes…"
                        style={{
                            background: "rgba(255,255,255,0.95)", border: "1px solid var(--border)",
                            borderRadius: 10, padding: "8px 14px", color: "var(--text-primary)",
                            fontSize: 13, outline: "none", width: 200,
                            backdropFilter: "blur(8px)",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "#7C3AED")}
                        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                    />
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        style={{
                            background: "rgba(255,255,255,0.95)", border: "1px solid var(--border)",
                            borderRadius: 10, padding: "8px 12px", color: "var(--text-primary)",
                            fontSize: 13, cursor: "pointer",
                        }}
                    >
                        <option value="all">All Nodes</option>
                        <option value="topics">Topics Only</option>
                        <option value="notes">Notes Only</option>
                    </select>
                    <button
                        onClick={handleRecluster}
                        disabled={reclustering}
                        style={{
                            background: reclustering ? "rgba(124, 58, 237, 0.2)" : "rgba(124, 58, 237, 0.15)",
                            border: "1px solid rgba(124, 58, 237, 0.4)",
                            color: "#A78BFA", borderRadius: 10, padding: "8px 14px",
                            fontSize: 13, cursor: reclustering ? "not-allowed" : "pointer",
                        }}
                    >
                        {reclustering ? "⏳ Clustering…" : "🧪 Recluster"}
                    </button>
                </div>

                {/* Stats badge */}
                <div style={{
                    position: "absolute", top: 16, right: sidePanel ? 324 : 16, zIndex: 20,
                    background: "rgba(255,255,255,0.9)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "var(--text-muted)",
                    backdropFilter: "blur(8px)",
                }}>
                    <span style={{ color: "#A78BFA", fontWeight: 600 }}>{topicCount}</span> topics &nbsp;·&nbsp;
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{noteCount}</span> notes
                </div>

                {/* Edge type toggles */}
                <div style={{
                    position: "absolute", bottom: 16, left: 16, zIndex: 20,
                    background: "rgba(255,255,255,0.92)", border: "1px solid var(--border)",
                    borderRadius: 12, padding: "14px 16px", fontSize: 12, color: "var(--text-muted)",
                    display: "flex", flexDirection: "column", gap: 10,
                    backdropFilter: "blur(8px)", minWidth: 200,
                }}>
                    <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: 2 }}>Edge Types</div>

                    {[
                        { key: "topic_link", color: "#7C3AED", label: "Topic clusters" },
                        { key: "semantic_link", color: "#3B82F6", label: "Semantic similarity" },
                        { key: "tag_link", color: "var(--border)", label: "Shared tags" },
                        { key: "backlink", color: "#10B981", label: "Backlinks" },
                    ].map(({ key, color, label }) => (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                            <input
                                type="checkbox"
                                checked={showEdgeTypes[key] !== false}
                                onChange={e => setShowEdgeTypes(prev => ({ ...prev, [key]: e.target.checked }))}
                                style={{ accentColor: color }}
                            />
                            <span style={{ width: 12, height: 2, background: color, display: "inline-block", borderRadius: 1 }} />
                            <span>{label}</span>
                        </label>
                    ))}

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
                        <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: 6 }}>
                            Semantic threshold: {semanticThreshold}%
                        </div>
                        <input
                            type="range" min={60} max={95} value={semanticThreshold}
                            onChange={e => setSemanticThreshold(Number(e.target.value))}
                            style={{ width: "100%", accentColor: "#3B82F6" }}
                        />
                    </div>

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
                        <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: 6 }}>Local graph depth</div>
                        <div style={{ display: "flex", gap: 6 }}>
                            {[1, 2, 3].map(d => (
                                <button key={d} onClick={() => setLocalDepth(d)} style={{
                                    padding: "4px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                                    background: localDepth === d ? "rgba(124,58,237,0.3)" : "transparent",
                                    border: `1px solid ${localDepth === d ? "rgba(124,58,237,0.6)" : "var(--border)"}`,
                                    color: localDepth === d ? "#A78BFA" : "var(--text-muted)",
                                }}>
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 2, fontSize: 11, color: "var(--text-muted)" }}>
                        Hover → highlight · Click → local graph · Right-click → open note
                    </div>
                </div>

                {/* Empty state */}
                {filteredData.nodes.length === 0 && !loading && (
                    <div style={{
                        position: "absolute", inset: 0, display: "flex",
                        flexDirection: "column", alignItems: "center", justifyContent: "center",
                        color: "var(--text-muted)", zIndex: 10,
                    }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🌌</div>
                        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--text-secondary)" }}>
                            {searchQuery ? "No matching nodes" : "No clusters yet"}
                        </p>
                        <p style={{ fontSize: 13, marginTop: 8 }}>
                            {searchQuery
                                ? "Try a different search term"
                                : "Save some notes, then click Recluster to organize them"}
                        </p>
                        {!searchQuery && (
                            <button
                                onClick={handleRecluster}
                                style={{
                                    marginTop: 20, background: "rgba(124,58,237,0.2)",
                                    border: "1px solid rgba(124,58,237,0.4)", color: "#A78BFA",
                                    padding: "10px 20px", borderRadius: 10, fontSize: 14, cursor: "pointer",
                                }}
                            >
                                🧪 Run UMAP + HDBSCAN Clustering
                            </button>
                        )}
                    </div>
                )}

                <GraphView
                    data={filteredData}
                    onNodeClick={handleNodeClick}
                    localMode={localMode}
                    localDepth={localDepth}
                    showEdgeTypes={showEdgeTypes}
                />
            </div>

            {/* ──────────────── Side Panel ──────────────── */}
            {sidePanel && (
                <div style={{
                    width: 320, background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    animation: "slideIn 0.2s ease",
                }}>
                    {/* Panel header */}
                    <div style={{
                        padding: "16px 20px", borderBottom: "1px solid var(--border)",
                        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{
                                display: "inline-block", marginBottom: 8, padding: "2px 10px",
                                borderRadius: 20, fontSize: 11, fontWeight: 600,
                                background: sidePanel.type === "topic" ? "rgba(124,58,237,0.2)" : "rgba(75,85,99,0.3)",
                                color: sidePanel.type === "topic" ? "#A78BFA" : "var(--text-secondary)",
                                border: `1px solid ${sidePanel.type === "topic" ? "rgba(124,58,237,0.4)" : "rgba(75,85,99,0.4)"}`,
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                {sidePanel.type === "topic" ? "Topic Cluster" : "Note"}
                            </span>
                            <h2 style={{
                                margin: 0, fontSize: 15, fontWeight: 700,
                                color: "var(--text-primary)", lineHeight: 1.3,
                                overflow: "hidden", textOverflow: "ellipsis",
                                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                            }}>
                                {sidePanel.node.label}
                            </h2>
                        </div>
                        <button
                            onClick={() => { setSidePanel(null); setSelectedNode(null); }}
                            style={{
                                background: "none", border: "none", color: "var(--text-muted)",
                                fontSize: 20, cursor: "pointer", padding: "0 0 0 12px",
                                lineHeight: 1, flexShrink: 0,
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                            onMouseOut={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        >×</button>
                    </div>

                    {/* Panel content */}
                    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
                        {sidePanelLoading ? (
                            <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}>
                                <div className="spinner" />
                            </div>
                        ) : sidePanel.type === "topic" && sidePanel.data ? (
                            <TopicPanel data={sidePanel.data} navigate={navigate} />
                        ) : sidePanel.type === "note" && sidePanel.data ? (
                            <NotePanel note={sidePanel.data} navigate={navigate} />
                        ) : null}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(20px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

// ─── Topic Side Panel ───────────────────────────────────────────────
function TopicPanel({ data, navigate }) {
    const notes = data?.notes || [];
    return (
        <div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                {notes.length} note{notes.length !== 1 ? "s" : ""} in this cluster
            </p>
            {notes.map((note) => (
                <div
                    key={note.id}
                    onClick={() => navigate(`/note/${note.id}`)}
                    style={{
                        background: "var(--bg-card)", borderRadius: 10, padding: "12px 14px",
                        marginBottom: 10, cursor: "pointer", border: "1px solid var(--border)",
                        transition: "all 0.15s",
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.background = "var(--bg-card-hover)";
                        e.currentTarget.style.borderColor = "rgba(124,58,237,0.3)";
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.background = "var(--bg-card)";
                        e.currentTarget.style.borderColor = "var(--border)";
                    }}
                >
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
                        {note.title || "Untitled"}
                    </p>
                    {note.summary && (
                        <div style={{
                            fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px 0",
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        }}>
                            <ReactMarkdown>{note.summary}</ReactMarkdown>
                        </div>
                    )}
                    <TagRow tags={note.auto_tags} color="#3B82F6" bg="rgba(59,130,246,0.1)" />
                </div>
            ))}
        </div>
    );
}

// ─── Note Side Panel ────────────────────────────────────────────────
function NotePanel({ note, navigate }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {note.summary && (
                <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        AI Summary
                    </p>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                    </div>
                </div>
            )}

            {note.source_url && (
                <a
                    href={note.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: "block", fontSize: 12, color: "#A78BFA",
                        textDecoration: "none", padding: "8px 12px",
                        background: "rgba(124,58,237,0.08)", borderRadius: 8,
                        border: "1px solid rgba(124,58,237,0.2)",
                    }}
                >
                    🔗 View Source →
                </a>
            )}

            {Array.isArray(note.auto_tags) && note.auto_tags.length > 0 && (
                <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        ✨ AI Tags
                    </p>
                    <TagRow tags={note.auto_tags} color="#60A5FA" bg="rgba(59,130,246,0.12)" border="rgba(59,130,246,0.25)" />
                </div>
            )}

            {Array.isArray(note.user_tags) && note.user_tags.length > 0 && (
                <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        🏷️ Your Tags
                    </p>
                    <TagRow tags={note.user_tags} color="#34D399" bg="rgba(16,185,129,0.12)" border="rgba(16,185,129,0.25)" />
                </div>
            )}

            <button
                onClick={() => navigate(`/note/${note.id}`)}
                style={{
                    background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                    color: "var(--text-primary)", border: "none", borderRadius: 10,
                    padding: "10px 16px", fontSize: 14, fontWeight: 600,
                    cursor: "pointer", width: "100%",
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
            >
                Open Full Note →
            </button>
        </div>
    );
}

// ─── Shared Tag Row ─────────────────────────────────────────────────
function TagRow({ tags, color = "var(--text-secondary)", bg = "rgba(75,85,99,0.2)", border = "transparent" }) {
    if (!Array.isArray(tags) || tags.length === 0) return null;
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tags.map((tag) => (
                <span
                    key={tag}
                    style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 6,
                        background: bg, color, border: `1px solid ${border}`,
                    }}
                >
                    {tag}
                </span>
            ))}
        </div>
    );
}
