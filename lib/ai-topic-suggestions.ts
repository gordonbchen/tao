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

// Proposes merging overlapping topics drawn from one course file (or from none), renaming unclear ones, and removing
// ones that are not course material. The student reviews each change before anything happens.
export async function cleanupTopicsWithAi(subject: string, file: { name: string; words: number; summary: string } | null, topics: { name: string; about: string; folder: string; otherFiles: string[] }[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_cleanup",
    `Tidy a student's course topics so each one is a distinct idea worth studying separately, as in a well-made course outline. ${file ? "These are all the topics the student has drawn from one course file, given with its summary and length; some also draw on other files. Topics were suggested one file at a time, so they often overlap or slice one short file too thinly: one lecture's slides rarely hold more than three to six ideas that deserve their own topic." : "These topics are linked to no course file, so judge them by their names and descriptions."} Propose only clear improvements: merge topics that cover largely the same material, or that are too small to study apart from each other, into one topic with a concise, specific name (which may be one of theirs); rename a topic whose name is vague or misleading; remove a topic that is not course content, such as course logistics or study advice. Keep genuinely different ideas apart, and do not split topics. Use each topic's exact name, include each topic in at most one change, and leave topics that are fine out entirely; return no changes if they are already clean. Give each change a one-sentence reason a student would find convincing. Return JSON with a changes array of objects with action (merge, rename, or remove), topics (exact names), name (the new name; empty for remove), and reason.`,
    JSON.stringify({ subject, file, topics }),
    options,
  );
  return value;
}
