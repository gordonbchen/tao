import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { getOwnedGroup, groupSummaryInput, groupSummaryStatus, subtreeCte } from "@/lib/topic-groups";
import { cleanName } from "@/lib/topic-tree";

type RouteContext = { params: Promise<{ groupId: string }> };

// A folder's summary and the union of resources linked to the topics inside it.
export async function GET(_request: Request, { params }: RouteContext) {
  const { groupId } = await params;
  if (!isUuid(groupId)) return jsonError("Folder not found", 404);
  const group = await getOwnedGroup(groupId);
  if (!group) return jsonError("Folder not found", 404);
  const [contents, resources] = await Promise.all([
    groupSummaryInput(group.subjectId, groupId),
    query(`${subtreeCte} SELECT r.id, r.filename FROM resources r
      WHERE r.owner_id = $2 AND EXISTS (SELECT 1 FROM topic_resources tr JOIN topics t ON t.id = tr.topic_id
        JOIN subtree s ON s.id = t.group_id WHERE tr.resource_id = r.id)
      ORDER BY r.created_at DESC`, [groupId, LOCAL_OWNER_ID]),
  ]);
  return Response.json({
    id: group.id, subjectId: group.subjectId, name: group.name, parentId: group.parentId, summary: group.summary,
    summaryStatus: groupSummaryStatus(group, contents?.basis ?? ""), summaryProvider: group.summaryProvider, summaryModel: group.summaryModel,
    topicCount: contents?.topicCount ?? 0, resources: resources.rows,
  });
}

// Renames a folder or moves it (parentId null is the top level). A folder cannot move inside itself.
export async function PATCH(request: Request, { params }: RouteContext) {
  const { groupId } = await params;
  if (!isUuid(groupId)) return jsonError("Folder not found", 404);
  let body: { name?: unknown; parentId?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const name = typeof body.name === "string" ? cleanName(body.name) : undefined;
  if (body.name !== undefined && !name) return jsonError("Folder name must be 1–160 characters");
  const moving = body.parentId !== undefined;
  if (moving && body.parentId !== null && (typeof body.parentId !== "string" || !isUuid(body.parentId))) return jsonError("Folder not found", 404);
  try {
    const result = await query(`${subtreeCte}
      UPDATE topic_groups g SET name = coalesce($3, g.name), parent_id = CASE WHEN $4::boolean THEN $5::uuid ELSE g.parent_id END
      FROM subjects s WHERE g.id = $1 AND s.id = g.subject_id AND s.owner_id = $2
        AND ($5::uuid IS NULL OR (EXISTS (SELECT 1 FROM topic_groups p WHERE p.id = $5 AND p.subject_id = g.subject_id)
          AND NOT EXISTS (SELECT 1 FROM subtree WHERE id = $5)))
      RETURNING g.id, g.name, g.parent_id AS "parentId"`, [groupId, LOCAL_OWNER_ID, name ?? null, moving, moving ? body.parentId : null]);
    return result.rows[0] ? Response.json(result.rows[0]) : jsonError("Folder not found, or it cannot move inside itself", 404);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("A folder with that name is already here", 409);
    throw error;
  }
}

// Removes the folder and everything inside it, including its topics and their review history.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { groupId } = await params;
  if (!isUuid(groupId)) return jsonError("Folder not found", 404);
  const result = await query(`DELETE FROM topic_groups g USING subjects s WHERE g.subject_id = s.id AND s.owner_id = $2 AND g.id = $1`, [groupId, LOCAL_OWNER_ID]);
  return result.rowCount ? new Response(null, { status: 204 }) : jsonError("Folder not found", 404);
}
