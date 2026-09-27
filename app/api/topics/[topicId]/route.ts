import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
type RouteContext = { params: Promise<{ topicId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  let body: { name?: string; coverageConfirmed?: boolean };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.name !== undefined && typeof body.name !== "string") return jsonError("Topic name must be text");
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && (!name || name.length > 160)) return jsonError("Topic name must be 1–160 characters");
  if (body.coverageConfirmed !== undefined && typeof body.coverageConfirmed !== "boolean") return jsonError("coverageConfirmed must be a boolean");
  const result = await query(`UPDATE topics t SET name = coalesce($2, name), coverage_confirmed = coalesce($3, coverage_confirmed)
    FROM subjects s WHERE t.subject_id = s.id AND s.owner_id = $4 AND t.id = $1
    RETURNING t.id, t.name, t.coverage_confirmed AS "coverageConfirmed"`, [topicId, name ?? null, body.coverageConfirmed ?? null, LOCAL_OWNER_ID]);
  return result.rows[0] ? Response.json(result.rows[0]) : jsonError("Topic not found", 404);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  const result = await query(`DELETE FROM topics t USING subjects s WHERE t.subject_id = s.id AND s.owner_id = $2 AND t.id = $1`, [topicId, LOCAL_OWNER_ID]);
  return result.rowCount ? new Response(null, { status: 204 }) : jsonError("Topic not found", 404);
}
