import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";

type RouteContext = { params: Promise<{ topicId: string; resourceId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { topicId, resourceId } = await params;
  if (!isUuid(topicId) || !isUuid(resourceId)) return jsonError("Topic or resource not found", 404);
  const result = await query(`DELETE FROM topic_resources tr USING topics t, subjects s, resources r
    WHERE tr.topic_id = t.id AND tr.resource_id = r.id AND t.subject_id = s.id
      AND s.owner_id = $3 AND r.owner_id = $3 AND t.id = $1 AND r.id = $2`, [topicId, resourceId, LOCAL_OWNER_ID]);
  if (!result.rowCount) return jsonError("Topic-resource link not found", 404);
  await query(`UPDATE topics SET summary_status = CASE WHEN summary_status = 'pending' THEN summary_status ELSE 'not_generated' END,
    summary_provider = NULL, summary_model = NULL WHERE id = $1`, [topicId]);
  return new Response(null, { status: 204 });
}
