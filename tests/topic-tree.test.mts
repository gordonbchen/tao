import assert from "node:assert/strict";
import test from "node:test";
import { buildTree, cleanPath, descendantGroupIds, flattenTree, groupPath, outline, parsePlacements, treeFromPaths } from "../lib/topic-tree.ts";

const groups = [
  { id: "analysis", name: "Analysis", parentId: null },
  { id: "sequences", name: "Sequences", parentId: "analysis" },
  { id: "algebra", name: "Algebra", parentId: null },
];
const topics = [
  { id: "t1", name: "Cauchy sequences", groupId: "sequences" },
  { id: "t2", name: "Continuity", groupId: "analysis" },
  { id: "t3", name: "Cardinality", groupId: null },
  { id: "t4", name: "Orphan", groupId: "removed-folder" },
];

test("builds folders before topics, counts nested topics, and drops items in missing folders", () => {
  const tree = buildTree(groups, topics);
  assert.deepEqual(outline(tree), [
    { folder: "Analysis", contents: [{ folder: "Sequences", contents: ["Cauchy sequences"] }, "Continuity"] },
    { folder: "Algebra", contents: [] },
    "Cardinality",
  ]);
  assert.equal(tree[0].kind === "group" && tree[0].topicCount, 2);
  assert.deepEqual(flattenTree(tree).map((node) => [node.kind === "group" ? node.group.name : node.topic.name, node.depth]),
    [["Analysis", 0], ["Sequences", 1], ["Cauchy sequences", 2], ["Continuity", 1], ["Algebra", 0], ["Cardinality", 0]]);
});

test("survives a folder cycle instead of recursing forever", () => {
  const cyclic = [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }];
  assert.deepEqual(buildTree(cyclic, []), []);
  assert.deepEqual(groupPath(cyclic, "a").length <= 3, true);
});

test("finds descendants and the path to a folder", () => {
  assert.deepEqual([...descendantGroupIds(groups, "analysis")].sort(), ["analysis", "sequences"]);
  assert.deepEqual(groupPath(groups, "sequences"), ["Analysis", "Sequences"]);
  assert.deepEqual(groupPath(groups, null), []);
});

test("cleans model placements: trims, drops blanks and duplicates, limits depth", () => {
  assert.deepEqual(cleanPath([" Analysis ", "", 3, "A", "B", "C", "D"]), ["Analysis", "A", "B", "C"]);
  assert.deepEqual(cleanPath("Analysis"), []);
  assert.deepEqual(parsePlacements({ topics: [
    { name: "  Limits ", path: ["Analysis"] },
    { name: "limits", path: [] },
    { name: "x", path: [] },
    { name: "Groups" },
    "junk",
  ] }, 12), [{ name: "Limits", path: ["Analysis"] }, { name: "Groups", path: [] }]);
  assert.throws(() => parsePlacements({ topics: "Limits" }, 12));
});

test("turns proposed paths into a previewable tree, merging folder names case-insensitively", () => {
  const preview = treeFromPaths([
    { id: "t1", name: "Limits", path: ["Analysis", "Sequences"] },
    { id: "t2", name: "Series", path: ["analysis", "sequences"] },
    { id: "t3", name: "Groups", path: [] },
  ]);
  assert.equal(preview.groups.length, 2);
  assert.deepEqual(outline(buildTree(preview.groups, preview.topics)), [
    { folder: "Analysis", contents: [{ folder: "Sequences", contents: ["Limits", "Series"] }] },
    "Groups",
  ]);
});
