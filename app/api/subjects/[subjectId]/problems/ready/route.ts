import { after } from "next/server";
import { aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { prepareReadyProblem } from "@/lib/practice";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Starts generating a practice problem for the selection (one topic, or any) if none is waiting.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to Codex or Claude before practicing", 409);
  let body: { topicId?: unknown } = {};
  try { body = await request.json(); } catch {}
  if (body.topicId !== undefined && (typeof body.topicId !== "string" || !isUuid(body.topicId))) return jsonError("Topic not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  const topicId = body.topicId as string | undefined;
  after(() => prepareReadyProblem(subjectId, aiOptions, { topicId }));
  return new Response(null, { status: 202 });
}
