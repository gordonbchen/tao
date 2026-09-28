import { generateProblem, type AiOptions } from "@/lib/ai";
import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { isNearDuplicatePrompt } from "@/lib/problem-quality";
import { chooseProblemDifficulty } from "@/lib/scheduler";
import { subtreeCte } from "@/lib/topic-groups";

export type PracticeTopic = { id: string; name: string; coverageSummary: string };
type ServedProblem = { id: string; topicId: string; topicName: string; prompt: string; difficulty: string; sourceRefs: string[]; createdAt: Date };
// What the student chose to practice: one topic, every topic in a folder, or any topic when both are omitted.
export type PracticeSelection = { topicId?: string; groupId?: string };
type Review = { lastRating: string | null; lastCorrectness: string | null; repetitions: number; dueAt: Date };
const problemColumns = `p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty, p.source_refs AS "sourceRefs", p.created_at AS "createdAt"`;

// Matches problems or topics (`t`) inside the selection; `$1` is the folder ID and `$3` the topic ID.
const inSelection = `($1::uuid IS NULL OR t.group_id IN (SELECT id FROM subtree)) AND ($3::uuid IS NULL OR t.id = $3)`;

// Picks the requested topic, or the most due confirmed topic in the selection, preferring one other than `avoidTopicId`.
export async function pickTopic(subjectId: string, { topicId, groupId, avoidTopicId }: PracticeSelection & { avoidTopicId?: string } = {}) {
  const result = await query<PracticeTopic>(`${subtreeCte} SELECT t.id, t.name, t.coverage_summary AS "coverageSummary"
    FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id
    WHERE t.subject_id = $2 AND t.coverage_confirmed = true AND ${inSelection}
    ORDER BY t.id = $4, coalesce(r.due_at, now()), t.created_at LIMIT 1`, [groupId ?? null, subjectId, topicId ?? null, avoidTopicId ?? null]);
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

// Serves the subject's waiting problem if it matches the selection.
export async function takeReadyProblem(subjectId: string, { topicId, groupId }: PracticeSelection = {}) {
  const result = await query<ServedProblem>(`${subtreeCte} UPDATE problems p SET served_at = now() FROM topics t
    WHERE p.id = (SELECT r.id FROM problems r JOIN topics t ON t.id = r.topic_id AND t.coverage_confirmed
      WHERE r.subject_id = $2 AND r.served_at IS NULL AND ${inSelection}
      ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED)
      AND t.id = p.topic_id
    RETURNING ${problemColumns}`, [groupId ?? null, subjectId, topicId ?? null]);
  return result.rows[0] ?? null;
}

// The most recently served problem in the selection that the student left without answering or skipping,
// with its tutor chat, so Practice returns to it instead of generating another.
export async function findUnfinishedProblem(subjectId: string, { topicId, groupId }: PracticeSelection = {}) {
  const result = await query<ServedProblem>(`${subtreeCte} SELECT ${problemColumns} FROM problems p
    JOIN topics t ON t.id = p.topic_id AND t.coverage_confirmed
    WHERE p.subject_id = $2 AND p.served_at IS NOT NULL AND ${inSelection}
      AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.problem_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM problem_feedback f WHERE f.problem_id = p.id AND f.skipped)
    ORDER BY p.served_at DESC LIMIT 1`, [groupId ?? null, subjectId, topicId ?? null]);
  const problem = result.rows[0];
  if (!problem) return null;
  const messages = await query<{ role: "user" | "assistant"; text: string }>(`SELECT CASE WHEN role = 'student' THEN 'user' ELSE 'assistant' END AS role,
    content AS text FROM tutor_messages WHERE problem_id = $1 AND kind IN ('question', 'hint') ORDER BY created_at`, [problem.id]);
  return { ...problem, messages: messages.rows };
}

// Keeps one generated problem waiting for each practice selection (any topic, a folder, or one topic) so
// Practice opens immediately. It is stored, so it carries over between visits instead of being regenerated.
const preparing: Map<string, Promise<void>> = ((globalThis as { taoReadyProblemPreparations?: Map<string, Promise<void>> }).taoReadyProblemPreparations ??= new Map());
const preparingKey = (subjectId: string, { topicId, groupId }: PracticeSelection) => `${subjectId}:${topicId ?? (groupId ? `group:${groupId}` : "any")}`;

export function prepareReadyProblem(subjectId: string, aiOptions: AiOptions, selection: PracticeSelection & { avoidTopicId?: string } = {}) {
  const { topicId, groupId } = selection;
  const key = preparingKey(subjectId, selection);
  const running = preparing.get(key);
  if (running) return running;
  const work = (async () => {
    await query(`DELETE FROM problems WHERE subject_id = $1 AND served_at IS NULL AND topic_id IS NULL`, [subjectId]);
    const waiting = await query(`${subtreeCte} SELECT 1 FROM problems p JOIN topics t ON t.id = p.topic_id AND t.coverage_confirmed
      WHERE p.subject_id = $2 AND p.served_at IS NULL AND ${inSelection} LIMIT 1`, [groupId ?? null, subjectId, topicId ?? null]);
    if (waiting.rowCount) return;
    const topic = await pickTopic(subjectId, selection);
    if (topic) await createProblem(subjectId, topic, aiOptions, { ready: true });
  })().catch((error) => {
    console.error("Could not prepare a practice problem", error instanceof Error ? error.message : error);
  }).finally(() => preparing.delete(key));
  preparing.set(key, work);
  return work;
}

// Serves a waiting problem, first letting an in-progress preparation for the same selection finish.
export async function takeOrAwaitReadyProblem(subjectId: string, selection: PracticeSelection) {
  const ready = await takeReadyProblem(subjectId, selection);
  if (ready) return ready;
  const running = preparing.get(preparingKey(subjectId, selection));
  if (!running) return null;
  await running;
  return takeReadyProblem(subjectId, selection);
}
