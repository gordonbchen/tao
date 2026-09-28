import assert from "node:assert/strict";
import test from "node:test";
import { pickSuggestedIds } from "../lib/link-suggestions.ts";

test("keeps only known candidates, in order, without duplicates", () => {
  assert.deepEqual(pickSuggestedIds({ ids: ["b", "made-up", "a", "b", 3] }, ["a", "b", "c"]), ["b", "a"]);
});

test("limits suggestions and rejects malformed responses", () => {
  assert.deepEqual(pickSuggestedIds({ ids: ["a", "b", "c"] }, ["a", "b", "c"], 2), ["a", "b"]);
  assert.throws(() => pickSuggestedIds({ topics: ["a"] }, ["a"]));
});
