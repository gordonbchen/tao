import assert from "node:assert/strict";
import test from "node:test";
import { completeArrayItems } from "../lib/partial-json.ts";

test("returns only the array elements that are complete so far", () => {
  const full = JSON.stringify({ cards: [{ front: "What is {x}?", back: "A \"set\" [1]" }, { front: "Second", back: "B" }] });
  assert.deepEqual(completeArrayItems(full.slice(0, full.indexOf("Second")), "cards"), [{ front: "What is {x}?", back: "A \"set\" [1]" }]);
  assert.equal(completeArrayItems(full, "cards").length, 2);
});

test("finds nothing before the array starts, and stops at its end", () => {
  assert.deepEqual(completeArrayItems("{\"car", "cards"), []);
  assert.deepEqual(completeArrayItems("{\"cards\": [], \"other\": [{\"a\": 1}]}", "cards"), []);
});

test("keeps nested objects inside an element together", () => {
  const text = "{\"cards\":[{\"front\":\"F\",\"frontDiagram\":{\"kind\":\"svg\",\"source\":\"<svg/>\"}},{\"front\":\"G";
  assert.deepEqual(completeArrayItems(text, "cards"), [{ front: "F", frontDiagram: { kind: "svg", source: "<svg/>" } }]);
});
