import { aiErrorResponse, aiOptionsFromRequest } from "@/lib/ai";
import { organizeTopicsWithAi } from "@/lib/ai-topic-suggestions";
import { isUuid, jsonError, LOCAL_OWNER_ID, query, transaction } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { loadTree, resolveGroupPath } from "@/lib/topic-groups";
import { cleanPath, outline } from "@/lib/topic-tree";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Proposes a place in the folder tree for each unorganized topic. Nothing moves until the student applies it with PUT.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const { topics, nodes } = await loadTree(subjectId);
  const unorganized = topics.filter((topic) => topic.unorganized);
  if (!unorganized.length) return jsonError("There are no unorganized topics to place.", 422);
  const subject = await query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  try {
    const placements = await organizeTopicsWithAi(subject.rows[0].name, outline(nodes),
      unorganized.map((topic) => ({ name: topic.name, about: topic.about })), aiOptionsFromRequest(request));
    const proposed = new Map(placements.map((placement) => [placement.name.toLocaleLowerCase(), placement.path]));
    // Topics the model left out stay unorganized.
    return Response.json({ topics: unorganized.filter((topic) => proposed.has(topic.name.toLocaleLowerCase()))
      .map((topic) => ({ id: topic.id, name: topic.name, path: proposed.get(topic.name.toLocaleLowerCase())! })) });
  } catch (error) {
    return aiErrorResponse(error, "organize topics");
  }
}

// Moves each listed topic to its folder path, creating folders as needed, last among its new siblings.
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
        await client.query("UPDATE topics SET group_id = $2, unorganized = false, position = extract(epoch FROM clock_timestamp()) WHERE id = $1",
          [item.id, await resolveGroupPath(client, subjectId, item.path)]);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A topic does not belong to this subject") return jsonError(error.message, 404);
    throw error;
  }
  return new Response(null, { status: 204 });
}
