export function nextReview(rating: string, correctness: string, repetitions: number) {
  if (rating === "could_not_solve" || correctness === "incorrect") return { intervalDays: 0, repetitions: 0, reason: "Needs another try" };
  if (rating === "hard" || correctness === "partial" || correctness === "uncertain") return { intervalDays: repetitions < 2 ? 1 : 2, repetitions: repetitions + 1, reason: "Review soon: this topic felt challenging" };
  const intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 3 : repetitions < 4 ? 7 : 14;
  return { intervalDays, repetitions: repetitions + 1, reason: rating === "easy" ? "Extend the interval after an easy review" : "Review interval increased after a steady review" };
}

export type ProblemDifficulty = "easy" | "okay" | "hard";

export function chooseProblemDifficulty(review?: { lastRating: string | null; lastCorrectness: string | null; repetitions: number }): ProblemDifficulty {
  if (!review) return "okay";
  if (review.lastCorrectness === "incorrect" || review.lastRating === "could_not_solve" || review.lastRating === "hard") return "easy";
  if (review.lastCorrectness === "partial") return "okay";
  if (review.repetitions >= 2 && review.lastRating === "easy") return "hard";
  if (review.repetitions >= 3 && review.lastCorrectness === "correct") return "hard";
  return "okay";
}
