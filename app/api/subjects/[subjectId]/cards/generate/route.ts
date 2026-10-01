import { aiOptionsFromRequest, withDisconnect, CARD_DENSITIES, type CardDensity, generateCards, hasAiProvider, isAiSetupError, MAX_INSTRUCTIONS } from "@/lib/ai";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { frontKey } from "@/lib/flashcards";
import { topicExcerpts } from "@/lib/practice";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Drafts cards for one topic at the chosen `density`, with figures when `diagrams` is true and following the student's
// `instructions`. `avoidFronts` are drafts other topics have written in the same run. The reply is one JSON object per line: each `card` as soon as the model finishes it, then `done`
// with the metadata, or `error`. Unsaved drafts are lost with the page, so leaving it also stops the model. Nothing is
// saved until the student keeps them from the preview.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  if (!hasAiProvider()) return jsonError("Sign in to an AI account before generating cards", 409);
  let body: { topicId?: unknown; count?: unknown; diagrams?: unknown; density?: unknown; instructions?: unknown; avoidFronts?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (typeof body.topicId !== "string" || !isUuid(body.topicId)) return jsonError("Choose a topic", 404);
  // "auto" lets the model decide how many the material needs.
  const count = body.count === "auto" ? undefined : typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 1 && body.count <= 30 ? body.count : 10;
  const density: CardDensity = CARD_DENSITIES.find((value) => value === body.density) ?? "standard";
  if (body.instructions !== undefined && (typeof body.instructions !== "string" || body.instructions.length > MAX_INSTRUCTIONS)) return jsonError(`instructions must be text of at most ${MAX_INSTRUCTIONS} characters`);
  const instructions = (body.instructions as string | undefined)?.trim() || undefined;
  const avoidFronts = Array.isArray(body.avoidFronts) ? body.avoidFronts.filter((front): front is string => typeof front === "string").slice(0, 300) : [];
  const topicResult = await query<{ id: string; name: string; coverageSummary: string; subject: string; }>(`SELECT t.id, t.name, t.coverage_summary AS "coverageSummary", s.name AS subject
    FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = $1 AND s.id = $2 AND s.owner_id = $3`, [body.topicId, subjectId, LOCAL_OWNER_ID]);
  const topic = topicResult.rows[0];
  if (!topic) return jsonError("Topic not found", 404);
  // Topics that share a resource with this one, and the cards already written on those resources, so each idea gets
  // one card under the topic it belongs to.
  const sharing = `SELECT DISTINCT b.topic_id FROM topic_resources a JOIN topic_resources b ON b.resource_id = a.resource_id AND b.topic_id <> a.topic_id WHERE a.topic_id = $1`;
  const [{ excerpts }, others, existing] = await Promise.all([
    topicExcerpts(subjectId, topic),
    query<{ name: string; about: string }>(`SELECT name, CASE WHEN brief <> '' THEN brief ELSE left(coverage_summary, 300) END AS about
      FROM topics WHERE id IN (${sharing}) ORDER BY position LIMIT 40`, [topic.id]),
    query<{ front: string }>(`SELECT front FROM cards WHERE subject_id = $2 AND (topic_id = $1 OR topic_id IN (${sharing})) ORDER BY created_at DESC LIMIT 400`, [topic.id, subjectId]),
  ]);
  const existingFronts = [...avoidFronts, ...existing.rows.map((row) => row.front)].map((front) => front.slice(0, 160));
  // Catches repeats the model still writes word for word.
  const seen = new Set(existingFronts.map(frontKey));
  const aiOptions = withDisconnect(aiOptionsFromRequest(request), request);
  const stopped = new AbortController();
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const line = (value: object) => { if (!stopped.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
      try {
        const generated = await generateCards({ subject: topic.subject, topic: topic.name, coverageSummary: topic.coverageSummary, excerpts,
          otherTopics: others.rows, existingFronts, count }, { ...aiOptions, signal: AbortSignal.any([aiOptions.signal!, stopped.signal]) },
          { diagrams: body.diagrams === true, density, instructions, onCard: (card) => {
            const key = frontKey(card.front);
            if (!seen.has(key)) { seen.add(key); line({ card }); }
          } });
        line({ done: true, metadata: { provider: generated.provider, model: generated.model, ...(instructions ? { instructions } : {}) } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate cards";
        line({ error: isAiSetupError(message) ? "Sign in to an AI account to generate cards." : message });
      }
      if (!stopped.signal.aborted) controller.close();
    },
    // The page stopped reading, so stop the model too.
    cancel() { stopped.abort(); },
  }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
