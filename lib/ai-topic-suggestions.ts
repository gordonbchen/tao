import { generateStructuredText, type AiOptions } from "@/lib/ai";
import { parsePlacements, parseTopicNames, pathsBesideTopics, type Outline } from "@/lib/topic-tree";

function distributedExtract(text: string) {
  if (text.length <= 32_000) return text;
  const width = 7_000;
  const positions = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.floor((text.length - width) * fraction));
  return positions.map((start, index) => `Excerpt ${index + 1}:\n${text.slice(start, start + width)}`).join("\n\n");
}

// Suggests topics taught in a resource. New ones are added as unorganized topics, so they need no place in the tree.
export async function suggestTopicsWithAi(filename: string, extractedText: string, existingTopics: string[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_names",
    "Identify specific study topics actually taught in this course resource. Infer them from the definitions, theorems, examples, and worked material, not only from headings. Suggest 3 to 12 concise topic names at the granularity a student would practice separately. Exclude generic labels such as 'Definitions', 'Chapter 1', and the document title unless it names a real concept. Do not add topics that the excerpts do not support. If an existing topic describes the same material, use its exact name so the student can link this resource to it. Return JSON with a topics array of topic names.",
    JSON.stringify({ filename, existingTopics, extractedText: distributedExtract(extractedText) }),
    options,
  );
  return parseTopicNames(value, 12);
}

// Proposes a place in the existing folder tree for each unorganized topic. The student reviews it before anything moves.
export async function organizeTopicsWithAi(subject: string, tree: Outline[], unorganized: { name: string; about: string }[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_placements",
    `Place a student's unorganized course topics into their existing folder tree, the way a well-structured course outline groups its material. The tree is a nested list: a string is a topic, and an object is a folder with its contents. A path lists folder names from the top level down; an empty path means the top level. The existing tree stays as it is. Return every unorganized topic exactly once, with its exact name and its path, and nothing else. Do not rename, merge, split, or invent topics. Reuse existing folder names exactly where a topic fits. When several unorganized topics belong together and no folder fits, create a folder for them with a short, specific name, inside an existing folder when that fits. Topics cannot contain other topics, so never name a folder after an existing topic. Do not create a folder for a single topic unless the tree already uses folders at that level, and nest at most four levels. Leave a topic at the top level when no folder fits. Return JSON with a topics array of objects with name and path.`,
    JSON.stringify({ subject, currentTree: tree, unorganizedTopics: unorganized }),
    options,
  );
  return pathsBesideTopics(parsePlacements(value, 500), tree);
}
