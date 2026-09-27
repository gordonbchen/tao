import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  let body: { resourceId?: string };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (!body.resourceId || !isUuid(body.resourceId)) return jsonError("Choose a valid resource");
  const linked = await query(`INSERT INTO topic_resources(topic_id, resource_id)
    SELECT t.id, r.id FROM topics t JOIN subjects s ON s.id = t.subject_id
    JOIN resources r ON r.subject_id = s.id AND r.owner_id = s.owner_id
    WHERE t.id = $1 AND s.owner_id = $2 AND r.id = $3
    ON CONFLICT(topic_id, resource_id) DO NOTHING RETURNING topic_id`, [topicId, LOCAL_OWNER_ID, body.resourceId]);
  if (!linked.rowCount) {
    const existing = await query(`SELECT 1 FROM topic_resources WHERE topic_id = $1 AND resource_id = $2`, [topicId, body.resourceId]);
    if (existing.rowCount) return Response.json({ linked: true });
    return jsonError("Topic or resource not found in the same subject", 404);
  }
  await query(`UPDATE topics SET summary_status = CASE WHEN summary_status = 'pending' THEN summary_status ELSE 'not_generated' END,
    summary_provider = NULL, summary_model = NULL WHERE id = $1`, [topicId]);
  return Response.json({ linked: true }, { status: 201 });
}
