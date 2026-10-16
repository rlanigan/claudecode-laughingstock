import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { processJobs } from "@/server/services/jobs";
import "@/server/services/ai"; // registers job handlers

export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req))
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Bad cron secret." } },
      { status: 401 },
    );
  return NextResponse.json(await processJobs(25));
}
