import { NextResponse, type NextRequest } from "next/server";
import { getTask, listReviewTasks, mergeCanonicals, resolveTask } from "@/lib/ingestion/repo";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const result = await listReviewTasks({
    status: sp.get("status") === "RESOLVED" ? "RESOLVED" : "OPEN",
    kind: sp.get("kind"),
    documentId: sp.get("documentId"),
    limit: Number(sp.get("limit")) || 100,
  });
  return NextResponse.json(result);
}

/** Resolve a task: `dismiss`, `resolve`, or `merge` (possible duplicates). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { taskId?: unknown; action?: unknown } | null;
  const taskId = Number(body?.taskId);
  if (!Number.isInteger(taskId)) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const task = await getTask(taskId);
  if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });

  if (body?.action === "merge") {
    const candidate = (task.resolution as { candidateCanonicalId?: string } | null)?.candidateCanonicalId;
    if (task.kind !== "POSSIBLE_DUPLICATE" || !candidate || !task.canonicalId) return NextResponse.json({ error: "Нечего объединять" }, { status: 400 });
    await mergeCanonicals(candidate, task.canonicalId);
    await resolveTask(taskId, { action: "MERGE", candidateCanonicalId: candidate, mergedInto: candidate });
    return NextResponse.json({ ok: true, canonicalId: candidate });
  }
  if (body?.action === "dismiss") {
    await resolveTask(taskId, { ...(task.resolution ?? {}), action: "DISMISS" }, "DISMISSED");
    return NextResponse.json({ ok: true });
  }
  await resolveTask(taskId, { ...(task.resolution ?? {}), action: "RESOLVE" });
  return NextResponse.json({ ok: true });
}
