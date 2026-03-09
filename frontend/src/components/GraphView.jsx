import ForceGraph2D from "react-force-graph-2d";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";

/**
 * Obsidian-level knowledge graph.
 *
 * Features:
 * - Node size scales with connection degree
 * - Per-topic color coding (notes inherit topic color)
 * - Edge types: topic_link (purple), semantic_link (blue), tag_link (gray), backlink (green)
 * - Local graph mode: click node → show N-hop neighborhood only
 * - UMAP 2D coords used as initial positions
 * - Outlier notes (no topic) rendered as dimmed gray
 */
export default function GraphView({
    data,
    onNodeClick,
    localMode = false,
    localDepth = 2,
    showEdgeTypes = { topic_link: true, semantic_link: true, tag_link: false, backlink: true },
}) {
    // ── Theme-aware canvas colors (CSS vars → resolved hex for Canvas API) ──
    const cssVars = typeof window !== "undefined"
        ? getComputedStyle(document.documentElement)
        : null;
    const CANVAS_BG = cssVars?.getPropertyValue("--bg-secondary").trim() || "#ffffff";
    const CANVAS_NODE = cssVars?.getPropertyValue("--text-muted").trim() || "#A0A0B0";
    const CANVAS_NODE_HOVER = cssVars?.getPropertyValue("--bg-card-hover").trim() || "#F9F9FB";
    const CANVAS_LABEL = cssVars?.getPropertyValue("--text-secondary").trim() || "#6B6B80";
    const CANVAS_LABEL_TOPIC = cssVars?.getPropertyValue("--accent-hover").trim() || "#6D28D9";
    const CANVAS_OUTLIER = "#D1D5DB";   // neutral gray
    const CANVAS_RING = cssVars?.getPropertyValue("--accent").trim() || "#7C3AED";
    const CANVAS_TAG_EDGE = "#9CA3AF";   // intentional soft purple

    const graphRef = useRef();
    const [hoveredNode, setHoveredNode] = useState(null);
    const [focusNode, setFocusNode] = useState(null);  // local graph center
    const [hlNodes, setHlNodes] = useState(new Set());
    const [hlLinks, setHlLinks] = useState(new Set());

    // ── Filter data by edge type visibility ──────────────────────────
    const filteredData = useMemo(() => {
        const visibleLinks = data.links.filter(l => showEdgeTypes[l.type] !== false);
        const visibleNodeIds = new Set(data.nodes.map(n => n.id));
        return { nodes: data.nodes, links: visibleLinks };
    }, [data, showEdgeTypes]);

    // ── Local graph: N-hop neighborhood of focusNode ─────────────────
    const localData = useMemo(() => {
        if (!focusNode) return filteredData;

        let frontier = new Set([focusNode.id]);
        let visited = new Set([focusNode.id]);

        for (let depth = 0; depth < localDepth; depth++) {
            const next = new Set();
            filteredData.links.forEach(l => {
                const s = l.source?.id ?? l.source;
                const t = l.target?.id ?? l.target;
                if (frontier.has(s)) next.add(t);
                if (frontier.has(t)) next.add(s);
            });
            next.forEach(n => visited.add(n));
            frontier = next;
        }

        const visibleNodes = filteredData.nodes.filter(n => visited.has(n.id));
        const visibleLinks = filteredData.links.filter(l => {
            const s = l.source?.id ?? l.source;
            const t = l.target?.id ?? l.target;
            return visited.has(s) && visited.has(t);
        });

        return { nodes: visibleNodes, links: visibleLinks };
    }, [focusNode, filteredData, localDepth]);

    // ── Adjacency for hover highlight ────────────────────────────────
    const connectedSet = useCallback((node) => {
        const ids = new Set([node.id]);
        const ls = new Set();
        localData.links.forEach(l => {
            const s = l.source?.id ?? l.source;
            const t = l.target?.id ?? l.target;
            if (s === node.id) { ids.add(t); ls.add(l); }
            if (t === node.id) { ids.add(s); ls.add(l); }
        });
        return { ids, ls };
    }, [localData.links]);

    const handleNodeHover = useCallback((node) => {
        if (node) {
            // Pin node in place while hovering
            node.fx = node.x;
            node.fy = node.y;
            const { ids, ls } = connectedSet(node);
            setHlNodes(ids);
            setHlLinks(ls);
        } else {
            // Unpin previous node when cursor leaves (only if sim is still running)
            if (hoveredNode && hoveredNode.fx !== undefined) {
                const simAlpha = graphRef.current?.d3Alpha?.() ?? 0;
                if (simAlpha > 0.01) {
                    hoveredNode.fx = undefined;
                    hoveredNode.fy = undefined;
                }
            }
            setHlNodes(new Set());
            setHlLinks(new Set());
        }
        setHoveredNode(node || null);
    }, [connectedSet, hoveredNode]);

    const handleNodeClick = useCallback((node) => {
        // Toggle local graph focus
        if (focusNode?.id === node.id) {
            setFocusNode(null);
        } else {
            setFocusNode(node);
            if (graphRef.current) {
                graphRef.current.centerAt(node.x, node.y, 600);
                graphRef.current.zoom(3.5, 700);
            }
        }
        onNodeClick?.(node);
    }, [focusNode, onNodeClick]);

    const handleNodeDblClick = useCallback((node) => {
        if (node.type === "note") {
            window.open(`/note/${node.id.replace("note-", "")}`, "_blank");
        }
    }, []);

    // ── Seed initial positions from UMAP coords ──────────────────────
    // Scale UMAP space (approx -5..5) to canvas space
    const UMAP_SCALE = 180;
    const seededNodes = useMemo(() => {
        return localData.nodes.map(n => ({
            ...n,
            x: n.graph_x != null ? n.graph_x * UMAP_SCALE : n.x,
            y: n.graph_y != null ? n.graph_y * UMAP_SCALE : n.y,
        }));
    }, [localData.nodes]);

    // Unpin nodes when data updates (recluster)
    useEffect(() => {
        if (data?.nodes) {
            data.nodes.forEach(n => {
                n.fx = undefined;
                n.fy = undefined;
            });
        }
    }, [data]);

    // ── Node painter ─────────────────────────────────────────────────
    const paintNode = useCallback((node, ctx, globalScale) => {
        if (!isFinite(node.x) || !isFinite(node.y)) return;

        const isTopic = node.type === "topic";
        const isHovered = hoveredNode?.id === node.id;
        const isFocused = focusNode?.id === node.id;
        const isHighlighted = hlNodes.has(node.id);
        const isDimmed = hlNodes.size > 0 && !isHighlighted;
        const isOutlier = node.is_outlier;

        // Size: topics by note_count, notes by degree
        const degree = node.degree || 0;
        const size = isTopic
            ? Math.max(12, Math.min(28, (node.count || 1) * 2.5 + 10))
            : Math.max(3.5, Math.min(11, degree * 1.8 + 3.5));

        // Color
        let baseColor = node.color || (isTopic ? "#7C3AED" : CANVAS_NODE);
        if (isOutlier) baseColor = CANVAS_OUTLIER;

        const alpha = isDimmed ? 0.15 : 1.0;
        ctx.globalAlpha = alpha;

        // Glow for highlighted / focused
        if ((isHighlighted || isFocused) && !isDimmed) {
            ctx.shadowColor = isTopic ? baseColor : "#A78BFA";
            ctx.shadowBlur = isTopic ? 18 : 10;
        } else {
            ctx.shadowBlur = 0;
        }

        // Draw circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);

        if (isTopic) {
            // Radial gradient for topic nodes
            const gradient = ctx.createRadialGradient(
                node.x - size * 0.3, node.y - size * 0.3, 0,
                node.x, node.y, size
            );
            gradient.addColorStop(0, lighten(baseColor, 0.3));
            gradient.addColorStop(1, baseColor);
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = isHovered ? CANVAS_NODE_HOVER : (isHighlighted ? "#A78BFA" : baseColor);
        }
        ctx.fill();

        // Ring for selected focus node
        if (isFocused) {
            ctx.strokeStyle = CANVAS_RING;
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;

        // Label
        const showLabel = isTopic || isHighlighted || isHovered || globalScale > 2.5;
        if (showLabel && !isDimmed) {
            const fontSize = isTopic
                ? Math.max(10, 13 / globalScale)
                : Math.max(8, 10 / globalScale);
            ctx.font = `${isTopic ? 600 : 400} ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = isTopic ? CANVAS_LABEL_TOPIC : CANVAS_LABEL;
            ctx.globalAlpha = isDimmed ? 0.1 : (isHighlighted ? 1 : 0.85);
            const label = node.label?.length > 28 ? node.label.slice(0, 26) + "…" : (node.label || "");
            ctx.fillText(label, node.x, node.y + size + 3);
            ctx.globalAlpha = 1.0;
        }
    }, [hoveredNode, focusNode, hlNodes]);

    // ── Link painter ─────────────────────────────────────────────────
    const paintLink = useCallback((link, ctx) => {
        const isHl = hlLinks.has(link);
        const type = link.type;

        const styles = {
            topic_link: { color: "#7C3AED", width: 1.2, opacity: 0.7 },
            semantic_link: { color: "#3B82F6", width: (link.weight || 0.75) * 2, opacity: 0.6 },
            tag_link: { color: CANVAS_TAG_EDGE, width: 0.5, opacity: 0.5 },
            backlink: { color: "#10B981", width: 1.2, opacity: 0.75 },
        };
        const s = styles[type] ?? { color: "#4B5563", width: 0.7, opacity: 0.25 };

        ctx.globalAlpha = isHl ? Math.min(s.opacity * 2, 1) : s.opacity;
        ctx.strokeStyle = isHl ? lighten(s.color, 0.4) : s.color;
        ctx.lineWidth = isHl ? s.width * 2 : s.width;

        // Dashed for tag links
        if (type === "tag_link") {
            ctx.setLineDash([2, 4]);
        } else {
            ctx.setLineDash([]);
        }
    }, [hlLinks]);

    return (
        <div style={{ width: "100%", height: "100%", background: "var(--bg-secondary)", borderRadius: 16, overflow: "hidden", position: "relative" }}>
            {/* Focus indicator */}
            {focusNode && (
                <div style={{
                    position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
                    zIndex: 30, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.4)",
                    borderRadius: 20, padding: "6px 16px", fontSize: 12, color: "#A78BFA",
                    backdropFilter: "blur(8px)", pointerEvents: "none",
                }}>
                    🔍 Local view · {focusNode.label?.slice(0, 30)} · click again to exit
                </div>
            )}

            <ForceGraph2D
                ref={graphRef}
                graphData={{ nodes: seededNodes, links: localData.links }}
                nodeCanvasObject={paintNode}
                nodeCanvasObjectMode={() => "replace"}
                linkCanvasObjectMode={() => "after"}
                linkCanvasObject={paintLink}
                onNodeHover={handleNodeHover}
                onNodeClick={handleNodeClick}
                onNodeRightClick={handleNodeDblClick}
                // Directional particles on highlighted edges
                linkDirectionalParticles={link => (hlLinks.has(link) ? 3 : 0)}
                linkDirectionalParticleSpeed={0.004}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleColor={link => link.type === "semantic_link" ? "#3B82F6" : "#7C3AED"}
                backgroundColor={CANVAS_BG}
                cooldownTicks={150}
                d3AlphaDecay={0.04}
                d3VelocityDecay={0.6}
                nodeRelSize={1}
                onEngineStop={() => {
                    // Pin all nodes at their settled positions
                    // Using requestAnimationFrame to prevent race condition with d3-force tick resulting in NaN coordinates
                    requestAnimationFrame(() => {
                        const graphData = graphRef.current?.graphData();
                        if (graphData && graphData.nodes) {
                            graphData.nodes.forEach(n => {
                                if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
                                    n.fx = n.x;
                                    n.fy = n.y;
                                    n.vx = 0;
                                    n.vy = 0;
                                }
                            });
                        }
                    });
                }}
            />
        </div>
    );
}

// ── Color utilities ────────────────────────────────────────────────────────
function lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
