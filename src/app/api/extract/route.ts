import { NextRequest, NextResponse } from "next/server";
import { runExtractionPipeline, extractWithBedrock, extractLocal } from "@/lib/connectors/bedrock-extract";
import { ingestFromS3 } from "@/lib/connectors/s3-ingest";
import { getGraphStats } from "@/lib/db/queries";

/**
 * POST /api/extract — Run entity extraction on text or S3 documents
 * 
 * Mode 1: Extract from raw text
 * Body: { vertical, mode: "text", text: "...", title?: "..." }
 * 
 * Mode 2: Extract from S3 bucket
 * Body: { vertical, mode: "s3", bucket: "...", prefix?: "...", maxFiles?: N }
 * 
 * Mode 3: Preview extraction (no storage, just returns what would be extracted)
 * Body: { vertical, mode: "preview", text: "..." }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { vertical = "otsec", mode = "text", text, title, bucket, prefix, maxFiles } = body;

  try {
    if (mode === "preview") {
      // Preview mode: extract but don't store
      if (!text) return NextResponse.json({ error: "text is required for preview mode" }, { status: 400 });
      
      const useBedrock = process.env.AWS_REGION && process.env.BEDROCK_MODEL_ID;
      const extraction = useBedrock
        ? await extractWithBedrock(text, vertical)
        : extractLocal(text, vertical);

      return NextResponse.json({
        mode: "preview",
        stored: false,
        extraction,
        note: extraction.model_used === "local-regex-fallback"
          ? "Using local regex extraction (set AWS_REGION + BEDROCK_MODEL_ID for AI extraction)"
          : "Using Amazon Bedrock Claude for extraction",
      });
    }

    if (mode === "text") {
      // Text mode: extract and store
      if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

      const docId = `manual-${Date.now()}`;
      const docTitle = title || `Manual ingestion ${new Date().toISOString().slice(0, 16)}`;
      const result = await runExtractionPipeline(docId, docTitle, "Manual Upload", text, vertical);
      const stats = getGraphStats(vertical);

      return NextResponse.json({
        mode: "text",
        stored: true,
        result,
        totals: stats,
      });
    }

    if (mode === "s3") {
      // S3 mode: ingest from bucket
      if (!bucket) return NextResponse.json({ error: "bucket is required for s3 mode" }, { status: 400 });

      const result = await ingestFromS3({
        vertical,
        bucket,
        prefix: prefix || "",
        maxFiles: maxFiles || 10,
      });
      const stats = getGraphStats(vertical);

      return NextResponse.json({
        mode: "s3",
        stored: true,
        result,
        totals: stats,
      });
    }

    return NextResponse.json({ error: `Unknown mode: ${mode}. Use 'text', 's3', or 'preview'` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
