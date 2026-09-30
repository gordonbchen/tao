import { aiOptionsFromRequest, hasAiProvider, tutorCard } from "@/lib/ai";
import { getOwnedCard } from "@/lib/cards";
import { isUuid, jsonError, query } from "@/lib/db";
import { withFigure, type Diagram } from "@/lib/diagrams";

type RouteContext = { params: Promise<{ cardId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = isUuid(cardId) ? await getOwnedCard(cardId) : undefined;
  if (!card) return jsonError("Card not found", 404);
  let body: { message?: unknown; revealed?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) return jsonError("Message must be 1–2,000 characters");
  if (!hasAiProvider()) return jsonError("Sign in to an AI account before asking the tutor", 409);
  const previous = await query<{ content: string; diagram: Diagram | null }>("SELECT content, diagram FROM tutor_messages WHERE card_id = $1 AND role = 'tutor' ORDER BY created_at DESC LIMIT 6", [cardId]);
  let reply: Awaited<ReturnType<typeof tutorCard>>;
  try { reply = await tutorCard({ front: withFigure(card.front, card.frontDiagram), back: withFigure(card.back, card.backDiagram, "Back figure") }, body.revealed === true, message, previous.rows.reverse().map((row) => withFigure(row.content, row.diagram)), aiOptionsFromRequest(request)); }
  catch { return jsonError("The tutor could not respond. Check the configured AI provider or try again.", 502); }
  if (!reply) return jsonError("The tutor could not respond. Try again.", 502);
  await query("INSERT INTO tutor_messages(card_id, role, kind, content, diagram) VALUES ($1, 'student', 'question', $2, NULL), ($1, 'tutor', 'hint', $3, $4)", [cardId, message, reply.text, reply.diagram]);
  return Response.json({ reply: reply.text, diagram: reply.diagram });
}
