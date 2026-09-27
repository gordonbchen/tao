import { aiOptionsFromRequest, generateProblem, hasAiProvider } from "@/lib/ai";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { isNearDuplicatePrompt } from "@/lib/problem-quality";
import { chooseProblemDifficulty, shouldReuseDueProblem } from "@/lib/scheduler";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const limitValue = Number(new URL(request.url).searchParams.get("limit") || 20);
  const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? Math.floor(limitValue) : 20, 50));
  const result = await query(`SELECT p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt,
    p.difficulty, p.source_refs AS "sourceRefs", p.created_at AS "createdAt",
    (SELECT count(*)::int FROM attempts a WHERE a.problem_id = p.id) AS "attemptCount"
    FROM problems p LEFT JOIN topics t ON t.id = p.topic_id
    WHERE p.subject_id = $1 ORDER BY p.created_at DESC LIMIT $2`, [subjectId, limit]);
  return Response.json({ problems: result.rows });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  if (!hasAiProvider()) return jsonError("Start Codex in Settings before practicing", 409);
  let body: { topicId?: string; skipReuse?: boolean };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.topicId !== undefined && (typeof body.topicId !== "string" || !isUuid(body.topicId))) return jsonError("Topic not found", 404);
  if (body.skipReuse !== undefined && typeof body.skipReuse !== "boolean") return jsonError("skipReuse must be a boolean");
  const subject = await query<{ id: string; name: string }>("SELECT id, name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  const topicResult = body.topicId
    ? await query<{ id: string; name: string; coverageSummary: string }>("SELECT id, name, coverage_summary AS \"coverageSummary\" FROM topics WHERE id = $1 AND subject_id = $2 AND coverage_confirmed = true", [body.topicId, subjectId])
    : await query<{ id: string; name: string; coverageSummary: string }>(`SELECT t.id, t.name, t.coverage_summary AS "coverageSummary" FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id
      WHERE t.subject_id = $1 AND t.coverage_confirmed = true ORDER BY coalesce(r.due_at, now()), t.created_at LIMIT 1`, [subjectId]);
  if (!topicResult.rows[0]) return jsonError("Add and confirm at least one covered topic before generating practice", 409);
  const topic = topicResult.rows[0];
  const reviewResult = await query<{ lastRating: string | null; lastCorrectness: string | null; repetitions: number; dueAt: Date }>(
    `SELECT last_rating AS "lastRating", last_correctness AS "lastCorrectness", repetitions, due_at AS "dueAt" FROM topic_reviews WHERE topic_id = $1`,
    [topic.id],
  );
  const lastAttemptResult = await query<{ id: string; topicId: string; topicName: string; prompt: string; difficulty: string; sourceRefs: string[]; createdAt: Date; lastAttemptAt: Date; rating: string; correctness: string }>(
    `SELECT p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty,
      p.source_refs AS "sourceRefs", p.created_at AS "createdAt", latest.rating, latest.correctness, latest.created_at AS "lastAttemptAt"
     FROM problems p JOIN topics t ON t.id = p.topic_id
     JOIN LATERAL (SELECT a.rating, a.correctness, a.created_at FROM attempts a WHERE a.problem_id = p.id
       ORDER BY a.created_at DESC LIMIT 1) latest ON true
     WHERE p.subject_id = $1 AND p.topic_id = $2
       AND (latest.rating = 'could_not_solve' OR latest.correctness = 'incorrect')
     ORDER BY latest.created_at DESC LIMIT 1`,
    [subjectId, topic.id],
  );
  const lastAttempt = lastAttemptResult.rows[0];
  if (!body.skipReuse && shouldReuseDueProblem(reviewResult.rows[0]?.dueAt, lastAttempt && { ...lastAttempt, createdAt: lastAttempt.lastAttemptAt }, new Date())) {
    return Response.json({ problem: {
      id: lastAttempt.id, topicId: lastAttempt.topicId, topicName: lastAttempt.topicName,
      prompt: lastAttempt.prompt, difficulty: lastAttempt.difficulty, sourceRefs: lastAttempt.sourceRefs,
      createdAt: lastAttempt.createdAt, isReview: true,
    } });
  }
  const difficulty = chooseProblemDifficulty(reviewResult.rows[0]);
  const resourceResult = await query<{ filename: string; modelSummary: string; excerpt: string }>(`SELECT r.filename, r.model_summary AS "modelSummary",
    CASE WHEN strpos(lower(r.extracted_text), lower($3::text)) > 0
      THEN substring(r.extracted_text FROM greatest(1, strpos(lower(r.extracted_text), lower($3::text)) - 700) FOR 3000)
      ELSE left(r.extracted_text, 3000) END AS excerpt
    FROM resources r LEFT JOIN topic_resources tr ON tr.resource_id = r.id AND tr.topic_id = $4
    WHERE r.subject_id = $1 AND r.owner_id = $2 AND (r.extracted_text <> '' OR r.model_summary <> '')
      AND ((EXISTS (SELECT 1 FROM topic_resources WHERE topic_id = $4) AND tr.topic_id = $4)
        OR NOT EXISTS (SELECT 1 FROM topic_resources WHERE topic_id = $4))
    ORDER BY CASE WHEN r.extracted_text ILIKE '%' || $3 || '%' THEN 0 ELSE 1 END, coalesce(tr.linked_at, r.created_at) DESC LIMIT 3`,
  [subjectId, LOCAL_OWNER_ID, topic.name, topic.id]);
  const excerpts = resourceResult.rows.map((resource) => `${resource.filename}${resource.modelSummary ? ` — resource summary: ${resource.modelSummary.slice(0, 1000)}` : ""}\nRelevant passage: ${resource.excerpt}`);
  const recentResult = await query<{ prompt: string }>(
    `SELECT prompt FROM problems WHERE subject_id = $1 AND topic_id = $2 ORDER BY created_at DESC LIMIT 5`,
    [subjectId, topic.id],
  );
  const recentPrompts = recentResult.rows.map((row) => row.prompt.slice(0, 1600));
  const topicFeedbackResult = await query<{ tags: string[]; note: string; skipped: boolean }>(
    `SELECT f.tags, f.note, f.skipped FROM problem_feedback f JOIN problems p ON p.id = f.problem_id
     WHERE p.subject_id = $1 AND p.topic_id = $2 ORDER BY f.created_at DESC LIMIT 3`,
    [subjectId, topic.id],
  );
  const subjectFeedbackResult = await query<{ tags: string[]; note: string; skipped: boolean }>(
    `SELECT f.tags, f.note, f.skipped FROM problem_feedback f JOIN problems p ON p.id = f.problem_id
     WHERE p.subject_id = $1 AND p.topic_id IS DISTINCT FROM $2 ORDER BY f.created_at DESC LIMIT 2`,
    [subjectId, topic.id],
  );
  const recentFeedback = [
    ...topicFeedbackResult.rows.map((row) => ({ ...row, note: row.note.slice(0, 650), scope: "this topic" as const })),
    ...subjectFeedbackResult.rows.map((row) => ({ ...row, note: row.note.slice(0, 350), scope: "this subject" as const })),
  ];
  try {
    const context = { subject: subject.rows[0].name, topic: topic.name, coverageSummary: topic.coverageSummary, difficulty, excerpts, recentPrompts, recentFeedback };
    let generated = await generateProblem(context, aiOptions);
    if (isNearDuplicatePrompt(generated.prompt, recentPrompts)) {
      const avoidPrompts = [generated.prompt, ...recentPrompts].slice(0, 6);
      generated = await generateProblem({ ...context, recentPrompts: avoidPrompts }, aiOptions);
      if (isNearDuplicatePrompt(generated.prompt, avoidPrompts)) return jsonError("The tutor repeated a recent problem. Try again for a different question.", 502);
    }
    const allowedSources = new Set(resourceResult.rows.map((resource) => resource.filename));
    const sourceRefs = generated.sourceRefs.filter((source) => allowedSources.has(source));
    const result = await query(`INSERT INTO problems(subject_id, topic_id, prompt, solution, hints, difficulty, source_refs, generation_metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb)
      RETURNING id, topic_id AS "topicId", prompt, difficulty, source_refs AS "sourceRefs", created_at AS "createdAt"`,
    [subjectId, topic.id, generated.prompt, generated.solution, JSON.stringify(generated.hints), difficulty, JSON.stringify(sourceRefs), JSON.stringify({ provider: generated.provider, model: generated.model })]);
    return Response.json({ problem: { ...result.rows[0], topicName: topic.name } }, { status: 201 });
  } catch {
    return jsonError("The tutor could not generate a problem. Check the configured AI provider or try again.", 502);
  }
}
