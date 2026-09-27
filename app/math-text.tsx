"use client";

import { useEffect, useRef } from "react";

type MathJaxApi = {
  typesetPromise: (elements: HTMLElement[]) => Promise<void>;
  typesetClear: (elements: HTMLElement[]) => void;
  startup: { promise: Promise<void> };
};

declare global {
  interface Window { MathJax?: Partial<MathJaxApi> & Record<string, unknown> }
}

let loading: Promise<MathJaxApi> | undefined;

function loadMathJax(): Promise<MathJaxApi> {
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
      if (!mathjax?.startup?.promise || !mathjax.typesetPromise || !mathjax.typesetClear) return reject(new Error("MathJax did not initialize"));
      mathjax.startup.promise.then(() => resolve(mathjax as MathJaxApi), reject);
    };
    script.onerror = () => reject(new Error("MathJax could not load"));
    document.head.append(script);
  });
  return loading;
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    window.MathJax?.typesetClear?.([element]);
    element.textContent = text;
    void loadMathJax().then((mathjax) => {
      if (active) return mathjax.typesetPromise([element]);
    }).catch(() => {});
    return () => { active = false; window.MathJax?.typesetClear?.([element]); };
  }, [text]);
  return <div ref={ref} className={className}>{text}</div>;
}
