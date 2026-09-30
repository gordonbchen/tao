import assert from "node:assert/strict";
import test from "node:test";
import { cleanDiagram, themedSvgUrl, withFigure } from "../lib/diagrams.ts";

test("keeps a valid diagram and trims its description", () => {
  assert.deepEqual(cleanDiagram({ kind: "mermaid", source: " graph TD; A-->B ", alt: " A leads\n to B. " }), { kind: "mermaid", source: "graph TD; A-->B", alt: "A leads to B." });
  assert.equal(cleanDiagram({ kind: "svg", source: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>', alt: "A circle." })?.kind, "svg");
});

test("rejects diagrams that are missing, unknown, undescribed, or not SVG", () => {
  assert.equal(cleanDiagram(null), null);
  assert.equal(cleanDiagram({ kind: "tikz", source: "\\draw (0,0) -- (1,1);", alt: "A line." }), null);
  assert.equal(cleanDiagram({ kind: "mermaid", source: "graph TD; A-->B", alt: " " }), null);
  assert.equal(cleanDiagram({ kind: "svg", source: "<div>not svg</div>", alt: "Text." }), null);
  assert.equal(cleanDiagram({ kind: "svg", source: `<svg>${"x".repeat(30_001)}</svg>`, alt: "Too big." }), null);
});

test("drops Mermaid init directives, which can change its security settings", () => {
  const diagram = cleanDiagram({ kind: "mermaid", source: '%%{init: {"securityLevel": "loose"}}%%\ngraph TD; A-->B', alt: "A leads to B." });
  assert.equal(diagram?.source, "graph TD; A-->B");
});

test("maps SVG color names to theme colors and keeps others", () => {
  const url = themedSvgUrl('<svg viewBox="0 0 10 10"><rect fill="white" stroke="accent"/><path stroke="Black" fill="none"/><circle fill="#123456"/></svg>', { ink: "#eee", paper: "#111", accent: "#abc" });
  const svg = decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 10 10"><style>svg\{color:#eee;fill:#eee;/);
  assert.match(svg, /<rect fill="#111" stroke="#abc"\/>/);
  assert.match(svg, /<path stroke="#eee" fill="none"\/>/);
  assert.match(svg, /<circle fill="#123456"\/>/);
});

test("describes the figure to the tutor", () => {
  assert.equal(withFigure("Find x.", { kind: "svg", source: "<svg></svg>", alt: "A right triangle with legs 3 and 4." }), "Find x.\n[Figure: A right triangle with legs 3 and 4.]");
  assert.equal(withFigure("Find x.", null), "Find x.");
});
