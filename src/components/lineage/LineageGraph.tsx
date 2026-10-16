"use client";
import { useMemo } from "react";
import { ReactFlow, Background, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Chip, VersionChip, cx } from "@/components/ui/primitives";
import type { LineageDTO } from "@/types/dto";
import { shortDate } from "@/lib/format";

const NODE_W = 200;
const COL_GAP = 110;
const ROW_H = 150;

type VersionNodeData = { kind: "version"; label: string; meta: string; excerpt: string; line: string; selected: boolean; compare: boolean; onClick: (shift: boolean) => void };
type LinkedNodeData = { kind: "linked"; number: string; excerpt: string; relation: string; href: string };
type BitNodeData = { kind: "bit"; name: string; meta: string; parents: string; href: string };
type PathNodeData = { kind: "path"; text: string; isQuestion: boolean };
type AnyData = VersionNodeData | LinkedNodeData | BitNodeData | PathNodeData;

function VersionNode({ data }: NodeProps<Node<VersionNodeData>>) {
  return (
    <button type="button" onClick={(e) => data.onClick(e.shiftKey)} className={cx("canvas-card w-[200px] rounded-lg border bg-card p-2.5 text-left", data.selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : data.compare ? "border-accent-dark border-dashed" : "border-border")}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between">
        <VersionChip label={data.label} />
        <span className="meta">{data.meta}</span>
      </div>
      <p className="mt-1.5 line-clamp-3 text-[12px] leading-[1.4] text-ink-body">{data.excerpt}</p>
      {data.line && <p className="meta mt-1">{data.line}</p>}
      <Handle type="source" position={Position.Right} />
    </button>
  );
}

function LinkedNode({ data }: NodeProps<Node<LinkedNodeData>>) {
  return (
    <a href={data.href} className="block w-[200px] rounded-lg border border-dashed border-dashed bg-surface p-2.5">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between"><span className="meta">{data.number}</span><Chip variant="dashed">{data.relation}</Chip></div>
      <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-body">{data.excerpt}</p>
      <Handle type="source" position={Position.Right} />
    </a>
  );
}

function BitNode({ data }: NodeProps<Node<BitNodeData>>) {
  return (
    <a href={data.href} className="block w-[200px] rounded-lg border border-accent bg-accent-wash p-2.5">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between"><Chip variant="version">bit</Chip><span className="meta">{data.meta}</span></div>
      <p className="mt-1 text-[13px] font-semibold">{data.name}</p>
      <p className="meta mt-1">parents: {data.parents}</p>
      <Handle type="source" position={Position.Right} />
    </a>
  );
}

function PathNode({ data }: NodeProps<Node<PathNodeData>>) {
  return (
    <div className={cx(data.isQuestion ? "rounded-full border-[1.5px] border-accent bg-accent-wash px-3 py-1 font-mono text-[10px] text-accent-dark" : "w-[160px] rounded-lg border border-border bg-card p-2 text-[11px] text-ink-body")}>
      <Handle type="target" position={Position.Left} />
      <span className="line-clamp-3">{data.text}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { version: VersionNode, linked: LinkedNode, bit: BitNode, path: PathNode };

/** D4 graph: columns by context, versions stacked, linked cards dashed, bits accent, workshop path on the left. */
export function LineageGraph({ lineage, selected, compare, onSelect }: { lineage: LineageDTO; selected: string | null; compare: string | null; onSelect: (label: string, shift: boolean) => void }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node<AnyData>[] = [];
    const edges: Edge[] = [];
    const colOf = new Map<string, number>();
    lineage.columns.forEach((c, i) => c.version_labels.forEach((l) => colOf.set(l, i)));
    const rowCount = new Map<number, number>();
    const pos = new Map<string, { x: number; y: number }>();
    const pathOffset = lineage.workshop_path ? 1 : 0;
    const incoming = lineage.links.filter((l) => l.direction === "incoming" && l.relation !== "promoted_from");
    const leftCols = pathOffset + (incoming.length ? 1 : 0);
    for (const v of lineage.versions) {
      const col = (colOf.get(v.label) ?? 0) + leftCols;
      const row = rowCount.get(col) ?? 0;
      rowCount.set(col, row + 1);
      const p = { x: col * (NODE_W + COL_GAP), y: 60 + row * ROW_H };
      pos.set(v.label, p);
      nodes.push({
        id: `v-${v.label}`,
        type: "version",
        position: p,
        data: { kind: "version", label: v.label, meta: v.created_context_label ?? v.created_context, excerpt: v.title ? `${v.title} — ${v.body}` : v.body, line: [v.change_note, v.edit_count > 1 ? `edited ${v.edit_count}×` : null].filter(Boolean).join(" · "), selected: selected === v.label, compare: compare === v.label, onClick: (shift) => onSelect(v.label, shift) },
      });
      if (v.parent_label) edges.push({ id: `e-${v.parent_label}-${v.label}`, source: `v-${v.parent_label}`, target: `v-${v.label}`, type: "smoothstep" });
    }
    // Incoming links (sources this card came from) in a left column.
    incoming.forEach((l, i) => {
      const id = `in-${l.other_card.number}-${i}`;
      nodes.push({ id, type: "linked", position: { x: pathOffset * (NODE_W + COL_GAP), y: 60 + i * 120 }, data: { kind: "linked", number: l.other_card.display_number, excerpt: l.other_card.display_title, relation: l.relation.replace("_from", ""), href: `/cards/${l.other_card.number}` } });
      edges.push({ id: `e-${id}`, source: id, target: `v-${l.this_version_label ?? lineage.versions[0]?.label}`, type: "smoothstep", style: { strokeDasharray: "4 3" } });
    });
    // Outgoing links (derived cards) to the right of the whole graph.
    const maxCol = Math.max(0, ...[...colOf.values()].map((c) => c + leftCols));
    const outgoing = lineage.links.filter((l) => l.direction === "outgoing");
    outgoing.forEach((l, i) => {
      const id = `out-${l.other_card.number}-${i}`;
      nodes.push({ id, type: "linked", position: { x: (maxCol + 1) * (NODE_W + COL_GAP), y: 60 + i * 120 }, data: { kind: "linked", number: l.other_card.display_number, excerpt: l.other_card.display_title, relation: l.relation.replace("_from", ""), href: `/cards/${l.other_card.number}` } });
      const from = l.this_version_label && pos.has(l.this_version_label) ? l.this_version_label : lineage.versions[lineage.versions.length - 1]?.label;
      edges.push({ id: `e-${id}`, source: `v-${from}`, target: id, type: "smoothstep", style: { strokeDasharray: "4 3" } });
    });
    // Bit membership nodes under the version they pin.
    lineage.bit_memberships.forEach((b, i) => {
      const id = `bit-${b.bit_id}`;
      const p = pos.get(b.version_label) ?? { x: 0, y: 0 };
      const row = rowCount.get((colOf.get(b.version_label) ?? 0) + leftCols) ?? 1;
      nodes.push({ id, type: "bit", position: { x: p.x + (NODE_W + COL_GAP), y: 60 + (row + i) * ROW_H + 20 }, data: { kind: "bit", name: b.bit_name, meta: b.set_names.join(", ") || "not in a set", parents: b.parents.map((x) => `${x.display_number} ${x.version_label}`).join(", "), href: `/bits/${b.bit_id}` } });
      edges.push({ id: `e-${id}`, source: `v-${b.version_label}`, target: id, type: "smoothstep", style: { stroke: "var(--accent)" } });
    });
    // Workshop path (seed → question → answer → … → v1).
    if (lineage.workshop_path) {
      let prev: string | null = null;
      lineage.workshop_path.forEach((s, i) => {
        const id = `path-${i}`;
        nodes.push({ id, type: "path", position: { x: 0, y: 60 + i * 70 }, data: { kind: "path", text: s.type === "seed" ? `seed #${String(s.card_number).padStart(4, "0")}: ${s.text}` : s.text, isQuestion: s.type === "question" } });
        if (prev) edges.push({ id: `e-${id}`, source: prev, target: id, type: "smoothstep" });
        prev = id;
      });
      if (prev && lineage.versions[0]) edges.push({ id: "e-path-v1", source: prev, target: `v-${lineage.versions[0].label}`, type: "smoothstep", style: { stroke: "var(--accent)" } });
    }
    return { nodes, edges };
  }, [lineage, selected, compare, onSelect]);

  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.3} maxZoom={1.5}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex gap-[310px]">
          {lineage.columns.map((c) => (
            <span key={c.key} className="label whitespace-nowrap">{c.label} · {c.date_label}</span>
          ))}
        </div>
      </ReactFlow>
    </div>
  );
}

export function dateLabel(iso: string) {
  return shortDate(iso);
}
