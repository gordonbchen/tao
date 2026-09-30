import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { findUnfinishedProblem } from "@/lib/practice";
import { selectionFromSearch } from "@/lib/selection";

type RouteContext = { params: Promise<{ subjectId: string }> };

// The problem the student opened in this selection but neither answered nor skipped, so the Problems tab returns to it.
export async function GET(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const selection = selectionFromSearch(new URL(request.url).searchParams);
  if (typeof selection === "string") return jsonError(selection);
  return Response.json({ problem: await findUnfinishedProblem(subjectId, selection) });
}
