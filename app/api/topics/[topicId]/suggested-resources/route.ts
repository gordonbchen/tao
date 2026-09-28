import { aiErrorResponse, aiOptionsFromRequest } from "@/lib/ai";
import { suggestResourcesForTopic } from "@/lib/ai-link-suggestions";
import { isUuid, jsonError } from "@/lib/db";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  try {
    const ids = await suggestResourcesForTopic(topicId, aiOptionsFromRequest(request));
    return ids ? Response.json({ ids }) : jsonError("Topic not found", 404);
  } catch (error) {
    return aiErrorResponse(error, "suggest resources");
  }
}
