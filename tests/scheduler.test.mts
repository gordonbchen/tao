import assert from "node:assert/strict";
import test from "node:test";
import { chooseProblemDifficulty, nextReview } from "../lib/scheduler.ts";

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

test("problem difficulty starts steady and adapts to the last attempt", () => {
  assert.equal(chooseProblemDifficulty(), "okay");
  assert.equal(chooseProblemDifficulty({ lastRating: "could_not_solve", lastCorrectness: "uncertain", repetitions: 0 }), "easy");
  assert.equal(chooseProblemDifficulty({ lastRating: "easy", lastCorrectness: "correct", repetitions: 3 }), "hard");
});
