"use client";
import { useEffect, useState } from "react";

export type Fidelity = "mock" | "ontology" | "coa";

/**
 * The active context mode, from GET /api/mode (the same request FidelityBadge
 * makes). Returns null while loading and "mock" if the request fails, so pages
 * can label their data honestly per mode.
 */
export function useFidelity(): Fidelity | null {
  const [fidelity, setFidelity] = useState<Fidelity | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mode")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setFidelity(((d.mode ?? d.fidelity) as Fidelity) ?? "mock");
      })
      .catch(() => {
        if (!cancelled) setFidelity("mock");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return fidelity;
}
