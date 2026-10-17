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
  const pRef = useRef(p);
  useEffect(() => { pRef.current = p; });
  useEffect(() => { pRef.current.onZoom?.(zoom); }, [zoom]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [lasso, setLasso] = useState<string[]>([]);
  /** Positions we've sent to the server but it hasn't echoed back yet, so a refetch doesn't snap the card. */
  const pending = useRef<Record<string, { x: number; y: number }>>({});

  const visibleItems = useMemo(() => p.board.items.filter((i) => p.showKilled || i.card.killed_at === null), [p.board.items, p.showKilled]);

  // Build the node list from the board, carrying over measured sizes and in-flight positions so React Flow
  // never treats a card as uninitialised (it hides unmeasured nodes, which reads as flashing).
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const cards: Node[] = visibleItems.map((i) => {
        const old = prevById.get(i.id);
        const pend = pending.current[i.id];
        if (pend && pend.x === i.x && pend.y === i.y) delete pending.current[i.id];
        const position = old?.dragging ? old.position : pending.current[i.id] ?? { x: i.x, y: i.y };
        return { id: i.id, type: "card", position, measured: old?.measured, initialWidth: CARD_W, initialHeight: CARD_H, dragging: old?.dragging, selected: old?.selected, data: { kind: "card", item: i, selected: p.selectedItemId === i.id || lasso.includes(i.id), colorBy: p.colorBy, dropTarget: dropTarget === i.id, showKilled: p.showKilled } as CardData, zIndex: 1 };
      });
      return withClusters(cards, p.board.clusters, p.selectedClusterId);
    });
  }, [visibleItems, p.board.clusters, p.selectedItemId, p.selectedClusterId, p.colorBy, p.showKilled, lasso, dropTarget]);

  const rectOf = useCallback((id: string, fallback: BoardItemDTO): Rect => {
    const n = nodes.find((x) => x.id === id);
    return { x: n?.position.x ?? fallback.x, y: n?.position.y ?? fallback.y, w: CARD_W, h: CARD_H };
  }, [nodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const ch of changes) {
      if (ch.type === "select" && ch.selected) {
        if (ch.id.startsWith("cluster-")) { pRef.current.onSelectCluster(ch.id.slice(8)); pRef.current.onSelectItem(null); }
        else { pRef.current.onSelectItem(ch.id); pRef.current.onSelectCluster(null); }
      }
    }
    setNodes((ns) => {
      const next = applyNodeChanges(changes, ns);
      const moved = changes.some((c) => c.type === "position");
      return moved ? withClusters(next.filter((n) => n.type === "card"), pRef.current.board.clusters, pRef.current.selectedClusterId, next) : next;
    });
  }, []);

  const hoverTarget = useCallback((id: string, x: number, y: number): BoardItemDTO | null => {
    const me: Rect = { x: x + CARD_W / 2 - 20, y: y + CARD_H / 2 - 20, w: 40, h: 40 };
    const hit = visibleItems.find((i) => i.id !== id && !i.cluster_id && rectsOverlap(me, rectOf(i.id, i)));
    return hit ?? null;
  }, [visibleItems, rectOf]);

  const onNodeDrag: OnNodeDrag = (_e, node) => {
    if (node.type !== "card") return;
    const t = hoverTarget(node.id, node.position.x, node.position.y);
    setDropTarget((cur) => (cur === (t?.id ?? null) ? cur : t?.id ?? null));
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
      if (rectsOverlap(centre, clusterBounds(members.map((m) => rectOf(m.id, m))))) { inside = c.id; break; }
    }
    if (inside !== item.cluster_id) clusterId = inside;
    pending.current[item.id] = { x: node.position.x, y: node.position.y };
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
      const cur = pRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g" && lasso.length > 1) { e.preventDefault(); cur.onGroupSelected?.(lasso); setLasso([]); }
      if (cur.selectedItemId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const id = cur.selectedItemId;
        const step = e.shiftKey ? 40 : 8;
        setNodes((ns) => {
          const n = ns.find((x) => x.id === id);
          if (!n) return ns;
          const next = { x: n.position.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), y: n.position.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) };
          pending.current[id] = next;
          cur.onMove(id, next.x, next.y, undefined);
          const moved = ns.map((x) => (x.id === id ? { ...x, position: next } : x));
          return withClusters(moved.filter((x) => x.type === "card"), cur.board.clusters, cur.selectedClusterId, moved);
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lasso]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeDoubleClick={(_e, node) => { const it = p.board.items.find((i) => i.id === node.id); if (it) p.onDoubleClickCard(it); }}
      onPaneClick={() => { p.onSelectItem(null); p.onSelectCluster(null); setLasso([]); }}
      onSelectionChange={({ nodes: sel }) => { const ids = sel.filter((n) => n.type === "card").map((n) => n.id); setLasso((cur) => (ids.length > 1 ? ids : cur.length ? [] : cur)); }}
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

/** Cluster outlines are derived from their members' current positions; they come first so cards render above. */
function withClusters(cards: Node[], clusters: BoardClusterDTO[], selectedClusterId: string | null, prev: Node[] = []): Node[] {
  const out: Node[] = [];
  for (const c of clusters) {
    const members = cards.filter((n) => (n.data as CardData).item.cluster_id === c.id);
    if (!members.length) continue;
    const b = clusterBounds(members.map((n) => ({ x: n.position.x, y: n.position.y, w: CARD_W, h: CARD_H })));
    const old = prev.find((n) => n.id === `cluster-${c.id}`);
    out.push({ id: `cluster-${c.id}`, type: "cluster", position: { x: b.x, y: b.y }, width: b.w, height: b.h, selected: old?.selected, data: { kind: "cluster", cluster: c, selected: selectedClusterId === c.id, w: b.w, h: b.h } as ClusterData, draggable: false, selectable: true, zIndex: 0 });
  }
  return [...out, ...cards];
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
