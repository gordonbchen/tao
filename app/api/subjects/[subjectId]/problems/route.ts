import { aiOptionsFromRequest, generateProblem, hasAiProvider } from "@/lib/ai";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { chooseProblemDifficulty } from "@/lib/scheduler";
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
  const apiKey = request.headers.get("x-openai-api-key")?.trim() || undefined;
  const aiOptions = aiOptionsFromRequest(request);
  if (!hasAiProvider(apiKey, aiOptions)) return jsonError("Configure an AI provider in Settings before practicing", 409);
  let body: { topicId?: string };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.topicId !== undefined && (typeof body.topicId !== "string" || !isUuid(body.topicId))) return jsonError("Topic not found", 404);
  const subject = await query<{ id: string; name: string }>("SELECT id, name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  const topicResult = body.topicId
    ? await query<{ id: string; name: string }>("SELECT id, name FROM topics WHERE id = $1 AND subject_id = $2 AND coverage_confirmed = true", [body.topicId, subjectId])
    : await query<{ id: string; name: string }>(`SELECT t.id, t.name FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id
      WHERE t.subject_id = $1 AND t.coverage_confirmed = true ORDER BY coalesce(r.due_at, now()), t.created_at LIMIT 1`, [subjectId]);
  if (!topicResult.rows[0]) return jsonError("Add and confirm at least one covered topic before generating practice", 409);
  const topic = topicResult.rows[0];
  const reviewResult = await query<{ lastRating: string | null; lastCorrectness: string | null; repetitions: number }>(
    `SELECT last_rating AS "lastRating", last_correctness AS "lastCorrectness", repetitions FROM topic_reviews WHERE topic_id = $1`,
    [topic.id],
  );
  const difficulty = chooseProblemDifficulty(reviewResult.rows[0]);
  const resourceResult = await query<{ filename: string; excerpt: string }>(`SELECT filename,
    CASE WHEN strpos(lower(extracted_text), lower($3::text)) > 0
      THEN substring(extracted_text FROM greatest(1, strpos(lower(extracted_text), lower($3::text)) - 700) FOR 3500)
      ELSE left(extracted_text, 3500) END AS excerpt FROM resources
    WHERE subject_id = $1 AND owner_id = $2 AND extracted_text <> ''
    ORDER BY CASE WHEN extracted_text ILIKE '%' || $3 || '%' THEN 0 ELSE 1 END, created_at DESC LIMIT 3`, [subjectId, LOCAL_OWNER_ID, topic.name]);
  const excerpts = resourceResult.rows.map((resource) => `${resource.filename}: ${resource.excerpt}`);
  try {
    const generated = await generateProblem({ subject: subject.rows[0].name, topic: topic.name, difficulty, excerpts }, apiKey, aiOptions);
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
