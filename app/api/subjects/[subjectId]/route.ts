import { rm } from "node:fs/promises";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId)) return jsonError("Subject not found", 404);
  const subjectResult = await query(`SELECT id, name, created_at AS "createdAt" FROM subjects WHERE id = $1 AND owner_id = $2`, [subjectId, LOCAL_OWNER_ID]);
  if (!subjectResult.rows[0]) return jsonError("Subject not found", 404);
  const [topicsResult, resourcesResult] = await Promise.all([
    query(`SELECT t.id, t.name, t.coverage_confirmed AS "coverageConfirmed", t.summary_status AS "summaryStatus",
      json_build_object('dueAt', r.due_at, 'intervalDays', r.interval_days, 'repetitions', r.repetitions,
        'lastRating', r.last_rating, 'lastCorrectness', r.last_correctness) AS review
      FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id
      WHERE t.subject_id = $1 ORDER BY t.created_at`, [subjectId]),
    query(`SELECT r.id, r.filename, r.content_type AS "contentType", r.extraction_status AS "extractionStatus",
      summary_status AS "summaryStatus", created_at AS "createdAt"
      , COALESCE((SELECT json_agg(tr.topic_id) FROM topic_resources tr WHERE tr.resource_id = r.id), '[]'::json) AS "topicIds"
      FROM resources r WHERE subject_id = $1 AND owner_id = $2 ORDER BY created_at DESC`, [subjectId, LOCAL_OWNER_ID])
  ]);
  return Response.json({ subject: subjectResult.rows[0], topics: topicsResult.rows, resources: resourcesResult.rows });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId)) return jsonError("Subject not found", 404);
  let body: { name?: string };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("Subject name must be text");
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && (!name || name.length > 120)) return jsonError("Subject name must be 1–120 characters");
  const result = await query(`UPDATE subjects SET name = coalesce($3, name), updated_at = now()
    WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at AS "createdAt"`, [subjectId, LOCAL_OWNER_ID, name ?? null]);
  return result.rows[0] ? Response.json(result.rows[0]) : jsonError("Subject not found", 404);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId)) return jsonError("Subject not found", 404);
  const resources = await query<{ storage_path: string }>(
    "SELECT storage_path FROM resources WHERE subject_id = $1 AND owner_id = $2",
    [subjectId, LOCAL_OWNER_ID],
  );
  const result = await query("DELETE FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  if (!result.rowCount) return jsonError("Subject not found", 404);
  const cleanup = await Promise.allSettled(resources.rows.map(({ storage_path }) => rm(storage_path, { force: true })));
  cleanup.forEach((result) => {
    if (result.status === "rejected") console.error("Could not remove a deleted subject resource", result.reason);
  });
  return new Response(null, { status: 204 });
}
