"use client";
import { useCallback, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Edge, type Node, type NodeProps, type OnNodeDrag } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Chip, cx } from "@/components/ui/primitives";
import type { MapDTO, NodeDTO, QuestionDTO } from "@/types/dto";

type SeedData = { kind: "seed"; title: string; text: string; context: string | null; selected: boolean; onClick: () => void };
type QuestionData = { kind: "question"; q: QuestionDTO; selected: boolean; onClick: () => void; onDrop: (templateId: string) => void };
type AnswerData = { kind: "answer"; n: NodeDTO; selected: boolean; hidden: boolean; onClick: () => void; onDrop: (templateId: string) => void };
type AskData = { kind: "ask"; onClick: () => void };

const DROP_TYPE = "application/x-question-template";

function SeedNode({ data }: NodeProps<Node<SeedData>>) {
  return (
    <button type="button" onClick={data.onClick} className={cx("canvas-card w-[230px] rounded-lg border-[1.5px] bg-card p-3 text-left", data.selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-ink")}>
      <div className="flex items-center justify-between"><Chip variant="dark">seed</Chip>{data.context && <span className="meta max-w-[120px] truncate">{data.context}</span>}</div>
      {data.title && <p className="mt-1.5 text-[13px] font-semibold">{data.title}</p>}
      <p className="mt-1 line-clamp-4 text-[12px] leading-[1.4] text-ink-body">{data.text}</p>
      <Handle type="source" position={Position.Bottom} />
    </button>
  );
}

function QuestionPillNode({ data }: NodeProps<Node<QuestionData>>) {
  return (
    <button type="button" onClick={data.onClick} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const t = e.dataTransfer.getData(DROP_TYPE); if (t) { e.preventDefault(); data.onDrop(t); } }} className={cx("w-[180px] rounded-full border-[1.5px] border-accent bg-accent-wash px-3 py-1.5 text-center font-mono text-[10px] text-accent-dark", data.selected && "ring-2 ring-[var(--accent-ring)]")}>
      <Handle type="target" position={Position.Top} />
      {data.q.short_label}
      <Handle type="source" position={Position.Bottom} />
    </button>
  );
}

function AnswerNode({ data }: NodeProps<Node<AnswerData>>) {
  const n = data.n;
  return (
    <button type="button" onClick={data.onClick} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const t = e.dataTransfer.getData(DROP_TYPE); if (t) { e.preventDefault(); data.onDrop(t); } }} className={cx("canvas-card w-[200px] rounded-lg border bg-card p-2.5 text-left", data.selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-border", n.is_dead_end && "opacity-55")}>
      <Handle type="target" position={Position.Top} />
      <p className="line-clamp-4 text-[12px] leading-[1.4]">{n.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {n.angle_label && <Chip variant="version">Angle {n.angle_label}</Chip>}
        {n.laugh_size && <Chip variant={n.laugh_size === "big" ? "success" : "status"}>{n.laugh_size === "big" ? "big laugh" : n.laugh_size === "table" ? "table laugh" : "unsure"}</Chip>}
        {n.promoted_card_number !== null && <Chip variant="accent">→ joke #{String(n.promoted_card_number).padStart(4, "0")}</Chip>}
        {n.is_dead_end && <Chip variant="dashed">dead end</Chip>}
        {n.author_label && <span className="meta ml-auto">{n.author_label}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </button>
  );
}

function AskNode({ data }: NodeProps<Node<AskData>>) {
  return (
    <button type="button" onClick={data.onClick} className="rounded-full border border-dashed border-dashed px-3 py-1.5 font-mono text-[10px] text-ink-2 hover:border-accent hover:text-accent-dark">
      <Handle type="target" position={Position.Top} />
      + ask a question
    </button>
  );
}

const nodeTypes = { seed: SeedNode, question: QuestionPillNode, answer: AnswerNode, ask: AskNode };

export function layoutMap(map: MapDTO, collapseDeadEnds: boolean, selectedNodeId: string | null) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 48, nodesep: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const hidden = new Set<string>();
  if (collapseDeadEnds) {
    const byQuestion = new Map<string, NodeDTO[]>();
    for (const n of map.nodes) if (n.question_id) byQuestion.set(n.question_id, [...(byQuestion.get(n.question_id) ?? []), n]);
    const qsOf = new Map<string, QuestionDTO[]>();
    for (const q of map.questions) qsOf.set(q.node_id, [...(qsOf.get(q.node_id) ?? []), q]);
    const hide = (nodeId: string) => { hidden.add(nodeId); for (const q of qsOf.get(nodeId) ?? []) { hidden.add(q.id); for (const a of byQuestion.get(q.id) ?? []) hide(a.id); } };
    for (const n of map.nodes) if (n.is_dead_end) hide(n.id);
  }
  const edges: Edge[] = [];
  g.setNode(map.root.id, { width: 230, height: 120 });
  for (const q of map.questions) {
    if (hidden.has(q.id) || hidden.has(q.node_id)) continue;
    g.setNode(q.id, { width: 180, height: 32 });
    g.setEdge(q.node_id, q.id);
    edges.push({ id: `e-${q.node_id}-${q.id}`, source: q.node_id, target: q.id, type: "smoothstep" });
  }
  for (const n of map.nodes) {
    if (n.kind === "root" || !n.question_id || hidden.has(n.id)) continue;
    g.setNode(n.id, { width: 200, height: 90 });
    g.setEdge(n.question_id, n.id);
    edges.push({ id: `e-${n.question_id}-${n.id}`, source: n.question_id, target: n.id, type: "smoothstep" });
  }
  if (selectedNodeId && !hidden.has(selectedNodeId)) {
    g.setNode("ask", { width: 140, height: 28 });
    g.setEdge(selectedNodeId, "ask");
    edges.push({ id: "e-ask", source: selectedNodeId, target: "ask", type: "smoothstep", style: { strokeDasharray: "4 3" } });
  }
  dagre.layout(g);
  const pos = (id: string, w: number, h: number) => {
    const n = g.node(id);
    return { x: n.x - w / 2, y: n.y - h / 2 };
  };
  return { pos, edges, hidden };
}

export function WorkshopCanvas({ map, collapseDeadEnds, selectedNodeId, selectedQuestionId, onSelectNode, onSelectQuestion, onAsk, onDropTemplate, onMoveNode }: { map: MapDTO; collapseDeadEnds: boolean; selectedNodeId: string | null; selectedQuestionId: string | null; onSelectNode: (id: string) => void; onSelectQuestion: (id: string) => void; onAsk: (nodeId: string) => void; onDropTemplate: (nodeId: string, templateId: string) => void; onMoveNode: (nodeId: string, x: number, y: number) => void }) {
  const { nodes, edges } = useMemo(() => {
    const { pos, edges, hidden } = layoutMap(map, collapseDeadEnds, selectedNodeId);
    const nodes: Node[] = [];
    const seedText = map.seed.current_version;
    nodes.push({ id: map.root.id, type: "seed", position: map.root.x !== null && map.root.y !== null ? { x: map.root.x, y: map.root.y } : pos(map.root.id, 230, 120), data: { kind: "seed", title: seedText.title ?? "", text: seedText.body, context: seedText.context, selected: selectedNodeId === map.root.id, onClick: () => onSelectNode(map.root.id) } as SeedData, draggable: true });
    for (const q of map.questions) {
      if (hidden.has(q.id) || hidden.has(q.node_id)) continue;
      nodes.push({ id: q.id, type: "question", position: pos(q.id, 180, 32), data: { kind: "question", q, selected: selectedQuestionId === q.id, onClick: () => onSelectQuestion(q.id), onDrop: (t) => onDropTemplate(q.node_id, t) } as QuestionData, draggable: false });
    }
    for (const n of map.nodes) {
      if (n.kind === "root" || hidden.has(n.id)) continue;
      nodes.push({ id: n.id, type: "answer", position: n.x !== null && n.y !== null ? { x: n.x, y: n.y } : pos(n.id, 200, 90), data: { kind: "answer", n, selected: selectedNodeId === n.id, hidden: false, onClick: () => onSelectNode(n.id), onDrop: (t) => onDropTemplate(n.id, t) } as AnswerData, draggable: true });
    }
    if (selectedNodeId && !hidden.has(selectedNodeId)) nodes.push({ id: "ask", type: "ask", position: pos("ask", 140, 28), data: { kind: "ask", onClick: () => onAsk(selectedNodeId) } as AskData, draggable: false, selectable: false });
    return { nodes, edges };
  }, [map, collapseDeadEnds, selectedNodeId, selectedQuestionId, onSelectNode, onSelectQuestion, onAsk, onDropTemplate]);

  const onNodeDragStop: OnNodeDrag = useCallback((_e, node) => { if (node.type === "answer" || node.type === "seed") onMoveNode(node.id, node.position.x, node.position.y); }, [onMoveNode]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeDragStop={onNodeDragStop} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.25} maxZoom={1.5} nodesConnectable={false} panOnScroll zoomOnScroll={false} zoomActivationKeyCode={["Meta", "Control"]} proOptions={{ hideAttribution: true }} onPaneClick={() => undefined}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
    </ReactFlow>
  );
}

export const QUESTION_DROP_TYPE = DROP_TYPE;
