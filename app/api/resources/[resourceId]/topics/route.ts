import { isUuid, jsonError, LOCAL_OWNER_ID, transaction } from "@/lib/db";

type RouteContext = { params: Promise<{ resourceId: string }> };

// Replaces the resource's topic links. Returns changed topics that still have resources,
// so the client can regenerate their summaries.
export async function PUT(request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  let body: { topicIds?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (!Array.isArray(body.topicIds) || body.topicIds.length > 200 || body.topicIds.some((id) => typeof id !== "string" || !isUuid(id))) {
    return jsonError("Choose up to 200 valid topics");
  }
  const topicIds = [...new Set(body.topicIds as string[])];
  try {
    const refreshTopicIds = await transaction(async (client) => {
      const resource = await client.query<{ subject_id: string }>(`SELECT subject_id FROM resources WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [resourceId, LOCAL_OWNER_ID]);
      if (!resource.rows[0]) throw new Error("Resource not found");
      const allowed = await client.query(`SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id
        WHERE t.id = ANY($1::uuid[]) AND t.subject_id = $2 AND s.owner_id = $3`, [topicIds, resource.rows[0].subject_id, LOCAL_OWNER_ID]);
      if (allowed.rows.length !== topicIds.length) throw new Error("A selected topic does not belong to this subject");
      const removed = await client.query<{ topic_id: string }>(`DELETE FROM topic_resources WHERE resource_id = $1 AND NOT (topic_id = ANY($2::uuid[])) RETURNING topic_id`,
        [resourceId, topicIds]);
      const added = await client.query<{ topic_id: string }>(`INSERT INTO topic_resources(topic_id, resource_id)
        SELECT unnest($2::uuid[]), $1 ON CONFLICT(topic_id, resource_id) DO NOTHING RETURNING topic_id`, [resourceId, topicIds]);
      const changed = [...removed.rows, ...added.rows].map((row) => row.topic_id);
      if (!changed.length) return [];
      const updated = await client.query<{ id: string; has_resources: boolean }>(`UPDATE topics t SET
          coverage_summary = CASE WHEN linked.has_resources THEN coverage_summary ELSE '' END,
          brief = CASE WHEN linked.has_resources THEN brief ELSE '' END,
          summary_status = 'not_generated', summary_provider = NULL, summary_model = NULL
        FROM (SELECT changed.id, EXISTS (SELECT 1 FROM topic_resources tr WHERE tr.topic_id = changed.id) AS has_resources
          FROM unnest($1::uuid[]) AS changed(id)) linked
        WHERE t.id = linked.id
        RETURNING t.id, linked.has_resources`, [changed]);
      return updated.rows.filter((row) => row.has_resources).map((row) => row.id);
    });
    return Response.json({ topicIds, refreshTopicIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save topic links";
    if (message === "Resource not found" || message === "A selected topic does not belong to this subject") return jsonError(message, 404);
    throw error;
  }
}
