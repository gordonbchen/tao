import { isUuid, jsonError, LOCAL_OWNER_ID, transaction } from "@/lib/db";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  let body: { resourceIds?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (!Array.isArray(body.resourceIds) || body.resourceIds.length > 100 || body.resourceIds.some((id) => typeof id !== "string" || !isUuid(id))) {
    return jsonError("Choose up to 100 valid resources");
  }
  const resourceIds = [...new Set(body.resourceIds as string[])];
  try {
    const changed = await transaction(async (client) => {
      const topic = await client.query<{ subject_id: string }>(`SELECT t.subject_id FROM topics t JOIN subjects s ON s.id = t.subject_id
        WHERE t.id = $1 AND s.owner_id = $2 FOR UPDATE OF t`, [topicId, LOCAL_OWNER_ID]);
      if (!topic.rows[0]) throw new Error("Topic not found");
      const allowed = await client.query<{ id: string }>(`SELECT id FROM resources WHERE id = ANY($1::uuid[]) AND subject_id = $2 AND owner_id = $3`,
        [resourceIds, topic.rows[0].subject_id, LOCAL_OWNER_ID]);
      if (allowed.rows.length !== resourceIds.length) throw new Error("A selected resource does not belong to this subject");
      const removed = await client.query(`DELETE FROM topic_resources WHERE topic_id = $1 AND NOT (resource_id = ANY($2::uuid[])) RETURNING resource_id`, [topicId, resourceIds]);
      const added = await client.query(`INSERT INTO topic_resources(topic_id, resource_id)
        SELECT $1, unnest($2::uuid[]) ON CONFLICT(topic_id, resource_id) DO NOTHING RETURNING resource_id`, [topicId, resourceIds]);
      const linksChanged = Boolean(removed.rowCount || added.rowCount);
      if (linksChanged) {
        await client.query(resourceIds.length
          ? `UPDATE topics SET summary_status = 'not_generated', summary_provider = NULL, summary_model = NULL WHERE id = $1`
          : `UPDATE topics SET coverage_summary = '', brief = '', summary_status = 'not_generated', summary_provider = NULL, summary_model = NULL WHERE id = $1`, [topicId]);
      }
      return linksChanged;
    });
    return Response.json({ changed, resourceIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save resource links";
    if (message === "Topic not found") return jsonError(message, 404);
    if (message === "A selected resource does not belong to this subject") return jsonError(message, 404);
    throw error;
  }
}
