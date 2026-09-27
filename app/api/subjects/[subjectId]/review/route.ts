import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const result = await query(`SELECT t.id AS "topicId", t.name, coalesce(r.due_at, now()) AS "dueAt",
    coalesce(r.interval_days, 0) AS "intervalDays", coalesce(r.repetitions, 0) AS repetitions,
    r.last_rating AS "lastRating", r.last_correctness AS "lastCorrectness"
    FROM topics t JOIN subjects s ON s.id = t.subject_id LEFT JOIN topic_reviews r ON r.topic_id = t.id
    WHERE t.subject_id = $1 AND s.owner_id = $2 AND t.coverage_confirmed = true
    AND coalesce(r.due_at, now()) <= now() ORDER BY coalesce(r.due_at, now()), t.created_at`, [subjectId, LOCAL_OWNER_ID]);
  const dueTopics = result.rows.map((topic) => ({ ...topic, reason: topic.lastRating === "hard" || topic.lastRating === "could_not_solve" || topic.lastCorrectness === "incorrect" ? "Needs another try" : topic.repetitions === 0 ? "Ready for a first review" : "Scheduled for review" }));
  return Response.json({ dueTopics, totalDue: dueTopics.length });
}
