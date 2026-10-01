import { aiOptionsFromRequest, hasAiProvider, MAX_INSTRUCTIONS, PROBLEM_DEPTHS, type ProblemDepth } from "@/lib/ai";
import { isUuid, jsonError, query, uuidList } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { createProblem, listProblems, pickTopic, topicReview } from "@/lib/practice";
import { shouldReuseDueProblem, type ProblemDifficulty } from "@/lib/scheduler";
import { selectionFromBody, selectionFromSearch } from "@/lib/selection";
type RouteContext = { params: Promise<{ subjectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const selection = selectionFromSearch(new URL(request.url).searchParams);
  if (typeof selection === "string") return jsonError(selection);
  return Response.json({ problems: await listProblems(subjectId, selection) });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  if (!hasAiProvider()) return jsonError("Sign in to an AI account before practicing", 409);
  let body: { topicIds?: unknown; groupIds?: unknown; skipReuse?: unknown; difficulty?: unknown; answerDepth?: unknown; instructions?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.skipReuse !== undefined && typeof body.skipReuse !== "boolean") return jsonError("skipReuse must be a boolean");
  const difficulty = body.difficulty ?? "auto";
  if (!["auto", "easy", "okay", "hard"].includes(difficulty as string)) return jsonError("difficulty must be auto, easy, okay, or hard");
  const answerDepth = body.answerDepth ?? "standard";
  if (!PROBLEM_DEPTHS.includes(answerDepth as ProblemDepth)) return jsonError(`answerDepth must be one of ${PROBLEM_DEPTHS.join(", ")}`);
  if (body.instructions !== undefined && (typeof body.instructions !== "string" || body.instructions.length > MAX_INSTRUCTIONS)) return jsonError(`instructions must be text of at most ${MAX_INSTRUCTIONS} characters`);
  const instructions = (body.instructions as string | undefined)?.trim() || undefined;
  const selection = selectionFromBody(body);
  if (typeof selection === "string") return jsonError(selection);
  const topic = await pickTopic(subjectId, selection);
  if (!topic) return jsonError("Add and confirm at least one covered topic before generating practice", 409);
  const lastAttemptResult = await query<{ id: string; topicId: string; topicName: string; prompt: string; difficulty: string; sourceRefs: string[]; diagram: unknown; createdAt: Date; lastAttemptAt: Date; rating: string; correctness: string }>(
    `SELECT p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty,
      p.source_refs AS "sourceRefs", p.diagram, p.created_at AS "createdAt", latest.rating, latest.correctness, latest.created_at AS "lastAttemptAt"
     FROM problems p JOIN topics t ON t.id = p.topic_id
     JOIN LATERAL (SELECT a.rating, a.correctness, a.created_at FROM attempts a WHERE a.problem_id = p.id
       ORDER BY a.created_at DESC LIMIT 1) latest ON true
     WHERE p.subject_id = $1 AND p.topic_id = $2 AND p.archived_at IS NULL
       AND (latest.rating = 'could_not_solve' OR latest.correctness = 'incorrect')
     ORDER BY latest.created_at DESC LIMIT 1`,
    [subjectId, topic.id],
  );
  const lastAttempt = lastAttemptResult.rows[0];
  // With Auto difficulty and no request of their own, a due problem the student could not solve comes back before a new
  // one. skipReuse asks for a new one.
  if (difficulty === "auto" && !instructions && !body.skipReuse && shouldReuseDueProblem((await topicReview(topic.id))?.dueAt, lastAttempt && { ...lastAttempt, createdAt: lastAttempt.lastAttemptAt }, new Date())) {
    return Response.json({ problem: {
      id: lastAttempt.id, topicId: lastAttempt.topicId, topicName: lastAttempt.topicName,
      prompt: lastAttempt.prompt, difficulty: lastAttempt.difficulty, sourceRefs: lastAttempt.sourceRefs,
      diagram: lastAttempt.diagram, createdAt: lastAttempt.createdAt, isReview: true,
    } });
  }
  try {
    const problem = await createProblem(subjectId, topic, aiOptions, { difficulty: difficulty === "auto" ? undefined : difficulty as ProblemDifficulty, answerDepth: answerDepth as ProblemDepth, instructions });
    return Response.json({ problem }, { status: 201 });
  } catch (error) {
    if (aiOptions.signal?.aborted) return jsonError("Request cancelled", 499);
    const message = error instanceof Error && error.message.startsWith("The tutor repeated") ? error.message : "The tutor could not generate a problem. Check the configured AI provider or try again.";
    return jsonError(message, 502);
  }
}

// Archives (`archived: true`) or restores the chosen problems, from Browse.
export async function PATCH(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { ids?: unknown; archived?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const ids = uuidList(body.ids, 2000);
  if (!ids || typeof body.archived !== "boolean") return jsonError("Choose up to 2,000 problems and whether to archive them");
  // An archived problem keeps its first archive time.
  await query(`UPDATE problems SET archived_at = CASE WHEN $3 THEN coalesce(archived_at, now()) END WHERE subject_id = $1 AND id = ANY($2::uuid[])`, [subjectId, ids, body.archived]);
  return new Response(null, { status: 204 });
}

// Deletes the chosen problems with their attempts, feedback, and chats.
export async function DELETE(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { ids?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const ids = uuidList(body.ids, 2000);
  if (!ids) return jsonError("Choose up to 2,000 problems to delete");
  await query("DELETE FROM problems WHERE subject_id = $1 AND id = ANY($2::uuid[])", [subjectId, ids]);
  return new Response(null, { status: 204 });
}
