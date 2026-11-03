"use client";
import { useEffect, useState } from "react";

export interface ApiJson<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * GET a JSON route and keep the result keyed by URL, so a vertical switch
 * never shows the previous vertical's body. State is only set in the promise
 * callbacks. Read-only (GET).
 */
export function useApiJson<T>(url: string): ApiJson<T> {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as T & { error?: string };
        if (cancelled) return;
        setState(r.ok ? { url, data: body, error: null } : { url, data: null, error: body?.error ?? `Request failed (${r.status})` });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ url, data: null, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const current = state?.url === url ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: current === null };
}
