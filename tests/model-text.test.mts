import assert from "node:assert/strict";
import test from "node:test";
import { undoDoubleEscaping, undoDoubleEscapingDeep } from "../lib/model-text.ts";

test("unescapes text whose TeX and line breaks were escaped twice", () => {
  const stored = String.raw`Let $n\\in\\mathbb N$ with\n\\[y_1^{\\,n}=x.\\]\nProve "it".`;
  assert.equal(undoDoubleEscaping(stored), 'Let $n\\in\\mathbb N$ with\n\\[y_1^{\\,n}=x.\\]\nProve "it".');
});

test("leaves correctly escaped TeX alone", () => {
  for (const text of [
    String.raw`Let \(n\in\mathbb N\) and \(a\neq b\).`,
    String.raw`\[\begin{aligned} a &= b \\ c &= d \end{aligned}\]`,
    String.raw`Rows: \(a \\\text{b}\) and \(\{0, 1\}\).`,
    "No math here.",
  ]) assert.equal(undoDoubleEscaping(text), text);
});

test("keeps real line breaks when unescaping", () => {
  assert.equal(undoDoubleEscaping("Show \\\\(x\\\\ge 0\\\\).\nThen stop."), "Show \\(x\\ge 0\\).\nThen stop.");
});

test("unescapes nested reply fields", () => {
  assert.deepEqual(undoDoubleEscapingDeep({ hints: [String.raw`Use \\sup`], n: 3 }), { hints: [String.raw`Use \sup`], n: 3 });
});

test("unescapes doubled math delimiters that hold no TeX command", () => {
  assert.equal(undoDoubleEscaping(String.raw`If \\(f(a)=2\\) and \\(5\\) lies on \\([a,b]\\)`), String.raw`If \(f(a)=2\) and \(5\) lies on \([a,b]\)`);
});
