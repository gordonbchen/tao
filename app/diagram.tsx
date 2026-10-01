"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DIAGRAM_COLORS, plainAlt, quoteMermaidLabels, spaceMermaidMath, themedSvgUrl, type Diagram as DiagramData } from "@/lib/diagrams";
import { Maximize2 } from "lucide-react";
import { MathText } from "./math-text";
import { cn, Modal } from "./ui";

// The theme toggle sets data-theme on <html>; diagrams redraw with the new token colors.
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const useTheme = () => useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme ?? "light", () => "light");

function tokenColors(names: readonly string[]) {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

let mermaidCount = 0;

// A generated figure. SVG is shown as an image, so nothing inside it can run; Mermaid renders in strict mode.
// When a figure cannot be drawn, its description is shown instead. The description may hold TeX: it is typeset where
// it is shown and read without delimiters by screen readers. Clicking a figure opens it at full screen size.
export function Diagram({ diagram, className }: { diagram: DiagramData; className?: string }) {
  const [enlarged, setEnlarged] = useState(false);
  return <>
    <button type="button" aria-label={`Enlarge figure: ${plainAlt(diagram.alt)}`} title="Enlarge figure" className={cn("group relative block w-full cursor-zoom-in rounded-md", className)} onClick={() => setEnlarged(true)}>
      <Figure diagram={diagram} />
      <Maximize2 size={16} aria-hidden className="absolute top-2 right-2 text-muted pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
    {enlarged && <Modal title="Figure" subtitle={<MathText as="span" text={diagram.alt} />} wide onClose={() => setEnlarged(false)}><Figure diagram={diagram} large /></Modal>}
  </>;
}

function Figure({ diagram, large }: { diagram: DiagramData; large?: boolean }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const svgUrl = useMemo(() => diagram.kind === "svg" && typeof document !== "undefined" && theme
    ? themedSvgUrl(diagram.source, tokenColors(DIAGRAM_COLORS)) : null, [diagram, theme]);

  useEffect(() => {
    const element = ref.current;
    if (diagram.kind !== "mermaid" || !element) return;
    let active = true;
    void (async () => {
      const { default: mermaid } = await import("mermaid");
      const colors = tokenColors(["ink", "muted", "line", "paper", "surface", "subtle", "accent", "accent-soft"]);
      mermaid.initialize({
        startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: '"Libertinus Serif", Georgia, serif',
        themeVariables: {
          fontSize: "16px", background: colors.paper, textColor: colors.ink, lineColor: colors.muted,
          primaryColor: colors["accent-soft"], primaryTextColor: colors.ink, primaryBorderColor: colors.accent,
          secondaryColor: colors.subtle, tertiaryColor: colors.surface, noteBkgColor: colors.subtle, noteTextColor: colors.ink,
        },
      });
      // Unquoted labels with parentheses are the usual parse failure in generated flowcharts.
      const written = spaceMermaidMath(diagram.source);
      const source = await mermaid.parse(written).then(() => written, async (error) => {
        const quoted = quoteMermaidLabels(written);
        if (quoted === written) throw error;
        await mermaid.parse(quoted);
        return quoted;
      });
      // Mermaid sizes each box from its label, so the math font must be ready first. Without it the math still draws.
      if (/\$\$/.test(source)) await document.fonts.load('16px "Libertinus Math"', "\u{1D465}").catch(() => undefined);
      const { svg } = await mermaid.render(`tao-diagram-${++mermaidCount}`, source);
      if (active) { element.innerHTML = svg; setFailed(false); }
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [diagram, theme]);

  if (failed) return <MathText as="span" className="block text-left text-sm text-muted" text={`The figure couldn’t be drawn. It shows: ${diagram.alt}`} />;
  return <span className={cn("diagram block", large && "diagram-large")}>
    {diagram.kind === "svg"
      // A data URL built on the client; next/image has nothing to optimize.
      // eslint-disable-next-line @next/next/no-img-element
      ? svgUrl && <img src={svgUrl} alt={plainAlt(diagram.alt)} onError={() => setFailed(true)} />
      : <span ref={ref} role="img" aria-label={plainAlt(diagram.alt)} className="block" />}
  </span>;
}
