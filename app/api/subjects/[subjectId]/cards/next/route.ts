import { cardCounts, nextCard } from "@/lib/cards";
import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { nextIntervals } from "@/lib/flashcards";
import { chatMessages } from "@/lib/practice";
import { selectionFromSearch } from "@/lib/selection";

type RouteContext = { params: Promise<{ subjectId: string }> };

// The next card to review in the selection, with its rating intervals and tutor chat, plus the due counts.
export async function GET(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const search = new URL(request.url).searchParams;
  const selection = selectionFromSearch(search);
  if (typeof selection === "string") return jsonError(selection);
  // `exclude` skips a card whose deletion is waiting on the undo toast.
  const exclude = search.get("exclude");
  if (exclude !== null && !isUuid(exclude)) return jsonError("Card not found", 404);
  const [card, counts] = await Promise.all([nextCard(subjectId, selection, exclude), cardCounts(subjectId, selection)]);
  return Response.json({
    counts,
    card: card && { id: card.id, topicId: card.topicId, topicName: card.topicName, front: card.front, back: card.back, state: card.state,
      intervals: nextIntervals(card), messages: await chatMessages({ cardId: card.id }) },
  });
}
