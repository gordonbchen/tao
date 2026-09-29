"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DIAGRAM_COLORS, themedSvgUrl, type Diagram as DiagramData } from "@/lib/diagrams";
import { cn } from "./ui";

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
// When a figure cannot be drawn, its description is shown instead.
export function Diagram({ diagram, className }: { diagram: DiagramData; className?: string }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
      await mermaid.parse(diagram.source);
      const { svg } = await mermaid.render(`tao-diagram-${++mermaidCount}`, diagram.source);
      if (active) { element.innerHTML = svg; setFailed(false); }
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [diagram, theme]);

  if (failed) return <p className={cn("text-sm text-muted", className)}>The figure couldn’t be drawn. It shows: {diagram.alt}</p>;
  return <figure className={cn("diagram", className)}>
    {diagram.kind === "svg"
      // A data URL built on the client; next/image has nothing to optimize.
      // eslint-disable-next-line @next/next/no-img-element
      ? svgUrl && <img src={svgUrl} alt={diagram.alt} onError={() => setFailed(true)} />
      : <div ref={ref} role="img" aria-label={diagram.alt} />}
  </figure>;
}
