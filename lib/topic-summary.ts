import { generateStructuredText, type AiOptions } from "@/lib/ai";

type TopicSource = { filename: string; summary: string; extractedText: string };

function selectRelevantText(topicName: string, text: string, limit: number) {
  const blocks = text.split(/\n+/).map((block) => block.trim()).filter(Boolean).flatMap((block) => {
    if (block.length <= 1_200) return [block];
    const chunks: string[] = [];
    for (let start = 0; start < block.length;) {
      let end = Math.min(start + 1_200, block.length);
      const boundary = block.lastIndexOf(" ", end);
      if (end < block.length && boundary > start + 700) end = boundary;
      chunks.push(block.slice(start, end));
      start = end;
    }
    return chunks;
  });
  if (text.length <= limit) return text;
  const terms = topicName.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2 && !["the", "and", "for", "from", "with"].includes(term));
  const phrase = topicName.toLocaleLowerCase().trim();
  const ranked = blocks.map((block, index) => {
    const lower = block.toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 + (lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0) : 0), 0)
      + (phrase.length > 3 && lower.includes(phrase) ? 5 : 0);
    return { block, index, score };
  });
  let selected = ranked.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  if (!selected.length) {
    // If the material uses different wording, sample across the whole source instead of only its opening.
    const step = Math.max(1, Math.floor(blocks.length / Math.max(1, Math.ceil(limit / 700))));
    selected = ranked.filter((item) => item.index % step === 0);
  }
  const keep = new Set<number>();
  let used = 0;
  for (const item of selected) {
    const block = item.block.slice(0, Math.max(0, limit - used));
    if (!block) break;
    keep.add(item.index);
    used += block.length + 2;
    if (used >= limit) break;
  }
  return [...keep].sort((a, b) => a - b).map((index) => blocks[index]).join("\n\n").slice(0, limit);
}

export async function summarizeTopic(topicName: string, sources: TopicSource[], options?: AiOptions) {
  const perSourceLimit = Math.min(8_000, Math.max(1, Math.floor(40_000 / sources.length)));
  const context = sources.map((source) => {
    const text = source.summary.trim() || source.extractedText.trim();
    return { filename: source.filename, content: selectRelevantText(topicName, text, perSourceLimit) };
  }).filter((source) => source.content);
  if (!context.length) throw new Error("Attach a resource with readable text before creating a topic summary.");

  const { value, provider, model } = await generateStructuredText(
    "topic_summary",
    "Write an accurate, concise coverage summary for a student's course topic using only the linked source material. Include the definitions, results, assumptions, methods, notation, and representative examples that are relevant to this topic. Omit unrelated material. Do not add facts or claim the course covered anything absent from the sources. Preserve mathematical notation with \\( ... \\) inline and \\[ ... \\] for display. Return JSON with one string property named summary.",
    JSON.stringify({ topic: topicName, linkedSources: context }),
    options,
  );
  if (!value || typeof value !== "object" || typeof (value as { summary?: unknown }).summary !== "string") {
    throw new Error("AI response did not contain a topic summary");
  }
  const summary = (value as { summary: string }).summary.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, 16_000);
  if (!summary) throw new Error("AI returned an empty topic summary");
  return { summary, provider, model };
}
