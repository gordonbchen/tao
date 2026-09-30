import { aiErrorResponse, aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { suggestTopicsWithAi } from "@/lib/ai-topic-suggestions";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { topicNames } from "@/lib/topic-groups";

type RouteContext = { params: Promise<{ resourceId: string }> };

// Suggests topics taught in a resource, as at upload, leaving out topics it is already linked to.
export async function POST(request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to an AI account to suggest topics", 409);
  const result = await query<{ subjectId: string; filename: string; extractedText: string }>(`SELECT subject_id AS "subjectId", filename, extracted_text AS "extractedText"
    FROM resources WHERE id = $1 AND owner_id = $2`, [resourceId, LOCAL_OWNER_ID]);
  const resource = result.rows[0];
  if (!resource) return jsonError("Resource not found", 404);
  if (!resource.extractedText.trim()) return jsonError("This resource has no selectable text to suggest topics from.", 422);
  try {
    const [suggested, linked] = await Promise.all([
      suggestTopicsWithAi(resource.filename, resource.extractedText, await topicNames(resource.subjectId), aiOptionsFromRequest(request)),
      query<{ name: string }>("SELECT t.name FROM topic_resources tr JOIN topics t ON t.id = tr.topic_id WHERE tr.resource_id = $1", [resourceId]),
    ]);
    const linkedNames = new Set(linked.rows.map((topic) => topic.name.toLocaleLowerCase()));
    return Response.json({ topics: suggested.filter((name) => !linkedNames.has(name.toLocaleLowerCase())) });
  } catch (error) {
    return aiErrorResponse(error, "suggest topics");
  }
}
