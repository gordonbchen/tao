import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
type RouteContext = { params: Promise<{ topicId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  const topic = await query(`SELECT t.id, t.subject_id AS "subjectId", t.name, t.group_id AS "groupId",
    t.coverage_confirmed AS "coverageConfirmed", t.coverage_summary AS "coverageSummary",
    t.summary_status AS "summaryStatus", t.summary_provider AS "summaryProvider", t.summary_model AS "summaryModel"
    FROM topics t JOIN subjects s ON s.id = t.subject_id
    WHERE t.id = $1 AND s.owner_id = $2`, [topicId, LOCAL_OWNER_ID]);
  if (!topic.rows[0]) return jsonError("Topic not found", 404);
  const resources = await query(`SELECT r.id, r.filename
    FROM topic_resources tr JOIN resources r ON r.id = tr.resource_id
    WHERE tr.topic_id = $1 AND r.owner_id = $2 ORDER BY tr.linked_at, r.filename`, [topicId, LOCAL_OWNER_ID]);
  return Response.json({ ...topic.rows[0], resources: resources.rows });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  let body: { name?: string; coverageConfirmed?: boolean; coverageSummary?: string; groupId?: unknown; position?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("Topic name must be text");
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && (!name || name.length > 160)) return jsonError("Topic name must be 1–160 characters");
  if (body.coverageConfirmed !== undefined && typeof body.coverageConfirmed !== "boolean") return jsonError("coverageConfirmed must be a boolean");
  if (body.coverageSummary !== undefined && typeof body.coverageSummary !== "string") return jsonError("Coverage summary must be text");
  if (body.coverageSummary !== undefined && body.coverageSummary.length > 16_000) return jsonError("Coverage summary must be 16,000 characters or fewer");
  if (body.groupId !== undefined && body.groupId !== null && (typeof body.groupId !== "string" || !isUuid(body.groupId))) return jsonError("Folder not found", 404);
  if (body.position !== undefined && !Number.isFinite(body.position)) return jsonError("Position must be a number");
  // A null groupId moves the topic to the top level; the folder must belong to the topic's subject.
  const result = await query(`UPDATE topics t SET name = coalesce($2, t.name), coverage_confirmed = coalesce($3, t.coverage_confirmed),
      group_id = CASE WHEN $6::boolean THEN $7::uuid ELSE t.group_id END, position = coalesce($8, t.position),
      coverage_summary = coalesce($5, t.coverage_summary),
      summary_status = CASE WHEN $5 IS NULL THEN t.summary_status WHEN length(trim($5)) = 0 THEN 'not_generated' ELSE 'complete' END,
      summary_provider = CASE WHEN $5 IS NULL THEN t.summary_provider ELSE NULL END,
      summary_model = CASE WHEN $5 IS NULL THEN t.summary_model ELSE NULL END
    FROM subjects s WHERE t.subject_id = s.id AND s.owner_id = $4 AND t.id = $1
      AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM topic_groups g WHERE g.id = $7 AND g.subject_id = t.subject_id))
    RETURNING t.id, t.name, t.group_id AS "groupId", t.position, t.coverage_confirmed AS "coverageConfirmed", t.coverage_summary AS "coverageSummary",
      t.summary_status AS "summaryStatus", t.summary_provider AS "summaryProvider", t.summary_model AS "summaryModel"`, [topicId, name ?? null, body.coverageConfirmed ?? null, LOCAL_OWNER_ID, body.coverageSummary ?? null,
      body.groupId !== undefined, body.groupId ?? null, body.position ?? null]);
  return result.rows[0] ? Response.json(result.rows[0]) : jsonError("Topic or folder not found", 404);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  const result = await query(`DELETE FROM topics t USING subjects s WHERE t.subject_id = s.id AND s.owner_id = $2 AND t.id = $1`, [topicId, LOCAL_OWNER_ID]);
  return result.rowCount ? new Response(null, { status: 204 }) : jsonError("Topic not found", 404);
}
