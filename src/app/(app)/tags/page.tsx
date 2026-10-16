"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SegmentedControl, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import { toast } from "@/components/ui/toast";

type Tab = "subjects" | "themes";
interface Row { id: string; name: string; count: number; last_used_at: string | null; source?: string }

/** S3 — Tags & themes hygiene. */
export default function TagsPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("subjects");
  const [filter, setFilter] = useState<"all" | "once" | "unused">("all");
  const [sort, setSort] = useState<"name" | "count">("name");
  const [rename, setRename] = useState<Row | null>(null);
  const [merge, setMerge] = useState<Row | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [newName, setNewName] = useState("");
  const [into, setInto] = useState("");
  const base = tab === "subjects" ? "/subjects" : "/themes";
  const { data, isLoading } = useQuery({ queryKey: [tab, "admin", sort, filter], queryFn: () => api.get<{ items: Row[] }>(`${base}${qs({ sort, filter })}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: [tab] });
    qc.invalidateQueries({ queryKey: ["subjects"] });
    qc.invalidateQueries({ queryKey: ["themes"] });
    qc.invalidateQueries({ queryKey: ["cards"] });
  };
  const doRename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`${base}/${id}`, { name }), onSuccess: () => { refresh(); setRename(null); }, onError: (e) => toast(e.message) });
  const doMerge = useMutation({ mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.post(`${base}/${id}/merge`, { into_id: intoId }), onSuccess: () => { refresh(); setMerge(null); toast("Merged"); }, onError: (e) => toast(e.message) });
  const doDelete = useMutation({ mutationFn: (id: string) => api.delete(`${base}/${id}`), onSuccess: () => { refresh(); toast("Deleted"); } });
  if (!mounted) return null;
  let items = data?.items ?? [];
  if (tab === "themes") {
    if (filter === "once") items = items.filter((i) => i.count === 1);
    if (filter === "unused") items = items.filter((i) => i.count === 0);
    if (sort === "count") items = [...items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  const body = (
    <div className="mx-auto max-w-[840px] p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold">Tags &amp; themes</h2>
        <SegmentedControl ariaLabel="Kind" size="sm" value={tab} options={[{ value: "subjects", label: "Subjects" }, { value: "themes", label: "Themes" }]} onChange={setTab} />
        <div className="flex-1" />
        <div className="flex gap-1">
          {(["all", "once", "unused"] as const).map((f) => <Chip key={f} variant={filter === f ? "dark" : "neutral"} pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "once" ? "Used once" : "Unused"}</Chip>)}
        </div>
        <Button size="sm" onClick={() => setSort((s) => (s === "name" ? "count" : "name"))}>Sort: {sort === "name" ? "name" : "count"}</Button>
      </div>
      {isLoading && <SkeletonRows n={4} />}
      {data && items.length === 0 && <EmptyState title={tab === "subjects" ? "No subject tags yet." : "No themes yet."} body={tab === "subjects" ? "They're suggested as you capture." : "Themes come from workshop answers and cluster names."} />}
      {items.length > 0 && (
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-bg"><tr className="label text-left"><th className="py-2">Name</th><th className="py-2">Cards</th><th className="py-2 max-md:hidden">Last used</th><th className="py-2 text-right">Actions</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="h-10 border-t border-divider">
                <td><Chip variant={tab === "themes" ? "theme" : "neutral"}>{r.name}</Chip>{r.source && <span className="meta ml-2">{r.source.replace("_", " ")}</span>}</td>
                <td className="font-mono text-[11px]">{r.count}</td>
                <td className="font-mono text-[11px] max-md:hidden">{r.last_used_at ? relativeTime(r.last_used_at) : "—"}</td>
                <td className="text-right">
                  <Menu trigger={<Button size="sm" aria-label={`Actions for ${r.name}`}>⋯</Button>} items={[{ label: "Rename", onSelect: () => { setRename(r); setNewName(r.name); } }, { label: "Merge into…", onSelect: () => { setMerge(r); setInto(""); } }, { label: "Delete", danger: true, onSelect: () => setDel(r) }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)} title={`Rename '${rename?.name ?? ""}'`} footer={<><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" disabled={!newName.trim()} onClick={() => rename && doRename.mutate({ id: rename.id, name: newName.trim() })}>Rename</Button></>}>
        <TextInput autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New name" />
      </Dialog>
      <Dialog open={!!merge} onOpenChange={(o) => !o && setMerge(null)} title={`Merge '${merge?.name ?? ""}' into…`} screenId="M9" description={merge ? `${merge.count} card${merge.count === 1 ? "" : "s"} will be re-tagged and '${merge.name}' deleted.` : undefined} footer={<><Button onClick={() => setMerge(null)}>Cancel</Button><Button variant="danger" disabled={!into} onClick={() => merge && doMerge.mutate({ id: merge.id, intoId: into })}>Merge</Button></>}>
        <select className="field" value={into} onChange={(e) => setInto(e.target.value)} aria-label="Merge into">
          <option value="">Choose…</option>
          {(data?.items ?? []).filter((i) => i.id !== merge?.id).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.count})</option>)}
        </select>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Remove '${del?.name ?? ""}' from ${del?.count ?? 0} card${del?.count === 1 ? "" : "s"}?`} confirmLabel="Delete" onConfirm={async () => { if (del) await doDelete.mutateAsync(del.id); }} />
    </div>
  );
  if (phone) return <PhonePage id="S3" title="Tags & themes">{body}</PhonePage>;
  return <DesktopPage id="S3"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}
