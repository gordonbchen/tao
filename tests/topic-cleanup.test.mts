import assert from "node:assert/strict";
import test from "node:test";
import { checkCleanup } from "../lib/topic-cleanup.ts";

const topics = [{ id: "a", name: "Population bottlenecks" }, { id: "b", name: "Genetic bottlenecks" }, { id: "c", name: "Note-taking" }, { id: "d", name: "Grasslands" }];

test("checkCleanup reads the model's changes by name and keeps each topic in one change", () => {
  const changes = checkCleanup({ changes: [
    { action: "merge", topics: ["population bottlenecks", "Genetic bottlenecks"], name: "Population bottlenecks", reason: "Same slides" },
    { action: "remove", topics: ["Note-taking", "Genetic bottlenecks"], name: "", reason: "Study advice" },
    { action: "rename", topics: ["Unknown"], name: "Anything", reason: "" },
  ] }, topics, "name");
  assert.deepEqual(changes, [{ action: "merge", topicIds: ["a", "b"], name: "Population bottlenecks", reason: "Same slides" }]);
});

test("checkCleanup drops names taken by topics outside the change and merges of one topic", () => {
  assert.deepEqual(checkCleanup({ changes: [
    { action: "rename", topics: ["d"], name: "Genetic bottlenecks", reason: "" },
    { action: "merge", topics: ["c"], name: "Study", reason: "" },
    { action: "rename", topics: ["d"], name: "Grasslands and diet", reason: "" },
    { action: "remove", topics: ["c"], name: "ignored", reason: "" },
  ] }, topics, "id"), [
    { action: "rename", topicIds: ["d"], name: "Grasslands and diet", reason: "" },
    { action: "remove", topicIds: ["c"], name: "", reason: "" },
  ]);
  assert.throws(() => checkCleanup({}, topics, "id"));
});

test("checkCleanup keeps later parts of a proposal from reusing a topic or a new name", () => {
  const taken = { ids: new Set<string>(), names: new Set<string>() };
  checkCleanup({ changes: [{ action: "rename", topics: ["Grasslands"], name: "Grassland diets", reason: "" }] }, topics, "name", taken);
  assert.deepEqual(checkCleanup({ changes: [
    { action: "merge", topics: ["Grasslands", "Note-taking"], name: "Other", reason: "" },
    { action: "rename", topics: ["Note-taking"], name: "grassland diets", reason: "" },
  ] }, topics, "name", taken), []);
});
