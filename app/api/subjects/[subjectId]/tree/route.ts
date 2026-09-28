import { aiErrorResponse, aiOptionsFromRequest } from "@/lib/ai";
import { organizeTopicsWithAi } from "@/lib/ai-topic-suggestions";
import { isUuid, jsonError, LOCAL_OWNER_ID, query, transaction } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { loadTree, resolveGroupPath } from "@/lib/topic-groups";
import { cleanPath, groupPath, outline } from "@/lib/topic-tree";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Proposes a folder tree for every topic. Nothing moves until the student applies it with PUT.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const { groups, topics, nodes } = await loadTree(subjectId);
  if (topics.length < 2) return jsonError("Add at least two topics before organizing them.", 422);
  const subject = await query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  try {
    const placements = await organizeTopicsWithAi(subject.rows[0].name, outline(nodes), aiOptionsFromRequest(request));
    const proposed = new Map(placements.map((placement) => [placement.name.toLocaleLowerCase(), placement.path]));
    // Topics the model left out keep their current place.
    return Response.json({ topics: topics.map((topic) => ({ id: topic.id, name: topic.name,
      path: proposed.get(topic.name.toLocaleLowerCase()) ?? groupPath(groups, topic.groupId) })) });
  } catch (error) {
    return aiErrorResponse(error, "organize topics");
  }
}

// Moves each listed topic to its folder path, creating folders as needed, then removes folders left empty.
export async function PUT(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { topics?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const items = Array.isArray(body.topics) ? body.topics : null;
  if (!items || items.length > 500 || items.some((item) => !item || typeof item.id !== "string" || !isUuid(item.id) || !Array.isArray(item.path))) {
    return jsonError("Provide up to 500 topics, each with an id and a folder path");
  }
  const placements = (items as { id: string; path: unknown }[]).map((item) => ({ id: item.id, path: cleanPath(item.path) }));
  try {
    await transaction(async (client) => {
      const owned = await client.query("SELECT id FROM topics WHERE subject_id = $1 AND id = ANY($2::uuid[])", [subjectId, placements.map((item) => item.id)]);
      if (owned.rowCount !== new Set(placements.map((item) => item.id)).size) throw new Error("A topic does not belong to this subject");
      for (const item of placements) {
        await client.query("UPDATE topics SET group_id = $2 WHERE id = $1", [item.id, await resolveGroupPath(client, subjectId, item.path)]);
      }
      await client.query(`WITH RECURSIVE kept(id) AS (
          SELECT group_id FROM topics WHERE subject_id = $1 AND group_id IS NOT NULL
          UNION SELECT g.parent_id FROM topic_groups g JOIN kept k ON g.id = k.id WHERE g.parent_id IS NOT NULL)
        DELETE FROM topic_groups WHERE subject_id = $1 AND id NOT IN (SELECT id FROM kept)`, [subjectId]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A topic does not belong to this subject") return jsonError(error.message, 404);
    throw error;
  }
  return new Response(null, { status: 204 });
}
