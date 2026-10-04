import { NextResponse, type NextRequest } from "next/server";
import { listCanonicals } from "@/lib/ingestion/repo";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const inBank = sp.get("inBank");
  const result = await listCanonicals({
    q: sp.get("q")?.slice(0, 200) || null,
    subject: sp.get("subject"),
    status: sp.get("status"),
    type: sp.get("type"),
    inBank: inBank === "1" ? true : inBank === "0" ? false : null,
    limit: Number(sp.get("limit")) || 50,
    offset: Number(sp.get("offset")) || 0,
  });
  return NextResponse.json(result);
}
