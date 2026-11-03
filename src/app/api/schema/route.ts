import { NextRequest, NextResponse } from "next/server";
import { getMode, getProvider, type Vertical } from "@/lib/context";
import { coaNamespace } from "@/lib/context/coa-namespace";
import { loadPackSchemaDetail, classifyLiveClasses, type LiveClassBreakdown } from "@/lib/context/pack-schema";
import { verticals } from "@/data/verticals";

/**
 * GET /api/schema?vertical=<id>
 *
 * Read-only. The vertical's pack ontology, parsed at runtime from
 * packs/<pack>/ontology.ttl. Only in Live COA mode, and only for a vertical
 * whose COA_NAMESPACE_<V> is set, it also reports what COA's describe_schema
 * returns for the namespace (GET via the provider), bounded to 8 s so a slow
 * COA never blocks the modal. The live classes are de-duplicated and split
 * into pack classes, governed-metric classes and other classes, so the count
 * is explained rather than shown as a bare number. Never returns the
 * namespace id. No POST/PUT/DELETE.
 */

const ALLOWED = Object.keys(verticals);
const LIVE_CHECK_TIMEOUT_MS = 8_000;

type LiveCheck = ({ ok: true; source: string } & LiveClassBreakdown) | { ok: false; error: string };

export const dynamic = "force-dynamic";

async function liveCheck(vertical: Vertical, detail: ReturnType<typeof loadPackSchemaDetail>): Promise<LiveCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LiveCheck>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: `COA describe_schema did not respond within ${LIVE_CHECK_TIMEOUT_MS / 1000}s` }),
      LIVE_CHECK_TIMEOUT_MS
    );
  });
  const check = (async (): Promise<LiveCheck> => {
    try {
      const schema = await getProvider().describeSchema(vertical);
      return { ok: true, source: schema.source, ...classifyLiveClasses(detail, schema) };
    } catch (err) {
      return { ok: false, error: (err as Error).message.split("\n")[0].slice(0, 200) };
    }
  })();
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const vertical = request.nextUrl.searchParams.get("vertical") ?? "";
  if (!ALLOWED.includes(vertical)) {
    return NextResponse.json({ error: `Unsupported vertical. Allowed: ${ALLOWED.join(", ")}.` }, { status: 400 });
  }
  const v = vertical as Vertical;
  try {
    const detail = loadPackSchemaDetail(v);
    const mode = getMode();
    const body =
      mode === "coa" && coaNamespace(v).configured
        ? { ...detail, mode, liveCheck: await liveCheck(v, detail) }
        : { ...detail, mode };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("GET /api/schema failed:", (error as Error).message);
    return NextResponse.json({ error: "Could not load the ontology for this vertical." }, { status: 500 });
  }
}
