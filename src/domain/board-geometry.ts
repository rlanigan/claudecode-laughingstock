// Rule 7.14 — board geometry. Pure.

export const CARD_W = 190;
export const CARD_H = 110; // server assumption; the client measures real heights
export const CLUSTER_PAD = 16;
export const CLUSTER_LABEL = 20;
export const CANVAS_MAX = 4000;
export const GRID_STEP_X = 210;
export const GRID_STEP_Y = 130;
export const GRID_ORIGIN = 24;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, lo = 0, hi = CANVAS_MAX): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Bounding box of member rects, expanded by 16 px plus 20 px on top for the label. */
export function clusterBounds(items: Rect[]): Rect {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const maxY = Math.max(...items.map((i) => i.y + i.h));
  return {
    x: minX - CLUSTER_PAD,
    y: minY - CLUSTER_PAD - CLUSTER_LABEL,
    w: maxX - minX + CLUSTER_PAD * 2,
    h: maxY - minY + CLUSTER_PAD * 2 + CLUSTER_LABEL,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Top-left free 190 × 110 slot scanning a 210 × 130 grid from (24, 24). */
export function landingSlot(occupied: Rect[]): { x: number; y: number } {
  const cols = Math.floor((CANVAS_MAX - GRID_ORIGIN) / GRID_STEP_X);
  for (let row = 0; row < 500; row++) {
    for (let col = 0; col < cols; col++) {
      const x = GRID_ORIGIN + col * GRID_STEP_X;
      const y = GRID_ORIGIN + row * GRID_STEP_Y;
      const slot = { x, y, w: CARD_W, h: CARD_H };
      if (!occupied.some((o) => rectsOverlap(o, slot))) return { x, y };
    }
  }
  return { x: GRID_ORIGIN, y: GRID_ORIGIN };
}

/** Where a dropped card lands when it creates a cluster with `target`. */
export function placeBesideTarget(target: Rect): { x: number; y: number } {
  const x = target.x + target.w + CLUSTER_PAD;
  if (x + CARD_W > CANVAS_MAX) return { x: target.x, y: target.y + target.h + CLUSTER_PAD };
  return { x, y: target.y };
}

/**
 * Tidy: clusters in rows (wrap at 1200 px), members in a 2-column grid inside each cluster,
 * loose cards in a row below.
 */
export function tidyLayout(
  clusters: { id: string; itemIds: string[] }[],
  looseItemIds: string[],
  cardH = CARD_H,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const WRAP = 1200;
  const GAP = 16;
  const OUTER = 40;
  let cx = OUTER;
  let cy = OUTER + CLUSTER_LABEL;
  let rowH = 0;
  for (const c of clusters) {
    const rows = Math.ceil(c.itemIds.length / 2);
    const w = (c.itemIds.length >= 2 ? 2 : 1) * CARD_W + (c.itemIds.length >= 2 ? GAP : 0) + CLUSTER_PAD * 2;
    const h = rows * cardH + (rows - 1) * GAP + CLUSTER_PAD * 2 + CLUSTER_LABEL;
    if (cx + w > WRAP && cx > OUTER) {
      cx = OUTER;
      cy += rowH + OUTER;
      rowH = 0;
    }
    c.itemIds.forEach((id, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      out[id] = { x: cx + CLUSTER_PAD + col * (CARD_W + GAP), y: cy + CLUSTER_PAD + row * (cardH + GAP) };
    });
    cx += w + OUTER;
    rowH = Math.max(rowH, h);
  }
  let ly = clusters.length ? cy + rowH + OUTER : OUTER;
  let lx = OUTER;
  for (const id of looseItemIds) {
    if (lx + CARD_W > WRAP) {
      lx = OUTER;
      ly += cardH + GAP;
    }
    out[id] = { x: lx, y: ly };
    lx += CARD_W + GAP;
  }
  return out;
}

/** Deterministic cosmetic rotation (−2° … +2°) from a card id. */
export function cardTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 400) / 100 - 2) as number;
}
