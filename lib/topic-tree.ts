// Pure helpers for a subject's folder tree. Folders (groups) nest; topics are always leaves.
// Used by both the server and the subject page, so keep this free of server imports.

// `position` orders siblings of both kinds together; items without one keep their input order, folders first.
export type TreeGroup = { id: string; name: string; parentId: string | null; position?: number };
export type TreeTopic = { id: string; name: string; groupId: string | null; position?: number };
export type TreeNode<G extends TreeGroup = TreeGroup, T extends TreeTopic = TreeTopic> =
  | { kind: "group"; group: G; children: TreeNode<G, T>[]; topicCount: number }
  | { kind: "topic"; topic: T };
// A topic name and the folder names leading to it from the top level.
export type Placement = { name: string; path: string[] };

export const MAX_DEPTH = 4;

// Builds the nested tree with siblings sorted by position (a stable sort, so ties keep folders first).
// Items whose folder is missing (for example, pending removal) are left out.
export function buildTree<G extends TreeGroup, T extends TreeTopic>(groups: G[], topics: T[]): TreeNode<G, T>[] {
  const build = (parentId: string | null, seen: Set<string>): TreeNode<G, T>[] => ([
    ...groups.filter((group) => group.parentId === parentId && !seen.has(group.id)).map((group) => {
      const children = build(group.id, new Set([...seen, group.id]));
      const topicCount = children.reduce((total, child) => total + (child.kind === "topic" ? 1 : child.topicCount), 0);
      return { kind: "group" as const, group, children, topicCount };
    }),
    ...topics.filter((topic) => topic.groupId === parentId).map((topic) => ({ kind: "topic" as const, topic })),
  ] as TreeNode<G, T>[]).sort((a, b) => nodePosition(a) - nodePosition(b));
  return build(null, new Set());
}

const nodePosition = (node: TreeNode) => (node.kind === "group" ? node.group.position : node.topic.position) ?? 0;

// The positions of a folder's children (or the top level's), in order, leaving out `excludeId`.
export function siblingPositions(groups: TreeGroup[], topics: TreeTopic[], parentId: string | null, excludeId?: string) {
  return [...groups.filter((group) => group.parentId === parentId), ...topics.filter((topic) => topic.groupId === parentId)]
    .filter((item) => item.id !== excludeId).map((item) => ({ id: item.id, position: item.position ?? 0 })).sort((a, b) => a.position - b.position);
}

// A position that sorts at `index` among sorted sibling positions: between two neighbors, or one past either end.
export function positionAt(positions: number[], index: number) {
  if (!positions.length) return 0;
  if (index <= 0) return positions[0] - 1;
  if (index >= positions.length) return positions[positions.length - 1] + 1;
  return (positions[index - 1] + positions[index]) / 2;
}

// Every folder and topic in the order the tree shows them, with nesting depth (0 at the top level).
export function flattenTree<G extends TreeGroup, T extends TreeTopic>(nodes: TreeNode<G, T>[], depth = 0): (TreeNode<G, T> & { depth: number })[] {
  return nodes.flatMap((node) => [{ ...node, depth }, ...(node.kind === "group" ? flattenTree(node.children, depth + 1) : [])]);
}

// The folder and every folder nested inside it.
export function descendantGroupIds(groups: TreeGroup[], groupId: string) {
  const ids = new Set([groupId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const group of groups) if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) { ids.add(group.id); grew = true; }
  }
  return ids;
}

// Folder names from the top level down to and including `groupId`.
export function groupPath(groups: TreeGroup[], groupId: string | null) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const path: string[] = [];
  for (let group = groupId ? byId.get(groupId) : undefined; group && path.length <= groups.length; group = group.parentId ? byId.get(group.parentId) : undefined) {
    path.unshift(group.name);
  }
  return path;
}

// A compact nested outline of the tree for model prompts.
export type Outline = string | { folder: string; contents: Outline[] };
export function outline(nodes: TreeNode[]): Outline[] {
  return nodes.map((node) => node.kind === "topic" ? node.topic.name : { folder: node.group.name, contents: outline(node.children) });
}

export function cleanName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

// Cleans a model-proposed folder path: trimmed names, no blanks, at most MAX_DEPTH levels.
export function cleanPath(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((part): part is string => typeof part === "string").map(cleanName).filter(Boolean).slice(0, MAX_DEPTH);
}

// Reads `{ topics: [{ name, path }] }` from a model reply, keeping the first entry for each name.
export function parsePlacements(raw: unknown, limit: number): Placement[] {
  const items = raw && typeof raw === "object" && "topics" in raw ? (raw as { topics: unknown }).topics : null;
  if (!Array.isArray(items)) throw new Error("AI returned invalid topic placements");
  const placements = new Map<string, Placement>();
  for (const item of items) {
    const name = item && typeof item === "object" && typeof item.name === "string" ? cleanName(item.name) : "";
    if (name.length < 2 || placements.has(name.toLocaleLowerCase())) continue;
    placements.set(name.toLocaleLowerCase(), { name, path: cleanPath(item.path) });
  }
  return [...placements.values()].slice(0, limit);
}

// Turns topics with proposed paths into folders and topics, so a proposal renders like the real tree.
// Folder IDs are derived from the path, and names match case-insensitively like stored folders.
export function treeFromPaths<T extends { id: string; name: string }>(items: (T & { path: string[] })[]) {
  const groups = new Map<string, TreeGroup>();
  const topics = items.map(({ path, ...topic }) => {
    let parentId: string | null = null;
    path.forEach((name, index) => {
      const id = JSON.stringify(path.slice(0, index + 1).map((part) => part.toLocaleLowerCase()));
      if (!groups.has(id)) groups.set(id, { id, name, parentId });
      parentId = id;
    });
    return { ...topic, groupId: parentId } as unknown as T & TreeTopic;
  });
  return { groups: [...groups.values()], topics };
}
