import { aiOptionsFromRequest, hasAiProvider, tutorCard } from "@/lib/ai";
import { getOwnedCard } from "@/lib/cards";
import { isUuid, jsonError, query } from "@/lib/db";

type RouteContext = { params: Promise<{ cardId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = isUuid(cardId) ? await getOwnedCard(cardId) : undefined;
  if (!card) return jsonError("Card not found", 404);
  let body: { message?: unknown; revealed?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) return jsonError("Message must be 1–2,000 characters");
  if (!hasAiProvider()) return jsonError("Sign in to Codex or Claude before asking the tutor", 409);
  const previous = await query<{ content: string }>("SELECT content FROM tutor_messages WHERE card_id = $1 AND role = 'tutor' ORDER BY created_at DESC LIMIT 6", [cardId]);
  let reply: string | undefined;
  try { reply = await tutorCard(card, body.revealed === true, message, previous.rows.reverse().map((row) => row.content), aiOptionsFromRequest(request)); }
  catch { return jsonError("The tutor could not respond. Check the configured AI provider or try again.", 502); }
  if (!reply) return jsonError("The tutor could not respond. Try again.", 502);
  await query("INSERT INTO tutor_messages(card_id, role, kind, content) VALUES ($1, 'student', 'question', $2), ($1, 'tutor', 'hint', $3)", [cardId, message, reply]);
  return Response.json({ reply });
}
