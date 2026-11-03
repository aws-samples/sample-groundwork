import { NextRequest, NextResponse } from "next/server";
import { getProvider, getMode, setMode, type ContextMode } from "@/lib/context";
import { configuredCoaVerticals } from "@/lib/context/coa-namespace";

/**
 * GET /api/mode — the active fidelity, for the UI's honesty badge + switcher.
 * Both responses carry `coaVerticals`: the vertical ids whose COA_NAMESPACE_<V>
 * is set (ids only, never namespace values).
 * POST /api/mode { mode: "mock" | "ontology" | "coa" } — switch modes at runtime.
 * See docs/RUNNING.md.
 */

const MODES: { id: ContextMode; label: string; blurb: string }[] = [
  { id: "mock", label: "Demo data", blurb: "SQLite seed — the story, zero AWS" },
  { id: "ontology", label: "Local ontology", blurb: "Real OWL reasoning + vector retrieval, no AWS" },
  { id: "coa", label: "Live COA", blurb: "Neptune graph via COA, in your AWS account" },
];

export async function GET() {
  try {
    const provider = getProvider();
    return NextResponse.json({ fidelity: provider.fidelity, mode: getMode(), modes: MODES, coaVerticals: configuredCoaVerticals() });
  } catch (error: unknown) {
    // A selected mode may be unavailable (e.g. coa without config). Report the
    // intended mode so the badge shows it rather than crashing.
    return NextResponse.json({ fidelity: getMode(), mode: getMode(), modes: MODES, coaVerticals: configuredCoaVerticals(), error: (error as Error).message });
  }
}

export async function POST(request: NextRequest) {
  let body: { mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON { mode }" }, { status: 400 });
  }
  const mode = (body.mode ?? "").toLowerCase();
  if (mode !== "mock" && mode !== "ontology" && mode !== "coa") {
    return NextResponse.json({ error: `Unknown mode '${mode}'. Use mock | ontology | coa.` }, { status: 400 });
  }
  try {
    const provider = setMode(mode as ContextMode);
    return NextResponse.json({ fidelity: provider.fidelity, mode: getMode(), modes: MODES, coaVerticals: configuredCoaVerticals() });
  } catch (error: unknown) {
    // Switch failed (e.g. coa without COA_BASE_URL) — surface it; mode unchanged.
    return NextResponse.json({ error: (error as Error).message, mode: getMode(), modes: MODES }, { status: 409 });
  }
}
