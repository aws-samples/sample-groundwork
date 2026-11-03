import { NextRequest, NextResponse } from "next/server";
import { getVerticalSources, CoaSourcesError } from "@/lib/coa-sources";
import { verticals } from "@/data/verticals";

/**
 * GET /api/sources?vertical=<id>[&refresh=1]
 *
 * Read-only view of a vertical's data sources: live COA source status in Live
 * COA mode (when COA_NAMESPACE_<V> is set), a "not configured" note when it is
 * not, and the local demo seed otherwise. No POST: this never registers,
 * rescans or approves anything in COA. Responses never include credential
 * ARNs, full database hosts, s3 prefixes or the namespace id.
 */

const ALLOWED = Object.keys(verticals);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const vertical = request.nextUrl.searchParams.get("vertical") ?? "";
  if (!ALLOWED.includes(vertical)) {
    return NextResponse.json({ error: `Unsupported vertical. Allowed: ${ALLOWED.join(", ")}.` }, { status: 400 });
  }
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    return NextResponse.json(await getVerticalSources(vertical, { refresh }));
  } catch (error: unknown) {
    if (error instanceof CoaSourcesError) {
      return NextResponse.json({ vertical, origin: "coa-live", error: error.message, sources: [] }, { status: 502 });
    }
    console.error("GET /api/sources failed:", (error as Error).message);
    return NextResponse.json({ error: "Could not load sources for this vertical." }, { status: 500 });
  }
}
