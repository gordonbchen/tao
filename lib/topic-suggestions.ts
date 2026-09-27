export function suggestTopics(text: string, filename: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const generic = /^(definitions?|theorems?|propositions?|examples?|proofs?|some results):?$/i;
  const headings = lines.filter((line) => {
    if (generic.test(line) || /^(proposition|theorem|definition|example):/i.test(line) || line.length > 100) return false;
    if (/^(#{1,6}\s|\d+(\.\d+)*[.)]?\s|chapter\s|section\s)/i.test(line)) return true;
    if (line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
    return line.length <= 80 && line.split(/\s+/).length <= 8 && /^[A-Z]/.test(line)
      && !/[.!?;:]$/.test(line) && !/[•=∼→{}]/.test(line) && !/^[-–]/.test(line);
  });
  const names = [...new Set(headings.map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^\d+(\.\d+)*[.)]?\s*/, "").trim()))].filter(Boolean).slice(0, 30);
  if (names.length || !text.trim()) return names;
  const basename = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return basename ? [basename.slice(0, 100)] : [];
}
