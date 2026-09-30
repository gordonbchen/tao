import { isUuid } from "@/lib/db";

// What the student chose to study: any mix of topics and folders. Empty means every topic in the subject.
export type Selection = { topicIds: string[]; groupIds: string[] };

// Queries using the selection take `$1` as folder IDs, `$2` as the subject ID, and `$3` as topic IDs.
// `selected_groups` names the chosen folders and every folder nested inside them.
export const selectionCte = `WITH RECURSIVE selected_groups(id) AS (
  SELECT id FROM topic_groups WHERE id = ANY($1::uuid[]) AND subject_id = $2
  UNION SELECT g.id FROM topic_groups g JOIN selected_groups s ON g.parent_id = s.id)`;

// Matches topic rows `t` inside the selection. With an empty selection it is true even when `t` is NULL.
export const inSelection = `((cardinality($1::uuid[]) = 0 AND cardinality($3::uuid[]) = 0)
  OR t.group_id IN (SELECT id FROM selected_groups) OR t.id = ANY($3::uuid[]))`;

export const selectionParams = (subjectId: string, { topicIds, groupIds }: Selection) => [groupIds, subjectId, topicIds];

// Reads `topicIds` and `groupIds` from a JSON body. Returns an error message for invalid input.
export function selectionFromBody(body: { topicIds?: unknown; groupIds?: unknown }): Selection | string {
  return validate(body.topicIds ?? [], body.groupIds ?? []);
}

// Reads repeated `topic` and `group` URL parameters.
export function selectionFromSearch(search: URLSearchParams): Selection | string {
  return validate(search.getAll("topic"), search.getAll("group"));
}

function validate(topicIds: unknown, groupIds: unknown): Selection | string {
  const ids = (value: unknown) => Array.isArray(value) && value.length <= 200 && value.every((id) => typeof id === "string" && isUuid(id)) ? [...new Set(value as string[])] : null;
  const topics = ids(topicIds);
  const groups = ids(groupIds);
  if (!topics || !groups) return "Choose up to 200 valid topics and folders";
  return { topicIds: topics, groupIds: groups };
}
