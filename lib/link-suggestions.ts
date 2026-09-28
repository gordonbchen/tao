// Keeps model-suggested IDs that name real, unlinked candidates, in the model's order.
export function pickSuggestedIds(raw: unknown, candidateIds: string[], limit = 5) {
  const ids = raw && typeof raw === "object" && "ids" in raw ? (raw as { ids: unknown }).ids : null;
  if (!Array.isArray(ids)) throw new Error("AI returned invalid link suggestions");
  const allowed = new Set(candidateIds);
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && allowed.has(id)))].slice(0, limit);
}
