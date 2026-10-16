import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { closeDb } from "@/server/db";
import { __setTestUserResolver } from "@/server/http";
import { freshUser } from "../helpers";
import * as cardsRoute from "@/app/api/v1/cards/route";
import * as cardRoute from "@/app/api/v1/cards/[number]/route";
import * as killRoute from "@/app/api/v1/cards/[number]/kill/route";
import * as subjectsRoute from "@/app/api/v1/cards/[number]/subjects/route";
import * as searchRoute from "@/app/api/v1/search/route";
import * as setsRoute from "@/app/api/v1/sets/route";
import * as meRoute from "@/app/api/v1/me/route";
import { listRouteFiles } from "./route-inventory";

let userA: string;
let userB: string;
let current: string | null = null;

beforeAll(async () => {
  userA = await freshUser("api-a");
  userB = await freshUser("api-b");
  __setTestUserResolver(async () => current);
});
afterAll(async () => {
  __setTestUserResolver(null);
  await closeDb();
});

function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

describe("API routes", () => {
  it("401 without a session", async () => {
    current = null;
    const res = await meRoute.GET(req("GET", "/api/v1/me"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("captures idempotently, validates, and scopes by user", async () => {
    current = userA;
    const clientId = randomUUID();
    const r1 = await cardsRoute.POST(req("POST", "/api/v1/cards", { client_id: clientId, text: "Dad's texts\nHe replied k.", capture_source: "phone", subjects: ["parents"] }));
    expect(r1.status).toBe(201);
    expect(r1.headers.get("x-request-id")).toBeTruthy();
    const { card } = await r1.json();
    expect(card.display_number).toBe("#0001");
    const r2 = await cardsRoute.POST(req("POST", "/api/v1/cards", { client_id: clientId, text: "ignored", capture_source: "phone" }));
    expect(r2.status).toBe(200);
    expect((await r2.json()).card.id).toBe(card.id);

    const bad = await cardsRoute.POST(req("POST", "/api/v1/cards", { capture_source: "phone" }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");

    const get = await cardRoute.GET(req("GET", "/api/v1/cards/1"), params({ number: "1" }));
    expect(get.status).toBe(200);
    const patch = await cardRoute.PATCH(req("PATCH", "/api/v1/cards/1", { rev: card.rev, context: { type: "inbox", id: null }, body: "edited" }), params({ number: "1" }));
    expect(patch.status).toBe(200);
    expect((await patch.json()).created_new_version).toBe(false);
    const stale = await cardRoute.PATCH(req("PATCH", "/api/v1/cards/1", { rev: card.rev, context: { type: "inbox", id: null }, body: "edited again" }), params({ number: "1" }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("CONFLICT");

    const tags = await subjectsRoute.PUT(req("PUT", "/api/v1/cards/1/subjects", { names: ["Dad", "!!!"] }), params({ number: "1" }));
    expect(tags.status).toBe(422);
    expect((await tags.json()).error.code).toBe("TAG_INVALID");

    const list = await cardsRoute.GET(req("GET", "/api/v1/cards?view=inbox&limit=5"));
    expect((await list.json()).items).toHaveLength(1);

    // User B cannot see or touch user A's card (404, never 403).
    current = userB;
    const foreign = await cardRoute.GET(req("GET", "/api/v1/cards/1"), params({ number: "1" }));
    expect(foreign.status).toBe(404);
    const foreignKill = await killRoute.POST(req("POST", "/api/v1/cards/1/kill"), params({ number: "1" }));
    expect(foreignKill.status).toBe(404);
    expect((await cardsRoute.GET(req("GET", "/api/v1/cards?view=all")).then((r) => r.json())).items).toHaveLength(0);

    current = userA;
    const search = await searchRoute.GET(req("GET", "/api/v1/search?q=edited"));
    expect((await search.json()).groups.cards[0].snippet_html).toContain("<mark>edited</mark>");
    const sets = await setsRoute.POST(req("POST", "/api/v1/sets", { name: "Tight 5 · Oct", target_duration_seconds: 300 }));
    expect(sets.status).toBe(201);
  });

  it("blocks cross-origin mutations", async () => {
    current = userA;
    const r = await cardsRoute.POST(new NextRequest("http://localhost:3000/api/v1/cards", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ text: "x", capture_source: "phone" }) }));
    expect(r.status).toBe(403);
  });

  it("exposes no merge endpoint for set revisions", () => {
    const files = listRouteFiles();
    expect(files.length).toBeGreaterThan(70);
    expect(files.filter((f) => /merge/.test(f) && /set|revision/.test(f))).toEqual([]);
  });
});
