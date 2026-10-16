"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => {
              if (err instanceof ApiRequestError && err.status < 500) return false;
              return count < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const onUnauth = () => setSignedOut(true);
    window.addEventListener("ccw:unauthenticated", onUnauth);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => window.removeEventListener("ccw:unauthenticated", onUnauth);
  }, []);

  return (
    <QueryClientProvider client={client}>
      {signedOut && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 bg-accent-tint px-4 py-2 text-[13px] text-accent-dark">
          <span>You&apos;ve been signed out. Sign in again — nothing you typed is lost.</span>
          <a href="/login" className="font-semibold underline">
            Sign in
          </a>
        </div>
      )}
      {children}
      <Toaster />
      <div id="live-region" aria-live="polite" className="sr-only" />
    </QueryClientProvider>
  );
}

export function announce(text: string) {
  const el = document.getElementById("live-region");
  if (el) {
    el.textContent = "";
    setTimeout(() => {
      el.textContent = text;
    }, 30);
  }
}
