import { LOCAL_OWNER_ID, query } from "@/lib/db";
import type { Diagram } from "@/lib/diagrams";
import type { CardSchedule } from "@/lib/flashcards";
import { inSelection, selectionCte, selectionParams, type Selection } from "@/lib/selection";

export type CardRow = CardSchedule & { id: string; topicId: string | null; topicName: string | null; front: string; back: string; frontDiagram: Diagram | null; backDiagram: Diagram | null };

const scheduleColumns = `c.due, c.stability, c.difficulty, c.elapsed_days AS "elapsedDays", c.scheduled_days AS "scheduledDays",
  c.learning_steps AS "learningSteps", c.reps, c.lapses, c.state, c.last_review AS "lastReview"`;
export const cardColumns = `c.id, c.topic_id AS "topicId", t.name AS "topicName", c.front, c.back,
  c.front_diagram AS "frontDiagram", c.back_diagram AS "backDiagram", ${scheduleColumns}`;

// Cards in the selection; an empty selection also includes cards without a topic.
const cardsInSelection = `${selectionCte} SELECT ${cardColumns} FROM cards c LEFT JOIN topics t ON t.id = c.topic_id
  WHERE c.subject_id = $2 AND ${inSelection}`;

// Cards to show now. Learning cards due within 20 minutes are shown early when nothing else is due, as Anki does.
const dueNow = "(c.due <= now() OR (c.state IN (1, 3) AND c.due <= now() + interval '20 minutes'))";

// The next card to review: due learning cards first, then due reviews, then new cards, oldest due first.
export async function nextCard(subjectId: string, selection: Selection, excludeId: string | null = null) {
  const result = await query<CardRow>(`${cardsInSelection}
    AND ${dueNow} AND c.id IS DISTINCT FROM $4
    ORDER BY c.due <= now() DESC, CASE c.state WHEN 0 THEN 2 WHEN 2 THEN 1 ELSE 0 END, c.due, c.created_at LIMIT 1`,
  [...selectionParams(subjectId, selection), excludeId]);
  return result.rows[0] ?? null;
}

// Counts due now by kind, like Anki's new / learning / review numbers, and when the next card after those is due.
export async function cardCounts(subjectId: string, selection: Selection) {
  const result = await query<{ new: number; learning: number; review: number; total: number; nextDue: Date | null }>(`${selectionCte}
    SELECT count(*) FILTER (WHERE c.state = 0 AND ${dueNow})::int AS new,
      count(*) FILTER (WHERE c.state IN (1, 3) AND ${dueNow})::int AS learning,
      count(*) FILTER (WHERE c.state = 2 AND ${dueNow})::int AS review,
      count(*)::int AS total,
      min(c.due) FILTER (WHERE NOT ${dueNow}) AS "nextDue"
    FROM cards c LEFT JOIN topics t ON t.id = c.topic_id WHERE c.subject_id = $2 AND ${inSelection}`, selectionParams(subjectId, selection));
  return result.rows[0];
}

export async function listCards(subjectId: string, selection: Selection) {
  const result = await query<CardRow>(`${cardsInSelection} ORDER BY c.created_at DESC, c.id LIMIT 5000`, selectionParams(subjectId, selection));
  return result.rows;
}

export async function getOwnedCard(cardId: string) {
  const result = await query<CardRow & { subjectId: string }>(`SELECT ${cardColumns}, c.subject_id AS "subjectId" FROM cards c
    JOIN subjects s ON s.id = c.subject_id LEFT JOIN topics t ON t.id = c.topic_id WHERE c.id = $1 AND s.owner_id = $2`, [cardId, LOCAL_OWNER_ID]);
  return result.rows[0];
}
