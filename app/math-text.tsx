"use client";

import { useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { protectMathFromMarkdown } from "@/lib/markdown-math";

type MathJaxApi = {
  typeset: (elements: HTMLElement[]) => void;
  typesetPromise: (elements: HTMLElement[]) => Promise<void>;
  typesetClear: (elements: HTMLElement[]) => void;
  tex2svgPromise: (tex: string) => Promise<unknown>;
  startup: { promise: Promise<void> };
};

declare global {
  interface Window { MathJax?: Partial<MathJaxApi> & Record<string, unknown> }
}

let loading: Promise<MathJaxApi> | undefined;
// Set once MathJax has started, so later text can be typeset before it is painted.
let loaded: MathJaxApi | undefined;
// Common notation whose font pieces MathJax loads on first use. Typesetting it once at startup loads them, so the
// first real typeset can usually finish synchronously.
const warmUp = String.raw`\alpha\Omega\mathbb{R}\mathcal{A}\mathscr{F}\mathfrak{g}\mathbf{b}\boldsymbol{\epsilon}\mathsf{A}\mathtt{x}\mathrm{d}
  \to\Rightarrow\leftarrow\mapsto\leftrightarrow\approx\neq\le\ge\in\subseteq\oplus\otimes\cdot\times\{\}\langle\rangle\|\lfloor\rceil
  \sum\int\prod\bigcup\sqrt{x}\frac12\hat{x}\tilde{x}\bar{x}\vec{x}\binom{n}{k}\left(\right)\ldots\infty\forall\exists\neg\wedge\vee`;

// Loads MathJax once. The app starts this early so math is usually typeset before it is first shown.
export function loadMathJax(): Promise<MathJaxApi> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.MathJax = {
      tex: {
        inlineMath: [["\\(", "\\)"], ["$", "$"]],
        displayMath: [["\\[", "\\]"], ["$$", "$$"]],
      },
      svg: { fontCache: "global" },
      output: { fontPath: "/mathjax-font" },
    };
    const script = document.createElement("script");
    script.src = "/mathjax/tex-svg.js";
    script.async = true;
    script.onload = () => {
      const mathjax = window.MathJax;
      if (!mathjax?.startup?.promise || !mathjax.typeset || !mathjax.tex2svgPromise || !mathjax.typesetPromise || !mathjax.typesetClear) return reject(new Error("MathJax did not initialize"));
      mathjax.startup.promise.then(() => {
        loaded = mathjax as MathJaxApi;
        loaded.tex2svgPromise(warmUp).catch(() => undefined);
        resolve(loaded);
      }, reject);
    };
    script.onerror = () => reject(new Error("MathJax could not load"));
    document.head.append(script);
  });
  return loading;
}

// Typesets `element` before the browser paints it when MathJax is ready and needs nothing more to load; otherwise
// once it is, which moves the text as the math takes its size. `prepare` resets the element before either attempt.
function typeset(element: HTMLElement, prepare: (mathjax: MathJaxApi) => void, fallback: () => void) {
  let active = true;
  const later = () => void loadMathJax().then(async (mathjax) => {
    if (!active) return;
    prepare(mathjax);
    await mathjax.typesetPromise([element]);
  }).catch(() => { if (active) fallback(); });
  if (loaded) {
    // A synchronous typeset throws when it has to wait for a font file; the asynchronous one then finishes it.
    try { prepare(loaded); loaded.typeset([element]); } catch { later(); }
  } else later();
  return () => { active = false; window.MathJax?.typesetClear?.([element]); };
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // MathJax replaces source text with rendered output. Clear that output before putting the latest text back.
    // If MathJax cannot load or parse it, the original text stays visible.
    return typeset(element, (mathjax) => { mathjax.typesetClear([element]); element.textContent = text; }, () => { element.textContent = text; });
  }, [text]);
  return <div ref={ref} className={className}>{text}</div>;
}

export function MarkdownMathText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return typeset(element, () => {}, () => {});
  }, [text]);
  const markdown = protectMathFromMarkdown(text);
  return <div ref={ref} className={["markdown", className].filter(Boolean).join(" ")}><ReactMarkdown key={text}>{markdown}</ReactMarkdown></div>;
}
