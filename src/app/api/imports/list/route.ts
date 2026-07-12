// Lightweight PPTX imports list for the operator LeftColumn Imports panel.
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listPptxImports } from "@/lib/server/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listPptxImports(user.churchId);
  return NextResponse.json({
    imports: rows.map((r) => ({
      id: r.id,
      fileName: r.originalFileName,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
