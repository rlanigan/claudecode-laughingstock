import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    const h = await headers();
    const path = h.get("x-invoke-path") ?? h.get("next-url") ?? "/";
    redirect(`/login${path && path !== "/" ? `?next=${encodeURIComponent(path)}` : ""}`);
  }
  return <AppShell>{children}</AppShell>;
}
