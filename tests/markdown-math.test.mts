import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { protectMathFromMarkdown } from "../lib/markdown-math.ts";

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, null, protectMathFromMarkdown(text)));

test("Markdown passes TeX through unchanged for MathJax", () => {
  assert.equal(render(String.raw`Let \(S = \{0, 1\}\).`), String.raw`<p>Let \(S = \{0, 1\}\).</p>`);
  assert.equal(render(String.raw`Rows \[a \\ b\] and $a_1 * b_2 * c_3$`), String.raw`<p>Rows \[a \\ b\] and $a_1 * b_2 * c_3$</p>`);
});

test("Markdown outside math still renders", () => {
  assert.equal(render(String.raw`**Bold** with $$x^*$$`), String.raw`<p><strong>Bold</strong> with $$x^*$$</p>`);
});
