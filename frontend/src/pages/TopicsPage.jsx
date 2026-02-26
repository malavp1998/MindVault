import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import GraphView from "../components/GraphView";
import { api } from "../api";

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
            const res = await fetch(`${API}/graph/data`);
            const data = await res.json();
            setGraphData(data);
            setFilteredData(data);
        } catch (err) {
            console.error("Failed to load graph data:", err);
        } finally {
            setLoading(false);
        }
    }

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
                const notesRes = await fetch(`${API}/topics/${topicId}`);
                const topicDetail = await notesRes.json();
                setSidePanel({ type: "topic", node, data: topicDetail });
            } else {
                const noteId = node.id.replace("note-", "");
                const noteRes = await fetch(`${API}/notes/${noteId}`);
                const note = await noteRes.json();
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
            <div style={{ flex: 1, position: "relative", background: "#030712" }}>

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
                            background: "rgba(17,24,39,0.95)", border: "1px solid #374151",
                            borderRadius: 10, padding: "8px 14px", color: "#fff",
                            fontSize: 13, outline: "none", width: 200,
                            backdropFilter: "blur(8px)",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "#7C3AED")}
                        onBlur={(e) => (e.target.style.borderColor = "#374151")}
                    />
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        style={{
                            background: "rgba(17,24,39,0.95)", border: "1px solid #374151",
                            borderRadius: 10, padding: "8px 12px", color: "#E5E7EB",
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
                    background: "rgba(17,24,39,0.9)", border: "1px solid #1F2937",
                    borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#6B7280",
                    backdropFilter: "blur(8px)",
                }}>
                    <span style={{ color: "#A78BFA", fontWeight: 600 }}>{topicCount}</span> topics &nbsp;·&nbsp;
                    <span style={{ color: "#9CA3AF", fontWeight: 600 }}>{noteCount}</span> notes
                </div>

                {/* Legend */}
                <div style={{
                    position: "absolute", bottom: 16, left: 16, zIndex: 20,
                    background: "rgba(17,24,39,0.9)", border: "1px solid #1F2937",
                    borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#6B7280",
                    display: "flex", flexDirection: "column", gap: 6,
                    backdropFilter: "blur(8px)",
                }}>
                    {[
                        { color: "#7C3AED", size: 12, label: "Topic cluster" },
                        { color: "#4B5563", size: 8, label: "Note" },
                        { color: "#F59E0B", size: 0, label: "Hovered node" },
                        { color: "#10B981", size: 0, label: "Selected node" },
                    ].map(({ color, size, label }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {size > 0 ? (
                                <div style={{
                                    width: size, height: size, borderRadius: "50%",
                                    background: color, boxShadow: `0 0 6px ${color}`,
                                    flexShrink: 0,
                                }} />
                            ) : (
                                <div style={{
                                    width: 12, height: 12, borderRadius: "50%",
                                    border: `2px solid ${color}`, flexShrink: 0,
                                }} />
                            )}
                            <span>{label}</span>
                        </div>
                    ))}
                    <div style={{ borderTop: "1px solid #1F2937", paddingTop: 6, marginTop: 2, fontSize: 11, color: "#4B5563" }}>
                        Hover → highlight · Click → details · Right-click → open note
                    </div>
                </div>

                {/* Empty state */}
                {filteredData.nodes.length === 0 && !loading && (
                    <div style={{
                        position: "absolute", inset: 0, display: "flex",
                        flexDirection: "column", alignItems: "center", justifyContent: "center",
                        color: "#6B7280", zIndex: 10,
                    }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🌌</div>
                        <p style={{ fontSize: 18, fontWeight: 600, color: "#9CA3AF" }}>
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
                                🧪 Run KMeans Clustering
                            </button>
                        )}
                    </div>
                )}

                <GraphView data={filteredData} onNodeClick={handleNodeClick} />
            </div>

            {/* ──────────────── Side Panel ──────────────── */}
            {sidePanel && (
                <div style={{
                    width: 320, background: "#0F1117", borderLeft: "1px solid #1F2937",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    animation: "slideIn 0.2s ease",
                }}>
                    {/* Panel header */}
                    <div style={{
                        padding: "16px 20px", borderBottom: "1px solid #1F2937",
                        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{
                                display: "inline-block", marginBottom: 8, padding: "2px 10px",
                                borderRadius: 20, fontSize: 11, fontWeight: 600,
                                background: sidePanel.type === "topic" ? "rgba(124,58,237,0.2)" : "rgba(75,85,99,0.3)",
                                color: sidePanel.type === "topic" ? "#A78BFA" : "#9CA3AF",
                                border: `1px solid ${sidePanel.type === "topic" ? "rgba(124,58,237,0.4)" : "rgba(75,85,99,0.4)"}`,
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                {sidePanel.type === "topic" ? "Topic Cluster" : "Note"}
                            </span>
                            <h2 style={{
                                margin: 0, fontSize: 15, fontWeight: 700,
                                color: "#F9FAFB", lineHeight: 1.3,
                                overflow: "hidden", textOverflow: "ellipsis",
                                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                            }}>
                                {sidePanel.node.label}
                            </h2>
                        </div>
                        <button
                            onClick={() => { setSidePanel(null); setSelectedNode(null); }}
                            style={{
                                background: "none", border: "none", color: "#6B7280",
                                fontSize: 20, cursor: "pointer", padding: "0 0 0 12px",
                                lineHeight: 1, flexShrink: 0,
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.color = "#fff")}
                            onMouseOut={(e) => (e.currentTarget.style.color = "#6B7280")}
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
            <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
                {notes.length} note{notes.length !== 1 ? "s" : ""} in this cluster
            </p>
            {notes.map((note) => (
                <div
                    key={note.id}
                    onClick={() => navigate(`/note/${note.id}`)}
                    style={{
                        background: "#1A1D27", borderRadius: 10, padding: "12px 14px",
                        marginBottom: 10, cursor: "pointer", border: "1px solid #1F2937",
                        transition: "all 0.15s",
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.background = "#232636";
                        e.currentTarget.style.borderColor = "rgba(124,58,237,0.3)";
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.background = "#1A1D27";
                        e.currentTarget.style.borderColor = "#1F2937";
                    }}
                >
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#E5E7EB", margin: "0 0 6px 0" }}>
                        {note.title || "Untitled"}
                    </p>
                    {note.summary && (
                        <p style={{
                            fontSize: 12, color: "#6B7280", margin: "0 0 8px 0",
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        }}>
                            {note.summary}
                        </p>
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
                    <p style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        AI Summary
                    </p>
                    <p style={{ fontSize: 13, color: "#D1D5DB", lineHeight: 1.6, margin: 0 }}>
                        {note.summary}
                    </p>
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
                    <p style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        ✨ AI Tags
                    </p>
                    <TagRow tags={note.auto_tags} color="#60A5FA" bg="rgba(59,130,246,0.12)" border="rgba(59,130,246,0.25)" />
                </div>
            )}

            {Array.isArray(note.user_tags) && note.user_tags.length > 0 && (
                <div>
                    <p style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        🏷️ Your Tags
                    </p>
                    <TagRow tags={note.user_tags} color="#34D399" bg="rgba(16,185,129,0.12)" border="rgba(16,185,129,0.25)" />
                </div>
            )}

            <button
                onClick={() => navigate(`/note/${note.id}`)}
                style={{
                    background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                    color: "#fff", border: "none", borderRadius: 10,
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
function TagRow({ tags, color = "#9CA3AF", bg = "rgba(75,85,99,0.2)", border = "transparent" }) {
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
