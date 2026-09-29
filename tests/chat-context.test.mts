import assert from "node:assert/strict";
import test from "node:test";
import { recentMessages, relevantPassages, sinceSummary } from "../lib/chat-context.ts";

test("short text is sent whole", () => {
  assert.equal(relevantPassages("Short notes on groups.", "anything"), "Short notes on groups.");
});

test("long text keeps the opening and the passages that match the question, in order", () => {
  const filler = (word: string) => `${word} `.repeat(600).slice(0, 3000);
  const text = [filler("intro"), filler("alpha"), filler("sylow"), filler("beta"), filler("lagrange")].join("");
  const result = relevantPassages(text, "What does Lagrange say, and how is Sylow used?", 9000);
  assert.ok(result.startsWith("intro"));
  assert.ok(result.includes("sylow") && result.includes("lagrange"));
  assert.ok(!result.includes("alpha") && !result.includes("beta"));
  assert.ok(result.indexOf("sylow") < result.indexOf("lagrange"));
});

test("chat history keeps the newest messages within the character budget", () => {
  const messages = ["a".repeat(50), "b".repeat(50), "c".repeat(30), "d".repeat(30)].map((text) => ({ role: "user", text }));
  assert.deepEqual(recentMessages(messages, 12, 100).map((item) => item.text[0]), ["c", "d"]);
  assert.deepEqual(recentMessages(messages, 2, 1000).map((item) => item.text[0]), ["c", "d"]);
  assert.equal(recentMessages([{ text: "x".repeat(500) }], 12, 100)[0].text.length, 100);
});

test("a chat summary stands in for the messages before it", () => {
  const chat = [{ role: "user", text: "q1" }, { role: "summary", text: "s1" }, { role: "user", text: "q2" }, { role: "summary", text: "s2" }, { role: "user", text: "q3" }, { role: "assistant", text: "a3" }];
  assert.deepEqual(sinceSummary(chat), { summary: "s2", messages: chat.slice(4) });
  assert.deepEqual(sinceSummary(chat.slice(0, 1)), { summary: undefined, messages: chat.slice(0, 1) });
});
