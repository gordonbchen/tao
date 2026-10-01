// Optional diagrams on problems and flashcards. Mermaid covers structure (flowcharts, timelines, sequences,
// mind maps); SVG covers spatial drawings (geometry, forces, circuits, labelled sketches). Both come from a model,
// so they are validated here before storage and drawn defensively in the browser.

export type Diagram = { kind: "mermaid" | "svg"; source: string; alt: string };

const LIMITS = { mermaid: 6000, svg: 30_000 };
const svgRoot = /^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i;

// Returns a stored diagram or null when the value is missing or unusable.
export function cleanDiagram(value: unknown): Diagram | null {
  if (!value || typeof value !== "object") return null;
  const { kind, source, alt } = value as Record<string, unknown>;
  if ((kind !== "mermaid" && kind !== "svg") || typeof source !== "string" || typeof alt !== "string") return null;
  const description = alt.replace(/\s+/g, " ").trim().slice(0, 600);
  // Mermaid init directives can change security settings, so they are dropped.
  const text = kind === "mermaid" ? source.replace(/%%\{[\s\S]*?\}%%/g, "").trim() : source.trim();
  if (!description || !text || text.length > LIMITS[kind]) return null;
  if (kind === "svg" && (!svgRoot.test(text) || !/<\/svg>$/i.test(text))) return null;
  return { kind, source: text, alt: description };
}

// Quotes a flowchart's node and edge labels, so text such as G(x) inside A[…] is not read as another shape.
// Models often leave labels unquoted; the browser tries this when a flowchart does not parse as written.
// Labels that open a special shape, such as A[(database)], are left alone.
export function quoteMermaidLabels(source: string) {
  if (!/^\s*(flowchart|graph)\b/i.test(source)) return source;
  return source
    .replace(/(\w)\[(?![[(/\\])([^\]\n"]+)\]/g, '$1["$2"]')
    .replace(/(\w)\{(?!\{)([^}\n"]+)\}/g, '$1{"$2"}')
    .replace(/\|([^|\n"]+)\|/g, '|"$1"|');
}

// Mermaid typesets $$…$$ in labels with KaTeX but drops the spaces beside each formula, so "Run $$D_H$$ on" would read
// "RunD_Hon". Each space next to a formula is repeated inside it as a TeX space.
export function spaceMermaidMath(source: string) {
  return source.replace(/( ?)\$\$([^$\n]+?)\$\$( ?)/g, (_match, before: string, tex: string, after: string) =>
    `${before}$$${before && "\\ "}${tex}${after && "\\ "}$$${after}`);
}

// The figure's description without TeX delimiters, for screen readers, which would otherwise read them aloud.
export function plainAlt(alt: string) {
  return alt.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g, (_match, ...tex: (string | undefined)[]) => tex.find((part) => part !== undefined) ?? "");
}

// The figure's description, appended to text sent to the tutor, which cannot see the drawing.
export function withFigure(text: string, diagram: Diagram | null | undefined, label = "Figure") {
  return diagram ? `${text}\n[${label}: ${diagram.alt}]` : text;
}

// Color names the model may use in SVG, mapped to Tao's color tokens. Black and white follow the theme too.
export const DIAGRAM_COLORS = ["ink", "muted", "line", "paper", "accent", "accent-soft", "danger", "success"] as const;
const aliases: Record<string, string> = { currentcolor: "ink", black: "ink", "#000": "ink", "#000000": "ink", white: "paper", "#fff": "paper", "#ffffff": "paper", soft: "accent-soft" };

// Rewrites a model's SVG with the current theme's colors as a data URL. It is shown in an <img>,
// where scripts, links, and external resources never run or load, so the SVG needs no sanitizing.
export function themedSvgUrl(source: string, colors: Record<string, string>) {
  const color = (value: string) => {
    const name = aliases[value.toLowerCase()] ?? value.toLowerCase();
    return colors[name] ?? value;
  };
  let svg = source.replace(/\b(fill|stroke|stop-color|color)\s*=\s*(["'])\s*([^"']*?)\s*\2/gi, (_match, attribute: string, quote: string, value: string) => `${attribute}=${quote}${color(value)}${quote}`);
  svg = svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const opening = /\sxmlns\s*=/.test(tag) ? tag : tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `${opening}<style>svg{color:${colors.ink};fill:${colors.ink};font-family:"Libertinus Serif",Georgia,serif}</style>`;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const DIAGRAM_RULES = `Use kind mermaid for structure: flowcharts, cycles, sequences, state machines, timelines, mind maps, trees, class or entity diagrams, and simple pie charts. Write valid Mermaid with no init directives, styling, click handlers, or HTML; put every flowchart node and edge label in double quotes, such as A["H(x) = 1"]; and write math in flowchart labels as TeX between $$ and $$ inside the quoted label, such as A["Run $$D_H$$ on $$r \\circ z$$"]; in other Mermaid diagrams write math as plain Unicode such as θ, x², or ≤. Use kind svg for drawings where position matters: geometry, force diagrams, circuits, graphs of specific points, and labelled sketches. Write one self-contained <svg> element with a viewBox, at most 20,000 characters, with no scripts, images, links, fonts, or external references; label with <text> using plain Unicode math. Work out the geometry before writing coordinates: derive every point from it so objects rest on the surfaces they touch, angles match their labels, and each arrow points in the direction the text states, such as along or perpendicular to a slope. For SVG colors use only ${DIAGRAM_COLORS.join(", ")}, or none, as fill and stroke values; they follow the reader's light or dark theme. Never rely on color alone. alt describes in one to three sentences everything a student needs from the figure, because the tutor only sees alt; write math in it as \\(…\\), as in the rest of the text.`;

// When a figure earns its place, shared by every prompt that may draw.
const DIAGRAM_TEST = "Draw a figure only when the idea is spatial or has enough interlocking parts that words alone would make the student sketch it themselves to follow: a geometric configuration, a free-body diagram, a circuit, a graph's shape, or a process with branches or a cycle. If a sentence or two says it just as well, such as a short chain of steps, a two-way comparison, a single relationship, a list, or a definition, write the sentence and leave the diagram null. When in doubt, leave it out.";

// Instructions for a chat reply's optional figure. Chats may always draw, but only when asked or when a figure clearly helps.
export function chatDiagramInstructions(secret = "") {
  return `diagram is null unless the student asks for a figure or one passes this test. ${DIAGRAM_TEST} When you draw one, the reply must still make sense without it. ${secret} ${DIAGRAM_RULES}`;
}

// Instructions for a generation prompt's figures: "asked" when the student asked for them, "judged" when the model decides
// (problems), and "none" when they are off.
export function diagramInstructions(mode: "asked" | "judged" | "none", fields: string, secret: string) {
  if (mode === "none") return `Set ${fields} to null.`;
  if (mode === "judged") return `${fields} are optional diagrams; set them to null unless a figure is part of the problem, such as a configuration the question refers to, or passes this test. ${DIAGRAM_TEST} Most problems need none. The text must still make sense without the figure. ${secret} ${DIAGRAM_RULES}`;
  return `${fields} are diagrams. The student allows figures, but most cards still need none. ${DIAGRAM_TEST} The text must still make sense without the figure. ${secret} ${DIAGRAM_RULES}`;
}
