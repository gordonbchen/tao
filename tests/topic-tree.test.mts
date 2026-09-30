import assert from "node:assert/strict";
import test from "node:test";
import { buildTree, cleanPath, descendantGroupIds, flattenTree, groupPath, outline, parsePlacements, parseTopicNames, pathsBesideTopics, placeInTree, positionAt, siblingPositions } from "../lib/topic-tree.ts";

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

test("places proposed topics into the existing tree, reusing folders case-insensitively and adding new ones last", () => {
  const preview = placeInTree(groups, topics.slice(0, 3), [
    { id: "n1", name: "Limits", path: ["analysis", "SEQUENCES"] },
    { id: "n2", name: "Rings", path: ["Algebra", "Rings and fields"] },
    { id: "n3", name: "Fields", path: ["algebra", "rings and fields"] },
    { id: "n4", name: "Logic", path: [] },
  ]);
  assert.equal(preview.groups.length, groups.length + 1);
  assert.deepEqual(outline(buildTree(preview.groups, preview.topics)), [
    { folder: "Analysis", contents: [{ folder: "Sequences", contents: ["Cauchy sequences", "Limits"] }, "Continuity"] },
    { folder: "Algebra", contents: [{ folder: "Rings and fields", contents: ["Rings", "Fields"] }] },
    "Cardinality",
    "Logic",
  ]);
});

test("reads suggested topic names, dropping blanks, junk, and case-insensitive duplicates", () => {
  assert.deepEqual(parseTopicNames({ topics: [" Limits ", "limits", "x", 3, "Group  actions"] }, 12), ["Limits", "Group actions"]);
  assert.deepEqual(parseTopicNames({ topics: ["A1", "B2", "C3"] }, 2), ["A1", "B2"]);
  assert.throws(() => parseTopicNames({ topics: "Limits" }, 12));
});

test("sorts folders and topics together by position, keeping folders first on ties", () => {
  const groups = [{ id: "g1", name: "Later folder", parentId: null, position: 3 }, { id: "g2", name: "Unplaced", parentId: null }];
  const topics = [{ id: "t1", name: "First", groupId: null, position: -1 }, { id: "t2", name: "Middle", groupId: null, position: 2 }, { id: "t3", name: "Tie", groupId: null }];
  assert.deepEqual(buildTree(groups, topics).map((node) => node.kind === "group" ? node.group.id : node.topic.id), ["t1", "g2", "t3", "t2", "g1"]);
});

test("places a dragged item between, before, or after its new siblings", () => {
  const groups = [{ id: "g", name: "Folder", parentId: null, position: 1 }];
  const topics = [{ id: "a", name: "A", groupId: null, position: 2 }, { id: "b", name: "B", groupId: null, position: 4 }, { id: "c", name: "C", groupId: "g", position: 5 }];
  const top = siblingPositions(groups, topics, null, "a").map((item) => item.position);
  assert.deepEqual(top, [1, 4]);
  assert.equal(positionAt(top, 0), 0);
  assert.equal(positionAt(top, 1), 2.5);
  assert.equal(positionAt(top, 2), 5);
  assert.equal(positionAt([], 0), 0);
});

test("a suggested path through an existing topic is cut back so the new topic sits beside it", () => {
  const tree = ["Probability spaces", { folder: "Groups", contents: ["Sylow theorems"] }];
  assert.deepEqual(pathsBesideTopics([
    { name: "Conditional probability", path: ["Probability Spaces"] },
    { name: "Sylow counting", path: ["Groups", "Sylow theorems", "Extra"] },
    { name: "Cosets", path: ["Groups", "Cosets and quotients"] },
  ], tree), [
    { name: "Conditional probability", path: [] },
    { name: "Sylow counting", path: ["Groups"] },
    { name: "Cosets", path: ["Groups", "Cosets and quotients"] },
  ]);
});
