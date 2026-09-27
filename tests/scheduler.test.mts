import assert from "node:assert/strict";
import test from "node:test";
import { chooseProblemDifficulty, nextReview, shouldReuseDueProblem } from "../lib/scheduler.ts";

test("a failed attempt is due immediately and resets the successful streak", () => {
  const review = nextReview("could_not_solve", "uncertain", 4);
  assert.equal(review.intervalDays, 0);
  assert.equal(review.repetitions, 0);
});

test("uncertain feedback does not turn an easy self-rating into a long interval", () => {
  const review = nextReview("easy", "uncertain", 4);
  assert.equal(review.intervalDays, 2);
});

test("successful repeated practice gradually extends the interval", () => {
  const intervals = [0, 1, 2, 4].map((repetitions) => nextReview("okay", "correct", repetitions).intervalDays);
  assert.deepEqual(intervals, [1, 3, 7, 14]);
});

test("problem difficulty starts steady, eases after failure, and advances after sustained success", () => {
  assert.equal(chooseProblemDifficulty(), "okay");
  assert.equal(chooseProblemDifficulty({ lastRating: "could_not_solve", lastCorrectness: "uncertain", repetitions: 0 }), "easy");
  assert.equal(chooseProblemDifficulty({ lastRating: "easy", lastCorrectness: "correct", repetitions: 3 }), "hard");
  assert.equal(chooseProblemDifficulty({ lastRating: "hard", lastCorrectness: "correct", repetitions: 4 }), "okay");
  assert.equal(chooseProblemDifficulty({ lastRating: "okay", lastCorrectness: "partial", repetitions: 3 }), "okay");
  assert.equal(chooseProblemDifficulty({ lastRating: "okay", lastCorrectness: "incorrect", repetitions: 3 }), "easy");
});

test("only an unsolved due problem is repeated after a cooling period", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const failed = { rating: "could_not_solve", correctness: "uncertain", createdAt: "2026-09-27T11:00:00Z" };
  assert.equal(shouldReuseDueProblem("2026-09-27T11:00:00Z", failed, now), true);
  assert.equal(shouldReuseDueProblem("2026-09-27T13:00:00Z", failed, now), false);
  assert.equal(shouldReuseDueProblem("2026-09-27T11:00:00Z", { ...failed, createdAt: "2026-09-27T11:45:00Z" }, now), false);
  assert.equal(shouldReuseDueProblem("2026-09-27T11:00:00Z", { ...failed, rating: "okay", correctness: "correct" }, now), false);
  assert.equal(shouldReuseDueProblem("2026-09-27T11:00:00Z", null, now), false);
  assert.equal(shouldReuseDueProblem("invalid", failed, now), false);
});
