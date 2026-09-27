import { rm } from "node:fs/promises";
import { LOCAL_OWNER_ID, isUuid, jsonError, query } from "@/lib/db";

type RouteContext = { params: Promise<{ resourceId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);
  const result = await query(`SELECT id, filename, extracted_text AS "extractedText", extraction_status AS "extractionStatus"
    FROM resources WHERE id = $1 AND owner_id = $2`, [resourceId, LOCAL_OWNER_ID]);
  return result.rows[0] ? Response.json(result.rows[0]) : jsonError("Resource not found", 404);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { resourceId } = await params;
  if (!isUuid(resourceId)) return jsonError("Resource not found", 404);

  const result = await query<{ storagePath: string }>(
    `DELETE FROM resources WHERE id = $1 AND owner_id = $2 RETURNING storage_path AS "storagePath"`,
    [resourceId, LOCAL_OWNER_ID],
  );
  const resource = result.rows[0];
  if (!resource) return jsonError("Resource not found", 404);
  await rm(resource.storagePath, { force: true });
  return new Response(null, { status: 204 });
}
