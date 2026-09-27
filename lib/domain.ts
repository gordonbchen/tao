import { LOCAL_OWNER_ID, query } from "@/lib/db";
export { nextReview } from "./scheduler";

export async function ownsSubject(subjectId: string) {
  const result = await query("SELECT id FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]);
  return result.rows.length > 0;
}

export async function getTopicInSubject(topicId: string, subjectId: string) {
  const result = await query<{ id: string; name: string }>("SELECT id, name FROM topics WHERE id = $1 AND subject_id = $2", [topicId, subjectId]);
  return result.rows[0];
}
