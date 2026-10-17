"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, BackgroundVariant, useReactFlow, ReactFlowProvider, type Node, type NodeProps, type OnNodeDrag, type NodeChange, applyNodeChanges, useViewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Chip, VersionChip, cx } from "@/components/ui/primitives";
import { CARD_H, CARD_W, cardTilt, clusterBounds, rectsOverlap, type Rect } from "@/domain/board-geometry";
import type { BoardClusterDTO, BoardDTO, BoardItemDTO } from "@/types/dto";
import { displayTitle } from "@/lib/format";

export type ColorBy = "none" | "form" | "subject" | "theme" | "status";

type CardData = { kind: "card"; item: BoardItemDTO; selected: boolean; colorBy: ColorBy; dropTarget: boolean; showKilled: boolean };
type ClusterData = { kind: "cluster"; cluster: BoardClusterDTO; selected: boolean; w: number; h: number };

const PALETTE = ["#fbe3d8", "#dfeadb", "#e3e6f5", "#f5ecd0", "#ead9ef", "#d9ecef"];
function colorFor(key: string | null) {
  if (!key) return null;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function CardNode({ data }: NodeProps<Node<CardData>>) {
  const { item, selected, colorBy, dropTarget } = data;
  const c = item.card;
  const key = colorBy === "form" ? c.form : colorBy === "subject" ? (c.subjects[0]?.name ?? null) : colorBy === "theme" ? (c.themes[0]?.name ?? null) : colorBy === "status" ? c.status : null;
  const bg = colorFor(key);
  const killed = c.killed_at !== null;
  return (
    <div
      className={cx("canvas-card w-[190px] rounded-lg border bg-card p-2.5", selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-border", dropTarget && "border-accent border-dashed", killed && "opacity-40")}
      style={{ transform: item.cluster_id ? undefined : `rotate(${cardTilt(c.id)}deg)`, background: bg ?? undefined, minHeight: CARD_H }}
    >
      <p className="line-clamp-3 text-[12px] leading-[1.4]">{item.pinned_title && <strong className="block">{item.pinned_title}</strong>}{item.pinned_body}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <VersionChip label={item.pinned_version_label} />
        {c.subjects[0] ? <Chip>{c.subjects[0].name}</Chip> : c.form ? <Chip>{c.form}</Chip> : null}
        {killed && <Chip variant="danger">killed</Chip>}
        {c.usage_label && <span className="meta ml-auto text-accent-dark">{c.usage_label}</span>}
      </div>
    </div>
  );
}

function ClusterNode({ data }: NodeProps<Node<ClusterData>>) {
  const { cluster, selected, w, h } = data;
  return (
    <div className={cx("rounded-[14px] border-[1.5px] border-dashed", selected ? "border-accent bg-[rgba(194,85,45,0.04)]" : "border-cluster-outline")} style={{ width: w, height: h }}>
      <span className={cx("absolute -top-3 left-3 bg-bg px-1 font-serif text-[15px] font-semibold", !cluster.name && "text-ink-2")}>{cluster.name ?? "Unnamed"}</span>
      <span className="absolute -top-2.5 right-3"><Chip>{cluster.member_count} card{cluster.member_count === 1 ? "" : "s"}</Chip></span>
    </div>
  );
}

const nodeTypes = { card: CardNode, cluster: ClusterNode };

export interface BoardCanvasProps {
  board: BoardDTO;
  colorBy: ColorBy;
  showKilled: boolean;
  selectedItemId: string | null;
  selectedClusterId: string | null;
  onSelectItem: (id: string | null) => void;
  onSelectCluster: (id: string | null) => void;
  onMove: (itemId: string, x: number, y: number, clusterId: string | null | undefined) => void;
  onDropOnCard: (itemId: string, targetItemId: string) => void;
  onDoubleClickCard: (item: BoardItemDTO) => void;
  onDropFromTray: (cardNumber: number, x: number, y: number) => void;
  onGroupSelected?: (itemIds: string[]) => void;
  onZoom?: (zoom: number) => void;
}

function CanvasInner(p: BoardCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  useEffect(() => p.onZoom?.(zoom), [zoom, p]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [lasso, setLasso] = useState<string[]>([]);
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    setPositions(Object.fromEntries(p.board.items.map((i) => [i.id, { x: i.x, y: i.y }])));
  }, [p.board.items]);

  const visibleItems = useMemo(() => p.board.items.filter((i) => p.showKilled || i.card.killed_at === null), [p.board.items, p.showKilled]);
  const rectOf = useCallback((i: BoardItemDTO): Rect => ({ x: positions[i.id]?.x ?? i.x, y: positions[i.id]?.y ?? i.y, w: CARD_W, h: CARD_H }), [positions]);

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const c of p.board.clusters) {
      const members = visibleItems.filter((i) => i.cluster_id === c.id);
      if (!members.length) continue;
      const b = clusterBounds(members.map(rectOf));
      out.push({ id: `cluster-${c.id}`, type: "cluster", position: { x: b.x, y: b.y }, data: { kind: "cluster", cluster: c, selected: p.selectedClusterId === c.id, w: b.w, h: b.h } as ClusterData, draggable: false, selectable: true, zIndex: 0, style: { width: b.w, height: b.h } });
    }
    for (const i of visibleItems) {
      out.push({ id: i.id, type: "card", position: positions[i.id] ?? { x: i.x, y: i.y }, data: { kind: "card", item: i, selected: p.selectedItemId === i.id || lasso.includes(i.id), colorBy: p.colorBy, dropTarget: dropTarget === i.id, showKilled: p.showKilled } as CardData, zIndex: 1, dragHandle: undefined });
    }
    return out;
  }, [p.board.clusters, visibleItems, positions, p.selectedItemId, p.selectedClusterId, p.colorBy, dropTarget, lasso, p.showKilled, rectOf]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const ch of changes) {
      if (ch.type === "position" && ch.position) setPositions((pos) => ({ ...pos, [ch.id]: ch.position! }));
      if (ch.type === "select" && ch.selected) {
        if (ch.id.startsWith("cluster-")) { p.onSelectCluster(ch.id.slice(8)); p.onSelectItem(null); }
        else { p.onSelectItem(ch.id); p.onSelectCluster(null); }
      }
    }
    void applyNodeChanges;
  }, [p]);

  const hoverTarget = useCallback((id: string, x: number, y: number): BoardItemDTO | null => {
    const me: Rect = { x: x + CARD_W / 2 - 20, y: y + CARD_H / 2 - 20, w: 40, h: 40 };
    const hit = visibleItems.find((i) => i.id !== id && !i.cluster_id && rectsOverlap(me, rectOf(i)));
    return hit ?? null;
  }, [visibleItems, rectOf]);

  const onNodeDragStart: OnNodeDrag = (_e, node) => { dragStart.current = { id: node.id, x: node.position.x, y: node.position.y }; };
  const onNodeDrag: OnNodeDrag = (_e, node) => {
    if (node.type !== "card") return;
    const t = hoverTarget(node.id, node.position.x, node.position.y);
    setDropTarget(t?.id ?? null);
  };
  const onNodeDragStop: OnNodeDrag = (_e, node) => {
    if (node.type !== "card") return;
    const item = p.board.items.find((i) => i.id === node.id);
    if (!item) return;
    const t = hoverTarget(node.id, node.position.x, node.position.y);
    setDropTarget(null);
    if (t && !item.cluster_id) { p.onDropOnCard(item.id, t.id); return; }
    // Cluster membership by outline containment.
    let clusterId: string | null | undefined = undefined;
    const centre: Rect = { x: node.position.x + CARD_W / 2, y: node.position.y + CARD_H / 2, w: 1, h: 1 };
    let inside: string | null = null;
    for (const c of p.board.clusters) {
      const members = visibleItems.filter((i) => i.cluster_id === c.id && i.id !== item.id);
      if (!members.length) continue;
      if (rectsOverlap(centre, clusterBounds(members.map(rectOf)))) { inside = c.id; break; }
    }
    if (inside !== item.cluster_id) clusterId = inside;
    p.onMove(item.id, node.position.x, node.position.y, clusterId);
  };

  const onDrop = (e: React.DragEvent) => {
    const n = e.dataTransfer.getData("application/x-card-number");
    if (!n) return;
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    p.onDropFromTray(Number(n), Math.max(0, pos.x - CARD_W / 2), Math.max(0, pos.y - 20));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g" && lasso.length > 1) { e.preventDefault(); p.onGroupSelected?.(lasso); setLasso([]); }
      if (p.selectedItemId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 40 : 8;
        const cur = positions[p.selectedItemId];
        if (!cur) return;
        const next = { x: cur.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), y: cur.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) };
        setPositions((pos) => ({ ...pos, [p.selectedItemId!]: next }));
        p.onMove(p.selectedItemId, next.x, next.y, undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lasso, p, positions]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeDoubleClick={(_e, node) => { const it = p.board.items.find((i) => i.id === node.id); if (it) p.onDoubleClickCard(it); }}
      onPaneClick={() => { p.onSelectItem(null); p.onSelectCluster(null); setLasso([]); }}
      onSelectionChange={({ nodes: sel }) => { const ids = sel.filter((n) => n.type === "card").map((n) => n.id); if (ids.length > 1) setLasso(ids); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={onDrop}
      selectionOnDrag
      panOnDrag={[1, 2]}
      panOnScroll
      zoomOnScroll={false}
      zoomActivationKeyCode={["Meta", "Control"]}
      minZoom={0.25}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      translateExtent={[[-200, -200], [4400, 4400]]}
      nodeExtent={[[0, 0], [4000, 4000]]}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
    </ReactFlow>
  );
}

export function BoardCanvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export function miniTitle(item: BoardItemDTO) {
  return displayTitle(item.pinned_title, item.pinned_body, 40);
}
