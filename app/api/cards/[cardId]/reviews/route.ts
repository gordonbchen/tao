import { getOwnedCard } from "@/lib/cards";
import { isUuid, jsonError, transaction } from "@/lib/db";
import { reviewCard, type CardRating } from "@/lib/flashcards";

type RouteContext = { params: Promise<{ cardId: string }> };

// Records a rating (1 Again, 2 Hard, 3 Good, 4 Easy) and moves the card to its next FSRS due date.
export async function POST(request: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = isUuid(cardId) ? await getOwnedCard(cardId) : undefined;
  if (!card) return jsonError("Card not found", 404);
  let body: { rating?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (![1, 2, 3, 4].includes(body.rating as number)) return jsonError("Rating must be 1 (Again) to 4 (Easy)");
  const rating = body.rating as CardRating;
  const { schedule, log } = reviewCard(card, rating);
  await transaction(async (client) => {
    await client.query(`UPDATE cards SET due = $2, stability = $3, difficulty = $4, elapsed_days = $5, scheduled_days = $6,
      learning_steps = $7, reps = $8, lapses = $9, state = $10, last_review = $11, updated_at = now() WHERE id = $1`,
    [cardId, schedule.due, schedule.stability, schedule.difficulty, schedule.elapsedDays, schedule.scheduledDays,
      schedule.learningSteps, schedule.reps, schedule.lapses, schedule.state, schedule.lastReview]);
    await client.query("INSERT INTO card_reviews(card_id, rating, log, reviewed_at) VALUES ($1, $2, $3::jsonb, $4)", [cardId, rating, JSON.stringify(log), log.review]);
  });
  return Response.json({ due: schedule.due });
}
