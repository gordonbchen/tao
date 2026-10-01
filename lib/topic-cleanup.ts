// One proposed change to a subject's topics: several topics become one named topic, one topic is renamed, or topics
// that are not course material are removed.
export const CLEANUP_ACTIONS = ["merge", "rename", "remove"] as const;
export type CleanupAction = typeof CLEANUP_ACTIONS[number];
export type CleanupChange = { action: CleanupAction; topicIds: string[]; name: string; reason: string };

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

// Checks a proposal against the subject's topics, from the model (by name) or the page (by id). Each topic takes part
// in at most one change, a merge needs two topics, and a new name may not belong to a topic outside its change,
// since topic names are unique within a subject. Anything else is dropped. Proposals checked in parts share `taken`,
// the topic ids and new names used so far.
export function checkCleanup(raw: unknown, topics: { id: string; name: string }[], by: "name" | "id", taken = { ids: new Set<string>(), names: new Set<string>() }): CleanupChange[] {
  const items = raw && typeof raw === "object" && "changes" in raw ? (raw as { changes: unknown }).changes : null;
  if (!Array.isArray(items)) throw new Error("Expected a list of changes");
  const find = new Map(topics.map((topic) => [by === "id" ? topic.id : topic.name.toLocaleLowerCase(), topic]));
  const { ids: used, names } = taken;
  const changes: CleanupChange[] = [];
  for (const item of items.slice(0, 200)) {
    if (!item || typeof item !== "object") continue;
    const action = CLEANUP_ACTIONS.find((value) => value === item.action);
    const refs: unknown[] = Array.isArray(item.topics) ? item.topics : [];
    const members = [...new Set(refs.filter((ref): ref is string => typeof ref === "string")
      .map((ref) => find.get(by === "id" ? ref : cleanName(ref).toLocaleLowerCase())).filter((topic) => topic !== undefined))];
    const name = action === "remove" || typeof item.name !== "string" ? "" : cleanName(item.name);
    const key = name.toLocaleLowerCase();
    if (!action || !members.length || members.some((topic) => used.has(topic.id))) continue;
    if (action === "merge" && (members.length < 2 || !name)) continue;
    if (action === "rename" && (members.length !== 1 || !name || name === members[0].name)) continue;
    if (name && (names.has(key) || topics.some((topic) => topic.name.toLocaleLowerCase() === key && !members.includes(topic)))) continue;
    members.forEach((topic) => used.add(topic.id));
    if (name) names.add(key);
    changes.push({ action, topicIds: members.map((topic) => topic.id), name, reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 300) : "" });
  }
  return changes;
}
