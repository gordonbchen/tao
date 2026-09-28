import { isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { cleanName } from "@/lib/topic-tree";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { name?: unknown; parentId?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const name = typeof body.name === "string" ? cleanName(body.name) : "";
  if (!name) return jsonError("Folder name must be 1–160 characters");
  if (body.parentId != null && (typeof body.parentId !== "string" || !isUuid(body.parentId))) return jsonError("Folder not found", 404);
  try {
    const result = await query(`INSERT INTO topic_groups(subject_id, parent_id, name)
      SELECT $1, $2::uuid, $3 WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM topic_groups WHERE id = $2 AND subject_id = $1)
      RETURNING id, name, parent_id AS "parentId", position`, [subjectId, body.parentId ?? null, name]);
    return result.rows[0] ? Response.json(result.rows[0], { status: 201 }) : jsonError("Folder not found", 404);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("A folder with that name is already here", 409);
    throw error;
  }
}
