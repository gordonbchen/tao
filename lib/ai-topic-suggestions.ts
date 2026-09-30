import { generateStructuredText, type AiOptions } from "@/lib/ai";
import { parsePlacements, pathsBesideTopics, type Outline } from "@/lib/topic-tree";

function distributedExtract(text: string) {
  if (text.length <= 32_000) return text;
  const width = 7_000;
  const positions = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.floor((text.length - width) * fraction));
  return positions.map((start, index) => `Excerpt ${index + 1}:\n${text.slice(start, start + width)}`).join("\n\n");
}

const TREE_FORMAT = "The tree is a nested list: a string is a topic, and an object is a folder with its contents. A path lists folder names from the top level down; an empty path means the top level.";

// Suggests topics taught in a resource, each placed in the subject's existing folder tree.
export async function suggestTopicsWithAi(filename: string, extractedText: string, tree: Outline[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_placements",
    `Identify specific study topics actually taught in this course resource. Infer them from the definitions, theorems, examples, and worked material, not only from headings. Suggest 3 to 12 concise topic names at the granularity a student would practice separately. Exclude generic labels such as 'Definitions', 'Chapter 1', and the document title unless it names a real concept. Do not add topics that the excerpts do not support. If an existing topic describes the same material, use its exact name and current path so the student can link this resource to it.
Place each new topic where it fits best in the student's existing topic tree. ${TREE_FORMAT} Reuse existing folder names exactly. Topics cannot contain other topics, so never name a folder after an existing topic; a new topic related to an existing one goes beside it. When several new topics belong together and no folder fits, create a new folder for them, inside an existing folder when that fits. Spread topics across folders by subject matter; do not create a folder for a single topic unless the tree already uses folders at that level, and nest at most four levels. Return JSON with a topics array of objects with name and path.`,
    JSON.stringify({ filename, existingTree: tree, extractedText: distributedExtract(extractedText) }),
    options,
  );
  return pathsBesideTopics(parsePlacements(value, 12), tree);
}

// Proposes a folder tree for every existing topic. The student reviews it before anything moves.
export async function organizeTopicsWithAi(subject: string, tree: Outline[], options: AiOptions = {}) {
  const { value } = await generateStructuredText(
    "topic_placements",
    `Organize a student's course topics into a clear folder tree, the way a well-structured course outline groups its material. ${TREE_FORMAT} Return every topic in the current tree exactly once, with its exact name and its new path. Do not rename, merge, split, or invent topics. Group closely related topics into folders with short, specific names; keep existing folders and names when they already work. A folder should hold at least two items. Nest folders only where it clarifies the structure, at most three levels deep. Leave a topic at the top level when no folder fits. Return JSON with a topics array of objects with name and path.`,
    JSON.stringify({ subject, currentTree: tree }),
    options,
  );
  return parsePlacements(value, 500);
}
