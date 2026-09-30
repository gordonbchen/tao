import { aiErrorResponse, aiOptionsFromRequest, generateCards, hasAiProvider } from "@/lib/ai";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { topicExcerpts } from "@/lib/practice";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Drafts cards for one topic, with figures when `diagrams` is true. Nothing is saved until the student keeps them from the preview.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to an AI account before generating cards", 409);
  let body: { topicId?: unknown; count?: unknown; diagrams?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (typeof body.topicId !== "string" || !isUuid(body.topicId)) return jsonError("Choose a topic", 404);
  // "auto" lets the model decide how many the material needs.
  const count = body.count === "auto" ? undefined : typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 1 && body.count <= 30 ? body.count : 10;
  const topicResult = await query<{ id: string; name: string; coverageSummary: string; subject: string; }>(`SELECT t.id, t.name, t.coverage_summary AS "coverageSummary", s.name AS subject
    FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = $1 AND s.id = $2 AND s.owner_id = $3`, [body.topicId, subjectId, LOCAL_OWNER_ID]);
  const topic = topicResult.rows[0];
  if (!topic) return jsonError("Topic not found", 404);
  const [{ excerpts }, existing] = await Promise.all([
    topicExcerpts(subjectId, topic),
    query<{ front: string }>("SELECT front FROM cards WHERE topic_id = $1 ORDER BY created_at DESC LIMIT 200", [topic.id]),
  ]);
  try {
    const generated = await generateCards({ subject: topic.subject, topic: topic.name, coverageSummary: topic.coverageSummary, excerpts,
      existingFronts: existing.rows.map((row) => row.front.slice(0, 200)), count }, aiOptionsFromRequest(request), body.diagrams === true);
    return Response.json({ cards: generated.cards, metadata: { provider: generated.provider, model: generated.model } });
  } catch (error) {
    return aiErrorResponse(error, "generate cards");
  }
}
