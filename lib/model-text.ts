// Models sometimes JSON-escape their text twice, so a string arrives holding
// `\\in` and a literal `\n` instead of `\in` and a line break. Unescape once
// when TeX commands or math delimiters such as `\\(` appear only in doubled form.
const doubledCommand = /\\\\[a-zA-Z()[\]]/;
const singleCommand = /(?<!\\)\\(?![nt\\"])[a-zA-Z({[]/;

export function undoDoubleEscaping(text: string) {
  if (!doubledCommand.test(text) || singleCommand.test(text)) return text;
  try {
    return JSON.parse(`"${text.replace(/\n/g, "\\n").replace(/(?<!\\)((?:\\\\)*)"/g, '$1\\"')}"`) as string;
  } catch {
    return text;
  }
}

// Applies undoDoubleEscaping to every string inside a model's JSON reply.
export function undoDoubleEscapingDeep<T>(value: T): T {
  if (typeof value === "string") return undoDoubleEscaping(value) as T;
  if (Array.isArray(value)) return value.map(undoDoubleEscapingDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, undoDoubleEscapingDeep(item)])) as T;
  return value;
}
