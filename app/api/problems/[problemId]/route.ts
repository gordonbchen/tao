import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
type RouteContext = { params: Promise<{ problemId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { problemId } = await params;
  if (!isUuid(problemId)) return jsonError("Problem not found", 404);
  const result = await query(`SELECT p.id, p.topic_id AS "topicId", p.prompt, p.difficulty, p.source_refs AS "sourceRefs",
    p.created_at AS "createdAt", s.name AS "subjectName", t.name AS "topicName",
    (SELECT count(*)::int FROM tutor_messages m WHERE m.problem_id = p.id AND m.kind = 'hint') AS "hintsUsed",
    EXISTS(SELECT 1 FROM attempts a WHERE a.problem_id = p.id) AS "hasAttempt"
    FROM problems p JOIN subjects s ON s.id = p.subject_id LEFT JOIN topics t ON t.id = p.topic_id
    WHERE p.id = $1 AND s.owner_id = $2`, [problemId, LOCAL_OWNER_ID]);
  if (!result.rows[0]) return jsonError("Problem not found", 404);
  const reveal = new URL(request.url).searchParams.get("reveal") === "true";
  if (reveal) {
    if (!result.rows[0].hasAttempt) return jsonError("Submit an attempt before revealing the solution", 409);
    const solution = await query<{ solution: string }>("SELECT solution FROM problems WHERE id = $1", [problemId]);
    return Response.json({ problem: result.rows[0], solution: solution.rows[0].solution });
  }
  return Response.json({ problem: result.rows[0] });
}
