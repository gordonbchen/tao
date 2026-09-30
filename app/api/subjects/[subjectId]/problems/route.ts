import { after } from "next/server";
import { aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { isUuid, jsonError, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { createProblem, findUnfinishedProblem, listProblems, pickTopic, prepareReadyProblem, takeOrAwaitReadyProblem, topicReview } from "@/lib/practice";
import { shouldReuseDueProblem } from "@/lib/scheduler";
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
  let body: { topicIds?: unknown; groupIds?: unknown; skipReuse?: boolean };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (body.skipReuse !== undefined && typeof body.skipReuse !== "boolean") return jsonError("skipReuse must be a boolean");
  const selection = selectionFromBody(body);
  if (typeof selection === "string") return jsonError(selection);
  // Return to a problem the student opened but neither answered nor skipped. skipReuse asks for a new one.
  const unfinished = body.skipReuse ? null : await findUnfinishedProblem(subjectId, selection);
  if (unfinished) return Response.json({ problem: unfinished });
  const topic = await pickTopic(subjectId, selection);
  if (!topic) return jsonError("Add and confirm at least one covered topic before generating practice", 409);
  const lastAttemptResult = await query<{ id: string; topicId: string; topicName: string; prompt: string; difficulty: string; sourceRefs: string[]; diagram: unknown; createdAt: Date; lastAttemptAt: Date; rating: string; correctness: string }>(
    `SELECT p.id, p.topic_id AS "topicId", t.name AS "topicName", p.prompt, p.difficulty,
      p.source_refs AS "sourceRefs", p.diagram, p.created_at AS "createdAt", latest.rating, latest.correctness, latest.created_at AS "lastAttemptAt"
     FROM problems p JOIN topics t ON t.id = p.topic_id
     JOIN LATERAL (SELECT a.rating, a.correctness, a.created_at FROM attempts a WHERE a.problem_id = p.id
       ORDER BY a.created_at DESC LIMIT 1) latest ON true
     WHERE p.subject_id = $1 AND p.topic_id = $2
       AND (latest.rating = 'could_not_solve' OR latest.correctness = 'incorrect')
     ORDER BY latest.created_at DESC LIMIT 1`,
    [subjectId, topic.id],
  );
  const lastAttempt = lastAttemptResult.rows[0];
  if (!body.skipReuse && shouldReuseDueProblem((await topicReview(topic.id))?.dueAt, lastAttempt && { ...lastAttempt, createdAt: lastAttempt.lastAttemptAt }, new Date())) {
    return Response.json({ problem: {
      id: lastAttempt.id, topicId: lastAttempt.topicId, topicName: lastAttempt.topicName,
      prompt: lastAttempt.prompt, difficulty: lastAttempt.difficulty, sourceRefs: lastAttempt.sourceRefs,
      diagram: lastAttempt.diagram, createdAt: lastAttempt.createdAt, isReview: true,
    } });
  }
  try {
    const problem = await takeOrAwaitReadyProblem(subjectId, selection) ?? await createProblem(subjectId, topic, aiOptions);
    if (!problem) throw new Error("A problem served at once is always stored");
    // Prepare the next problem for the same selection while the student works on this one; across topics, prefer a different one.
    const singleTopic = selection.topicIds.length === 1 && !selection.groupIds.length;
    // Stopping this request does not stop that preparation.
    after(() => prepareReadyProblem(subjectId, { ...aiOptions, signal: undefined }, selection, singleTopic ? undefined : problem.topicId));
    return Response.json({ problem }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("The tutor repeated") ? error.message : "The tutor could not generate a problem. Check the configured AI provider or try again.";
    return jsonError(message, 502);
  }
}
