import { ownsSubject } from "@/lib/domain";
import { isUuid, jsonError, query, transaction } from "@/lib/db";
import { groupInSubject } from "@/lib/topic-groups";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const result = await query(`SELECT t.id, t.name, t.group_id AS "groupId", t.position, t.unorganized, t.coverage_confirmed AS "coverageConfirmed",
    json_build_object('dueAt', r.due_at, 'intervalDays', r.interval_days, 'repetitions', r.repetitions,
      'lastRating', r.last_rating, 'lastCorrectness', r.last_correctness) AS review
    FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id WHERE t.subject_id = $1 ORDER BY t.position, t.created_at`, [subjectId]);
  return Response.json(result.rows);
}

// Creates topics in the folder `groupId`, at the top level, or, with `unorganized`, outside the tree.
// A name that already exists returns the existing topic where it is; it is never moved.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { name?: string; names?: string[]; coverageConfirmed?: boolean; groupId?: unknown; unorganized?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.names !== undefined && (!Array.isArray(body.names) || body.names.some((name) => typeof name !== "string"))) return jsonError("names must be an array of text values");
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("name must be text");
  if (body.coverageConfirmed !== undefined && typeof body.coverageConfirmed !== "boolean") return jsonError("coverageConfirmed must be a boolean");
  if (body.groupId != null && (typeof body.groupId !== "string" || !isUuid(body.groupId))) return jsonError("Folder not found", 404);
  if (body.unorganized !== undefined && typeof body.unorganized !== "boolean") return jsonError("unorganized must be a boolean");
  if (body.unorganized && body.groupId != null) return jsonError("An unorganized topic has no folder");
  const names = (body.names ?? (body.name ? [body.name] : [])).map((name) => name.trim()).filter(Boolean);
  if (!names.length || names.length > 100 || names.some((name) => name.length > 160)) return jsonError("Provide between 1 and 100 topic names, each 160 characters or fewer");
  try {
    const created = await transaction(async (client) => {
      if (typeof body.groupId === "string" && !(await groupInSubject(client, body.groupId, subjectId))) throw new Error("Folder not found");
      const rows = [];
      for (const name of [...new Set(names)]) {
        const result = await client.query(`INSERT INTO topics(subject_id, name, coverage_confirmed, group_id, unorganized) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT(subject_id, name) DO UPDATE SET name = excluded.name
          RETURNING id, name, group_id AS "groupId", position, unorganized, coverage_confirmed AS "coverageConfirmed"`,
          [subjectId, name, body.coverageConfirmed ?? true, body.groupId ?? null, body.unorganized ?? false]);
        await client.query("INSERT INTO topic_reviews(topic_id) VALUES ($1) ON CONFLICT(topic_id) DO NOTHING", [result.rows[0].id]);
        rows.push({ ...result.rows[0], review: { dueAt: new Date().toISOString(), intervalDays: 0, repetitions: 0, lastRating: null, lastCorrectness: null } });
      }
      return rows;
    });
    return Response.json(body.names ? created : created[0], { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Folder not found") return jsonError(error.message, 404);
    throw error;
  }
}
