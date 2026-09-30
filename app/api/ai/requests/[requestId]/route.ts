import { cancelAiRequest } from "@/lib/ai";
import { isUuid, jsonError } from "@/lib/db";

type RouteContext = { params: Promise<{ requestId: string }> };

// Stops an AI request the page started with this ID, including its model call.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { requestId } = await params;
  if (!isUuid(requestId)) return jsonError("Request not found", 404);
  cancelAiRequest(requestId);
  return new Response(null, { status: 204 });
}
