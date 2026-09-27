export function nextReview(rating: string, correctness: string, repetitions: number) {
  if (rating === "could_not_solve" || correctness === "incorrect") return { intervalDays: 0, repetitions: 0, reason: "Needs another try" };
  if (rating === "hard" || correctness === "partial" || correctness === "uncertain") return { intervalDays: repetitions < 2 ? 1 : 2, repetitions: repetitions + 1, reason: "Review soon: this topic felt challenging" };
  const intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 3 : repetitions < 4 ? 7 : 14;
  return { intervalDays, repetitions: repetitions + 1, reason: rating === "easy" ? "Extend the interval after an easy review" : "Review interval increased after a steady review" };
}

export type ProblemDifficulty = "easy" | "okay" | "hard";

export function chooseProblemDifficulty(review?: { lastRating: string | null; lastCorrectness: string | null; repetitions: number }): ProblemDifficulty {
  if (!review) return "okay";
  if (review.lastCorrectness === "incorrect" || review.lastRating === "could_not_solve") return "easy";
  if (review.lastCorrectness === "partial" || review.lastCorrectness === "uncertain" || review.lastRating === "hard") return "okay";
  if (review.lastCorrectness === "correct" && review.lastRating === "easy" && review.repetitions >= 2) return "hard";
  if (review.lastCorrectness === "correct" && review.repetitions >= 4) return "hard";
  return "okay";
}

export function shouldReuseDueProblem(
  dueAt: Date | string | null | undefined,
  lastAttempt: { rating: string; correctness: string; createdAt?: Date | string } | null | undefined,
  now = new Date(),
  cooldownMs = 30 * 60 * 1000,
) {
  if (!dueAt || !lastAttempt) return false;
  const dueTime = dueAt instanceof Date ? dueAt.getTime() : Date.parse(dueAt);
  if (!Number.isFinite(dueTime) || dueTime > now.getTime()) return false;
  if (!lastAttempt.createdAt) return false;
  const attemptTime = lastAttempt.createdAt instanceof Date ? lastAttempt.createdAt.getTime() : Date.parse(lastAttempt.createdAt);
  if (!Number.isFinite(attemptTime) || now.getTime() - attemptTime < cooldownMs) return false;
  return lastAttempt.rating === "could_not_solve" || lastAttempt.correctness === "incorrect";
}
