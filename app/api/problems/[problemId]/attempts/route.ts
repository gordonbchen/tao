import { aiOptionsFromRequest, checkAnswer, hasAiProvider, type Correctness, type Rating } from "@/lib/ai";
import { LOCAL_OWNER_ID, isUuid, jsonError, query, transaction } from "@/lib/db";
import { nextReview } from "@/lib/domain";
type RouteContext = { params: Promise<{ problemId: string }> };
const ratings: Rating[] = ["easy", "okay", "hard", "could_not_solve"];

export async function POST(request: Request, { params }: RouteContext) {
  const { problemId } = await params;
  if (!isUuid(problemId)) return jsonError("Problem not found", 404);
  let body: { answer?: string; difficulty?: Rating };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.answer !== undefined && typeof body.answer !== "string") return jsonError("Answer must be text");
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const rating = body.difficulty;
  if (!answer || answer.length > 20_000) return jsonError("Answer must be between 1 and 20,000 characters");
  if (!rating || !ratings.includes(rating)) return jsonError("Choose easy, okay, hard, or could_not_solve");
  const problemResult = await query<{ prompt: string; solution: string; topicId: string | null }>(`SELECT p.prompt, p.solution, p.topic_id AS "topicId" FROM problems p
    JOIN subjects s ON s.id = p.subject_id WHERE p.id = $1 AND s.owner_id = $2`, [problemId, LOCAL_OWNER_ID]);
  const problem = problemResult.rows[0];
  if (!problem) return jsonError("Problem not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  if (!hasAiProvider()) return jsonError("Start Codex in Settings before checking answers", 409);
  let checked: { feedback: string; correctness: Correctness };
  try { checked = await checkAnswer(problem, answer, aiOptions); }
  catch { return jsonError("The tutor could not check this answer. Check the configured AI provider or try again.", 502); }
  const saved = await transaction(async (client) => {
    const attempt = await client.query(`INSERT INTO attempts(problem_id, answer, rating, correctness, feedback)
      VALUES ($1, $2, $3, $4, $5) RETURNING id, answer, rating AS difficulty, correctness, feedback, created_at AS "createdAt"`,
    [problemId, answer, rating, checked.correctness, checked.feedback]);
    let review = null;
    if (problem.topicId) {
      const current = await client.query<{ repetitions: number }>("SELECT repetitions FROM topic_reviews WHERE topic_id = $1 FOR UPDATE", [problem.topicId]);
      const updated = nextReview(rating, checked.correctness, current.rows[0]?.repetitions ?? 0);
      const dueAt = new Date(Date.now() + updated.intervalDays * 24 * 60 * 60 * 1000);
      await client.query(`INSERT INTO topic_reviews(topic_id, due_at, interval_days, repetitions, last_rating, last_correctness, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT(topic_id) DO UPDATE SET due_at = excluded.due_at, interval_days = excluded.interval_days,
          repetitions = excluded.repetitions, last_rating = excluded.last_rating, last_correctness = excluded.last_correctness, updated_at = now()`,
      [problem.topicId, dueAt, updated.intervalDays, updated.repetitions, rating, checked.correctness]);
      review = { ...updated, dueAt, reason: updated.reason };
    }
    await client.query("INSERT INTO tutor_messages(problem_id, role, kind, content) VALUES ($1, 'student', 'answer_check', $2)", [problemId, answer]);
    await client.query("INSERT INTO tutor_messages(problem_id, role, kind, content) VALUES ($1, 'tutor', 'answer_check', $2)", [problemId, checked.feedback]);
    return { attempt: attempt.rows[0], review };
  });
  return Response.json({ ...saved, feedback: saved.attempt.feedback, correctness: saved.attempt.correctness, solution: problem.solution });
}
