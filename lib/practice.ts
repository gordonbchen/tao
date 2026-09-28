import { generateProblem, type AiOptions } from "@/lib/ai";
import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { isNearDuplicatePrompt } from "@/lib/problem-quality";
import { chooseProblemDifficulty } from "@/lib/scheduler";

export type PracticeTopic = { id: string; name: string; coverageSummary: string };
type ServedProblem = { id: string; topicId: string; topicName: string; prompt: string; difficulty: string; sourceRefs: string[]; createdAt: Date };
type Review = { lastRating: string | null; lastCorrectness: string | null; repetitions: number; dueAt: Date };
const problemColumns = `p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty, p.source_refs AS "sourceRefs", p.created_at AS "createdAt"`;

// Picks the requested topic, or the most due confirmed topic, preferring one other than `avoidTopicId`.
export async function pickTopic(subjectId: string, { topicId, avoidTopicId }: { topicId?: string; avoidTopicId?: string } = {}) {
  const result = topicId
    ? await query<PracticeTopic>(`SELECT id, name, coverage_summary AS "coverageSummary" FROM topics WHERE id = $1 AND subject_id = $2 AND coverage_confirmed = true`, [topicId, subjectId])
    : await query<PracticeTopic>(`SELECT t.id, t.name, t.coverage_summary AS "coverageSummary" FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id
      WHERE t.subject_id = $1 AND t.coverage_confirmed = true ORDER BY t.id = $2, coalesce(r.due_at, now()), t.created_at LIMIT 1`, [subjectId, avoidTopicId ?? null]);
  return result.rows[0] ?? null;
}

export async function topicReview(topicId: string) {
  const result = await query<Review>(`SELECT last_rating AS "lastRating", last_correctness AS "lastCorrectness", repetitions, due_at AS "dueAt"
    FROM topic_reviews WHERE topic_id = $1`, [topicId]);
  return result.rows[0];
}

// Generates and stores a problem. Ready problems stay unserved until `takeReadyProblem` hands them out.
export async function createProblem(subjectId: string, topic: PracticeTopic, aiOptions: AiOptions, { ready = false } = {}) {
  const subject = await query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  const difficulty = chooseProblemDifficulty(await topicReview(topic.id));
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
  const context = { subject: subject.rows[0].name, topic: topic.name, coverageSummary: topic.coverageSummary, difficulty, excerpts, recentPrompts, recentFeedback };
  let generated = await generateProblem(context, aiOptions);
  if (isNearDuplicatePrompt(generated.prompt, recentPrompts)) {
    const avoidPrompts = [generated.prompt, ...recentPrompts].slice(0, 6);
    generated = await generateProblem({ ...context, recentPrompts: avoidPrompts }, aiOptions);
    if (isNearDuplicatePrompt(generated.prompt, avoidPrompts)) throw new Error("The tutor repeated a recent problem. Try again for a different question.");
  }
  const allowedSources = new Set(resourceResult.rows.map((resource) => resource.filename));
  const sourceRefs = generated.sourceRefs.filter((source) => allowedSources.has(source));
  const result = await query<Omit<ServedProblem, "topicName">>(`INSERT INTO problems(subject_id, topic_id, prompt, solution, hints, difficulty, source_refs, generation_metadata, served_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, CASE WHEN $9 THEN NULL ELSE now() END)
    RETURNING id, topic_id AS "topicId", prompt, difficulty, source_refs AS "sourceRefs", created_at AS "createdAt"`,
  [subjectId, topic.id, generated.prompt, generated.solution, JSON.stringify(generated.hints), difficulty, JSON.stringify(sourceRefs), JSON.stringify({ provider: generated.provider, model: generated.model }), ready]);
  return { ...result.rows[0], topicName: topic.name } satisfies ServedProblem;
}

// Serves the subject's waiting problem if it matches the requested topic (any topic when omitted).
export async function takeReadyProblem(subjectId: string, topicId?: string) {
  const result = await query<ServedProblem>(`UPDATE problems p SET served_at = now() FROM topics t
    WHERE p.id = (SELECT r.id FROM problems r JOIN topics rt ON rt.id = r.topic_id AND rt.coverage_confirmed
      WHERE r.subject_id = $1 AND r.served_at IS NULL AND ($2::uuid IS NULL OR r.topic_id = $2)
      ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED)
      AND t.id = p.topic_id
    RETURNING ${problemColumns}`, [subjectId, topicId ?? null]);
  return result.rows[0] ?? null;
}

// Keeps one generated problem waiting for each practice selection (any topic, or one topic) so
// Practice opens immediately. It is stored, so it carries over between visits instead of being regenerated.
const preparing: Map<string, Promise<void>> = ((globalThis as { taoReadyProblemPreparations?: Map<string, Promise<void>> }).taoReadyProblemPreparations ??= new Map());
const preparingKey = (subjectId: string, topicId?: string) => `${subjectId}:${topicId ?? "any"}`;

export function prepareReadyProblem(subjectId: string, aiOptions: AiOptions, { topicId, avoidTopicId }: { topicId?: string; avoidTopicId?: string } = {}) {
  const key = preparingKey(subjectId, topicId);
  const running = preparing.get(key);
  if (running) return running;
  const work = (async () => {
    await query(`DELETE FROM problems WHERE subject_id = $1 AND served_at IS NULL AND topic_id IS NULL`, [subjectId]);
    const waiting = await query(`SELECT 1 FROM problems p JOIN topics t ON t.id = p.topic_id AND t.coverage_confirmed
      WHERE p.subject_id = $1 AND p.served_at IS NULL AND ($2::uuid IS NULL OR p.topic_id = $2) LIMIT 1`, [subjectId, topicId ?? null]);
    if (waiting.rowCount) return;
    const topic = await pickTopic(subjectId, { topicId, avoidTopicId });
    if (topic) await createProblem(subjectId, topic, aiOptions, { ready: true });
  })().catch((error) => {
    console.error("Could not prepare a practice problem", error instanceof Error ? error.message : error);
  }).finally(() => preparing.delete(key));
  preparing.set(key, work);
  return work;
}

// Serves a waiting problem, first letting an in-progress preparation for the same selection finish.
export async function takeOrAwaitReadyProblem(subjectId: string, topicId?: string) {
  const ready = await takeReadyProblem(subjectId, topicId);
  if (ready) return ready;
  const running = preparing.get(preparingKey(subjectId, topicId));
  if (!running) return null;
  await running;
  return takeReadyProblem(subjectId, topicId);
}
