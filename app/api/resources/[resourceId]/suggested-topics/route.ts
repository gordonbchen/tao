import { aiErrorResponse, aiOptionsFromRequest } from "@/lib/ai";
import { suggestTopicsForResource } from "@/lib/ai-link-suggestions";
import { isUuid, jsonError } from "@/lib/db";

type RouteContext = { params: Promise<{ resourceId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  try {
    const ids = await suggestTopicsForResource(resourceId, aiOptionsFromRequest(request));
    return ids ? Response.json({ ids }) : jsonError("Resource not found", 404);
  } catch (error) {
    return aiErrorResponse(error, "suggest topics");
  }
}
