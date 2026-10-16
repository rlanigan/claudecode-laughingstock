// Rule 7.2 — card versioning decisions. Pure; no I/O.
import type { VersionContext } from "@/types/dto";

export const IN_PLACE_WINDOW_MS = 30 * 60 * 1000;
export const EDIT_COUNT_GAP_MS = 2 * 60 * 1000;

export interface EditTarget {
  sealed: boolean;
  hasChildren: boolean;
  /** V is pinned by a board item or bit item other than the one being edited from. */
  pinnedByOtherContainers: boolean;
  cardInInbox: boolean;
  versionContext: VersionContext;
  versionContextRef: string | null;
  lastEditedAt: Date;
}

/** Rule V3: update V in place iff every condition holds. */
export function shouldEditInPlace(v: EditTarget, ctx: VersionContext, ref: string | null, now: Date): boolean {
  if (v.sealed) return false;
  if (v.hasChildren) return false;
  if (v.pinnedByOtherContainers) return false;
  if (v.cardInInbox) return true;
  const sameContext = v.versionContext === ctx && (v.versionContextRef ?? null) === (ref ?? null);
  return sameContext && now.getTime() - v.lastEditedAt.getTime() <= IN_PLACE_WINDOW_MS;
}

const BRANCH_SEQUENCE = ["", ...Array.from({ length: 25 }, (_, i) => String.fromCharCode(98 + i))]; // '', b..z

/** Rule V4: branch label for a new child of (parentDepth, parentBranch). */
export function nextBranch(
  parentDepth: number,
  parentBranch: string,
  usedBranchesAtDepth: Set<string>,
): { depth: number; branch: string } {
  const depth = parentDepth + 1;
  if (!usedBranchesAtDepth.has(parentBranch)) return { depth, branch: parentBranch };
  for (const b of BRANCH_SEQUENCE) if (!usedBranchesAtDepth.has(b)) return { depth, branch: b };
  for (let i = 2; ; i++) {
    const b = `z${i}`;
    if (!usedBranchesAtDepth.has(b)) return { depth, branch: b };
  }
}

export function versionLabel(depth: number, branch: string): string {
  return `v${depth}${branch}`;
}

export function parseVersionLabel(label: string): { depth: number; branch: string } | null {
  const m = /^v(\d+)([b-z]|z\d+)?$/.exec(label.trim());
  if (!m) return null;
  return { depth: Number(m[1]), branch: m[2] ?? "" };
}

/** Rule V5: edit_count increments when the previous edit was more than 2 minutes ago. */
export function shouldIncrementEditCount(lastEditedAt: Date, now: Date): boolean {
  return now.getTime() - lastEditedAt.getTime() > EDIT_COUNT_GAP_MS;
}

export function contextLabel(ctx: VersionContext, name?: string | null): string {
  switch (ctx) {
    case "board":
      return `Board ${name ?? ""}`.trim();
    case "bit":
      return `Bit ${name ?? ""}`.trim();
    case "set":
      return `Set ${name ?? ""}`.trim();
    case "workshop":
      return `Workshop ${name ?? ""}`.trim();
    case "inbox":
      return "Inbox";
    case "review":
      return "Review";
    case "lineage":
      return "Lineage";
    case "capture":
      return "Capture";
    case "import":
      return "Import";
  }
}
