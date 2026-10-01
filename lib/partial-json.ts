// The objects already complete in the array under `key` of a JSON text that is still being written, such as a model's
// streamed output. Later, unfinished elements are left out; an element that is complete but invalid JSON becomes null.
export function completeArrayItems(text: string, key: string): unknown[] {
  const keyAt = text.indexOf(JSON.stringify(key));
  const open = keyAt < 0 ? -1 : text.indexOf("[", keyAt);
  if (open < 0) return [];
  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === "{" || char === "[") { if (depth++ === 0) start = index; }
    else if (char === "}" || char === "]") {
      if (depth === 0) break; // The array itself closed.
      if (--depth === 0) {
        try { items.push(JSON.parse(text.slice(start, index + 1))); } catch { items.push(null); }
      }
    }
  }
  return items;
}
