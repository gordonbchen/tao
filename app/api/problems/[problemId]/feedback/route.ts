import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";

type RouteContext = { params: Promise<{ problemId: string }> };
const allowedTags = new Set(["too_easy", "repetitive", "incorrect", "outside_coverage", "other"]);

export async function POST(request: Request, { params }: RouteContext) {
  const { problemId } = await params;
  if (!isUuid(problemId)) return jsonError("Problem not found", 404);
  let body: { tags?: unknown; note?: unknown; skipped?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string" || !allowedTags.has(tag)))) {
    return jsonError("Choose valid feedback options");
  }
  if (body.note !== undefined && typeof body.note !== "string") return jsonError("Feedback must be text");
  if (body.skipped !== undefined && typeof body.skipped !== "boolean") return jsonError("skipped must be a boolean");
  const tags = [...new Set((body.tags ?? []) as string[])];
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const skipped = body.skipped === true;
  if (note.length > 2000) return jsonError("Feedback must be 2,000 characters or fewer");

  const problemResult = await query(`SELECT p.id FROM problems p JOIN subjects s ON s.id = p.subject_id
    WHERE p.id = $1 AND s.owner_id = $2`, [problemId, LOCAL_OWNER_ID]);
  if (!problemResult.rows[0]) return jsonError("Problem not found", 404);

  let saved = false;
  if (tags.length || note || skipped) {
    await query(`INSERT INTO problem_feedback(problem_id, skipped, tags, note) VALUES ($1, $2, $3, $4)
      ON CONFLICT(problem_id) DO UPDATE SET skipped = excluded.skipped, tags = excluded.tags, note = excluded.note, created_at = now()`,
    [problemId, skipped, tags, note]);
    saved = true;
  }
  return Response.json({ saved });
}
