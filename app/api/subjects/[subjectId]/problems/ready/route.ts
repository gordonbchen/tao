import { after } from "next/server";
import { aiOptionsFromRequest, hasAiProvider } from "@/lib/ai";
import { isUuid, jsonError } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { prepareReadyProblem } from "@/lib/practice";
import { selectionFromBody } from "@/lib/selection";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Starts generating a practice problem for the selection (any topic, or chosen topics and folders) if none is waiting.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to an AI account before practicing", 409);
  let body: { topicIds?: unknown; groupIds?: unknown } = {};
  try { body = await request.json(); } catch {}
  const selection = selectionFromBody(body);
  if (typeof selection === "string") return jsonError(selection);
  const aiOptions = aiOptionsFromRequest(request);
  after(() => prepareReadyProblem(subjectId, aiOptions, selection));
  return new Response(null, { status: 202 });
}
