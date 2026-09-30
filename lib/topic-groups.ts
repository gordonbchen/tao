import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { briefFrom, generateStructuredText, type AiOptions } from "@/lib/ai";
import { LOCAL_OWNER_ID, query } from "@/lib/db";
import { buildTree, groupPath, type TreeNode } from "@/lib/topic-tree";

type Queryable = Pick<PoolClient, "query">;
type GroupRow = { id: string; name: string; parentId: string | null; position: number; summary: string; brief: string };
type TopicRow = { id: string; name: string; groupId: string | null; position: number; about: string; unorganized: boolean };

// Recursive CTE naming a folder and every folder inside it as `subtree(id)`.
export const subtreeCte = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM topic_groups WHERE id = $1
  UNION SELECT g.id FROM topic_groups g JOIN subtree s ON g.parent_id = s.id)`;

export async function getOwnedGroup(groupId: string) {
  const result = await query<{ id: string; subjectId: string; name: string; parentId: string | null; summary: string; summaryBasis: string; summaryProvider: string | null; summaryModel: string | null }>(
    `SELECT g.id, g.subject_id AS "subjectId", g.name, g.parent_id AS "parentId", g.summary, g.summary_basis AS "summaryBasis",
      g.summary_provider AS "summaryProvider", g.summary_model AS "summaryModel"
    FROM topic_groups g JOIN subjects s ON s.id = g.subject_id WHERE g.id = $1 AND s.owner_id = $2`, [groupId, LOCAL_OWNER_ID]);
  return result.rows[0];
}

export async function groupInSubject(client: Queryable, groupId: string, subjectId: string) {
  const result = await client.query("SELECT 1 FROM topic_groups WHERE id = $1 AND subject_id = $2", [groupId, subjectId]);
  return Boolean(result.rowCount);
}

// Finds the folder at `path` (names from the top level, matched case-insensitively), creating missing folders.
export async function resolveGroupPath(client: Queryable, subjectId: string, path: string[]) {
  let parentId: string | null = null;
  for (const name of path) {
    const found: { rows: { id: string }[] } = await client.query(`SELECT id FROM topic_groups
      WHERE subject_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3)`, [subjectId, parentId, name]);
    parentId = found.rows[0]?.id ?? (await client.query<{ id: string }>(
      "INSERT INTO topic_groups(subject_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id", [subjectId, parentId, name])).rows[0].id;
  }
  return parentId;
}

export async function loadTree(subjectId: string) {
  const [groups, topics] = await Promise.all([
    query<GroupRow>(`SELECT id, name, parent_id AS "parentId", position, summary, brief FROM topic_groups WHERE subject_id = $1 ORDER BY position, created_at`, [subjectId]),
    query<TopicRow>(`SELECT id, name, group_id AS "groupId", position, unorganized, CASE WHEN brief <> '' THEN brief ELSE left(coverage_summary, 300) END AS about
      FROM topics WHERE subject_id = $1 ORDER BY position, created_at`, [subjectId]),
  ]);
  // Unorganized topics sit outside the folder tree.
  return { groups: groups.rows, topics: topics.rows, nodes: buildTree(groups.rows, topics.rows.filter((topic) => !topic.unorganized)) };
}

export async function topicNames(subjectId: string) {
  return (await query<{ name: string }>("SELECT name FROM topics WHERE subject_id = $1 ORDER BY position, created_at", [subjectId])).rows.map((topic) => topic.name);
}

function findNode(nodes: TreeNode<GroupRow, TopicRow>[], groupId: string): Extract<TreeNode<GroupRow, TopicRow>, { kind: "group" }> | undefined {
  for (const node of nodes) {
    if (node.kind !== "group") continue;
    if (node.group.id === groupId) return node;
    const found = findNode(node.children, groupId);
    if (found) return found;
  }
}

// What a folder summary is written from: its direct contents, described by their own briefs or summaries.
// The hash of this input is stored with the summary, so any change to the contents marks it stale.
export async function groupSummaryInput(subjectId: string, groupId: string) {
  const { groups, nodes } = await loadTree(subjectId);
  const node = findNode(nodes, groupId);
  if (!node) return null;
  const topicNames = (children: TreeNode<GroupRow, TopicRow>[]): string[] => children.flatMap((child) => child.kind === "topic" ? [child.topic.name] : topicNames(child.children));
  const input = {
    folder: node.group.name,
    path: groupPath(groups, node.group.parentId),
    contents: node.children.map((child) => child.kind === "topic"
      ? { topic: child.topic.name, about: child.topic.about }
      : { folder: child.group.name, about: child.group.brief || child.group.summary.slice(0, 400), topics: topicNames(child.children) }),
  };
  return { input, basis: createHash("sha256").update(JSON.stringify(input)).digest("hex"), topicCount: node.topicCount };
}

export function groupSummaryStatus(group: { summary: string; summaryBasis: string }, basis: string) {
  return !group.summary ? "not_generated" : group.summaryBasis === basis ? "complete" : "stale";
}

export async function summarizeGroup(input: object, options?: AiOptions) {
  const { value, provider, model } = await generateStructuredText(
    "group_summary",
    "Write a concise overview of one folder in a student's tree of course topics, using only its listed contents. In two to five short sentences, or a brief bulleted Markdown list, say what the folder covers and how its parts relate, naming its subfolders and topics. Stay at the level of the given descriptions: do not add definitions, results, or outside facts. Use \\( ... \\) for any inline math. Also write a brief: one plain-text sentence under 200 characters naming what the folder covers. Return JSON with string properties summary and brief.",
    JSON.stringify(input),
    options,
  );
  const summary = value && typeof value === "object" && typeof (value as { summary?: unknown }).summary === "string"
    ? (value as { summary: string }).summary.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, 4_000) : "";
  if (!summary) throw new Error("AI returned an empty folder summary");
  return { summary, brief: briefFrom(value, 200), provider, model };
}
