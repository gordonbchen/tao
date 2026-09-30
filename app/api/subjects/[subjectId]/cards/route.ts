import { cleanDrafts, MAX_IMPORT_CARDS } from "@/lib/card-import";
import { cleanDiagram } from "@/lib/diagrams";
import { listCards } from "@/lib/cards";
import { isUuid, jsonError, query } from "@/lib/db";
import { getTopicInSubject, ownsSubject } from "@/lib/domain";
import { selectionFromSearch } from "@/lib/selection";

type RouteContext = { params: Promise<{ subjectId: string }> };
const sources = ["manual", "import", "ai"];

export async function GET(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const selection = selectionFromSearch(new URL(request.url).searchParams);
  if (typeof selection === "string") return jsonError(selection);
  return Response.json({ cards: await listCards(subjectId, selection) });
}

// Saves cards written by hand, imported, or generated and kept after preview. All go to one topic, or none.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: { cards?: unknown; topicId?: unknown; source?: unknown; metadata?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  if (!Array.isArray(body.cards) || !body.cards.length || body.cards.length > MAX_IMPORT_CARDS
    || body.cards.some((card) => typeof card?.front !== "string" || typeof card?.back !== "string")) {
    return jsonError(`Provide 1 to ${MAX_IMPORT_CARDS.toLocaleString()} cards, each with a front and back`);
  }
  if (typeof body.source !== "string" || !sources.includes(body.source)) return jsonError("Unknown card source");
  const topicId = body.topicId ?? null;
  if (topicId !== null && (typeof topicId !== "string" || !isUuid(topicId) || !(await getTopicInSubject(topicId, subjectId)))) return jsonError("Topic not found", 404);
  const cards = cleanDrafts(body.cards as { front: string; back: string; frontDiagram?: unknown; backDiagram?: unknown }[])
    .map((card) => ({ front: card.front, back: card.back, frontDiagram: cleanDiagram(card.frontDiagram), backDiagram: cleanDiagram(card.backDiagram) }));
  if (!cards.length) return jsonError("Every card needs a front");
  const metadata = body.source === "ai" && body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const result = await query(`INSERT INTO cards(subject_id, topic_id, front, back, source, generation_metadata, front_diagram, back_diagram)
    SELECT $1, $2, c.front, c.back, $4, $5::jsonb, c."frontDiagram", c."backDiagram"
    FROM jsonb_to_recordset($3::jsonb) AS c(front text, back text, "frontDiagram" jsonb, "backDiagram" jsonb)`,
  [subjectId, topicId, JSON.stringify(cards), body.source, JSON.stringify(metadata)]);
  return Response.json({ created: result.rowCount }, { status: 201 });
}
