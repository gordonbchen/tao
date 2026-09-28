import { rm } from "node:fs/promises";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";
import { aiErrorResponse, aiOptionsFromRequest, isAiSetupError } from "@/lib/ai";
import { summarizeResource } from "@/lib/resource-summary";

type RouteContext = { params: Promise<{ resourceId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  const result = await query(`SELECT id, filename, extracted_text AS "extractedText", extraction_status AS "extractionStatus",
    model_summary AS "modelSummary", summary_status AS "summaryStatus", summary_provider AS "summaryProvider", summary_model AS "summaryModel"
    FROM resources WHERE id = $1 AND owner_id = $2`, [resourceId, LOCAL_OWNER_ID]);
  if (!result.rows[0]) return jsonError("Resource not found", 404);
  const topics = await query(`SELECT t.id, t.name FROM topic_resources tr JOIN topics t ON t.id = tr.topic_id
    JOIN subjects s ON s.id = t.subject_id WHERE tr.resource_id = $1 AND s.owner_id = $2 ORDER BY t.created_at`, [resourceId, LOCAL_OWNER_ID]);
  return Response.json({ ...result.rows[0], topics: topics.rows });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  const result = await query<{ filename: string; extractedText: string }>(
    `SELECT filename, extracted_text AS "extractedText" FROM resources WHERE id = $1 AND owner_id = $2`,
    [resourceId, LOCAL_OWNER_ID],
  );
  const resource = result.rows[0];
  if (!resource) return jsonError("Resource not found", 404);
  if (!resource.extractedText.trim()) return jsonError("This resource has no selectable text to summarize.", 422);

  try {
    await query(`UPDATE resources SET summary_status = 'pending' WHERE id = $1 AND owner_id = $2`, [resourceId, LOCAL_OWNER_ID]);
    const generated = await summarizeResource(resource.filename, resource.extractedText, aiOptionsFromRequest(request));
    const saved = await query(`UPDATE resources SET model_summary = $3, summary_status = 'complete', summary_provider = $4,
      summary_model = $5, brief = $6 WHERE id = $1 AND owner_id = $2
      RETURNING id, filename, extracted_text AS "extractedText", extraction_status AS "extractionStatus",
        model_summary AS "modelSummary", summary_status AS "summaryStatus", summary_provider AS "summaryProvider", summary_model AS "summaryModel"`,
    [resourceId, LOCAL_OWNER_ID, generated.summary, generated.provider, generated.model, generated.brief]);
    return saved.rows[0] ? Response.json(saved.rows[0]) : jsonError("Resource not found", 404);
  } catch (error) {
    const noProvider = isAiSetupError(error instanceof Error ? error.message : "");
    await query(`UPDATE resources SET summary_status = $3 WHERE id = $1 AND owner_id = $2`, [resourceId, LOCAL_OWNER_ID, noProvider ? "not_generated" : "failed"]);
    return aiErrorResponse(error, "create a resource summary");
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);

  const affected = await query<{ topic_id: string }>(
    `SELECT tr.topic_id FROM topic_resources tr JOIN topics t ON t.id = tr.topic_id
      JOIN subjects s ON s.id = t.subject_id WHERE tr.resource_id = $1 AND s.owner_id = $2`,
    [resourceId, LOCAL_OWNER_ID],
  );
  const result = await query<{ storagePath: string }>(
    `DELETE FROM resources WHERE id = $1 AND owner_id = $2 RETURNING storage_path AS "storagePath"`,
    [resourceId, LOCAL_OWNER_ID],
  );
  const resource = result.rows[0];
  if (!resource) return jsonError("Resource not found", 404);
  if (affected.rows.length) {
    await query(`UPDATE topics SET summary_status = 'not_generated', summary_provider = NULL, summary_model = NULL
      WHERE id = ANY($1::uuid[])`, [affected.rows.map(row => row.topic_id)]);
  }
  await rm(resource.storagePath, { force: true });
  return new Response(null, { status: 204 });
}
