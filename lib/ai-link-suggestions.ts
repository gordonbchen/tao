import { generateStructuredText, type AiOptions } from "@/lib/ai";
import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { pickSuggestedIds } from "@/lib/link-suggestions";

type Item = { id: string; name: string; content: string };

// Candidates are described by their brief, or the opening of their summary before a brief exists.
const resourceBrief = `CASE WHEN r.brief <> '' THEN r.brief WHEN octet_length(r.model_summary) > 0 THEN left(r.model_summary, 300) ELSE left(r.extracted_text, 300) END`;
const topicBrief = `CASE WHEN t.brief <> '' THEN t.brief ELSE left(t.coverage_summary, 300) END`;

// Returns up to five unlinked resources in the topic's subject, or null if the topic is not found.
export async function suggestResourcesForTopic(topicId: string, options: AiOptions) {
  const topic = (await query<Item & { subjectId: string }>(`SELECT t.subject_id AS "subjectId", t.name, left(t.coverage_summary, 3000) AS content
    FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = $1 AND s.owner_id = $2`, [topicId, LOCAL_OWNER_ID])).rows[0];
  if (!topic) return null;
  const candidates = await query<Item>(`SELECT r.id, r.filename AS name, ${resourceBrief} AS content FROM resources r
    WHERE r.subject_id = $1 AND r.owner_id = $2 AND NOT EXISTS (SELECT 1 FROM topic_resources tr WHERE tr.topic_id = $3 AND tr.resource_id = r.id)
    ORDER BY r.created_at LIMIT 60`, [topic.subjectId, LOCAL_OWNER_ID, topicId]);
  return rankCandidates("topic", topic, candidates.rows, options);
}

// Returns up to five unlinked topics in the resource's subject, or null if the resource is not found.
export async function suggestTopicsForResource(resourceId: string, options: AiOptions) {
  const resource = (await query<Item & { subjectId: string }>(`SELECT r.subject_id AS "subjectId", r.filename AS name,
    CASE WHEN octet_length(r.model_summary) > 0 THEN left(r.model_summary, 3000) ELSE left(r.extracted_text, 3000) END AS content
    FROM resources r WHERE r.id = $1 AND r.owner_id = $2`, [resourceId, LOCAL_OWNER_ID])).rows[0];
  if (!resource) return null;
  const candidates = await query<Item>(`SELECT t.id, t.name, ${topicBrief} AS content FROM topics t JOIN subjects s ON s.id = t.subject_id
    WHERE t.subject_id = $1 AND s.owner_id = $2 AND NOT EXISTS (SELECT 1 FROM topic_resources tr WHERE tr.resource_id = $3 AND tr.topic_id = t.id)
    ORDER BY t.created_at LIMIT 60`, [resource.subjectId, LOCAL_OWNER_ID, resourceId]);
  return rankCandidates("resource", resource, candidates.rows, options);
}

async function rankCandidates(kind: "topic" | "resource", target: { name: string; content: string }, candidates: Item[], options: AiOptions) {
  if (!candidates.length) return [];
  const candidateKind = kind === "topic" ? "resource" : "topic";
  const { value } = await generateStructuredText(
    "link_suggestions",
    `A student links course topics to the resources that teach them. Given one ${kind} and candidate ${candidateKind}s from the same course, choose up to 5 candidates whose content substantially covers the same material, most relevant first. Each candidate has only a short description, so judge by the concepts it names and by its name. Return fewer, or none, when nothing clearly matches. Return JSON with an ids array containing only candidate ids.`,
    JSON.stringify({ [kind]: { name: target.name, content: target.content }, candidates }),
    options,
  );
  return pickSuggestedIds(value, candidates.map((candidate) => candidate.id));
}
