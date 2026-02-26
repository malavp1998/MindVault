import ForceGraph2D from "react-force-graph-2d";
import { useRef, useState, useCallback, useEffect } from "react";

/**
 * Obsidian-style force-directed graph canvas.
 * Topics render as large glowing purple orbs; notes as small dark dots.
 * Hover highlights connected neighbors. Click fires onNodeClick.
 */
export default function GraphView({ data, onNodeClick }) {
    const graphRef = useRef();
    const [hoveredNode, setHoveredNode] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);

    // Build adjacency set for fast highlight lookup
    const connectedSet = useCallback(
        (node) => {
            const ids = new Set([node.id]);
            const ls = new Set();
            data.links.forEach((link) => {
                const srcId = link.source?.id ?? link.source;
                const tgtId = link.target?.id ?? link.target;
                if (srcId === node.id) { ids.add(tgtId); ls.add(link); }
                if (tgtId === node.id) { ids.add(srcId); ls.add(link); }
            });
            return { ids, ls };
        },
        [data.links]
    );

    const [hlNodes, setHlNodes] = useState(new Set());
    const [hlLinks, setHlLinks] = useState(new Set());

    const handleNodeHover = useCallback(
        (node) => {
            if (node) {
                const { ids, ls } = connectedSet(node);
                setHlNodes(ids);
                setHlLinks(ls);
            } else {
                setHlNodes(new Set());
                setHlLinks(new Set());
            }
            setHoveredNode(node || null);
        },
        [connectedSet]
    );

    const handleNodeClick = useCallback(
        (node) => {
            setSelectedNode(node);
            onNodeClick?.(node);
            // Smooth zoom to node
            if (graphRef.current) {
                graphRef.current.centerAt(node.x, node.y, 800);
                graphRef.current.zoom(3.5, 800);
            }
        },
        [onNodeClick]
    );

    const handleNodeDblClick = useCallback((node) => {
        if (node.type === "note") {
            window.open(`/note/${node.id.replace("note-", "")}`, "_blank");
        }
    }, []);

    // ─── Canvas Painter ────────────────────────────────────────
    const paintNode = useCallback(
        (node, ctx, globalScale) => {
            const isTopic = node.type === "topic";
            const isHovered = hoveredNode?.id === node.id;
            const isSelected = selectedNode?.id === node.id;
            const isHighlighted = hlNodes.has(node.id);
            const isDimmed = hlNodes.size > 0 && !isHighlighted;

            // Size: topics scale with note_count, notes are small dots
            const size = isTopic
                ? Math.max(10, Math.min(24, (node.count || 1) * 2 + 8))
                : 4;

            // Base color
            let color = isTopic ? "#7C3AED" : "#4B5563";
            if (isHighlighted) color = isTopic ? "#A78BFA" : "#9CA3AF";
            if (isHovered) color = "#F59E0B";
            if (isSelected) color = "#10B981";
            if (isDimmed) {
                ctx.globalAlpha = 0.15;
            } else {
                ctx.globalAlpha = 1;
            }

            // Glow for hovered/selected
            if (isHovered || isSelected) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = color;
            } else if (isTopic) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = "#7C3AED";
            } else {
                ctx.shadowBlur = 0;
            }

            // Draw circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();

            // Ring on topics
            if (isTopic) {
                ctx.strokeStyle = isHovered ? "#F59E0B" : "#A78BFA";
                ctx.lineWidth = isHovered ? 2.5 : 1.5;
                ctx.stroke();
            }

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;

            // Labels — always for topics; for notes only on hover or high zoom
            if (isTopic || isHovered || isSelected || globalScale > 2.5) {
                const fontSize = isTopic
                    ? Math.max(10, 13 / globalScale)
                    : Math.max(7, 9 / globalScale);
                ctx.font = `${isTopic ? "600 " : ""}${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = isDimmed
                    ? "rgba(255,255,255,0.1)"
                    : isTopic
                        ? isHovered || isSelected ? "#FFFFFF" : "#E5E7EB"
                        : "#9CA3AF";
                ctx.textAlign = "center";
                const label =
                    node.label.length > 22
                        ? node.label.slice(0, 22) + "…"
                        : node.label;
                ctx.fillText(label, node.x, node.y + size + fontSize + 2);
            }
        },
        [hoveredNode, selectedNode, hlNodes]
    );

    // ─── Link Painter ──────────────────────────────────────────
    const paintLink = useCallback(
        (link, ctx) => {
            const isHl = hlLinks.has(link);
            const isTagLink = link.type === "tag_link";

            ctx.globalAlpha = isHl ? 0.9 : isTagLink ? 0.15 : 0.4;
            ctx.strokeStyle = isHl ? "#A78BFA" : isTagLink ? "#374151" : "#4B5563";
            ctx.lineWidth = isHl ? 1.5 : isTagLink ? 0.4 : 0.7;
        },
        [hlLinks]
    );

    return (
        <div style={{ width: "100%", height: "100%", background: "#030712", borderRadius: 16, overflow: "hidden" }}>
            <ForceGraph2D
                ref={graphRef}
                graphData={data}
                nodeCanvasObject={paintNode}
                nodeCanvasObjectMode={() => "replace"}
                linkCanvasObjectMode={() => "after"}
                linkCanvasObject={paintLink}
                onNodeHover={handleNodeHover}
                onNodeClick={handleNodeClick}
                onNodeRightClick={handleNodeDblClick}
                linkDirectionalParticles={(link) => (hlLinks.has(link) ? 3 : 0)}
                linkDirectionalParticleSpeed={0.005}
                linkDirectionalParticleWidth={2}
                backgroundColor="#030712"
                cooldownTicks={120}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.25}
                // Stronger repulsion for topic nodes
                nodeRelSize={1}
                d3Force="charge"
            />
        </div>
    );
}
