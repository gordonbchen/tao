import { briefFrom, generateStructuredText, type AiOptions, type AiProvider } from "@/lib/ai";

function splitText(text: string, maxChars = 18_000) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const paragraphEnd = text.lastIndexOf("\n", end);
      if (paragraphEnd > start + Math.floor(maxChars * 0.6)) end = paragraphEnd + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export async function summarizeResource(filename: string, extractedText: string, options?: AiOptions) {
  const chunks = splitText(extractedText);
  const summaries: string[] = [];
  const briefs: string[] = [];
  let provider: AiProvider | undefined;
  let model: string | undefined;
  for (let start = 0; start < chunks.length; start += 2) {
    const batch = chunks.slice(start, start + 2);
    const results = await Promise.all(batch.map(async (chunk, offset) => {
      const part = start + offset + 1;
      const { value, provider: usedProvider, model: usedModel } = await generateStructuredText(
        "resource_summary",
        "Summarize this section of a course resource for a student. Preserve the important definitions, claims, methods, assumptions, examples, notation, and scope limits in this section. Be concise but cover all examinable information. Organize the result with a short heading and bullets. Preserve math using \\(...\\) inline and \\[...\\] for display. Do not add outside facts. Keep this section summary under about 2,500 characters. Also write a brief: one plain-text sentence under 200 characters naming the main concepts this section teaches, used to match it with course topics. Return JSON with string properties summary and brief.",
        JSON.stringify({ filename, part, totalParts: chunks.length, extractedText: chunk }),
        options,
      );
      if (!value || typeof value !== "object" || typeof (value as { summary?: unknown }).summary !== "string") {
        throw new Error("AI response did not contain a resource summary");
      }
      if (!provider) { provider = usedProvider; model = usedModel; }
      return { summary: (value as { summary: string }).summary.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, 3500), brief: briefFrom(value, 250) };
    }));
    summaries.push(...results.map((result) => result.summary));
    briefs.push(...results.map((result) => result.brief).filter(Boolean));
  }
  // Each section summary starts with its own heading.
  const summary = summaries.join("\n\n").slice(0, 45_000);
  if (!summary) throw new Error("AI returned an empty resource summary");
  return { summary, brief: briefs.join(" ").slice(0, 3000), provider: provider!, model: model! };
}
