const PASSAGE = 3000;
const TEXT_BUDGET = 24_000;

// Short text is sent whole. Longer text is cut into passages, and the opening passage plus those sharing the most
// words with the conversation are sent, in document order.
export function relevantPassages(text: string, question: string, budget = TEXT_BUDGET) {
  if (text.length <= budget) return text;
  const words = new Set(question.toLowerCase().match(/\p{L}[\p{L}\p{N}]{3,}/gu) ?? []);
  const passages = Array.from({ length: Math.ceil(text.length / PASSAGE) }, (_, i) => text.slice(i * PASSAGE, (i + 1) * PASSAGE));
  const score = (passage: string) => (passage.toLowerCase().match(/\p{L}[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => words.has(word)).length;
  const ranked = passages.map((passage, index) => ({ index, score: index === 0 ? Infinity : score(passage) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = ranked.slice(0, Math.floor(budget / PASSAGE)).map((item) => item.index).sort((a, b) => a - b);
  return chosen.map((index) => passages[index]).join("\n[…]\n");
}

// The newest messages of a conversation, at most `count` of them and about `budget` characters in total,
// so a few long replies cannot make every later request expensive. The newest message is always kept, cut to the budget.
export function recentMessages<T extends { text: string }>(messages: T[], count = 12, budget = 20_000) {
  const kept: T[] = [];
  let used = 0;
  for (const message of messages.slice(-count).reverse()) {
    if (kept.length && used + message.text.length > budget) break;
    kept.unshift({ ...message, text: message.text.slice(0, budget) });
    used += message.text.length;
  }
  return kept;
}

// The latest summary of a chat and the messages after it; a summary stands in for everything before it.
export function sinceSummary<T extends { role: string; text: string }>(messages: T[]) {
  const last = messages.findLastIndex((message) => message.role === "summary");
  return { summary: last < 0 ? undefined : messages[last].text, messages: messages.slice(last + 1) };
}

const words = (text: string) => new Set(text.toLowerCase().match(/\p{L}[\p{L}\p{N}]{3,}/gu) ?? []);

// The items whose names share the most words with the conversation, best first; none when nothing matches.
export function mentionedItems<T extends { name: string }>(items: T[], question: string, limit: number) {
  const asked = words(question);
  return items.map((item) => ({ item, score: [...words(item.name)].filter((word) => asked.has(word)).length }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.item);
}
