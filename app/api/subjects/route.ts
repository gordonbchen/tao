import { LOCAL_OWNER_ID, jsonError, query } from "@/lib/db";

export async function GET() {
  const result = await query(`SELECT s.id, s.name, s.created_at AS "createdAt",
    count(DISTINCT t.id)::int AS "topicCount",
    count(DISTINCT t.id) FILTER (WHERE coalesce(r.due_at, now()) <= now())::int AS "dueCount"
    FROM subjects s LEFT JOIN topics t ON t.subject_id = s.id
    LEFT JOIN topic_reviews r ON r.topic_id = t.id
    WHERE s.owner_id = $1 GROUP BY s.id ORDER BY s.created_at`, [LOCAL_OWNER_ID]);
  return Response.json(result.rows);
}

export async function POST(request: Request) {
  let body: { name?: string };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return jsonError("Subject name must be 1–120 characters");
  const result = await query(`INSERT INTO subjects(owner_id, name) VALUES ($1, $2)
    RETURNING id, name, created_at AS "createdAt"`, [LOCAL_OWNER_ID, name]);
  return Response.json({ ...result.rows[0], topicCount: 0, dueCount: 0 }, { status: 201 });
}
