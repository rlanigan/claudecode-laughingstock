"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { clockTime, displayTitle } from "@/lib/format";
import { listOutbox, onOutboxChange, discardOutboxItem } from "@/lib/offline/outbox";
import type { OutboxRow } from "@/lib/offline/db";
import type { CardSummaryDTO } from "@/types/dto";
import { splitTitle } from "@/domain/title-split";

/** "Today" section on P1: server cards captured today merged with unsynced outbox items. */
export function TodayStrip({ onFix }: { onFix?: (row: OutboxRow) => void }) {
  const tz = new Date().getTimezoneOffset();
  const { data } = useQuery({ queryKey: qk.today, queryFn: () => api.get<{ items: CardSummaryDTO[] }>(`/cards/today${qs({ tz })}`), staleTime: 10_000 });
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => listOutbox().then((rows) => alive && setOutbox(rows));
    refresh();
    const off = onOutboxChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const items = data?.items ?? [];
  if (!items.length && !outbox.length) return null;
  return (
    <section className="mt-2">
      <div className="label mb-2">Today</div>
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {outbox.map((row) => {
          const { title, body } = splitTitle(row.payload.text);
          return (
            <li key={row.clientId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[15px]">
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => row.status === "error" && onFix?.(row)}>
                {displayTitle(title, body, 40)}
              </button>
              {row.status === "error" ? (
                <span className="flex shrink-0 items-center gap-2">
                  <button type="button" className="meta !text-accent-dark" onClick={() => onFix?.(row)}>
                    Couldn&apos;t save — tap to fix
                  </button>
                  <button type="button" className="meta" onClick={() => discardOutboxItem(row.clientId)} aria-label="Discard">
                    ✕
                  </button>
                </span>
              ) : (
                <span className="meta shrink-0">{clockTime(new Date(row.createdAt).toISOString())} · Waiting to sync</span>
              )}
            </li>
          );
        })}
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/cards/${c.number}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[15px]">
              <span className="min-w-0 flex-1 truncate">{displayTitle(c.title, c.body, 40)}</span>
              <span className="meta shrink-0">{clockTime(c.captured_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
