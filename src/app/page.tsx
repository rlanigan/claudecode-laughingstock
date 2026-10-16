"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** `/` → /capture on phone-width viewports, /inbox otherwise (§38.1). */
export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)").matches;
    router.replace(phone ? "/capture" : "/inbox");
  }, [router]);
  return <div className="p-6 text-[13px] text-ink-2">Opening Cards…</div>;
}
