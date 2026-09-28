// Pure helpers for a subject's folder tree. Folders (groups) nest; topics are always leaves.
// Used by both the server and the subject page, so keep this free of server imports.

export type TreeGroup = { id: string; name: string; parentId: string | null };
export type TreeTopic = { id: string; name: string; groupId: string | null };
export type TreeNode<G extends TreeGroup = TreeGroup, T extends TreeTopic = TreeTopic> =
  | { kind: "group"; group: G; children: TreeNode<G, T>[]; topicCount: number }
  | { kind: "topic"; topic: T };
// A topic name and the folder names leading to it from the top level.
export type Placement = { name: string; path: string[] };

export const MAX_DEPTH = 4;

// Builds the nested tree, folders before topics, keeping the input order within each.
// Items whose folder is missing (for example, pending removal) are left out.
export function buildTree<G extends TreeGroup, T extends TreeTopic>(groups: G[], topics: T[]): TreeNode<G, T>[] {
  const build = (parentId: string | null, seen: Set<string>): TreeNode<G, T>[] => [
    ...groups.filter((group) => group.parentId === parentId && !seen.has(group.id)).map((group) => {
      const children = build(group.id, new Set([...seen, group.id]));
      const topicCount = children.reduce((total, child) => total + (child.kind === "topic" ? 1 : child.topicCount), 0);
      return { kind: "group" as const, group, children, topicCount };
    }),
    ...topics.filter((topic) => topic.groupId === parentId).map((topic) => ({ kind: "topic" as const, topic })),
  ];
  return build(null, new Set());
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
