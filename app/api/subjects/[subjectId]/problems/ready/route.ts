import { after } from "next/server";
import { aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { prepareReadyProblem } from "@/lib/practice";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Starts generating a practice problem for the selection (one topic, a folder, or any) if none is waiting.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to Codex or Claude before practicing", 409);
  let body: { topicId?: unknown; groupId?: unknown } = {};
  try { body = await request.json(); } catch {}
  if (body.topicId !== undefined && (typeof body.topicId !== "string" || !isUuid(body.topicId))) return jsonError("Topic not found", 404);
  if (body.groupId !== undefined && (typeof body.groupId !== "string" || !isUuid(body.groupId))) return jsonError("Folder not found", 404);
  const aiOptions = aiOptionsFromRequest(request);
  const selection = body.topicId ? { topicId: body.topicId as string } : body.groupId ? { groupId: body.groupId as string } : {};
  after(() => prepareReadyProblem(subjectId, aiOptions, selection));
  return new Response(null, { status: 202 });
}
