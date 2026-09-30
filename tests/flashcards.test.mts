import assert from "node:assert/strict";
import test from "node:test";
import { formatInterval, nextIntervals, reviewCard, type CardSchedule } from "../lib/flashcards.ts";

const now = new Date("2026-01-01T12:00:00Z");
const newCard: CardSchedule = { due: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null };

test("a new card rated Again returns within minutes and Easy graduates it for days", () => {
  const again = reviewCard(newCard, 1, now).schedule;
  const easy = reviewCard(newCard, 4, now).schedule;
  assert.ok(again.due.getTime() - now.getTime() <= 10 * 60_000);
  assert.equal(easy.state, 2);
  assert.ok(easy.due.getTime() - now.getTime() >= 24 * 60 * 60_000);
});

test("forgetting a review card counts a lapse and shortens its interval", () => {
  const learned = reviewCard(newCard, 4, now).schedule;
  const later = new Date(learned.due);
  const lapsed = reviewCard(learned, 1, later).schedule;
  const recalled = reviewCard(learned, 3, later).schedule;
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.due < recalled.due);
});

test("interval previews are ordered from Again to Easy", () => {
  const intervals = nextIntervals(newCard, now);
  assert.equal(intervals[1], "1m");
  assert.match(intervals[4], /d$/);
});

test("intervals are formatted in the largest sensible unit", () => {
  assert.equal(formatInterval(30_000), "1m");
  assert.equal(formatInterval(90 * 60_000), "2h");
  assert.equal(formatInterval(3 * 86_400_000), "3d");
  assert.equal(formatInterval(90 * 86_400_000), "3mo");
  assert.equal(formatInterval(500 * 86_400_000), "1.4y");
});
