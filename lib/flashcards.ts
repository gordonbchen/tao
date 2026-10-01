// FSRS scheduling for flashcards, kept free of database and AI code so it stays deterministic and testable.
import { fsrs, Rating, type Card, type Grade } from "ts-fsrs";

// Scheduling columns of a `cards` row, as the API reads them.
export type CardSchedule = {
  due: Date; stability: number; difficulty: number; elapsedDays: number; scheduledDays: number;
  learningSteps: number; reps: number; lapses: number; state: number; lastReview: Date | null;
};
export type CardRating = 1 | 2 | 3 | 4;
export const CARD_RATINGS: { value: CardRating; label: string }[] = [
  { value: Rating.Again, label: "Again" }, { value: Rating.Hard, label: "Hard" }, { value: Rating.Good, label: "Good" }, { value: Rating.Easy, label: "Easy" },
];

// Default FSRS parameters, 90% target retention, and fixed intervals (no fuzz) so a review is reproducible.
const scheduler = fsrs({ enable_fuzz: false });

const toCard = (row: CardSchedule): Card => ({
  due: row.due, stability: row.stability, difficulty: row.difficulty, elapsed_days: row.elapsedDays, scheduled_days: row.scheduledDays,
  learning_steps: row.learningSteps, reps: row.reps, lapses: row.lapses, state: row.state, last_review: row.lastReview ?? undefined,
});

const fromCard = (card: Card): CardSchedule => ({
  due: card.due, stability: card.stability, difficulty: card.difficulty, elapsedDays: card.elapsed_days, scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.last_review ?? null,
});

export function reviewCard(row: CardSchedule, rating: CardRating, now = new Date()) {
  const { card, log } = scheduler.next(toCard(row), now, rating as Grade);
  return { schedule: fromCard(card), log };
}

// How long until the card returns for each rating, formatted for the rating buttons.
export function nextIntervals(row: CardSchedule, now = new Date()) {
  const preview = scheduler.repeat(toCard(row), now);
  return Object.fromEntries(CARD_RATINGS.map(({ value }) => [value, formatInterval(preview[value as Grade].card.due.getTime() - now.getTime())])) as Record<CardRating, string>;
}

export function formatInterval(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 36.5) / 10}y`;
}

// What two card fronts share when they ask the same thing in the same words: case, punctuation, spacing, and leading
// filler such as "What is" or "Around when" are ignored.
export function frontKey(front: string) {
  return front.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(?:(?:around|approximately|about|roughly) )?(?:(?:what|when|which|who|how|why|where)(?: is| are| was| were| does| do| did)? )?/, "");
}
