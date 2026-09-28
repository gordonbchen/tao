// TeX spans in the delimiters MathJax is configured for: \[...\], $$...$$, \(...\), $...$.
const mathSpan = /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$[^$\n]+?\$/g;

// Markdown treats a backslash before punctuation as an escape and * or _ as emphasis, which
// mangles TeX such as \{0, 1\} or a_1 b_2. Backslash-escaping every ASCII punctuation character
// inside math spans makes Markdown emit the span exactly as written, for MathJax to typeset.
export function protectMathFromMarkdown(text: string) {
  return text.replace(mathSpan, (span) => span.replace(/[!-/:-@[-`{-~]/g, "\\$&"));
}
