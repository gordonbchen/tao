function normalizePrompt(prompt: string) {
  return prompt.normalize("NFKC").toLowerCase()
    .replace(/\\(?:left|right|displaystyle|textstyle|,|;|!|quad|qquad|\(|\)|\[|\])/g, " ")
    .replace(/\\([a-z]+)/g, "$1")
    .replace(/\d+(?:\.\d+)?/g, " number ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ");
}

function trigrams(value: string) {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index += 1) result.add(value.slice(index, index + 3));
  return result;
}

export function isNearDuplicatePrompt(candidate: string, recentPrompts: string[]) {
  const normalizedCandidate = normalizePrompt(candidate);
  if (!normalizedCandidate) return false;
  const candidateShingles = trigrams(normalizedCandidate);
  return recentPrompts.some((prompt) => {
    const normalizedRecent = normalizePrompt(prompt);
    if (!normalizedRecent) return false;
    if (normalizedCandidate === normalizedRecent) return true;
    if (Math.min(normalizedCandidate.length, normalizedRecent.length) < 48) return false;
    const candidateWords = new Set(normalizedCandidate.split(" "));
    const recentWords = new Set(normalizedRecent.split(" "));
    if (Math.min(candidateWords.size, recentWords.size) >= 8) {
      let sharedWords = 0;
      for (const word of candidateWords) if (recentWords.has(word)) sharedWords += 1;
      const wordContainment = sharedWords / Math.min(candidateWords.size, recentWords.size);
      const wordSizeRatio = Math.min(candidateWords.size, recentWords.size) / Math.max(candidateWords.size, recentWords.size);
      if (wordContainment >= 0.9 && wordSizeRatio >= 0.78) return true;
    }
    const recentShingles = trigrams(normalizedRecent);
    let overlap = 0;
    for (const shingle of candidateShingles) if (recentShingles.has(shingle)) overlap += 1;
    const union = candidateShingles.size + recentShingles.size - overlap;
    const jaccard = overlap / union;
    const containment = overlap / Math.min(candidateShingles.size, recentShingles.size);
    return jaccard >= 0.88 || (containment >= 0.96 && Math.min(normalizedCandidate.length, normalizedRecent.length) / Math.max(normalizedCandidate.length, normalizedRecent.length) >= 0.8);
  });
}
