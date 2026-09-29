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

const DIAGRAM_RULES = `Use kind mermaid for structure: flowcharts, cycles, sequences, state machines, timelines, mind maps, trees, class or entity diagrams, and simple pie charts. Write valid Mermaid with no init directives, styling, click handlers, or HTML, and write any math in labels as plain Unicode such as θ, x², or ≤. Use kind svg for drawings where position matters: geometry, force diagrams, circuits, graphs of specific points, and labelled sketches. Write one self-contained <svg> element with a viewBox, at most 20,000 characters, with no scripts, images, links, fonts, or external references; label with <text> using plain Unicode math. Work out the geometry before writing coordinates: derive every point from it so objects rest on the surfaces they touch, angles match their labels, and each arrow points in the direction the text states, such as along or perpendicular to a slope. For SVG colors use only ${DIAGRAM_COLORS.join(", ")}, or none, as fill and stroke values; they follow the reader's light or dark theme. Never rely on color alone. alt describes in one to three sentences everything a student needs from the figure, because the tutor only sees alt.`;

// Instructions for a generation prompt, depending on the subject's diagram setting.
export function diagramInstructions(enabled: boolean, fields: string, secret: string) {
  if (!enabled) return `Set ${fields} to null.`;
  return `${fields} are diagrams. The student has asked for figures, so draw one wherever a figure is the natural way to show or check the idea: a free-body diagram, a cycle or process, a timeline, a geometric configuration, a circuit, a labelled structure, a comparison. Set it to null only when a figure would add nothing, such as for a bare definition, date, or word. The text must still make sense without the figure. ${secret} ${DIAGRAM_RULES}`;
}
