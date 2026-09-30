import { aiErrorResponse, aiOptionsFromRequest, isAiSetupError } from "@/lib/ai";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { summarizeTopic } from "@/lib/topic-summary";

type RouteContext = { params: Promise<{ topicId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { topicId } = await params;
  if (!isUuid(topicId)) return jsonError("Topic not found", 404);
  const topicResult = await query<{ id: string; name: string; coverageSummary: string; summaryStatus: string }>(`SELECT t.id, t.name, t.coverage_summary AS "coverageSummary",
    t.summary_status AS "summaryStatus" FROM topics t JOIN subjects s ON s.id = t.subject_id
    WHERE t.id = $1 AND s.owner_id = $2`, [topicId, LOCAL_OWNER_ID]);
  const topic = topicResult.rows[0];
  if (!topic) return jsonError("Topic not found", 404);
  const sources = await query<{ filename: string; modelSummary: string; extractedText: string }>(`SELECT r.filename,
    r.model_summary AS "modelSummary", r.extracted_text AS "extractedText"
    FROM topic_resources tr JOIN resources r ON r.id = tr.resource_id
    WHERE tr.topic_id = $1 AND r.owner_id = $2 ORDER BY tr.linked_at, r.filename`, [topicId, LOCAL_OWNER_ID]);
  if (!sources.rows.length) return jsonError("Link a resource to this topic before creating its summary.", 422);

  const aiOptions = aiOptionsFromRequest(request);
  try {
    await query("UPDATE topics SET summary_status = 'pending' WHERE id = $1", [topicId]);
    const generated = await summarizeTopic(topic.name, sources.rows.map((source) => ({ filename: source.filename, summary: source.modelSummary, extractedText: source.extractedText })), aiOptions, topic.coverageSummary);
    const saved = await query(`UPDATE topics SET coverage_summary = $2, summary_status = 'complete', summary_provider = $3,
      summary_model = $4, brief = $5 WHERE id = $1 RETURNING id, name, coverage_summary AS "coverageSummary", summary_status AS "summaryStatus",
      summary_provider AS "summaryProvider", summary_model AS "summaryModel"`, [topicId, generated.summary, generated.provider, generated.model, generated.brief]);
    return Response.json(saved.rows[0]);
  } catch (error) {
    const noProvider = isAiSetupError(error instanceof Error ? error.message : "");
    // A cancelled summary leaves the topic as it was.
    const status = aiOptions.signal?.aborted ? topic.summaryStatus : noProvider ? "not_generated" : "failed";
    await query("UPDATE topics SET summary_status = $2 WHERE id = $1", [topicId, status]);
    return aiErrorResponse(error, "create a topic summary");
  }
}
