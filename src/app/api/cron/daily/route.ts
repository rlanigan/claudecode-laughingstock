import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { dailyMaintenance } from "@/server/services/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = env.cronSecret;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Bad cron secret." } },
      { status: 401 },
    );
  }
  return NextResponse.json(await dailyMaintenance());
}
