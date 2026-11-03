import { NextRequest, NextResponse } from "next/server";
import { getProvider, type Vertical } from "@/lib/context";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const vertical = (searchParams.get("vertical") || "otsec") as Vertical;

  try {
    const provider = getProvider();
    const documents = await provider.listDocuments(vertical);
    const stats = await provider.getStats(vertical);
    return NextResponse.json({
      documents,
      count: documents.length,
      totalChunks: stats.totalChunks,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
