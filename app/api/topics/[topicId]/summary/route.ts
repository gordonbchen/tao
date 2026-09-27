import { aiOptionsFromRequest } from "@/lib/ai";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { summarizeTopic } from "@/lib/topic-summary";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  const topicResult = await query<{ id: string; name: string }>(`SELECT t.id, t.name FROM topics t JOIN subjects s ON s.id = t.subject_id
    WHERE t.id = $1 AND s.owner_id = $2`, [topicId, LOCAL_OWNER_ID]);
  const topic = topicResult.rows[0];
  if (!topic) return jsonError("Topic not found", 404);
  const sources = await query<{ filename: string; modelSummary: string; extractedText: string }>(`SELECT r.filename,
    r.model_summary AS "modelSummary", r.extracted_text AS "extractedText"
    FROM topic_resources tr JOIN resources r ON r.id = tr.resource_id
    WHERE tr.topic_id = $1 AND r.owner_id = $2 ORDER BY tr.linked_at, r.filename`, [topicId, LOCAL_OWNER_ID]);
  if (!sources.rows.length) return jsonError("Link a resource to this topic before creating its summary.", 422);

  try {
    await query("UPDATE topics SET summary_status = 'pending' WHERE id = $1", [topicId]);
    const generated = await summarizeTopic(topic.name, sources.rows.map((source) => ({ filename: source.filename, summary: source.modelSummary, extractedText: source.extractedText })), aiOptionsFromRequest(request));
    const saved = await query(`UPDATE topics SET coverage_summary = $2, summary_status = 'complete', summary_provider = $3,
      summary_model = $4 WHERE id = $1 RETURNING id, name, coverage_summary AS "coverageSummary", summary_status AS "summaryStatus",
      summary_provider AS "summaryProvider", summary_model AS "summaryModel"`, [topicId, generated.summary, generated.provider, generated.model]);
    return Response.json(saved.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not summarize this topic";
    const noProvider = /no ai provider configured|codex is unavailable|codex is not signed in/i.test(message);
    await query("UPDATE topics SET summary_status = $2 WHERE id = $1", [topicId, noProvider ? "not_generated" : "failed"]);
    return jsonError(noProvider ? "Connect the local Codex sidecar to create a topic summary." : message, noProvider ? 503 : 502);
  }
}
