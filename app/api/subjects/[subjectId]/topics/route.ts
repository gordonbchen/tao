import { ownsSubject } from "@/lib/domain";
import { isUuid, jsonError, query } from "@/lib/db";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const result = await query(`SELECT t.id, t.name, t.coverage_confirmed AS "coverageConfirmed",
    json_build_object('dueAt', r.due_at, 'intervalDays', r.interval_days, 'repetitions', r.repetitions,
      'lastRating', r.last_rating, 'lastCorrectness', r.last_correctness) AS review
    FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id WHERE t.subject_id = $1 ORDER BY t.created_at`, [subjectId]);
  return Response.json(result.rows);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { name?: string; names?: string[]; coverageConfirmed?: boolean };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.names !== undefined && (!Array.isArray(body.names) || body.names.some((name) => typeof name !== "string"))) return jsonError("names must be an array of text values");
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("name must be text");
  if (body.coverageConfirmed !== undefined && typeof body.coverageConfirmed !== "boolean") return jsonError("coverageConfirmed must be a boolean");
  const names = (body.names ?? (body.name ? [body.name] : [])).map((name) => name.trim()).filter(Boolean);
  if (!names.length || names.length > 100 || names.some((name) => name.length > 160)) return jsonError("Provide between 1 and 100 topic names, each 160 characters or fewer");
  const created = [];
  for (const name of [...new Set(names)]) {
    const result = await query(`INSERT INTO topics(subject_id, name, coverage_confirmed) VALUES ($1, $2, $3)
      ON CONFLICT(subject_id, name) DO UPDATE SET name = excluded.name
      RETURNING id, name, coverage_confirmed AS "coverageConfirmed"`, [subjectId, name, body.coverageConfirmed ?? true]);
    await query("INSERT INTO topic_reviews(topic_id) VALUES ($1) ON CONFLICT(topic_id) DO NOTHING", [result.rows[0].id]);
    created.push({ ...result.rows[0], review: { dueAt: new Date().toISOString(), intervalDays: 0, repetitions: 0, lastRating: null, lastCorrectness: null } });
  }
  return Response.json(body.names ? created : created[0], { status: 201 });
}
