import { generateStructuredText, type AiOptions } from "@/lib/ai";

function distributedExtract(text: string) {
  if (text.length <= 32_000) return text;
  const width = 7_000;
  const positions = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.floor((text.length - width) * fraction));
  return positions.map((start, index) => `Excerpt ${index + 1}:\n${text.slice(start, start + width)}`).join("\n\n");
}

export async function suggestTopicsWithAi(filename: string, extractedText: string, existingTopics: string[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_suggestions",
    "Identify specific study topics actually taught in this course resource. Infer them from the definitions, theorems, examples, and worked material, not only from headings. Suggest 3 to 12 concise topic names at the granularity a student would practice separately. Exclude generic labels such as 'Definitions', 'Chapter 1', and the document title unless it names a real concept. Do not add topics that the excerpts do not support. If an existing topic name describes the same material, use that name so the student can link this resource to it. Return JSON with a topics array of strings only.",
    JSON.stringify({ filename, existingTopics, extractedText: distributedExtract(extractedText) }),
    options,
  );
  const raw = value && typeof value === "object" && "topics" in value ? (value as { topics: unknown }).topics : null;
  if (!Array.isArray(raw)) throw new Error("AI returned invalid topic suggestions");
  const names = raw.filter((name): name is string => typeof name === "string")
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => name.length > 1 && name.length <= 160);
  return [...new Map(names.map((name) => [name.toLocaleLowerCase(), name])).values()].slice(0, 12);
}
