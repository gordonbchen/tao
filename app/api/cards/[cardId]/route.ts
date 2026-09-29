import { getOwnedCard } from "@/lib/cards";
import { isUuid, jsonError, query } from "@/lib/db";
import { getTopicInSubject } from "@/lib/domain";

type RouteContext = { params: Promise<{ cardId: string }> };

// Edits a card's text or topic. Its schedule is unchanged.
export async function PATCH(request: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = isUuid(cardId) ? await getOwnedCard(cardId) : undefined;
  if (!card) return jsonError("Card not found", 404);
  let body: { front?: unknown; back?: unknown; topicId?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const front = typeof body.front === "string" ? body.front.trim() : card.front;
  const back = typeof body.back === "string" ? body.back.trim() : card.back;
  if (!front || front.length > 4000 || back.length > 8000) return jsonError("The front must be 1–4,000 characters and the back up to 8,000");
  const topicId = body.topicId === undefined ? card.topicId : body.topicId;
  if (topicId !== null && (typeof topicId !== "string" || !isUuid(topicId) || !(await getTopicInSubject(topicId, card.subjectId)))) return jsonError("Topic not found", 404);
  await query("UPDATE cards SET front = $2, back = $3, topic_id = $4, updated_at = now() WHERE id = $1", [cardId, front, back, topicId]);
  return Response.json({ id: cardId, front, back, topicId });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = isUuid(cardId) ? await getOwnedCard(cardId) : undefined;
  if (!card) return jsonError("Card not found", 404);
  await query("DELETE FROM cards WHERE id = $1", [cardId]);
  return new Response(null, { status: 204 });
}
