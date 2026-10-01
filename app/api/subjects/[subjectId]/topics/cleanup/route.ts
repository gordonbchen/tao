import { aiOptionsFromRequest, isAiSetupError, withDisconnect } from "@/lib/ai";
import { cleanupTopicsWithAi } from "@/lib/ai-topic-suggestions";
import { isUuid, jsonError, LOCAL_OWNER_ID, query, transaction } from "@/lib/db";
import { ownsSubject } from "@/lib/domain";
import { checkCleanup } from "@/lib/topic-cleanup";
import { loadTree } from "@/lib/topic-groups";
import { groupPath } from "@/lib/topic-tree";

type RouteContext = { params: Promise<{ subjectId: string }> };

// Proposes merges, renames, and removals, one model request for the topics of each course file that has several (and
// one for topics linked to no file), three at a time. The reply is one JSON object per line: `total` requests, then
// each checked `change` as its request finishes, `finished` after each request, an `error` for a request that failed,
// and `done`. Nothing changes until the student applies the changes they keep with PUT.
export async function POST(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  const [{ groups, topics: treeTopics }, subject, links, files] = await Promise.all([loadTree(subjectId),
    query<{ name: string }>("SELECT name FROM subjects WHERE id = $1 AND owner_id = $2", [subjectId, LOCAL_OWNER_ID]),
    query<{ topicId: string; resourceId: string }>(`SELECT tr.topic_id AS "topicId", tr.resource_id AS "resourceId" FROM topic_resources tr JOIN topics t ON t.id = tr.topic_id WHERE t.subject_id = $1`, [subjectId]),
    query<{ id: string; name: string; words: number; summary: string }>(`SELECT id, filename AS name, coalesce(array_length(regexp_split_to_array(trim(extracted_text), '\\s+'), 1), 0) AS words,
      CASE WHEN model_summary <> '' THEN left(model_summary, 6000) ELSE left(extracted_text, 6000) END AS summary FROM resources WHERE subject_id = $1`, [subjectId])]);
  const counts = await query<{ id: string; cards: number; problems: number }>(`SELECT t.id, (SELECT count(*)::int FROM cards WHERE topic_id = t.id) AS cards,
    (SELECT count(*)::int FROM problems WHERE topic_id = t.id) AS problems FROM topics t WHERE t.subject_id = $1`, [subjectId]);
  const count = new Map(counts.rows.map((row) => [row.id, row]));
  const fileName = new Map(files.rows.map((file) => [file.id, file.name]));
  const filesOf = (topicId: string) => links.rows.filter((link) => link.topicId === topicId).map((link) => link.resourceId);
  const describe = (topic: typeof treeTopics[number], file?: string) => ({ name: topic.name, about: topic.about,
    folder: topic.unorganized ? "Unorganized" : groupPath(groups, topic.groupId).join(" › "), otherFiles: filesOf(topic.id).filter((id) => id !== file).map((id) => fileName.get(id)!) });
  // The files with the most topics go first, since they overlap the most.
  const parts: { file: { name: string; words: number; summary: string } | null; topics: ReturnType<typeof describe>[] }[] = files.rows.map((file) => ({ file, topics: treeTopics.filter((topic) => filesOf(topic.id).includes(file.id)) }))
    .filter((part) => part.topics.length > 1).sort((a, b) => b.topics.length - a.topics.length)
    .map(({ file, topics }) => ({ file: { name: file.name, words: file.words, summary: file.summary }, topics: topics.map((topic) => describe(topic, file.id)) }));
  const unlinked = treeTopics.filter((topic) => !filesOf(topic.id).length);
  for (let index = 0; index < unlinked.length - 1; index += 40) parts.push({ file: null, topics: unlinked.slice(index, index + 40).map((topic) => describe(topic)) });
  if (!parts.length) return jsonError("No course file has more than one topic, so there is nothing to clean up.", 422);

  const aiOptions = withDisconnect(aiOptionsFromRequest(request), request);
  const stopped = new AbortController();
  const signal = AbortSignal.any([aiOptions.signal!, stopped.signal]);
  const encoder = new TextEncoder();
  const taken = { ids: new Set<string>(), names: new Set<string>() };
  return new Response(new ReadableStream({
    async start(controller) {
      const line = (value: object) => { if (!stopped.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
      line({ total: parts.length });
      let next = 0;
      const worker = async () => {
        for (let index = next++; index < parts.length && !signal.aborted; index = next++) {
          try {
            const raw = await cleanupTopicsWithAi(subject.rows[0].name, parts[index].file, parts[index].topics, { ...aiOptions, signal });
            for (const { topicIds, ...change } of checkCleanup(raw, treeTopics, "name", taken)) {
              line({ change: { ...change, topics: topicIds.map((id) => ({ id, name: treeTopics.find((topic) => topic.id === id)!.name, cards: count.get(id)?.cards ?? 0, problems: count.get(id)?.problems ?? 0 })) } });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Could not clean up topics";
            if (!signal.aborted) line({ error: isAiSetupError(message) ? "Sign in to an AI account to clean up topics." : message });
          }
          line({ finished: true });
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker));
      line({ done: true });
      if (!stopped.signal.aborted) controller.close();
    },
    // The page stopped reading, so stop the model too.
    cancel() { stopped.abort(); },
  }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

// Applies the kept changes in one transaction. A merge keeps the topic with the most review history (then the most
// cards and problems) under the new name, moves the others' cards, problems, and resource links to it, archives their
// chats under it, and deletes them. Removing a topic keeps its cards and problems, unfiled. Returns the merged topics,
// whose summaries need writing again from their combined resources.
export async function PUT(request: Request, { params }: RouteContext) {
  const { subjectId } = await params;
  if (!isUuid(subjectId) || !(await ownsSubject(subjectId))) return jsonError("Subject not found", 404);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const refreshTopicIds: string[] = [];
  await transaction(async (client) => {
    const topics = (await client.query<{ id: string; name: string }>("SELECT id, name FROM topics WHERE subject_id = $1 FOR UPDATE", [subjectId])).rows;
    const changes = checkCleanup(body, topics, "id");
    for (const change of changes.filter((item) => item.action === "remove")) await client.query("DELETE FROM topics WHERE id = ANY($1::uuid[])", [change.topicIds]);
    for (const change of changes.filter((item) => item.action === "merge")) {
      const keep = (await client.query<{ id: string }>(`SELECT t.id FROM topics t LEFT JOIN topic_reviews r ON r.topic_id = t.id WHERE t.id = ANY($1::uuid[])
        ORDER BY coalesce(r.repetitions, 0) DESC, (SELECT count(*) FROM cards WHERE topic_id = t.id) + (SELECT count(*) FROM problems WHERE topic_id = t.id) DESC, t.position
        LIMIT 1`, [change.topicIds])).rows[0].id;
      const others = change.topicIds.filter((id) => id !== keep);
      await client.query("UPDATE cards SET topic_id = $1 WHERE topic_id = ANY($2::uuid[])", [keep, others]);
      await client.query("UPDATE problems SET topic_id = $1 WHERE topic_id = ANY($2::uuid[])", [keep, others]);
      await client.query(`INSERT INTO topic_resources(topic_id, resource_id, linked_at) SELECT $1, resource_id, linked_at FROM topic_resources
        WHERE topic_id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`, [keep, others]);
      // Each merged topic's current chat becomes its own archived chat, a moment apart so they stay separate.
      for (const [index, id] of others.entries()) {
        await client.query("UPDATE tutor_messages SET topic_id = $1, cleared_at = coalesce(cleared_at, now() - make_interval(secs => $3)) WHERE topic_id = $2",
          [keep, id, (index + 1) / 1000]);
      }
      await client.query("DELETE FROM topics WHERE id = ANY($1::uuid[])", [others]);
      await client.query("UPDATE topics SET name = $2 WHERE id = $1", [keep, change.name]);
      refreshTopicIds.push(keep);
    }
    for (const change of changes.filter((item) => item.action === "rename")) await client.query("UPDATE topics SET name = $2 WHERE id = $1", [change.topicIds[0], change.name]);
  });
  return Response.json({ refreshTopicIds });
}
