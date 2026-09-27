import assert from "node:assert/strict";
import test from "node:test";
import { suggestTopics } from "../lib/topic-suggestions.ts";

test("recognizes plain PDF headings without treating definitions as topics", () => {
  const text = `Cardinality
Cardinality generalizes counting. When you count a set S of n objects you give a bijection
Definitions:
• A set is countable if it is bijective to N.
-- 1 of 4 --
Cardinality as a relation
Some results
Cantor diagonalization and uncountable sets
Theorem: There is no surjection from a set to its power set.`;
  assert.deepEqual(suggestTopics(text, "Countability.pdf"), ["Cardinality", "Cardinality as a relation", "Cantor diagonalization and uncountable sets"]);
});

test("uses the filename when extracted text has no recognizable heading", () => {
  assert.deepEqual(suggestTopics("A long paragraph about sequences.\nAnother sentence.", "Sequences.pdf"), ["Sequences"]);
  assert.deepEqual(suggestTopics("", "Scan.pdf"), []);
});
