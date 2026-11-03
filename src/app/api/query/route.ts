import { NextRequest, NextResponse } from "next/server";
import { getProvider, type Vertical, type QueryMode } from "@/lib/context";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { vertical = "otsec", query, mode = "graph", startNodes = [], model } = body as {
    vertical: Vertical;
    query: string;
    mode: QueryMode;
    startNodes?: string[];
    model?: string;
  };

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const provider = getProvider();
    const result = await provider.query(vertical, query, mode, startNodes, model);
    // `graphDb` kept as an alias of `backend` for backward-compatibility with the UI.
    return NextResponse.json({ ...result, graphDb: result.backend, fidelity: provider.fidelity });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
