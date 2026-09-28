import { ownsSubject } from "@/lib/domain";
import { isUuid, jsonError, query, transaction } from "@/lib/db";
import { groupInSubject, resolveGroupPath } from "@/lib/topic-groups";
import { cleanPath } from "@/lib/topic-tree";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const result = await query(`SELECT t.id, t.name, t.group_id AS "groupId", t.position, t.coverage_confirmed AS "coverageConfirmed",
    json_build_object('dueAt', r.due_at, 'intervalDays', r.interval_days, 'repetitions', r.repetitions,
      'lastRating', r.last_rating, 'lastCorrectness', r.last_correctness) AS review
    FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id WHERE t.subject_id = $1 ORDER BY t.position, t.created_at`, [subjectId]);
  return Response.json(result.rows);
}

// Creates topics in a folder given by `groupId` or by `path` (folder names, created as needed).
// A name that already exists returns the existing topic where it is; it is never moved.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { name?: string; names?: string[]; coverageConfirmed?: boolean; groupId?: unknown; path?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.names !== undefined && (!Array.isArray(body.names) || body.names.some((name) => typeof name !== "string"))) return jsonError("names must be an array of text values");
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("name must be text");
  if (body.coverageConfirmed !== undefined && typeof body.coverageConfirmed !== "boolean") return jsonError("coverageConfirmed must be a boolean");
  if (body.groupId != null && (typeof body.groupId !== "string" || !isUuid(body.groupId))) return jsonError("Folder not found", 404);
  if (body.path !== undefined && (!Array.isArray(body.path) || body.path.some((part) => typeof part !== "string"))) return jsonError("path must be an array of folder names");
  const names = (body.names ?? (body.name ? [body.name] : [])).map((name) => name.trim()).filter(Boolean);
  if (!names.length || names.length > 100 || names.some((name) => name.length > 160)) return jsonError("Provide between 1 and 100 topic names, each 160 characters or fewer");
  try {
    const created = await transaction(async (client) => {
      if (typeof body.groupId === "string" && !(await groupInSubject(client, body.groupId, subjectId))) throw new Error("Folder not found");
      // Only make the path's folders when a topic is new, so linking an existing topic leaves no empty folders.
      const existing = await client.query("SELECT 1 FROM topics WHERE subject_id = $1 AND name = ANY($2::text[])", [subjectId, names]);
      const groupId = typeof body.groupId === "string" ? body.groupId
        : existing.rowCount === new Set(names).size ? null : await resolveGroupPath(client, subjectId, cleanPath(body.path));
      const rows = [];
      for (const name of [...new Set(names)]) {
        const result = await client.query(`INSERT INTO topics(subject_id, name, coverage_confirmed, group_id) VALUES ($1, $2, $3, $4)
          ON CONFLICT(subject_id, name) DO UPDATE SET name = excluded.name
          RETURNING id, name, group_id AS "groupId", position, coverage_confirmed AS "coverageConfirmed"`, [subjectId, name, body.coverageConfirmed ?? true, groupId]);
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
