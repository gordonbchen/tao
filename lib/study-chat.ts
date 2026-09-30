import { aiOptionsFromRequest, chatAbout, hasAiProvider, summarizeChat } from "@/lib/ai";
import { isUuid, jsonError, LOCAL_OWNER_ID, query } from "@/lib/db";
import { withFigure, type Diagram } from "@/lib/diagrams";
import { recentMessages, relevantPassages, sinceSummary } from "@/lib/chat-context";
import { chatMessages, topicExcerpts } from "@/lib/practice";
import { subjectMaterial } from "@/lib/subject-context";
import { getOwnedGroup, groupSummaryInput } from "@/lib/topic-groups";

// A chat about a subject, topic, folder, or resource, outside practice. Messages are stored in tutor_messages.
export type ChatTarget = "subject" | "topic" | "group" | "resource";
const parents = { subject: "subject_id", topic: "topic_id", group: "group_id", resource: "resource_id" } as const;
const notFound = { subject: "Subject not found", topic: "Topic not found", group: "Folder not found", resource: "Resource not found" };

// The material the tutor reads, or null when the item does not exist or belongs to someone else.
async function material(target: ChatTarget, id: string, question: string) {
  if (target === "subject") return subjectMaterial(id, question);
  if (target === "topic") {
    const result = await query<{ id: string; subjectId: string; subject: string; name: string; coverageSummary: string }>(`SELECT t.id, t.subject_id AS "subjectId",
      s.name AS subject, t.name, t.coverage_summary AS "coverageSummary" FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = $1 AND s.owner_id = $2`, [id, LOCAL_OWNER_ID]);
    const topic = result.rows[0];
    if (!topic) return null;
    const { excerpts } = await topicExcerpts(topic.subjectId, topic);
    return { subject: topic.subject, topic: topic.name, coverageSummary: topic.coverageSummary, sourcePassages: excerpts };
  }
  if (target === "group") {
    const group = await getOwnedGroup(id);
    if (!group) return null;
    const [subject, contents] = await Promise.all([
      query<{ name: string }>("SELECT name FROM subjects WHERE id = $1", [group.subjectId]),
      groupSummaryInput(group.subjectId, id),
    ]);
    return { subject: subject.rows[0]?.name, folderSummary: group.summary, ...contents?.input };
  }
  const result = await query<{ subject: string; filename: string; modelSummary: string; extractedText: string }>(`SELECT s.name AS subject, r.filename,
    r.model_summary AS "modelSummary", r.extracted_text AS "extractedText" FROM resources r JOIN subjects s ON s.id = r.subject_id WHERE r.id = $1 AND r.owner_id = $2`, [id, LOCAL_OWNER_ID]);
  const resource = result.rows[0];
  if (!resource) return null;
  return { subject: resource.subject, resource: resource.filename, summary: resource.modelSummary, text: relevantPassages(resource.extractedText, question) };
}

async function owned(target: ChatTarget, id: string) {
  const sql = {
    subject: "SELECT 1 FROM subjects WHERE id = $1 AND owner_id = $2",
    topic: "SELECT 1 FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = $1 AND s.owner_id = $2",
    group: "SELECT 1 FROM topic_groups g JOIN subjects s ON s.id = g.subject_id WHERE g.id = $1 AND s.owner_id = $2",
    resource: "SELECT 1 FROM resources WHERE id = $1 AND owner_id = $2",
  }[target];
  return isUuid(id) && (await query(sql, [id, LOCAL_OWNER_ID])).rowCount === 1;
}

export async function getStudyChat(target: ChatTarget, id: string, request: Request) {
  if (!await owned(target, id)) return jsonError(notFound[target], 404);
  if (new URL(request.url).searchParams.has("archived")) return Response.json({ chats: await archivedChats(target, id) });
  return Response.json({ messages: await chatMessages(parents[target], id), name: await chatName(target, id) });
}

// The current chat's name: the model's or the student's, empty until either gives one.
async function chatName(target: ChatTarget, id: string) {
  const result = await query<{ content: string }>(`SELECT content FROM tutor_messages WHERE ${parents[target]} = $1 AND kind = 'title'
    AND cleared_at IS NULL ORDER BY created_at DESC LIMIT 1`, [id]);
  return result.rows[0]?.content ?? "";
}

// Earlier conversations set aside by starting a new chat or switching to another, most recently used first.
// `clearedAt` is ISO text with microseconds, so it names the chat exactly when switching back to it.
async function archivedChats(target: ChatTarget, id: string) {
  const result = await query<{ clearedAt: string; lastAt: string; kind: string; role: "user" | "assistant" | "summary"; text: string; diagram: Diagram | null }>(`SELECT
    to_json(cleared_at) #>> '{}' AS "clearedAt", max(created_at) FILTER (WHERE kind <> 'title') OVER (PARTITION BY cleared_at) AS "lastAt", kind,
    CASE WHEN kind = 'summary' THEN 'summary' WHEN role = 'student' THEN 'user' ELSE 'assistant' END AS role, content AS text, diagram
    FROM tutor_messages WHERE ${parents[target]} = $1 AND cleared_at IS NOT NULL AND kind IN ('question', 'hint', 'summary', 'title')
    ORDER BY "lastAt" DESC NULLS LAST, cleared_at, created_at, tutor_messages.role`, [id]);
  const chats: { clearedAt: string; lastAt: string; name: string; messages: Omit<(typeof result.rows)[number], "clearedAt" | "lastAt" | "kind">[] }[] = [];
  for (const { clearedAt, lastAt, kind, ...message } of result.rows) {
    let chat = chats.at(-1);
    if (chat?.clearedAt !== clearedAt) chats.push(chat = { clearedAt, lastAt, name: "", messages: [] });
    if (kind === "title") chat.name = message.text;
    else chat.messages.push(message);
  }
  return chats.filter((chat) => chat.messages.length);
}

const isTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-][\d:]+)$/.test(value);

// Renames the current chat.
export async function renameStudyChat(target: ChatTarget, id: string, request: Request) {
  let body: { name?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 80) return jsonError("Name must be 1–80 characters");
  if (!await owned(target, id)) return jsonError(notFound[target], 404);
  const match = `${parents[target]} = $1 AND cleared_at IS NULL`;
  const exists = await query(`SELECT 1 FROM tutor_messages WHERE ${match} AND kind IN ('question', 'hint') LIMIT 1`, [id]);
  if (!exists.rowCount) return jsonError("Chat not found", 404);
  await query(`DELETE FROM tutor_messages WHERE ${match} AND kind = 'title'`, [id]);
  await query(`INSERT INTO tutor_messages(${parents[target]}, role, kind, content) VALUES ($1, 'student', 'title', $2)`, [id, name]);
  return Response.json({ name });
}

// Posts a message and returns the tutor's reply, or with `summarize: true` summarizes the chat so far.
export async function postStudyChat(target: ChatTarget, id: string, request: Request) {
  if (!isUuid(id)) return jsonError(notFound[target], 404);
  let body: { message?: unknown; summarize?: unknown };
  try { body = await request.json(); } catch { return jsonError("Expected a JSON request body"); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (body.summarize !== true && (!message || message.length > 2000)) return jsonError("Message must be 1–2,000 characters");
  if (!hasAiProvider()) return jsonError("Sign in to Codex or Claude before chatting", 409);
  if (!await owned(target, id)) return jsonError(notFound[target], 404);
  // The tutor reads its earlier figures as their descriptions.
  const { summary, messages } = sinceSummary((await chatMessages(parents[target], id)).map((item) => ({ role: item.role, text: withFigure(item.text, item.diagram) })));
  const options = aiOptionsFromRequest(request);

  if (body.summarize === true) {
    if (messages.length < 2) return jsonError("There is nothing new to summarize yet.", 422);
    let text: string | undefined;
    try { text = await summarizeChat(summary, recentMessages(messages, 200, 60_000), options); }
    catch { return jsonError("The chat could not be summarized. Check the configured AI provider or try again.", 502); }
    if (!text) return jsonError("The chat could not be summarized. Try again.", 502);
    await query(`INSERT INTO tutor_messages(${parents[target]}, role, kind, content) VALUES ($1, 'tutor', 'summary', $2)`, [id, text]);
    return Response.json({ summary: text });
  }

  const conversation = recentMessages(messages);
  const context = await material(target, id, [...conversation.filter((item) => item.role === "user").map((item) => item.text), message].join(" "));
  if (!context) return jsonError(notFound[target], 404);
  let reply: Awaited<ReturnType<typeof chatAbout>>;
  const unnamed = !await chatName(target, id);
  try { reply = await chatAbout(context, summary, conversation, message, unnamed, options); }
  catch { return jsonError("The tutor could not respond. Check the configured AI provider or try again.", 502); }
  if (!reply) return jsonError("The tutor could not respond. Try again.", 502);
  await query(`INSERT INTO tutor_messages(${parents[target]}, role, kind, content, diagram) VALUES ($1, 'student', 'question', $2, NULL), ($1, 'tutor', 'hint', $3, $4)`, [id, message, reply.text, reply.diagram]);
  const name = unnamed && reply.title ? reply.title : undefined;
  if (name) await query(`INSERT INTO tutor_messages(${parents[target]}, role, kind, content) VALUES ($1, 'tutor', 'title', $2)`, [id, name]);
  return Response.json({ reply: reply.text, diagram: reply.diagram, name });
}

// Sets the current conversation aside; it stays among the archived chats. With `restore` (an archived chat's
// `clearedAt`), that chat becomes the current one again.
export async function clearStudyChat(target: ChatTarget, id: string, request: Request) {
  const restore = new URL(request.url).searchParams.get("restore");
  if (restore !== null && !isTimestamp(restore)) return jsonError("Chat not found", 404);
  if (!await owned(target, id)) return jsonError(notFound[target], 404);
  if (restore === null) {
    await query(`UPDATE tutor_messages SET cleared_at = now() WHERE ${parents[target]} = $1 AND cleared_at IS NULL`, [id]);
    return new Response(null, { status: 204 });
  }
  const exists = await query(`SELECT 1 FROM tutor_messages WHERE ${parents[target]} = $1 AND cleared_at = $2::timestamptz AND kind IN ('question', 'hint') LIMIT 1`, [id, restore]);
  if (!exists.rowCount) return jsonError("Chat not found", 404);
  // One statement, so the two chats swap together.
  await query(`UPDATE tutor_messages SET cleared_at = CASE WHEN cleared_at IS NULL THEN now() END
    WHERE ${parents[target]} = $1 AND (cleared_at IS NULL OR cleared_at = $2::timestamptz)`, [id, restore]);
  return new Response(null, { status: 204 });
}
