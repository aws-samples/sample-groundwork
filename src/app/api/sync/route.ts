import { NextRequest, NextResponse } from "next/server";
import { syncNvd } from "@/lib/connectors/nvd";
import { syncMitreIcs } from "@/lib/connectors/mitre-ics";
import { syncCisaKev } from "@/lib/connectors/cisa-kev";
import { ingestFromS3 } from "@/lib/connectors/s3-ingest";
import { getGraphStats } from "@/lib/db/queries";

/**
 * POST /api/sync — Trigger a data source sync
 * 
 * Body: {
 *   vertical: "otsec" | "cyber" | "energy",
 *   connector: "nvd" | "mitre-ics" | "cisa-kev" | "all",
 *   options?: { keywords?: string[], maxResults?: number }
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { vertical = "otsec", connector = "all", options = {} } = body;

  const results: Record<string, unknown> = {};
  const startTime = Date.now();

  try {
    if (connector === "nvd" || connector === "all") {
      results.nvd = await syncNvd({
        vertical,
        keywords: options.keywords || ["Siemens", "Rockwell", "Schneider Electric", "Fortinet", "Palo Alto"],
        cvssMinScore: options.cvssMinScore || 7.0,
        maxResults: options.maxResults || 10,
        apiKey: process.env.NVD_API_KEY,
      });
    }

    if (connector === "mitre-ics" || connector === "all") {
      results.mitreIcs = await syncMitreIcs(vertical);
    }

    if (connector === "cisa-kev" || connector === "all") {
      results.cisaKev = await syncCisaKev(vertical);
    }

    if (connector === "s3") {
      if (!options.bucket) {
        return NextResponse.json({ error: "options.bucket required for s3 connector" }, { status: 400 });
      }
      results.s3 = await ingestFromS3({
        vertical,
        bucket: options.bucket,
        prefix: options.prefix || "",
        maxFiles: options.maxFiles || 10,
      });
    }

    const stats = getGraphStats(vertical);
    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      vertical,
      connector,
      elapsed_ms: elapsed,
      results,
      totals: stats,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message, results }, { status: 500 });
  }
}

/**
 * GET /api/sync — Get available connectors and their status
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const vertical = searchParams.get("vertical") || "otsec";

  const stats = getGraphStats(vertical);

  return NextResponse.json({
    vertical,
    connectors: [
      { id: "nvd", name: "NVD CVE Feed", description: "NIST National Vulnerability Database (real CVEs)", status: "available", rate_limit: "5 req/30s (no key) or 50 req/30s (with key)" },
      { id: "mitre-ics", name: "MITRE ATT&CK for ICS", description: "ICS techniques, groups, malware from MITRE STIX bundle", status: "available", rate_limit: "None (GitHub raw)" },
      { id: "cisa-kev", name: "CISA KEV Catalog", description: "Known Exploited Vulnerabilities (enriches existing CVEs)", status: "available", rate_limit: "None" },
      { id: "s3", name: "Amazon S3 Documents", description: "Ingest documents from S3 bucket (runs AI extraction pipeline)", status: "available", config_required: "S3_BUCKET env var or pass bucket in options" },
    ],
    currentStats: stats,
  });
}
